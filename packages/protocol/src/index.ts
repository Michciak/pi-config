export type EngineStatus = "stopped" | "starting" | "running" | "stopping" | "crashed";
export type SessionStatus = "idle" | "running" | "waiting" | "interrupted" | "error";
export type QuestionMode = "text" | "single-select" | "multi-select";
export type QuestionStatus = "pending" | "answered" | "cancelled" | "invalidated";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "invalidated";

export interface AskOption {
  id: string;
  label: string;
  value: string;
  description?: string;
  index?: number;
  isOther?: boolean;
}

export type UserAnswer =
  | { type: "text"; label: string; value: string }
  | { type: "option"; label: string; value: string; index: number }
  | { type: "other"; label: string; value: string };

export interface UserQuestion {
  id: string;
  sessionId: string;
  source: { kind: "orchestrator" | "extension"; name?: string };
  question: string;
  details?: string;
  mode: QuestionMode;
  options: AskOption[];
  allowOther: boolean;
  status: QuestionStatus;
  answers: UserAnswer[];
  createdAt: string;
  resolvedAt?: string;
  externalRequestId?: string;
}

export interface Approval {
  id: string;
  sessionId: string;
  title: string;
  message: string;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  externalRequestId?: string;
}

export interface SessionSummary {
  id: string;
  name: string;
  workspace: string;
  status: SessionStatus;
  sessionFile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerStatus {
  serverId: string;
  control: "online";
  engine: EngineStatus;
  sessions: SessionSummary[];
  firebase: "enabled" | "disabled" | "error";
  version: string;
}

export interface PiEvent<T = unknown> {
  seq: number;
  timestamp: string;
  serverId: string;
  sessionId?: string;
  type: string;
  payload: T;
}

export interface SessionCommand {
  command: string;
  payload?: Record<string, unknown>;
}

export interface CreateSessionRequest {
  workspace: string;
  name?: string;
  sessionPath?: string;
}

export interface PairingRequest {
  code: string;
  deviceId: string;
  name: string;
  publicKey: string;
  fcmToken?: string;
}

export function normalizeOptions(
  values: Array<{ label: string; value?: string; description?: string }> | undefined,
  allowOther = true,
): AskOption[] {
  const options = (values ?? [])
    .map((option, zeroIndex) => ({
      id: `option:${zeroIndex}`,
      label: option.label.trim(),
      value: option.value?.trim() || option.label.trim(),
      description: option.description?.trim() || undefined,
      index: zeroIndex + 1,
    }))
    .filter((option) => option.label.length > 0);
  if (allowOther) {
    const label = options.some((option) => option.label.toLowerCase() === "other")
      ? "Other (custom)"
      : "Other";
    options.push({ id: "other", label, value: "__other__", isOther: true });
  }
  return options;
}

export function validateQuestionAnswers(question: UserQuestion, answers: UserAnswer[]): string | null {
  if (question.status !== "pending") return "Question is no longer pending";
  if (question.mode === "text") {
    return answers.length === 1 && answers[0]?.type === "text" ? null : "Text question requires one text answer";
  }
  if (question.mode === "single-select" && answers.length !== 1) return "Select exactly one answer";
  if (question.mode === "multi-select" && answers.length < 1) return "Select at least one answer";

  const known = new Map(question.options.map((option) => [option.value, option]));
  for (const answer of answers) {
    if (answer.type === "text") return "Text answers are not valid for this question";
    if (answer.type === "other") {
      if (!question.allowOther || answer.label.trim().length === 0) return "Other requires non-empty text";
      continue;
    }
    const option = known.get(answer.value);
    if (!option || option.isOther || option.index !== answer.index || option.label !== answer.label) {
      return "Answer does not match an available option";
    }
  }
  return null;
}
