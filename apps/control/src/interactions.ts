import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import type { Approval, AskOption, QuestionMode, UserAnswer, UserQuestion } from "@pi-local/protocol";
import { normalizeOptions, validateQuestionAnswers } from "@pi-local/protocol";
import { EventBus } from "./events.js";
import { FirebaseNotifier } from "./firebase.js";
import { StateStore } from "./store.js";

interface BrokerWireRequest {
  type: "ask_user_question";
  requestId?: string;
  sessionId: string;
  question: string;
  details?: string;
  mode: QuestionMode;
  options?: Array<{ label: string; value?: string; description?: string }>;
  allowOther?: boolean;
  sourceName?: string;
}

type QuestionResolver = (result: { status: "answered" | "cancelled" | "unavailable"; answers: UserAnswer[]; message?: string }) => void;
type ApprovalResolver = (confirmed: boolean) => void;

export class InteractionBroker {
  private socketServer?: Server;
  private readonly questionResolvers = new Map<string, QuestionResolver>();
  private readonly approvalResolvers = new Map<string, ApprovalResolver>();

  constructor(
    private readonly store: StateStore,
    private readonly events: EventBus,
    private readonly notifier: FirebaseNotifier,
  ) {}

  async listen(socketPath: string): Promise<void> {
    if (existsSync(socketPath)) unlinkSync(socketPath);
    this.socketServer = createServer((socket) => this.handleSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.socketServer!.once("error", reject);
      this.socketServer!.listen(socketPath, () => resolve());
    });
  }

  async close(): Promise<void> {
    if (!this.socketServer) return;
    await new Promise<void>((resolve) => this.socketServer!.close(() => resolve()));
    this.socketServer = undefined;
  }

  createQuestion(
    input: Omit<UserQuestion, "id" | "status" | "answers" | "createdAt">,
    resolver?: QuestionResolver,
  ): UserQuestion {
    const question: UserQuestion = {
      ...input,
      id: randomUUID(),
      status: "pending",
      answers: [],
      createdAt: new Date().toISOString(),
    };
    this.store.createQuestion(question);
    if (resolver) this.questionResolvers.set(question.id, resolver);
    const event = this.events.publish("user_question.created", question, question.sessionId);
    void this.notifier.send(String(event.seq));
    return question;
  }

  createExtensionQuestion(args: {
    sessionId: string;
    externalRequestId: string;
    question: string;
    details?: string;
    mode: QuestionMode;
    options?: AskOption[];
    allowOther?: boolean;
    responder: (response: { value?: string; cancelled?: true }) => void;
  }): UserQuestion {
    return this.createQuestion({
      sessionId: args.sessionId,
      source: { kind: "extension" },
      question: args.question,
      details: args.details,
      mode: args.mode,
      options: args.options ?? [],
      allowOther: args.allowOther ?? false,
      externalRequestId: args.externalRequestId,
    }, (result) => {
      if (result.status !== "answered") return args.responder({ cancelled: true });
      const answer = result.answers[0];
      args.responder({ value: answer?.value ?? answer?.label ?? "" });
    });
  }

  createApproval(args: {
    sessionId: string;
    externalRequestId: string;
    title: string;
    message: string;
    responder: ApprovalResolver;
  }): Approval {
    const approval: Approval = {
      id: randomUUID(), sessionId: args.sessionId, externalRequestId: args.externalRequestId,
      title: args.title, message: args.message, status: "pending", createdAt: new Date().toISOString(),
    };
    this.store.createApproval(approval);
    this.approvalResolvers.set(approval.id, args.responder);
    const event = this.events.publish("approval.created", approval, approval.sessionId);
    void this.notifier.send(String(event.seq));
    return approval;
  }

  answerQuestion(id: string, answers: UserAnswer[]): UserQuestion {
    const question = this.store.question(id);
    if (!question) throw Object.assign(new Error("Question not found"), { statusCode: 404 });
    const first = this.store.firstPendingQuestion(question.sessionId);
    if (first && first.id !== id) throw Object.assign(new Error("An earlier question in this session must be answered first"), { statusCode: 409 });
    const error = validateQuestionAnswers(question, answers);
    if (error) throw Object.assign(new Error(error), { statusCode: 409 });
    if (!this.store.resolveQuestion(id, "answered", answers)) {
      throw Object.assign(new Error("Question is no longer pending"), { statusCode: 409 });
    }
    const resolved = this.store.question(id)!;
    this.questionResolvers.get(id)?.({ status: "answered", answers });
    this.questionResolvers.delete(id);
    this.events.publish("user_question.answered", resolved, resolved.sessionId);
    return resolved;
  }

  cancelQuestion(id: string, message = "User cancelled the question"): UserQuestion {
    const question = this.store.question(id);
    if (!question) throw Object.assign(new Error("Question not found"), { statusCode: 404 });
    if (!this.store.resolveQuestion(id, "cancelled")) {
      throw Object.assign(new Error("Question is no longer pending"), { statusCode: 409 });
    }
    const resolved = this.store.question(id)!;
    this.questionResolvers.get(id)?.({ status: "cancelled", answers: [], message });
    this.questionResolvers.delete(id);
    this.events.publish("user_question.cancelled", resolved, resolved.sessionId);
    return resolved;
  }

  resolveApproval(id: string, approved: boolean): Approval {
    const approval = this.store.approval(id);
    if (!approval) throw Object.assign(new Error("Approval not found"), { statusCode: 404 });
    if (!this.store.resolveApproval(id, approved ? "approved" : "rejected")) {
      throw Object.assign(new Error("Approval is no longer pending"), { statusCode: 409 });
    }
    const resolved = this.store.approval(id)!;
    this.approvalResolvers.get(id)?.(approved);
    this.approvalResolvers.delete(id);
    this.events.publish("approval.resolved", resolved, resolved.sessionId);
    return resolved;
  }

  invalidateAll(reason: string): void {
    for (const question of this.store.questions("pending")) {
      this.store.resolveQuestion(question.id, "invalidated");
      this.questionResolvers.get(question.id)?.({ status: "unavailable", answers: [], message: reason });
      this.events.publish("user_question.invalidated", { ...question, status: "invalidated", reason }, question.sessionId);
    }
    for (const approval of this.store.approvals("pending")) {
      this.store.resolveApproval(approval.id, "invalidated");
      this.approvalResolvers.get(approval.id)?.(false);
      this.events.publish("approval.resolved", { ...approval, status: "invalidated", reason }, approval.sessionId);
    }
    this.questionResolvers.clear();
    this.approvalResolvers.clear();
  }

  private handleSocket(socket: Socket): void {
    let buffer = "";
    let questionId: string | undefined;
    let completed = false;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0 || questionId) return;
      const line = buffer.slice(0, newline);
      let request: BrokerWireRequest;
      try { request = JSON.parse(line); } catch { socket.end(JSON.stringify({ status: "unavailable", message: "Invalid broker request" }) + "\n"); return; }
      if (request.type !== "ask_user_question" || !request.sessionId || !request.question) {
        socket.end(JSON.stringify({ status: "unavailable", message: "Invalid ask_user_question request" }) + "\n");
        return;
      }
      const question = this.createQuestion({
        sessionId: request.sessionId,
        source: { kind: "orchestrator", name: request.sourceName },
        question: request.question,
        details: request.details,
        mode: request.mode,
        options: normalizeOptions(request.options, request.allowOther !== false),
        allowOther: request.allowOther !== false,
        externalRequestId: request.requestId,
      }, (result) => {
        completed = true;
        socket.end(JSON.stringify(result) + "\n");
      });
      questionId = question.id;
    });
    socket.on("close", () => {
      if (!completed && questionId && this.store.question(questionId)?.status === "pending") {
        try { this.cancelQuestion(questionId, "Question request was aborted"); } catch {}
      }
    });
  }
}
