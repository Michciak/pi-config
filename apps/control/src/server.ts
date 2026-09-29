import { scopeSnapshot, saveScope } from "./pi-settings.js";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import websocket from "@fastify/websocket";
import type { PairingRequest, SessionCommand, UserAnswer } from "@pi-local/protocol";
import { loadSnippets } from "@pi-local/prompt-snippets";
import type { ControlConfig } from "./config.js";
import { authorized, isLoopback, randomToken } from "./auth.js";
import { EngineManager } from "./engine.js";
import { EventBus } from "./events.js";
import { FirebaseNotifier } from "./firebase.js";
import { InteractionBroker } from "./interactions.js";
import { StateStore } from "./store.js";
import { resolveFileUnderWorkspace, listWorkspaceDirectories } from "./workspace.js";

interface Dependencies {
  config: ControlConfig;
  store: StateStore;
  events: EventBus;
  notifier: FirebaseNotifier;
  interactions: InteractionBroker;
  engine: EngineManager;
}

function requireAuth(store: StateStore, request: FastifyRequest): void {
  if (!authorized(store, request)) throw Object.assign(new Error("Authentication required"), { statusCode: 401 });
}

const pairingAttempts = new Map<string, number[]>();

export async function buildServer(deps: Dependencies): Promise<FastifyInstance> {
  const { config, store, events, notifier, interactions, engine } = deps;
  const app = Fastify({ logger: { level: process.env.PI_WEB_LOG_LEVEL ?? "info" }, bodyLimit: 12 * 1024 * 1024 });
  await app.register(swagger, { openapi: { info: { title: "Pi Local Control API", version: "0.1.0" } } });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });
  await app.register(websocket);

  app.setErrorHandler((error: any, _request, reply) => {
    const status = Number(error?.statusCode) || 500;
    if (status >= 500) app.log.error(error);
    reply.code(status).send({ error: status >= 500 ? "Internal server error" : error.message });
  });

  app.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/v1/")) return;
    if (!allowedHttpHost(request.hostname)) return reply.code(403).send({ error: "Untrusted Host header" });
    const origin = request.headers.origin;
    if (origin && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      try {
        if (new URL(origin).host !== request.headers.host) return reply.code(403).send({ error: "Cross-origin mutation rejected" });
      } catch { return reply.code(403).send({ error: "Invalid Origin header" }); }
    }
    const path = request.url.split("?")[0];
    const publicRoute = path === "/api/v1/auth/exchange" || path === "/api/v1/devices/pair";
    if (!publicRoute && !authorized(store, request)) return reply.code(401).send({ error: "Authentication required" });
  });

  app.get("/api/v1/status", async () => ({
    serverId: store.serverId,
    control: "online",
    engine: engine.status(),
    sessions: engine.sessions(),
    firebase: notifier.status(),
    notifications: notifier.diagnostics(),
    version: "0.1.0",
  }));
  app.get("/api/v1/config", async () => ({ workspaceRoot: config.workspaceRoot, port: config.port }));
  app.get("/api/v1/openapi.json", async () => app.swagger());
  app.get("/api/v1/settings/pi/scope", async (request:any) => {
    let models: any[] = [];
    const ids = [...new Set([request.query?.sessionId, ...engine.sessions().map(session => session.id)].filter(Boolean))];
    for (const id of ids) {
      try { models = await engine.execute(String(id), {command:"get_available_models",payload:{}}) as any[]; if(models.length) break; }
      catch(error:any) { if(error.statusCode !== 409) throw error; }
    }
    return scopeSnapshot(config.runtimeDir, models as any[]);
  });
  app.put("/api/v1/settings/pi/scope", async (request:any) => {
    await saveScope(config.runtimeDir, request.body?.patterns, request.body?.expected);
    return {saved:true, appliesTo:"new-or-resumed-sessions"};
  });
  app.get("/api/v1/directories", async (request: any, reply) => {
    try { return listWorkspaceDirectories(config.workspaceRoot, String(request.query?.path ?? config.workspaceRoot)); }
    catch { return reply.code(400).send({ error: "Folder is unavailable or outside the allowed workspace" }); }
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
    await engine.stop("Control Service restarted");
    await reply.send({ restarting: true });
    setTimeout(() => process.exit(0), 250);
  });

  app.get("/api/v1/sessions", async () => engine.sessions());
  app.post("/api/v1/sessions", async (request: any, reply) => {
    const body = request.body ?? {};
    const session = await engine.createSession({ workspace: String(body.workspace ?? ""), name: body.name });
    return reply.code(201).send(session);
  });
  app.post("/api/v1/sessions/import", async (request: any, reply) => {
    const body = request.body ?? {};
    const session = await engine.importTerminalSession(String(body.sourcePath ?? ""), String(body.workspace ?? ""), body.name);
    return reply.code(201).send(session);
  });
  app.post("/api/v1/sessions/:id/resume", async (request: any) => engine.resumeSession(request.params.id));
  app.get("/api/v1/sessions/:id/subagent-runs", async (request:any) => engine.subagentRuns(request.params.id));
  app.get("/api/v1/sessions/:id/subagents", async (request: any) => engine.subagents(request.params.id));
  app.post("/api/v1/sessions/:id/stop", async (request: any) => { await engine.stopSession(request.params.id, true); return { stopped: true }; });
  app.delete("/api/v1/sessions/:id", async (request: any, reply) => {
    await engine.deleteSession(request.params.id);
    return reply.code(204).send();
  });
  app.post("/api/v1/sessions/:id/commands", async (request: any) => {
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
    const content = readFileSync(file);
    if (content.length > 1024 * 1024) return reply.code(413).send({ error: "File is larger than 1 MiB" });
    return { path: file, content: content.toString("utf8") };
  });
  app.post("/api/v1/files/open-rider", async (request: any) => {
    const file = resolveFileUnderWorkspace(config.workspaceRoot, String(request.body?.path ?? ""));
    await new Promise<void>((resolve, reject) => {
      const child = spawn("/usr/bin/open", ["-a", "Rider", "--", file], { stdio: "ignore" });
      child.once("error", () => reject(new Error("Cannot launch Rider")));
      child.once("exit", code => code === 0 ? resolve() : reject(new Error("Rider failed to open the file")));
    });
    return { opened: true, path: file };
  });

  app.get("/api/v1/events", { websocket: true }, (socket: any, request: any) => {
    requireAuth(store, request);
    const raw = new URL(request.raw.url ?? "/", "http://localhost").searchParams.get("after");
    const after = Number.parseInt(raw ?? "0", 10) || 0;
    for (const event of events.after(after)) socket.send(JSON.stringify(event));
    const unsubscribe = events.subscribe((event) => {
      if (socket.readyState === 1) socket.send(JSON.stringify(event));
    });
    socket.on("close", unsubscribe);
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
