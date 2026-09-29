import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, realpathSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import type { EngineStatus, SessionCommand, SessionSummary, SessionStatus } from "@pi-local/protocol";
import { discoverSubagents, type SubagentProfile } from "./catalog.js";
import type { ControlConfig } from "./config.js";
import { EventBus } from "./events.js";
import { InteractionBroker } from "./interactions.js";
import { StateStore } from "./store.js";
import { resolveOutputUnderWorkspace, resolveWorkspace } from "./workspace.js";

interface RuntimeSession {
  summary: SessionSummary;
  client: RpcClient;
  unsubscribe: () => void;
  stopping?: boolean;
}

function now(): string { return new Date().toISOString(); }

export class EngineManager {
  private statusValue: EngineStatus = "stopped";
  private readonly running = new Map<string, RuntimeSession>();
  private caffeinate?: ChildProcess;
  private readonly cliPath: string;

  constructor(
    private readonly config: ControlConfig,
    private readonly store: StateStore,
    private readonly events: EventBus,
    private readonly interactions: InteractionBroker,
  ) {
    const packageEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
    this.cliPath = join(dirname(packageEntry), "cli.js");
  }

  status(): EngineStatus { return this.statusValue; }

  async start(): Promise<void> {
    if (this.statusValue === "running") return;
    if (this.statusValue !== "stopped" && this.statusValue !== "crashed") throw new Error(`Engine is ${this.statusValue}`);
    this.setStatus("starting");
    try {
      this.startCaffeinate();
      this.setStatus("running");
    } catch (error) {
      this.setStatus("crashed", { error: String(error) });
      throw error;
    }
  }

  async stop(reason = "Engine stopped"): Promise<void> {
    if (this.statusValue === "stopped") return;
    this.setStatus("stopping");
    this.interactions.invalidateAll(reason);
    await Promise.allSettled([...this.running.keys()].map((id) => this.stopSession(id, true)));
    this.caffeinate?.kill("SIGTERM");
    this.caffeinate = undefined;
    this.setStatus("stopped");
  }

  async restart(): Promise<void> { await this.stop("Engine restarted"); await this.start(); }

  sessions(): SessionSummary[] { return this.store.sessions(); }

  subagents(id: string): SubagentProfile[] {
    const summary = this.store.session(id);
    if (!summary) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
    return discoverSubagents(summary.workspace);
  }

  async createSession(input: { workspace: string; name?: string; sessionPath?: string }): Promise<SessionSummary> {
    this.requireRunning();
    const workspace = resolveWorkspace(this.config.workspaceRoot, input.workspace);
    const id = randomUUID();
    const createdAt = now();
    const summary: SessionSummary = {
      id, name: input.name?.trim() || basename(workspace), workspace,
      status: "idle", createdAt, updatedAt: createdAt,
    };
    this.store.upsertSession(summary);
    await this.launch(summary, input.sessionPath);
    return this.store.session(id)!;
  }

  async resumeSession(id: string): Promise<SessionSummary> {
    this.requireRunning();
    if (this.running.has(id)) return this.store.session(id)!;
    const summary = this.store.session(id);
    if (!summary) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
    await this.launch(summary, summary.sessionFile);
    return this.store.session(id)!;
  }

  async stopSession(id: string, interrupted = false): Promise<void> {
    const runtime = this.running.get(id);
    if (!runtime) return;
    runtime.stopping = true;
    runtime.unsubscribe();
    await runtime.client.stop();
    this.running.delete(id);
    this.updateSession(id, interrupted ? "interrupted" : "idle");
  }

  async deleteSession(id: string): Promise<void> {
    const summary = this.store.session(id);
    if (!summary) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
    this.interactions.invalidateSession(id, "Session deleted");
    await this.stopSession(id);
    if (summary.sessionFile && existsSync(summary.sessionFile)) {
      unlinkSync(this.resolveOwnedSession(summary.sessionFile));
    }
    if (!this.store.deleteSession(id)) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
    this.events.publish("session.deleted", { id, name: summary.name }, id);
  }

  async importTerminalSession(sourcePath: string, workspace: string, name?: string): Promise<SessionSummary> {
    this.requireRunning();
    const allowed = realpathSync(join(homedir(), ".pi", "agent", "sessions"));
    const expandedSource = sourcePath.startsWith("~/") ? join(homedir(), sourcePath.slice(2)) : sourcePath;
    const source = realpathSync(expandedSource);
    const rel = relative(allowed, source);
    if (rel.startsWith("..") || rel.startsWith("/")) throw new Error("Only Pi session files can be imported");
    const targetDir = join(this.config.sessionsDir, "imports");
    mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    const target = join(targetDir, `${Date.now()}-${basename(source)}`);
    copyFileSync(source, target);
    return this.createSession({ workspace, name: name ?? `Imported ${basename(source)}`, sessionPath: target });
  }

  async execute(id: string, request: SessionCommand): Promise<unknown> {
    const runtime = this.running.get(id);
    if (!runtime) throw Object.assign(new Error("Session is not running"), { statusCode: 409 });
    const client = runtime.client;
    const payload = request.payload ?? {};
    switch (request.command) {
      case "prompt": return client.prompt(String(payload.message ?? ""), payload.images as any);
      case "steer": return client.steer(String(payload.message ?? ""), payload.images as any);
      case "follow_up": return client.followUp(String(payload.message ?? ""), payload.images as any);
      case "abort": return client.abort();
      case "clear_queue": return client.clearQueue();
      case "get_state": return client.getState();
      case "get_messages": return client.getMessages();
      case "set_model": return client.setModel(String(payload.provider), String(payload.modelId));
      case "cycle_model": return client.cycleModel();
      case "get_available_models": return client.getAvailableModels();
      case "set_thinking_level": {
        const levels = await client.getAvailableThinkingLevels();
        if (!levels.includes(payload.level as any)) throw Object.assign(new Error(`This model supports: ${levels.join(", ") || "no configurable thinking"}`), {statusCode:400});
        await client.setThinkingLevel(payload.level as any);
        const state = await client.getState();
        if (state.thinkingLevel !== payload.level) throw Object.assign(new Error(`Pi selected thinking level ${state.thinkingLevel}; requested level was not applied`), {statusCode:409});
        return {level:state.thinkingLevel};
      }
      case "cycle_thinking_level": return client.cycleThinkingLevel();
      case "get_available_thinking_levels": return client.getAvailableThinkingLevels();
      case "set_steering_mode": return client.setSteeringMode(payload.mode as any);
      case "set_follow_up_mode": return client.setFollowUpMode(payload.mode as any);
      case "compact": return client.compact(payload.customInstructions as string | undefined);
      case "set_auto_compaction": return client.setAutoCompaction(Boolean(payload.enabled));
      case "set_auto_retry": return client.setAutoRetry(Boolean(payload.enabled));
      case "abort_retry": return client.abortRetry();
      case "bash": return client.bash(String(payload.command ?? ""));
      case "abort_bash": return client.abortBash();
      case "get_session_stats": return client.getSessionStats();
      case "export_html": return client.exportHtml(payload.outputPath
        ? resolveOutputUnderWorkspace(runtime.summary.workspace, String(payload.outputPath)) : undefined);
      case "switch_session": {
        const sessionPath = this.resolveOwnedSession(String(payload.sessionPath ?? ""));
        const result = await client.switchSession(sessionPath);
        await this.refreshRuntimeSession(runtime);
        return result;
      }
      case "fork": {
        const result = await client.fork(String(payload.entryId ?? ""));
        await this.refreshRuntimeSession(runtime);
        return result;
      }
      case "clone": {
        const result = await client.clone();
        await this.refreshRuntimeSession(runtime);
        return result;
      }
      case "get_fork_messages": return client.getForkMessages();
      case "get_entries": return client.getEntries(payload.since as string | undefined);
      case "get_tree": return client.getTree();
      case "get_last_assistant_text": return client.getLastAssistantText();
      case "set_session_name": {
        const name = String(payload.name ?? "").trim();
        await client.setSessionName(name);
        runtime.summary.name = name;
        runtime.summary.updatedAt = now();
        this.store.upsertSession(runtime.summary);
        return null;
      }
      case "get_commands": return client.getCommands();
      case "new_session": {
        const result = await client.newSession(payload.parentSession as string | undefined);
        await this.refreshRuntimeSession(runtime);
        return result;
      }
      default: throw Object.assign(new Error(`Unsupported session command: ${request.command}`), { statusCode: 400 });
    }
  }

  private async launch(summary: SessionSummary, sessionPath?: string): Promise<void> {
    const args = ["--session-dir", this.config.sessionsDir];
    if (sessionPath) args.push("--session", sessionPath);
    else args.push("--name", summary.name);
    const client = new RpcClient({
      cliPath: this.cliPath,
      cwd: summary.workspace,
      env: {
        PI_ASK_USER_SOCKET: this.config.socketPath,
        PI_WEB_SESSION_ID: summary.id,
        PI_SUBAGENT_TRANSPORT: "rpc",
        PI_WEB_WORKSPACE_ROOT: this.config.workspaceRoot,
        PI_WEB_SUBAGENT_SESSIONS_DIR: join(this.config.sessionsDir, "subagents"),
      },
      args,
    });
    const unsubscribe = client.onEvent((event: any) => this.handleEvent(summary.id, client, event));
    try {
      await client.start();
      const state = await client.getState();
      summary.sessionFile = state.sessionFile;
      summary.status = "idle";
      summary.updatedAt = now();
      this.store.upsertSession(summary);
      this.running.set(summary.id, { summary, client, unsubscribe });
      const processHandle = (client as unknown as { process?: { once(event: string, listener: (code: unknown, signal: unknown) => void): unknown } }).process;
      processHandle?.once("exit", (code, signal) => {
        const runtime = this.running.get(summary.id);
        if (!runtime || runtime.stopping) return;
        this.running.delete(summary.id);
        this.updateSession(summary.id, "error");
        this.events.publish("session.crashed", { code, signal, stderr: client.getStderr().slice(-4000) }, summary.id);
      });
      this.events.publish("session.started", summary, summary.id);
    } catch (error) {
      unsubscribe();
      summary.status = "error";
      summary.updatedAt = now();
      this.store.upsertSession(summary);
      throw error;
    }
  }

  private handleEvent(sessionId: string, client: RpcClient, event: any): void {
    if (event.type === "agent_start") this.updateSession(sessionId, "running");
    if (event.type === "agent_settled") this.updateSession(sessionId, "idle");
    if (event.type === "extension_ui_request") {
      this.handleUiRequest(sessionId, client, event);
      return;
    }
    this.events.publish(`pi.${event.type}`, event, sessionId, persistedPiMetadata(event));
  }

  private handleUiRequest(sessionId: string, client: RpcClient, request: any): void {
    const respond = (response: Record<string, unknown>) => this.writeUiResponse(client, { type: "extension_ui_response", id: request.id, ...response });
    if (request.method === "confirm") {
      this.interactions.createApproval({ sessionId, externalRequestId: request.id,
        title: request.title, message: request.message, responder: (confirmed) => respond({ confirmed }) });
      return;
    }
    if (request.method === "select") {
      const options = (request.options ?? []).map((label: string, index: number) => ({
        id: `option:${index}`, label, value: label, index: index + 1,
      }));
      this.interactions.createExtensionQuestion({ sessionId, externalRequestId: request.id,
        question: request.title, mode: "single-select", options, allowOther: false,
        responder: (value) => respond(value.cancelled ? { cancelled: true } : { value: value.value ?? "" }) });
      return;
    }
    if (request.method === "input" || request.method === "editor") {
      this.interactions.createExtensionQuestion({ sessionId, externalRequestId: request.id,
        question: request.title, details: request.placeholder ?? request.prefill,
        mode: "text", allowOther: false,
        responder: (value) => respond(value.cancelled ? { cancelled: true } : { value: value.value ?? "" }) });
      return;
    }
    this.events.publish(`ui.${request.method}`, request, sessionId);
  }

  private writeUiResponse(client: RpcClient, response: Record<string, unknown>): void {
    const processHandle = (client as unknown as { process?: { stdin?: NodeJS.WritableStream } }).process;
    if (!processHandle?.stdin?.writable) throw new Error("Pi RPC stdin is unavailable");
    processHandle.stdin.write(`${JSON.stringify(response)}\n`);
  }

  private updateSession(id: string, status: SessionStatus): void {
    const runtime = this.running.get(id);
    const summary = runtime?.summary ?? this.store.session(id);
    if (!summary) return;
    summary.status = status;
    summary.updatedAt = now();
    this.store.upsertSession(summary);
    this.events.publish("session.status_changed", summary, id);
  }

  private resolveOwnedSession(requested: string): string {
    if (!requested) throw Object.assign(new Error("Session path is required"), { statusCode: 400 });
    const root = realpathSync(this.config.sessionsDir);
    const candidate = realpathSync(requested);
    const rel = relative(root, candidate);
    if (rel.startsWith("..") || rel.startsWith("/") || !candidate.endsWith(".jsonl")) {
      throw Object.assign(new Error("Only web-owned session files can be opened directly"), { statusCode: 400 });
    }
    return candidate;
  }

  private async refreshRuntimeSession(runtime: RuntimeSession): Promise<void> {
    const state = await runtime.client.getState();
    runtime.summary.sessionFile = state.sessionFile;
    if (state.sessionName) runtime.summary.name = state.sessionName;
    runtime.summary.updatedAt = now();
    this.store.upsertSession(runtime.summary);
  }

  private setStatus(status: EngineStatus, extra: Record<string, unknown> = {}): void {
    this.statusValue = status;
    this.events.publish("engine.status_changed", { status, ...extra });
  }

  private requireRunning(): void {
    if (this.statusValue !== "running") throw Object.assign(new Error("Pi Engine is not running"), { statusCode: 409 });
  }

  private startCaffeinate(): void {
    const processHandle = spawn("/usr/bin/caffeinate", ["-i"], { stdio: "ignore" });
    this.caffeinate = processHandle;
    processHandle.once("exit", (code, signal) => {
      if (this.caffeinate === processHandle) this.caffeinate = undefined;
      if (this.statusValue === "running") {
        this.events.publish("engine.caffeinate_restarting", { code, signal });
        setTimeout(() => { if (this.statusValue === "running" && !this.caffeinate) this.startCaffeinate(); }, 500);
      }
    });
  }
}

function persistedPiMetadata(event: any): Record<string, unknown> {
  const metadata: Record<string, unknown> = { type: event.type, contentStoredInSessionFile: true };
  for (const key of ["toolCallId", "toolName", "isError", "reason", "aborted", "willRetry", "attempt", "maxAttempts", "delayMs", "level", "name"]) {
    if (event[key] !== undefined) metadata[key] = event[key];
  }
  return metadata;
}
