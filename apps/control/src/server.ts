import { readServiceLogs } from "./diagnostics.js";
import {prepareControlRestart} from "./control-restart.js";
import { agentCatalogDir, loadStoredModels, mergeModelCatalog } from "./model-catalog.js";
import { scopeSnapshot, saveScope } from "./pi-settings.js";
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, createReadStream, statSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import { PI_REMOTE_PROTOCOL_VERSION, type PairingRequest, type SessionCommand, type UserAnswer } from "@pi-local/protocol";
import { loadSnippets } from "@pi-local/prompt-snippets";
import type { ControlConfig } from "./config.js";
import { authorized, isLoopback, randomToken, requireLocalAdmin } from "./auth.js";
import { EngineManager } from "./engine.js";
import { EventBus } from "./events.js";
import { FirebaseNotifier } from "./firebase.js";
import { InteractionBroker } from "./interactions.js";
import { StateStore } from "./store.js";
import { resolveFileUnderWorkspace, listWorkspaceDirectories } from "./workspace.js";
import { insideWorkspace, listWorkspace, protectSecrets, readDocument, readHex, searchWorkspace, uploadFile, writeDocument } from "./cockpit-workspace.js";
import { gitActions, gitSnapshot } from "./git.js";
import { extensionConfig, extensionInventory, saveExtensionConfig, PluginStore } from "./extensions.js";
import { TerminalManager } from "./terminals.js";
import { PluginHost } from "./plugin-host.js";
import { pluginCatalog } from "./plugin-catalog.js";
import {proxyPlugin,pluginResponse} from "./plugin-http.js";
import { extensionVersions, providerSettings, saveProviderKey, saveProviderSettings, updateExtension } from "./local-admin.js";
import { ownedProcesses } from "./processes.js";

interface Dependencies {
  config: ControlConfig;
  store: StateStore;
  events: EventBus;
  notifier: FirebaseNotifier;
  interactions: InteractionBroker;
  engine: EngineManager;
  terminals?: TerminalManager;
  plugins?: PluginStore;
}

function requireAuth(store: StateStore, request: FastifyRequest): void {
  if (!authorized(store, request)) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
}

const pairingAttempts = new Map<string, number[]>();

export async function buildServer(deps: Dependencies): Promise<FastifyInstance> {
  const { config, store, events, notifier, interactions, engine } = deps;
  const terminals = deps.terminals ?? new TerminalManager();
  const plugins = deps.plugins ?? new PluginStore(config.runtimeDir);
  const pluginHost = new PluginHost(plugins, events, config.workspaceRoot, engine);
  await pluginHost.load();
  const workspaceFor = (request: FastifyRequest, requested?: string,allowDescendant=false) => {
    const path = realpathSync(requested || config.workspaceRoot);
    if (!isLoopback(request.ip)) {
      const roots = [config.workspaceRoot, ...engine.sessions().map(session => session.workspace)].flatMap(root => {try{return [realpathSync(root)];}catch{return [];}});
      if (!roots.some(root=>path===root||(allowDescendant&&path.startsWith(root+"/")))) throw Object.assign(new Error("Unknown workspace"), { statusCode: 403 });
    }
    return path;
  };
  const app = Fastify({ logger: { level: process.env.PI_WEB_LOG_LEVEL ?? "info" }, bodyLimit: 12 * 1024 * 1024 });
  const localPluginRequest=(request:FastifyRequest)=>{
    requireLocalAdmin(request);
    if(!allowedHttpHost(request.hostname))throw Object.assign(new Error("Untrusted Host"),{statusCode:403});
    if(request.headers.origin&&new URL(request.headers.origin).host!==request.headers.host)throw Object.assign(new Error("Cross-origin plugin request rejected"),{statusCode:403});
  };
  app.addHook("onRequest",async(request,reply)=>{const hit=pluginHost.manager.findProxy(request.url.split("?")[0]);if(hit){localPluginRequest(request);proxyPlugin(request,reply,hit);}});
  app.addHook("onSend",async(request,reply,payload)=>{
    reply.header("X-Content-Type-Options","nosniff").header("Referrer-Policy","no-referrer");
    if(request.url.startsWith("/api/"))reply.header("Cache-Control","no-store");
    else reply.header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-src 'self' blob: data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    return payload;
  });
  await app.register(swagger, { openapi: { info: { title: "Pi Local Control API", version: "0.1.0" } } });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });
  await app.register(websocket);

  app.setErrorHandler((error: any, _request, reply) => {
    const status = Number(error?.statusCode) || 500;
    if (status >= 500) app.log.error(error);
    reply.code(status).send({ error: status >= 500 && !["PI_SESSION_START_TIMEOUT","PI_RPC_TIMEOUT","PI_RPC_MUTATION_TIMEOUT"].includes(error.code) ? "Internal server error" : error.message, code: error.code });
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/")) return;
    if (!allowedHttpHost(request.hostname)) return reply.code(403).send({ error: "Untrusted Host header" });
    const origin = request.headers.origin;
    if (origin && (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) || request.headers.upgrade === "websocket")) {
      try {
        if (new URL(origin).host !== request.headers.host) return reply.code(403).send({ error: "Cross-origin mutation rejected" });
      } catch { return reply.code(403).send({ error: "Invalid Origin header" }); }
    }
    const path = request.url.split("?")[0];
    const publicRoute = path === "/api/v1/auth/exchange" || path === "/api/v1/devices/pair";
    if (!publicRoute && !authorized(store, request)) return reply.code(401).send({ error: "Authentication required" });
    if (path?.startsWith("/api/v1/terminals")) requireLocalAdmin(request);
  });
  app.addHook("onClose", async () => { terminals.closeAll(); await pluginHost.close(); });

  app.get("/api/v1/status", async () => ({
    serverId: store.serverId,
    control: "online",
    engine: engine.status(),
    sessions: engine.sessions(),
    firebase: notifier.status(),
    notifications: notifier.diagnostics(),
    version: "0.1.0",
    buildVersion: process.env.PI_WEB_BUILD_VERSION ?? "dev",
    protocolVersion: PI_REMOTE_PROTOCOL_VERSION,
    eventCursor: Number((store.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events").get() as any).seq),
  }));
  app.get("/api/v1/capabilities", async (request) => {
    const localAdmin = isLoopback(request.ip);
    return { localAdmin, chat: true, workspaceRead: true, workspaceWrite: localAdmin, terminal: localAdmin,
      gitWrite: localAdmin, pluginsWrite: localAdmin, providersWrite: localAdmin };
  });
  app.get("/api/v1/config", async () => ({ workspaceRoot: config.workspaceRoot, port: config.port }));
  app.get("/api/v1/settings/notifications", async () => notifier.preferences());
  app.put("/api/v1/settings/notifications", async (request) => {
    requireLocalAdmin(request);
    return notifier.savePreferences(request.body);
  });
  app.get("/api/v1/openapi.json", async () => app.swagger());
  app.get("/api/v1/settings/pi/diagnostics", async () => ({ logs: readServiceLogs(config.runtimeDir) }));
  app.get("/api/v1/settings/pi/scope", async (request:any) => {
    let live: any[] = [];
    const ids = [...new Set([request.query?.sessionId, ...engine.sessions().map(session => session.id)].filter(Boolean))];
    for (const id of ids) {
      try { live = await engine.execute(String(id), {command:"get_available_models",payload:{}}) as any[]; if(live.length) break; }
      catch(error:any) { if(error.statusCode !== 409) throw error; }
    }
    const stored = loadStoredModels(agentCatalogDir(config.runtimeDir));
    return scopeSnapshot(config.runtimeDir, mergeModelCatalog(stored, live));
  });
  app.put("/api/v1/settings/pi/scope", async (request:any) => {
    requireLocalAdmin(request);
    await saveScope(config.runtimeDir, request.body?.patterns, request.body?.expected);
    return {saved:true, appliesTo:"new-or-resumed-sessions"};
  });
  app.get("/api/v1/directories", async (request: any, reply) => {
    workspaceFor(request, String(request.query?.path ?? config.workspaceRoot),true);
    try { return listWorkspaceDirectories(config.workspaceRoot, String(request.query?.path ?? config.workspaceRoot)); }
    catch { return reply.code(400).send({ error: "Folder is unavailable. Podaj istniejący katalog na tym Macu." }); }
  });
  app.get("/api/v1/snippets", async () => loadSnippets(config.snippetsDir));
  app.post("/api/v1/notifications/test", async (_request, reply) => {
    const event = events.publish("notification.test", {
      title: "Pi Remote działa",
      message: "Powiadomienia z Maca docierają do telefonu.",
    });
    const delivery = await notifier.send(String(event.seq));
    if (!delivery.attempted) return reply.code(409).send({ error: delivery.error, delivery });
    if (delivery.successCount === 0) return reply.code(502).send({ error: delivery.error ?? "FCM rejected the notification", delivery });
    return { delivered: true, delivery };
  });

  app.post("/api/v1/auth/exchange", async (request: any, reply) => {
    const session = store.exchangeWebToken(String(request.body?.token ?? ""));
    if (!session) return reply.code(401).send({ error: "Invalid or expired web token" });
    return { token: session, expiresIn: 12 * 60 * 60 };
  });

  app.post("/api/v1/pairing/start", async (request, reply) => {
    if (!isLoopback(request.ip) && !authorized(store, request)) return reply.code(401).send({ error: "Authentication required" });
    const code = String(randomInt(100000, 1000000));
    const expiresAt = Date.now() + 5 * 60_000;
    store.createPairingCode(code, expiresAt);
    const host = lanAddress();
    return {
      code,
      expiresAt,
      host,
      deepLink: `piremote://pair?host=${encodeURIComponent(host)}&port=${config.port}&code=${code}`,
    };
  });

  app.post("/api/v1/devices/pair", async (request: any, reply) => {
    const recent = (pairingAttempts.get(request.ip) ?? []).filter((timestamp) => timestamp > Date.now() - 5 * 60_000);
    if (recent.length >= 10) return reply.code(429).send({ error: "Too many pairing attempts" });
    recent.push(Date.now()); pairingAttempts.set(request.ip, recent);
    const body = request.body as PairingRequest;
    if (!body?.code || !body.deviceId || !body.name || !body.publicKey) return reply.code(400).send({ error: "Incomplete pairing request" });
    if (!store.consumePairingCode(body.code)) return reply.code(401).send({ error: "Invalid or expired pairing code" });
    store.upsertDevice({ id: body.deviceId, name: body.name, publicKey: body.publicKey, fcmToken: body.fcmToken });
    pairingAttempts.delete(request.ip);
    events.publish("device.paired", { id: body.deviceId, name: body.name });
    return { paired: true, serverId: store.serverId };
  });

  app.post("/api/v1/engine/start", async () => { await engine.start(); return { status: engine.status() }; });
  app.post("/api/v1/engine/stop", async () => { await engine.stop(); return { status: engine.status() }; });
  app.post("/api/v1/engine/restart", async () => { await engine.restart(); return { status: engine.status() }; });
  app.post("/api/v1/control/restart", async (_request, reply) => {
    requireLocalAdmin(_request);
    prepareControlRestart(config.runtimeDir,engine.sessions().filter(session=>["idle","running","waiting"].includes(session.status)).map(session=>session.id));
    await engine.stop("Control Service restarted");
    await reply.send({ restarting: true,engineWillStart:true });
    setTimeout(() => process.kill(process.pid,"SIGTERM"), 250);
  });

  app.get("/api/v1/sessions", async () => engine.sessions());
  app.post("/api/v1/sessions", async (request: any, reply) => {
    const body = request.body ?? {};
    workspaceFor(request, String(body.workspace || config.workspaceRoot),true);
    const session = await engine.createSession({ workspace: String(body.workspace ?? ""), name: body.name });
    return reply.code(201).send(session);
  });
  app.post("/api/v1/sessions/import", async (request: any, reply) => {
    requireLocalAdmin(request);
    const body = request.body ?? {};
    const session = await engine.importTerminalSession(String(body.sourcePath ?? ""), String(body.workspace ?? ""), body.name);
    return reply.code(201).send(session);
  });
  app.post("/api/v1/sessions/:id/resume", async (request: any) => engine.resumeSession(request.params.id));
  app.get("/api/v1/sessions/:id/subagent-runs", async (request:any) => engine.subagentRuns(request.params.id));
  app.get("/api/v1/sessions/:id/subagents", async (request: any) => engine.subagents(request.params.id));
  app.get("/api/v1/sessions/:id/extension-ui", async (request: any) => engine.extensionUiState(request.params.id));
  app.post("/api/v1/sessions/:id/reask", async(request:any)=>engine.reask(request.params.id,String(request.body?.entryId??""),String(request.body?.message??"")));
  app.post("/api/v1/sessions/:id/stop", async (request: any) => { await engine.stopSession(request.params.id, true); return { stopped: true }; });
  app.delete("/api/v1/sessions/:id", async (request: any, reply) => {
    await engine.deleteSession(request.params.id);
    return reply.code(204).send();
  });
  app.post("/api/v1/sessions/:id/commands", async (request: any) => {
    if (["bash", "abort_bash", "export_html", "switch_session", "set_auto_compaction", "reload_extensions"].includes(request.body?.command)) requireLocalAdmin(request);
    if (request.body?.command === "set_auto_compaction" && request.body?.payload?.enabled && extensionInventory().some(item=>item.name==="billion-context")) {
      throw Object.assign(new Error("ACP owns context compression; a second automatic compaction mechanism is disabled"),{statusCode:409,code:"ACP_OWNS_COMPACTION"});
    }
    const result = await engine.execute(request.params.id, request.body as SessionCommand);
    return { result: result ?? null };
  });

  app.get("/api/v1/events/:seq", async (request: any, reply) => {
    const seq = Number.parseInt(request.params.seq, 10);
    const event = Number.isInteger(seq) ? store.event(seq) : undefined;
    return event ?? reply.code(404).send({ error: "Event not found" });
  });

  app.get("/api/v1/questions", async (request: any) => store.questions(request.query?.status));
  app.get("/api/v1/questions/:id", async (request: any, reply) => store.question(request.params.id) ?? reply.code(404).send({ error: "Question not found" }));
  app.post("/api/v1/questions/:id/answer", async (request: any) => interactions.answerQuestion(request.params.id, (request.body?.answers ?? []) as UserAnswer[]));
  app.post("/api/v1/questions/:id/cancel", async (request: any) => interactions.cancelQuestion(request.params.id));

  app.get("/api/v1/approvals", async (request: any) => store.approvals(request.query?.status));
  app.get("/api/v1/approvals/:id", async (request: any, reply) => store.approval(request.params.id) ?? reply.code(404).send({ error: "Approval not found" }));
  app.post("/api/v1/approvals/:id/decision", async (request: any) => interactions.resolveApproval(request.params.id, request.body?.decision === "approve"));

  app.post("/api/v1/devices/:id/fcm-token", async (request: any, reply) => {
    if (request.headers["x-pi-device"] !== request.params.id) return reply.code(403).send({ error: "Device mismatch" });
    store.updateDeviceToken(request.params.id, String(request.body?.token ?? ""));
    return { updated: true };
  });
  app.post("/api/v1/devices/:id/web-token", async (request: any, reply) => {
    if (request.headers["x-pi-device"] !== request.params.id) return reply.code(403).send({ error: "Device mismatch" });
    const token = randomToken();
    store.createWebToken(request.params.id, token, Date.now() + 2 * 60_000);
    const interactionId = typeof request.body?.interactionId === "string" ? request.body.interactionId : undefined;
    const query = interactionId ? `?interaction=${encodeURIComponent(interactionId)}` : "";
    return { token, url: `http://${lanAddress()}:${config.port}/${query}#token=${token}` };
  });

  app.get("/api/v1/files/preview", async (request: any, reply) => {
    const file = resolveFileUnderWorkspace(config.workspaceRoot, String(request.query?.path ?? ""));
    if (!isLoopback(request.ip)) {
      const roots=[config.workspaceRoot,...engine.sessions().map(session=>session.workspace)];
      if (!roots.some(root=>{try{return insideWorkspace(root,file)===file;}catch{return false;}})) throw Object.assign(new Error("Unknown workspace"),{statusCode:403});
    }
    protectSecrets(file);
    const content = readFileSync(file);
    if (content.length > 1024 * 1024) return reply.code(413).send({ error: "File is larger than 1 MiB" });
    return { path: file, content: content.toString("utf8") };
  });
  app.post("/api/v1/files/open-rider", async (request: any) => {
    requireLocalAdmin(request);
    const file = resolveFileUnderWorkspace(config.workspaceRoot, String(request.body?.path ?? ""));
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/open", ["-a", "Rider", "--", file], { stdio: "ignore" });
      child.once("error", () => reject(new Error("Cannot launch Rider")));
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("Rider failed to open the file")));
    });
    return { opened: true, path: file };
  });

  app.get("/api/v1/extensions", async () => extensionInventory());
  app.get("/api/v1/extensions/versions", async(request)=>{requireLocalAdmin(request);return extensionVersions();});
  app.post("/api/v1/extensions/update",async(request:any)=>{requireLocalAdmin(request);if(engine.sessions().some(item=>["running","waiting"].includes(item.status)))throw Object.assign(new Error("Finish or pause active sessions before updating extensions"),{statusCode:409});return updateExtension(String(request.body?.source??""),config.runtimeDir);});
  app.get("/api/v1/providers",async(request)=>{requireLocalAdmin(request);return providerSettings();});
  app.put("/api/v1/providers",async(request:any)=>{requireLocalAdmin(request);return saveProviderSettings(request.body);});
  app.put("/api/v1/providers/:id/key",async(request:any)=>{requireLocalAdmin(request);return saveProviderKey(request.params.id,String(request.body?.key??""));});
  app.get("/api/v1/processes",async(request)=>{requireLocalAdmin(request);return ownedProcesses([...terminals.processIds(),...engine.processIds()]);});
  app.post("/api/v1/processes/:pid/stop",async(request:any)=>{
    requireLocalAdmin(request);
    const pid=Number(request.params.pid);
    const owned=await ownedProcesses([...terminals.processIds(),...engine.processIds()]);
    if (!owned.some(item=>item.pid===pid)) throw Object.assign(new Error("Process is not owned by Pi Remote"),{statusCode:403});
    process.kill(pid,"SIGTERM");return {stopped:true};
  });
  app.get("/api/v1/extensions/config", async (request: any) => extensionConfig(String(request.query?.name ?? "")));
  app.put("/api/v1/extensions/config", async (request: any) => {
    requireLocalAdmin(request);
    return saveExtensionConfig(String(request.body?.name ?? ""), request.body?.patch ?? {});
  });

  app.get("/api/v1/workspace/tree", async (request: any) =>
    listWorkspace(workspaceFor(request, request.query?.workspace), String(request.query?.path ?? ".")));
  app.get("/api/v1/workspace/search", async (request: any) =>
    searchWorkspace(workspaceFor(request, request.query?.workspace), String(request.query?.q ?? ""), request.query?.contents==="true"));
  app.get("/api/v1/workspace/hex",async(request:any)=>readHex(workspaceFor(request,request.query?.workspace),String(request.query?.path??"")));
  app.get("/api/v1/workspace/document", async (request: any) =>
    readDocument(workspaceFor(request, request.query?.workspace), String(request.query?.path ?? ""), !isLoopback(request.ip)));
  app.get("/api/v1/workspace/media", async (request: any, reply) => {
    const path = insideWorkspace(workspaceFor(request,request.query?.workspace),String(request.query?.path??""));
    protectSecrets(path);
    const stat = statSync(path);
    if (!stat.isFile()) throw Object.assign(new Error("Not a file"),{statusCode:400});
    const types:Record<string,string>={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",mp4:"video/mp4",webm:"video/webm",mp3:"audio/mpeg",wav:"audio/wav",ogg:"audio/ogg"};
    const type=types[path.split(".").at(-1)?.toLowerCase()??""];
    if (!type) throw Object.assign(new Error("Unsupported media format"),{statusCode:415});
    reply.header("Accept-Ranges","bytes").header("Content-Type",type).header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff");
    const range=request.headers.range;
    if (range) {
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return reply.code(416).header("Content-Range",`bytes */${stat.size}`).send();
      const start=match[1]?Number(match[1]):Math.max(0,stat.size-Number(match[2]));
      const end=match[1]&&match[2]?Math.min(stat.size-1,Number(match[2])):stat.size-1;
      if (!Number.isSafeInteger(start)||start>end||start>=stat.size) return reply.code(416).header("Content-Range",`bytes */${stat.size}`).send();
      return reply.code(206).header("Content-Range",`bytes ${start}-${end}/${stat.size}`).header("Content-Length",end-start+1).send(createReadStream(path,{start,end}));
    }
    return reply.header("Content-Length",stat.size).send(createReadStream(path));
  });
  app.put("/api/v1/workspace/document", async (request: any) => {
    requireLocalAdmin(request);
    return writeDocument(String(request.body?.workspace ?? config.workspaceRoot), String(request.body?.path ?? ""),
      String(request.body?.content ?? ""), request.body?.etag);
  });
  app.post("/api/v1/workspace/upload", { bodyLimit: 140 * 1024 * 1024 }, async (request: any) => {
    requireLocalAdmin(request);
    return uploadFile(String(request.body?.workspace ?? config.workspaceRoot), String(request.body?.directory ?? "."),
      String(request.body?.name ?? ""), String(request.body?.base64 ?? ""));
  });

  app.get("/api/v1/git/status", async (request: any) => gitSnapshot(workspaceFor(request, request.query?.workspace)));
  app.get("/api/v1/git/diff", async (request: any) => ({ diff: await gitActions.diff(
    workspaceFor(request, request.query?.workspace), String(request.query?.staged ?? "") === "true",
    request.query?.path ? String(request.query.path) : undefined) }));
  app.get("/api/v1/git/log", async (request: any) => ({ log: await gitActions.log(workspaceFor(request, request.query?.workspace)) }));
  app.get("/api/v1/git/branches", async (request: any) => ({branches:(await gitActions.branches(workspaceFor(request,request.query?.workspace))).trim().split("\n").filter(Boolean)}));
  app.post("/api/v1/git/action", async (request: any) => {
    requireLocalAdmin(request);
    const body = request.body ?? {}; const workspace = String(body.workspace ?? config.workspaceRoot); const action = String(body.action ?? "");
    if (action === "stage") await gitActions.stage(workspace, String(body.path ?? ""));
    else if (action === "unstage") await gitActions.unstage(workspace, String(body.path ?? ""));
    else if (action === "commit") await gitActions.commit(workspace, String(body.message ?? ""));
    else if (action === "switch") await gitActions.switchBranch(workspace, String(body.branch ?? ""));
    else if (action === "pull") await gitActions.pull(workspace);
    else if (action === "push") await gitActions.push(workspace);
    else throw Object.assign(new Error("Unsupported Git action"), { statusCode: 400 });
    return gitSnapshot(workspace);
  });

  app.get("/api/v1/terminals", async (request) => { requireLocalAdmin(request); return terminals.list(); });
  app.post("/api/v1/terminals", async (request: any) => {
    requireLocalAdmin(request);
    return terminals.create(String(request.body?.cwd ?? config.workspaceRoot), request.body?.title, request.body?.cols, request.body?.rows);
  });
  app.patch("/api/v1/terminals/:id", async (request: any) => {
    requireLocalAdmin(request); return terminals.rename(request.params.id, String(request.body?.title ?? ""));
  });
  app.delete("/api/v1/terminals/:id", async (request: any, reply) => {
    requireLocalAdmin(request); terminals.close(request.params.id); return reply.code(204).send();
  });
  app.get("/api/v1/terminals/:id/socket", { websocket: true }, (socket: any, request: any) => {
    requireLocalAdmin(request);
    const detach = terminals.attach(request.params.id, (packet) => socket.readyState === 1 && socket.send(JSON.stringify(packet)));
    socket.on("message", (raw: Buffer) => {
      try {
        const packet = JSON.parse(raw.toString());
        if (packet.type === "input") terminals.input(request.params.id, String(packet.data ?? ""));
        if (packet.type === "resize") terminals.resize(request.params.id, Number(packet.cols), Number(packet.rows));
      } catch { /* malformed terminal packets are ignored */ }
    });
    socket.on("close", detach);
  });

  app.get("/api/v1/plugins", async (request) => isLoopback(request.ip)?pluginHost.list():plugins.list().map(({id,name,version,description,permissions})=>({id,name,version,description,permissions})));
  app.all("/plugins-api/:id/*",async(request:any,reply)=>{localPluginRequest(request);pluginHost.manager.handleHttp(request.params.id,request.method,request.params["*"],request,pluginResponse(reply));return reply;});
  app.get("/plugins/:id/client/*",async(request:any,reply)=>{localPluginRequest(request);if(pluginHost.blocked(request.params.id))return reply.code(403).send({code:"PLUGIN_DOM_CONSENT_REQUIRED"});const path=plugins.asset(request.params.id,"client/"+request.params["*"]);return reply.type(/\.m?js$/.test(path)?"text/javascript":/\.css$/.test(path)?"text/css":"application/octet-stream").send(readFileSync(path));});
  app.get("/api/v1/plugins/grants",async(request)=>{requireLocalAdmin(request);return pluginHost.grants();});
  app.post("/api/v1/plugins/grants/:id",async(request:any)=>{requireLocalAdmin(request);return pluginHost.decide(request.params.id,request.body?.ok===true,request.body?.remember===true);});
  app.post("/api/v1/plugins/:id/dom",async(request:any)=>{requireLocalAdmin(request);return pluginHost.dom(request.params.id,request.body?.granted===true);});
  app.delete("/api/v1/plugins/:id/grants/:family",async(request:any)=>{requireLocalAdmin(request);return pluginHost.revoke(request.params.id,request.params.family,request.query?.path)??{};});
  app.post("/api/v1/plugins/attach",async(request:any)=>{requireLocalAdmin(request);await pluginHost.attach(request.body?.sessionId);return {attached:true};});
  app.get("/api/v1/plugins/background",async(request)=>{requireLocalAdmin(request);return pluginHost.manager.bgTasks();});
  app.post("/api/v1/plugins/guards/:phase",async(request:any)=>{requireLocalAdmin(request);return request.params.phase==="pre"?(await pluginHost.manager.evaluateToolPre(request.body)).verdict:await pluginHost.manager.evaluateToolPost(request.body)??null;});
  app.delete("/api/v1/plugins/background/:id",async(request:any)=>{requireLocalAdmin(request);return {stopped:pluginHost.manager.stopPluginBgTask(request.params.id)};});
  app.get("/api/v1/plugins/catalog",async()=>pluginCatalog);
  app.post("/api/v1/plugins/preview", async (request: any) => { requireLocalAdmin(request); return plugins.inspect(String(request.body?.source ?? "")); });
  app.get("/api/v1/plugins/commands", async (request) => { requireLocalAdmin(request); return pluginHost.commands(); });
  app.get("/api/v1/plugins/tools", async (request) => { requireLocalAdmin(request); return pluginHost.tools(); });
  app.get("/api/v1/plugins/:id/ui",async(request:any)=>{requireLocalAdmin(request);return pluginHost.ui(request.params.id);});
  app.post("/api/v1/plugins/install", async (request: any) => {
    requireLocalAdmin(request);
    if (!request.body?.digest) throw Object.assign(new Error("Review plugin manifest before installation"), {statusCode:428});
    const manifest = plugins.install(String(request.body?.source ?? ""), String(request.body.digest));
    try { await pluginHost.activate(manifest); }
    catch (error) {
      try { await pluginHost.activate(plugins.rollback(manifest.id)); }
      catch { await pluginHost.deactivate(manifest.id); plugins.remove(manifest.id); }
      throw error;
    }
    return manifest;
  });
  app.post("/api/v1/plugins/:id/rollback", async (request: any) => { requireLocalAdmin(request); const manifest=plugins.rollback(request.params.id); await pluginHost.activate(manifest); return manifest; });
  app.get("/api/v1/plugins/:id/config", async (request: any) => { requireLocalAdmin(request); return pluginHost.config(request.params.id); });
  app.put("/api/v1/plugins/:id/config", async (request: any) => { requireLocalAdmin(request); return pluginHost.saveConfig(request.params.id,request.body??{}); });
  app.post("/api/v1/plugins/:id/message", async (request: any) => { requireLocalAdmin(request); await pluginHost.message(request.params.id,request.body); return {sent:true}; });
  app.post("/api/v1/plugins/:id/command", async (request: any) => { requireLocalAdmin(request); return await pluginHost.command(request.params.id,String(request.body?.name),String(request.body?.args??"")) ?? null; });
  app.post("/api/v1/plugins/:id/tool", async (request: any) => { requireLocalAdmin(request); return pluginHost.tool(request.params.id,String(request.body?.name),String(request.body?.callId),request.body?.params??{}); });
  app.get("/api/v1/plugins/:id/asset/*", async (request: any, reply) => {
    requireLocalAdmin(request);
    if(pluginHost.blocked(request.params.id))return reply.code(403).send({error:"Explicit DOM consent required",code:"PLUGIN_DOM_CONSENT_REQUIRED"});
    const path=plugins.asset(request.params.id,request.params["*"]);
    const extension=path.split(".").at(-1);
    reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'");
    return reply.type(extension==="mjs"||extension==="js"?"text/javascript":extension==="css"?"text/css":"application/octet-stream").send(readFileSync(path));
  });
  app.delete("/api/v1/plugins/:id", async (request: any, reply) => {
    requireLocalAdmin(request); await pluginHost.deactivate(request.params.id); plugins.remove(request.params.id); return reply.code(204).send();
  });

  app.get("/api/v1/events", { websocket: true }, (socket: any, request: any) => {
    requireAuth(store, request);
    const clientId=randomUUID();
    socket.on("message",(raw:Buffer)=>{try {const packet=JSON.parse(raw.toString());if(packet.type==="client.visibility")notifier.setForegroundClient?.(clientId,packet.visible===true);}catch{}});
    const raw = new URL(request.raw.url ?? "/", "http://localhost").searchParams.get("after");
    const after = Number.parseInt(raw ?? "0", 10) || 0;
    const replay = events.after(after);
    for (const event of replay) if(isLoopback(request.ip)||!event.type.startsWith("plugin."))socket.send(JSON.stringify(event));
    if (replay.length === 1000) socket.send(JSON.stringify({seq:replay.at(-1)!.seq,type:"server.replay_truncated",payload:{},timestamp:new Date().toISOString(),serverId:store.serverId}));
    const unsubscribe = events.subscribe((event) => {
      if (socket.readyState === 1 && (isLoopback(request.ip)||!event.type.startsWith("plugin."))) socket.send(JSON.stringify(event));
    });
    socket.on("close", () => {unsubscribe();notifier.setForegroundClient?.(clientId,false);});
  });

  if (existsSyncSafe(config.webAssets)) {
    await app.register(fastifyStatic, { root: config.webAssets, prefix: "/" });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Not found" });
    });
  } else {
    app.get("/", async (_request, reply) => reply.type("text/html").send(
      "<!doctype html><meta charset=utf-8><title>Pi Control</title><h1>Pi Control</h1><p>Web assets are not built. Run <code>npm run build</code>.</p>",
    ));
  }
  return app;
}

function existsSyncSafe(path: string): boolean {
  try { return readFileSync(`${path}/index.html`).length > 0; } catch { return false; }
}

function lanAddress(): string {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) return address.address;
    }
  }
  return "127.0.0.1";
}

function allowedHttpHost(hostWithPort: string): boolean {
  const host = (hostWithPort.startsWith("[")
    ? hostWithPort.slice(1, hostWithPort.indexOf("]"))
    : hostWithPort.split(":")[0])?.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  const localName = hostname().toLowerCase();
  if (host === localName || host === `${localName}.local` || host === localName.replace(/\.local$/, "")) return true;
  return Object.values(networkInterfaces()).some((addresses) =>
    (addresses ?? []).some((address) => !address.internal && address.address.toLowerCase() === host));
}
