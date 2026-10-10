import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, copyFileSync, existsSync, mkdirSync, realpathSync, unlinkSync, appendFileSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import type { EngineStatus, SessionCommand, SessionSummary, SessionStatus } from "@pi-local/protocol";
import { discoverSubagents, type SubagentProfile } from "./catalog.js";
import type { ControlConfig } from "./config.js";
import { EventBus } from "./events.js";
import { InteractionBroker } from "./interactions.js";
import { StateStore } from "./store.js";
import { redactLog } from "./diagnostics.js";
import { applyExtensionEvent, sanitizeTerminalText } from "./extension-adapters.js";
import { resolveOutputUnderWorkspace, resolveWorkspace } from "./workspace.js";
import { extensionInventory } from "./extensions.js";
import {attachPromptFiles} from "./prompt-attachments.js";
import {childTranscript} from "./child-transcripts.js";
import {sharedRpcRead,rpcTimeoutError} from "./rpc-reads.js";

interface RuntimeSession {
  summary: SessionSummary;
  client: RpcClient;
  unsubscribe: () => void;
  stopping?: boolean;
}

function now(): string { return new Date().toISOString(); }

export async function awaitStartupState<T>(read: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await read(); }
    catch (error) {
      last = error;
      if (!String(error).includes("Timeout waiting for response") || attempt === attempts - 1) throw error;
    }
  }
  throw last;
}

export class EngineManager {
  private statusValue: EngineStatus = "stopped";
  private readonly childLive = new Map<string, any>();
  private readonly launching = new Map<string, Promise<void>>();
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
    await Promise.allSettled([...this.launching.values()]);
    await Promise.allSettled([...this.running.keys()].map((id) => this.stopSession(id, true)));
    this.caffeinate?.kill("SIGTERM");
    this.caffeinate = undefined;
    this.setStatus("stopped");
  }

  async restart(): Promise<void> { await this.stop("Engine restarted"); await this.start(); }

  sessions(): SessionSummary[] {
    const active = new Set((this.store.db.prepare("SELECT DISTINCT session_id FROM subagent_runs WHERE json_extract(metadata,'$.status') IN ('running','starting','waiting')").all() as any[]).map(row=>row.session_id));
    return this.store.sessions().map(session=>this.running.has(session.id) && active.has(session.id) && session.status === "idle" ? {...session,status:"running"} : session);
  }
  processIds(): number[] {
    return [...this.running.values()].flatMap(runtime=>{const pid=(runtime.client as any).process?.pid;return typeof pid==="number"?[pid]:[];});
  }

  subagents(id: string): SubagentProfile[] {
    const summary = this.store.session(id);
    if (!summary) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
    return discoverSubagents(summary.workspace);
  }

  async subagentRuns(id:string): Promise<any[]> {
    const rows=this.store.db.prepare("SELECT metadata FROM subagent_runs WHERE session_id=?").all(id) as any[];
    const results:any[]=[];
    // Bound concurrent file buffers rather than opening every historical run at once.
    for(let offset=0;offset<rows.length;offset+=4)results.push(...await Promise.all(rows.slice(offset,offset+4).map(async row=>{
      const item=JSON.parse(row.metadata);
      const root=item.transport === "acp" ? join(tmpdir(),"acp-delegate") : join(this.config.sessionsDir,"subagents");
      const transcript=await childTranscript(root,item.sessionFile);
      return {...item,...(item.transport==="acp"&&transcript.model?{model:transcript.model}:{}),messages:transcript.messages,liveMessage:this.childLive.get(item.id)};
    })));
    return results;
  }

  extensionUiState(id: string): any {
    if (!this.store.session(id)) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
    return this.store.extensionUiState(id);
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

  async reask(id: string, entryId: string, message: string): Promise<SessionSummary> {
    const runtime = this.running.get(id);
    if (!runtime) throw Object.assign(new Error("Session is not running"), { statusCode:409 });
    const state = await runtime.client.getState();
    if (state.isStreaming || state.pendingMessageCount) throw Object.assign(new Error("Wait for Pi to settle before editing history"), {statusCode:409});
    if (!message.trim() || !state.sessionFile) throw Object.assign(new Error("Message and session file are required"), {statusCode:400});
    const choices = await runtime.client.getForkMessages();
    if (!choices.some(item=>item.entryId===entryId)) throw Object.assign(new Error("User entry not found"),{statusCode:404});
    // Fork a copy, never replace the source session's selected branch.
    const dir=join(this.config.sessionsDir,"forks");
    mkdirSync(dir,{recursive:true,mode:0o700});
    const path=join(dir,randomUUID()+".jsonl");
    copyFileSync(this.resolveOwnedSession(state.sessionFile),path);
    const session=await this.createSession({workspace:runtime.summary.workspace,name:runtime.summary.name+" · fork",sessionPath:path});
    try {
      const result=await this.execute(session.id,{command:"fork",payload:{entryId}}) as any;
      if (result?.cancelled) throw new Error("Pi cancelled the fork");
      await this.execute(session.id,{command:"prompt",payload:{message}});
      return this.store.session(session.id)!;
    } catch(error) { await this.stopSession(session.id,true); throw error; }
  }

  async stopSession(id: string, interrupted = false): Promise<void> {
    const runtime = this.running.get(id);
    if (!runtime) return;
    runtime.stopping = true;
    runtime.unsubscribe();
    await runtime.client.stop();
    this.store.db.prepare("UPDATE subagent_runs SET metadata=json_set(metadata,'$.status','interrupted') WHERE session_id=? AND json_extract(metadata,'$.status') IN ('running','starting','waiting')").run(id);
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
    this.store.db.prepare("DELETE FROM subagent_runs WHERE session_id=?").run(id);
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
    try {
      const client=this.running.get(id)?.client;
      if(client && ["get_messages_page","get_messages","get_state","get_commands","get_available_models","get_available_thinking_levels","get_session_stats"].includes(request.command))
        return await sharedRpcRead(client,JSON.stringify(request),()=>this.executeCommand(id,request),["get_commands","get_available_models"].includes(request.command)?1000:0);
      return await this.executeCommand(id,request);
    } catch(error) {throw rpcTimeoutError(error,request.command.startsWith("get_"));}
  }

  private async executeCommand(id: string, request: SessionCommand): Promise<unknown> {
    const runtime = this.running.get(id);
    if (!runtime) throw Object.assign(new Error("Session is not running"), { statusCode: 409 });
    const client = runtime.client;
    const payload = request.payload ?? {};
    if(["prompt","steer","follow_up"].includes(request.command)&&typeof payload.message==="string"&&!payload.message.trimStart().startsWith("/")) {
      const attached=await attachPromptFiles(runtime.summary.workspace,payload.message);
      request={...request,payload:{...payload,message:attached.message,images:[...(Array.isArray(payload.images)?payload.images:[]),...attached.images]}};
      if(request.command==="prompt")return client.prompt(attached.message,request.payload!.images as any);
      if(request.command==="steer")return client.steer(attached.message,request.payload!.images as any);
      return client.followUp(attached.message,request.payload!.images as any);
    }
    switch (request.command) {
      case "get_messages_page": {
        const response=await (client as any).send({type:"get_messages_page",limit:payload.limit,before:payload.before});
        if(!response.success)throw Object.assign(new Error(response.error),{statusCode:400});
        return response.data;
      }
      case "get_completions":
      case "reload_extensions": {
        // Versioned runtime patch; SDK send is private in its TS surface, not in JS.
        const response=await (client as unknown as {send(packet:unknown):Promise<any>}).send({type:request.command,name:String(payload.name??""),prefix:String(payload.prefix??"")});
        if(!response.success)throw Object.assign(new Error(response.error),{statusCode:400});
        if(request.command==="get_completions")return {items:(response.data?.items??[]).map((item:any)=>({...item,label:sanitizeTerminalText(item.label),description:sanitizeTerminalText(item.description)}))};
        return response.data;
      }
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
        // Extension/provider discovery can exceed the RPC client's 30s request limit.
      // Retry only the read-only readiness probe, never prompts or tools.
      let state;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { state = await client.getState(); break; }
        catch (error) {
          if (!String(error).includes("Timeout waiting for response") || attempt === 2) throw error;
        }
      }
      if (!state) throw new Error("Pi did not report its state");
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

  private launch(summary: SessionSummary, sessionPath?: string): Promise<void> {
    const pending = this.launching.get(summary.id);
    if (pending) return pending;
    const task = this.launchProcess(summary, sessionPath).finally(() => this.launching.delete(summary.id));
    this.launching.set(summary.id, task);
    return task;
  }

  private async launchProcess(summary: SessionSummary, sessionPath?: string): Promise<void> {
    const args = ["--session-dir", this.config.sessionsDir];
    if (sessionPath) args.push("--session", sessionPath);
    else args.push("--name", summary.name);
    const client = new RpcClient({
      cliPath: this.cliPath,
      cwd: summary.workspace,
      env: {
        PI_ASK_USER_SOCKET: this.config.socketPath,
        PI_WEB_SESSION_ID: summary.id,
        PI_WEB_CLI_PATH: this.cliPath,
        PI_WEB_CONTROL_PORT: String(this.config.port),
        PI_WEB_RUNTIME_DIR: this.config.runtimeDir,
        PI_SUBAGENT_TRANSPORT: "rpc",
        PI_WEB_WORKSPACE_ROOT: this.config.workspaceRoot,
        PI_WEB_SUBAGENT_SESSIONS_DIR: join(this.config.sessionsDir, "subagents"),
      },
      args,
    });
    const unsubscribe = client.onEvent((event: any) => this.handleEvent(summary.id, client, event));
    try {
      await client.start();
      const state = await awaitStartupState(() => client.getState());
      // ACP is the sole context compressor; keep native Pi auto-compaction off.
      if(extensionInventory().some(item=>item.name==="billion-context"))await client.setAutoCompaction(false);
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
        this.events.publish("session.crashed", { code, signal, stderr: redactLog(client.getStderr()).slice(-4000) }, summary.id);
      });
      this.events.publish("session.started", summary, summary.id);
    } catch (error) {
      this.noteLaunchFailure(summary, error, client.getStderr());
      unsubscribe();
      await client.stop().catch(() => {});
      summary.status = "error";
      summary.updatedAt = now();
      this.store.upsertSession(summary);
      if (String(error).includes("Timeout waiting for response")) {
        throw Object.assign(new Error("Pi nie odpowiedziało podczas uruchamiania sesji. Sprawdź rozszerzenia i dostępność providerów, a następnie ponów otwarcie sesji. Szczegóły są w Ustawienia → Pi · Diagnostyka. Historia nie została usunięta."), {statusCode:503, code:"PI_SESSION_START_TIMEOUT"});
      }
      throw error;
    }
  }

  private noteLaunchFailure(summary: SessionSummary, error: unknown, stderr: string): void {
    this.events.publish("session.launch_failed", { reason: "Pi session failed to start" }, summary.id);
    const line = `${now()} session=${summary.id} name=${summary.name.replace(/[\r\n]/g, " ")} error=${redactLog(String(error)).slice(0, 500)} stderr=${redactLog(stderr).slice(-800)}\n`;
    try { appendFileSync(join(this.config.runtimeDir, "session-launch.log"), line, { mode: 0o600 }); }
    catch { /* diagnostics stay available from the control logs */ }
  }

  private handleEvent(sessionId: string, client: RpcClient, event: any): void {
    if((event.type==="message_end"&&event.message?.stopReason==="error")||["auto_retry_start","auto_retry_end"].includes(event.type)) {
      const entry={timestamp:now(),sessionId,type:event.type,error:redactLog(String(event.message?.errorMessage??event.errorMessage??event.finalError??"")).slice(0,2000),attempt:event.attempt,success:event.success};
      try {appendFileSync(join(this.config.runtimeDir,"session-runtime.log"),JSON.stringify(entry)+"\n",{mode:0o600});}
      catch { /* An unavailable diagnostic disk must never stop a model turn. */ }
    }
    const ui = this.store.extensionUiState(sessionId);
    if (applyExtensionEvent(ui, event)) {
      ui.updatedAt = now();
      this.store.saveExtensionUiState(sessionId, ui);
      this.events.publish("extension.snapshot", ui, sessionId);
    }
    if (event.type === "agent_start") this.updateSession(sessionId, "running");
    if (event.type === "agent_settled") this.updateSession(sessionId, "idle");
    if (event.type === "extension_ui_request") {
      this.handleUiRequest(sessionId, client, event);
      return;
    }
    this.events.publish(`pi.${event.type}`, event, sessionId, persistedPiMetadata(event));
  }

  private handleUiRequest(sessionId: string, client: RpcClient, request: any): void {
    if(request.method === "setWidget" && String(request.widgetKey).startsWith("remote-subagent:")) {
      try {
        const {liveMessage,...metadata}=JSON.parse(request.widgetLines?.[0] ?? "{}");
        if(!metadata.id) return;
        this.childLive.set(metadata.id,liveMessage);
        this.store.db.prepare("INSERT OR REPLACE INTO subagent_runs(id,session_id,metadata) VALUES(?,?,?)").run(metadata.id,sessionId,JSON.stringify(metadata));
        this.events.publish("subagent.updated",metadata,sessionId);
      }catch{}
      return;
    }
    if (["setStatus", "setWidget", "notify"].includes(request.method)) {
      const state = this.store.extensionUiState(sessionId);
      applyExtensionEvent(state, request);
      state.sessionId = sessionId;
      state.statuses ??= {};
      state.widgets ??= {};
      state.notices ??= [];
      if (request.method === "setStatus") {
        if (request.statusText) state.statuses[String(request.statusKey)] = sanitizeTerminalText(String(request.statusText));
        else delete state.statuses[String(request.statusKey)];
      }
      if (request.method === "setWidget") {
        if (request.widgetLines) state.widgets[String(request.widgetKey)] = (request.widgetLines as unknown[]).map((line) => sanitizeTerminalText(String(line)));
        else delete state.widgets[String(request.widgetKey)];
      }
      if (request.method === "notify") {
        if (request.notifyType === "error") this.events.publish("session.error", { reason: "Extension reported an error" }, sessionId);
        state.notices.push({ id: randomUUID(), message: sanitizeTerminalText(String(request.message ?? "")), kind: String(request.notifyType ?? "info"), createdAt: now() });
        state.notices = state.notices.slice(-20);
      }
      state.updatedAt = now();
      this.store.saveExtensionUiState(sessionId, state);
      this.events.publish("extension.snapshot", state, sessionId);
    }
    const respond = (response: Record<string, unknown>) => this.writeUiResponse(client, { type: "extension_ui_response", id: request.id, ...response });
    if (request.method === "confirm") {
      this.interactions.createApproval({ sessionId, externalRequestId: request.id,
        title: sanitizeTerminalText(String(request.title ?? "")), message: sanitizeTerminalText(String(request.message ?? "")), responder: (confirmed) => respond({ confirmed }) });
      return;
    }
    if (request.method === "select") {
      const options = (request.options ?? []).map((label: string, index: number) => ({
        id: `option:${index}`, label: sanitizeTerminalText(label), value: label, index: index + 1,
      }));
      this.interactions.createExtensionQuestion({ sessionId, externalRequestId: request.id,
        question: sanitizeTerminalText(String(request.title ?? "")), mode: "single-select", options, allowOther: false,
        responder: (value) => respond(value.cancelled ? { cancelled: true } : { value: value.value ?? "" }) });
      return;
    }
    if (request.method === "input" || request.method === "editor") {
      this.interactions.createExtensionQuestion({ sessionId, externalRequestId: request.id,
        question: sanitizeTerminalText(String(request.title ?? "")), details: sanitizeTerminalText(String(request.placeholder ?? request.prefill ?? "")),
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
    if(status === "error" || status === "interrupted") this.store.db.prepare("UPDATE subagent_runs SET metadata=json_set(metadata,'$.status','interrupted') WHERE session_id=? AND json_extract(metadata,'$.status') IN ('running','starting','waiting')").run(id);
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

function stripAnsi(value: string): string {
  return value.replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}

function persistedPiMetadata(event: any): Record<string, unknown> {
  const metadata: Record<string, unknown> = { type: event.type, contentStoredInSessionFile: true };
  for (const key of ["toolCallId", "toolName", "isError", "reason", "aborted", "willRetry", "attempt", "maxAttempts", "delayMs", "level", "name"]) {
    if (event[key] !== undefined) metadata[key] = event[key];
  }
  return metadata;
}
