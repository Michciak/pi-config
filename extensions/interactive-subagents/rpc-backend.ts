import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { createServer, type Server, Socket } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { selectSubagentModel, ref as modelRef } from "./routing.ts";
import {createSettlement} from "./settlement.ts";

interface AgentProfile {
  name: string;
  description?: string;
  tools: string[];
  thinking?: string;
  body: string;
  subagents: string[];
  source: "global" | "project";
}

interface RunningAgent {
  id: string;
  name: string;
  agent: string;
  task: string;
  cwd: string;
  model: string;
  profile: AgentProfile;
  client?: RpcClient;
  sessionFile?: string;
  status: "starting" | "running" | "waiting" | "completed" | "error";
  startedAt: number;
  liveMessage?: any;
  lastPublish?: number;
  result?: string;
  error?: string;
}

interface ParentQuestion {
  id: string;
  name: string;
  question: string;
  socket: Socket;
}

const running = new Map<string, RunningAgent>();
const questions = new Map<string, ParentQuestion[]>();
let context: ExtensionContext | undefined;
let questionServer: Server | undefined;
let questionSocketPath: string | undefined;
let generation = 0;
const cancellations = new Set<() => void>();
const jobs = new Set<Promise<void>>();

function reportBackendError(error: unknown): void {
  console.error(`${new Date().toISOString()} RPC subagent backend: ${String(error)}`);
}

function frontmatterValue(frontmatter: string, key: string): string | undefined {
  return frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
}

function list(value?: string): string[] {
  return (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parseAgent(path: string, source: AgentProfile["source"]): AgentProfile | undefined {
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return;
  const frontmatter = match[1]!;
  const fallback = basename(path, ".md");
  return {
    name: frontmatterValue(frontmatter, "name") ?? fallback,
    description: frontmatterValue(frontmatter, "description"),
    tools: list(frontmatterValue(frontmatter, "tools")),
    thinking: frontmatterValue(frontmatter, "thinking"),
    body: match[2]!.trim(),
    subagents: list(frontmatterValue(frontmatter, "subagent_agents")),
    source,
  };
}

function profiles(): AgentProfile[] {
  const found = new Map<string, AgentProfile>();
  const directories: Array<[string, AgentProfile["source"]]> = [
    [join(homedir(), ".pi", "agent", "agents"), "global"],
    [join(process.cwd(), ".pi", "agents"), "project"],
  ];
  for (const [directory, source] of directories) {
    if (!existsSync(directory)) continue;
    for (const file of readdirSync(directory).filter((item) => item.endsWith(".md"))) {
      try {
        const profile = parseAgent(join(directory, file), source);
        if (profile) found.set(profile.name, profile);
      } catch {}
    }
  }
  const allowed = process.env.PI_SUBAGENT_ALLOWED ? new Set(list(process.env.PI_SUBAGENT_ALLOWED)) : undefined;
  return [...found.values()].filter((profile) => !allowed || allowed.has(profile.name));
}

// Sessions may live in any directory now, so subagent cwd only has to be an
// existing directory — it is no longer bound to the default workspace root.
function safeCwd(input: string | undefined, fallback: string): string {
  const raw = input?.startsWith("~/") ? join(homedir(), input.slice(2)) : resolve(input || fallback);
  let candidate: string;
  try { candidate = realpathSync(raw); }
  catch { throw new Error(`Subagent cwd does not exist: ${raw}`); }
  if (!statSync(candidate).isDirectory()) throw new Error(`Subagent cwd is not a directory: ${candidate}`);
  return candidate;
}

function uniqueName(requested: string): string {
  if (!running.has(requested)) return requested;
  let suffix = 2;
  while (running.has(`${requested}-${suffix}`)) suffix += 1;
  return `${requested}-${suffix}`;
}

function updateWidget(): void {
  if (!context) return;
  for (const item of running.values()) context.ui.setWidget(`remote-subagent:${item.id}`, [JSON.stringify({id:item.id,parentId:process.env.PI_SUBAGENT_RUN_ID??null,name:item.name,agent:item.agent,model:item.model,status:item.status,sessionFile:item.sessionFile,liveMessage:item.liveMessage})]);
  const rows = [...running.values()].filter((item) => item.status !== "completed").map((item) =>
    `${item.status === "running" ? "●" : item.status === "waiting" ? "?" : "○"} ${item.name} · ${item.agent} · ${item.status}`,
  );
  context.ui.setWidget("rpc-subagents", rows.length ? ["RPC subagents", ...rows] : undefined);
}

function sendUiResponse(client: RpcClient, response: Record<string, unknown>): void {
  const child = (client as unknown as { process?: { stdin?: NodeJS.WritableStream } }).process;
  if (!child?.stdin?.writable) throw new Error("Nested Pi RPC stdin is unavailable");
  child.stdin.write(`${JSON.stringify(response)}\n`);
}

function askOrchestrator(pi: ExtensionAPI, item: ParentQuestion): void {
  const pending = questions.get(item.name) ?? [];
  pending.push(item);
  questions.set(item.name, pending);
  const agent = running.get(item.name);
  if (agent) agent.status = "waiting";
  updateWidget();
  pi.sendMessage({
    customType: "subagent_question",
    content: `Subagent "${item.name}" asks its orchestrator:\n\n${item.question}\n\nAnswer it with subagent_message({ name: "${item.name}", message: "…" }). If human input is required, call ask_user_question first and then forward that answer.`,
    display: true,
    details: { subagent: item.name, questionId: item.id, question: item.question },
  }, { triggerTurn: true, deliverAs: "steer" });
}

async function listenForChildQuestions(pi: ExtensionAPI): Promise<void> {
  const socketDirectory = dirname(process.env.PI_ASK_USER_SOCKET ?? join(homedir(), ".pi", "agent", "web-control", "interactions.sock"));
  mkdirSync(socketDirectory, { recursive: true, mode: 0o700 });
  questionSocketPath = join(socketDirectory, `sa-${process.pid}.sock`);
  if (existsSync(questionSocketPath)) unlinkSync(questionSocketPath);
  questionServer = createServer((socket) => {
    let buffer = "";
    let queued: ParentQuestion | undefined;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0 || queued) return;
      try {
        const request = JSON.parse(buffer.slice(0, newline));
        if (request.type !== "ask_question" || !request.name || !request.question) throw new Error("Invalid request");
        queued = { id: request.id ?? randomUUID(), name: request.name, question: request.question, socket };
        askOrchestrator(pi, queued);
      } catch (error) {
        socket.end(JSON.stringify({ status: "unavailable", message: String(error) }) + "\n");
      }
    });
    socket.on("close", () => {
      if (!queued) return;
      const pending = questions.get(queued.name) ?? [];
      questions.set(queued.name, pending.filter((item) => item !== queued));
    });
  });
  await new Promise<void>((resolvePromise, reject) => {
    questionServer!.once("error", reject);
    questionServer!.listen(questionSocketPath, () => resolvePromise());
  });
  chmodSync(questionSocketPath, 0o600);
}

function registerAskQuestion(pi: ExtensionAPI): void {
  const parentSocket = process.env.PI_SUBAGENT_PARENT_SOCKET;
  if (!parentSocket) return;
  pi.registerTool({
    name: "ask_question",
    label: "Ask orchestrator",
    description: "Ask your orchestrator one free-form question when you cannot safely continue without its decision.",
    parameters: Type.Object({ question: Type.String({ minLength: 1 }) }),
    async execute(toolCallId, params, signal) {
      return new Promise<{content: Array<{type:"text";text:string}>;details:{status:string}}>((resolvePromise) => {
        const socket = new Socket();
        let buffer = "";
        let settled = false;
        const finish = (text: string, status: string) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", abort);
          socket.destroy();
          resolvePromise({ content: [{ type: "text" as const, text }], details: { status } });
        };
        const abort = () => finish("Question cancelled", "cancelled");
        signal?.addEventListener("abort", abort, { once: true });
        socket.connect(parentSocket, () => socket.write(JSON.stringify({
          type: "ask_question", id: toolCallId,
          name: process.env.PI_SUBAGENT_NAME ?? "subagent", question: params.question,
        }) + "\n"));
        socket.setEncoding("utf8");
        socket.on("data", (chunk) => {
          buffer += chunk;
          const newline = buffer.indexOf("\n");
          if (newline < 0) return;
          try {
            const response = JSON.parse(buffer.slice(0, newline));
            finish(response.answer ?? response.message ?? "No answer", response.status ?? "answered");
          } catch { finish("Invalid response from orchestrator", "unavailable"); }
        });
        socket.once("error", (error) => finish(`Orchestrator unavailable: ${error.message}`, "unavailable"));
      });
    },
  });
}

function cliPath(): string {
  // Nested Remote agents must use the same release-local SDK fixes as their parent.
  if(process.env.PI_WEB_SESSION_ID && process.env.PI_WEB_CLI_PATH) return process.env.PI_WEB_CLI_PATH;
  const entry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  return join(dirname(entry), "cli.js");
}

function childArgs(agent: RunningAgent, sessionFile: string | undefined, ctx: ExtensionContext): string[] {
  const sessionDir = process.env.PI_WEB_SUBAGENT_SESSIONS_DIR ?? join(dirname(process.env.PI_ASK_USER_SOCKET ?? join(homedir(), ".pi", "agent", "web-control", "interactions.sock")), "subagents");
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const args = ["--session-dir", sessionDir];
  if (sessionFile) args.push("--session", sessionFile); else args.push("--name", agent.name);
  const scope = (ctx as any).scopedModels?.map((entry: any) => modelRef(entry.model)).filter(Boolean);
  if (scope?.length) args.push("--models", scope.join(","));
  args.push("--model", agent.profile.thinking ? `${agent.model}:${agent.profile.thinking}` : agent.model);
  if (agent.profile.body) args.push("--append-system-prompt", agent.profile.body);
  const tools = new Set(agent.profile.tools);
  tools.add("ask_question");
  if (agent.profile.subagents.length) {
    tools.add("subagent"); tools.add("subagent_message"); tools.add("subagents_list");
  }
  args.push("--tools", [...tools].join(","));
  return args;
}

function forwardChildUi(pi: ExtensionAPI, agent: RunningAgent, client: RpcClient, request: any): void {
  const childKey = `${agent.name}:${request.statusKey ?? request.widgetKey ?? request.method}`;
  if(request.method === "setWidget" && String(request.widgetKey).startsWith("remote-subagent:")) { context?.ui.setWidget(request.widgetKey,request.widgetLines); return; }
  if(request.method === "setWidget" && request.widgetKey === "remote-metrics") return;
  if (request.method === "setStatus") context?.ui.setStatus(childKey, request.statusText ? `[${agent.name}] ${request.statusText}` : undefined);
  else if (request.method === "setWidget") context?.ui.setWidget(childKey, request.widgetLines?.map((line: string) => `[${agent.name}] ${line}`));
  else if (request.method === "notify") context?.ui.notify(`[${agent.name}] ${request.message}`, request.notifyType);
  else if (["confirm", "select", "input", "editor"].includes(request.method)) {
    const prompt = request.method === "confirm"
      ? `${request.title}\n\n${request.message}\n\nReply with approve or reject.`
      : `${request.title}\n\n${(request.options ?? []).join("\n") || request.placeholder || request.prefill || ""}`;
    const socket = { end: (line: string) => {
      const answer = JSON.parse(line).answer as string;
      if (request.method === "confirm") sendUiResponse(client, { type: "extension_ui_response", id: request.id, confirmed: /^(approve|yes|tak|true)$/i.test(answer.trim()) });
      else sendUiResponse(client, { type: "extension_ui_response", id: request.id, value: answer });
    }, destroy: () => {}, on: () => {} } as unknown as Socket;
    askOrchestrator(pi, { id: request.id, name: agent.name, question: prompt, socket });
  } else {
    pi.sendMessage({ customType: "subagent_ui", content: `[${agent.name}] ${request.method}`, display: false, details: request });
  }
}

async function runAgent(pi: ExtensionAPI, agent: RunningAgent, prompt: string, sessionFile: string | undefined, createClient: (options: ConstructorParameters<typeof RpcClient>[0]) => RpcClient): Promise<void> {
  const owner=generation, ownerContext=context;
  const alive=()=>owner===generation && !!ownerContext && context===ownerContext;
  let client: RpcClient | undefined;
  let unsubscribe = () => {};
  const {outcome:settled,finish} = createSettlement();
  const cancel=()=>finish(new Error("Subagent cancelled by session shutdown"));
  cancellations.add(cancel);
  try {
  if (!ownerContext || !questionSocketPath) throw new Error("RPC subagent backend is not initialized");
  agent.status = "starting";
  updateWidget();
  client = createClient({
    cliPath: cliPath(), cwd: agent.cwd,
    env: {
      PI_SUBAGENT_TRANSPORT: "rpc",
      PI_SUBAGENT_PARENT_SOCKET: questionSocketPath,
      PI_SUBAGENT_NAME: agent.name,
      PI_SUBAGENT_RUN_ID: agent.id,
      PI_SUBAGENT_AGENT: agent.agent,
      PI_SUBAGENT_DEPTH: String(Number(process.env.PI_SUBAGENT_DEPTH ?? "0") + 1),
      PI_SUBAGENT_ALLOWED: agent.profile.subagents.join(","),
      PI_WEB_WORKSPACE_ROOT: process.env.PI_WEB_WORKSPACE_ROOT ?? ownerContext.cwd,
      PI_ASK_USER_SOCKET: process.env.PI_ASK_USER_SOCKET ?? "",
      PI_WEB_SESSION_ID: process.env.PI_WEB_SESSION_ID ?? "",
      PI_WEB_SUBAGENT_SESSIONS_DIR: process.env.PI_WEB_SUBAGENT_SESSIONS_DIR ?? "",
    },
    args: childArgs(agent, sessionFile, ownerContext),
  });
  agent.client = client;
  // Exit can happen during start/getState/prompt, before the waiter is awaited.
  // Resolve with an outcome instead of leaving an early rejected promise unhandled.
  unsubscribe = client.onEvent((event: any) => {
      if(!alive()) return;
      try {
      if(event.type === "message_update") { agent.liveMessage=event.message ?? event.assistantMessageEvent?.partial; if(Date.now()-(agent.lastPublish??0)>300){agent.lastPublish=Date.now();updateWidget();} }
      if(event.type === "message_end") {agent.liveMessage=undefined;updateWidget();}
      if (event.type === "agent_start") { agent.status = "running"; updateWidget(); }
      if (event.type === "extension_ui_request") forwardChildUi(pi, agent, client!, event);
      if (event.type === "agent_settled") { unsubscribe(); finish(); }
      } catch(error) {finish(error instanceof Error ? error : new Error(String(error)));}
  });
    await client.start();
    if(!alive()) return;
    const child = (client as unknown as { process?: { once(event: string, listener: (code: unknown) => void): unknown } }).process;
    child?.once("exit", (code: unknown) => finish(new Error(`Nested Pi exited before settling (${code})`)));
    const state = await client.getState();
    if(!alive()) return;
    agent.sessionFile = state.sessionFile;
    if(state.model) agent.model = `${state.model.provider}/${state.model.id}`;
    updateWidget();
    await client.prompt(prompt);
    const failure = await settled;
    if(!alive()) return;
    if (failure) throw failure;
    const messages=await client.getMessages();
    const lastAssistant=[...messages].reverse().find((message:any)=>message.role==="assistant");
    if(lastAssistant?.stopReason==="error") throw new Error(lastAssistant.errorMessage??"Subagent provider failed");
    if(lastAssistant?.stopReason==="aborted") throw new Error("Subagent turn was aborted");
    agent.result = await client.getLastAssistantText() ?? "Subagent finished without a text result.";
    agent.status = "completed";
    const stats = await client.getSessionStats().catch(() => undefined);
    if(!alive()) return;
    pi.sendMessage({
      customType: "subagent_result", content: `Subagent "${agent.name}" completed:\n\n${agent.result}`,
      display: true, details: { id: agent.id, name: agent.name, agent: agent.agent, task: agent.task, model: agent.model, sessionFile: agent.sessionFile, stats },
    }, { triggerTurn: true, deliverAs: "steer" });
  } catch (error) {
    if(!alive()) return;
    agent.status = agent.result===undefined ? "error" : "completed";
    agent.error = error instanceof Error ? error.message : String(error);
    // The delivery API itself can fail after reload. Never recurse into it uncaught.
    try { pi.sendMessage({ customType: "subagent_result", content: agent.result===undefined ? `Subagent "${agent.name}" failed: ${agent.error}` : `Subagent "${agent.name}" completed. Result delivery encountered an error (${agent.error}); do not repeat its completed work.\n\n${agent.result}`, display: true,
      details: { id: agent.id, name: agent.name, agent: agent.agent, error: agent.error, status:agent.status } }, { triggerTurn: true, deliverAs: "steer" }); }
    catch(deliveryError) { reportBackendError(deliveryError); }
  } finally {
    cancellations.delete(cancel);
    try {unsubscribe();} catch(error) {reportBackendError(error);}
    await client?.stop().catch(reportBackendError);
    agent.client = undefined;
    if(alive()) {try {updateWidget();} catch(error) {reportBackendError(error);}}
  }
}

export function registerRpcSubagents(pi: ExtensionAPI, createClient = (options: ConstructorParameters<typeof RpcClient>[0]) => new RpcClient(options)): void {
  const launch=(agent: RunningAgent,prompt:string,file?:string)=>{
    const job=runAgent(pi,agent,prompt,file,createClient).catch(reportBackendError);
    jobs.add(job);void job.then(()=>jobs.delete(job));
  };
  registerAskQuestion(pi);
  pi.on("session_start", async (_event, ctx) => {
    generation++;
    context = ctx;
    const isTopLevel = !process.env.PI_SUBAGENT_PARENT_SOCKET;
    const maySpawn = list(process.env.PI_SUBAGENT_ALLOWED).length > 0;
    if (isTopLevel || maySpawn) await listenForChildQuestions(pi);
  });
  pi.on("session_shutdown", async () => {
    // Invalidate captured APIs before stopping children (exit/settled events race here).
    generation++; context=undefined;
    for(const cancel of cancellations) cancel();
    for(const pending of questions.values()) for(const item of pending) item.socket.destroy();
    await Promise.all([...running.values()].map(agent=>agent.client?.stop().catch(reportBackendError)));
    await Promise.all([...jobs]);
    running.clear(); questions.clear();
    if (questionServer) await new Promise<void>((resolvePromise) => questionServer!.close(() => resolvePromise()));
    if (questionSocketPath && existsSync(questionSocketPath)) unlinkSync(questionSocketPath);
    questionServer = undefined; questionSocketPath = undefined; context = undefined;
  });

  pi.registerTool({
    name: "subagents_list", label: "List RPC subagents",
    description: "List subagent profiles available to this orchestrator.", parameters: Type.Object({}),
    async execute() {
      const agents = profiles();
      return { content: [{ type: "text" as const, text: agents.map((item) => `• ${item.name}${item.description ? ` — ${item.description}` : ""}`).join("\n") || "No subagents found." }], details: { agents } };
    },
  });

  pi.registerTool({
    name: "subagent", label: "RPC subagent",
    description: "Start a nested Pi RPC subagent. Choose the model for the concrete task, complexity, modalities and verified capabilities, not for sameness or diversity relative to the orchestrator. Omit model for automatic task-based routing from the authenticated active scope. Set model for a justified task-fit choice or a user-requested model. The result is delivered automatically as a system steer message, not a new user task.",
    parameters: Type.Object({
      agent: Type.String(), task: Type.String({ minLength: 1 }), name: Type.Optional(Type.String()),
      model: Type.Optional(Type.String({description:"Exact scoped provider/model justified by task fit or explicitly selected by the user. Omit for automatic task-based selection."})), cwd: Type.Optional(Type.String()),
    }),
    async execute(_id, params, _signal, _update, ctx) {
      const profile = profiles().find((item) => item.name === params.agent);
      if (!profile) return { isError: true, details: {status:"error", name:params.name ?? "unknown"}, content: [{ type: "text" as const, text: `Unknown or disallowed agent: ${params.agent}` }] };
      const name = uniqueName(params.name?.trim() || profile.name);
      const model = selectSubagentModel(params.task, ctx, profile.name, params.model);
      const item: RunningAgent = {
        id: randomUUID(), name, agent: profile.name, task: params.task,
        cwd: safeCwd(params.cwd, ctx.cwd), model, profile, status: "starting", startedAt: Date.now(),
      };
      running.set(name, item);
      launch(item, params.task);
      return { content: [{ type: "text" as const, text: `Subagent "${name}" started through nested Pi RPC. Its result will arrive automatically.` }],
        details: { id: item.id, name, agent: profile.name, model, status: "started" } };
    },
  });

  pi.registerTool({
    name: "subagent_message", label: "Message RPC subagent",
    description: "Answer a waiting subagent, steer a running one, or resume its completed RPC session.",
    parameters: Type.Object({ name: Type.String(), message: Type.String({ minLength: 1 }) }),
    async execute(_id, params) {
      const item = running.get(params.name);
      if (!item) return { isError: true, details: {status:"error", name:params.name ?? "unknown"}, content: [{ type: "text" as const, text: `Unknown subagent: ${params.name}` }] };
      const pending = questions.get(item.name) ?? [];
      const question = pending.shift();
      if (question) {
        questions.set(item.name, pending);
        question.socket.end(JSON.stringify({ status: "answered", answer: params.message }) + "\n");
        item.status = "running"; updateWidget();
        return { content: [{ type: "text" as const, text: `Answered ${item.name}'s question.` }], details: { status: "answered", name: item.name } };
      }
      if (item.client && (item.status === "running" || item.status === "waiting" || item.status === "starting")) {
        await item.client.steer(params.message);
        return { content: [{ type: "text" as const, text: `Steered subagent "${item.name}".` }], details: { status: "steered", name: item.name } };
      }
      if (!item.sessionFile) return { isError: true, details: {status:"error", name:params.name ?? "unknown"}, content: [{ type: "text" as const, text: `Subagent "${item.name}" has no resumable session.` }] };
      item.task = params.message; item.startedAt = Date.now(); item.result = undefined; item.error = undefined;
      launch(item, params.message, item.sessionFile);
      return { content: [{ type: "text" as const, text: `Resumed subagent "${item.name}" through Pi RPC.` }], details: { status: "resumed", name: item.name } };
    },
  });
}
