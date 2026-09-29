import type { Approval, PiEvent, ServerStatus, SessionCommand, SessionSummary, UserAnswer, UserQuestion } from "@pi-local/protocol";
import type { PromptSnippet } from "@pi-local/prompt-snippets";

export interface SubagentProfile {
  name: string;
  description?: string;
  tools: string[];
  skills: string[];
  subagents: string[];
  thinking?: string;
  source: "global" | "project";
}

export interface NotificationDelivery {
  eventId: string;
  attemptedAt: string;
  attempted: boolean;
  successCount: number;
  failureCount: number;
  error?: string;
}

export type ControlStatus = ServerStatus & {
  notifications?: {
    state: "enabled" | "disabled" | "error";
    pairedDevices: number;
    registeredDevices: number;
    lastDelivery?: NotificationDelivery;
  };
};

const SESSION_KEY = "pi-web-session";
let token = sessionStorage.getItem(SESSION_KEY) ?? "";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export async function exchangeHashToken(): Promise<void> {
  const match = location.hash.match(/(?:^#|&)token=([^&]+)/);
  if (!match) return;
  history.replaceState(null, "", location.pathname + location.search);
  const response = await fetch("/api/v1/auth/exchange", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: decodeURIComponent(match[1]!) }),
  });
  if (!response.ok) throw new Error("Nie udało się uwierzytelnić linku z aplikacji");
  const data = await response.json();
  token = data.token;
  sessionStorage.setItem(SESSION_KEY, token);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`/api/v1${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error ?? `HTTP ${response.status}`, response.status);
  return data as T;
}

export const controlApi = {
  status: () => api<ControlStatus>("/status"),
  config: () => api<{ workspaceRoot: string }>("/config"),
  snippets: () => api<PromptSnippet[]>("/snippets"),
  engine: (action: "start" | "stop" | "restart") => api(`/engine/${action}`, { method: "POST" }),
  restartControl: () => api("/control/restart", { method: "POST" }),
  testNotification: () => api<{ delivered: true; delivery: NotificationDelivery }>("/notifications/test", { method: "POST" }),
  startPairing: () => api<{ code: string; expiresAt: number; host: string; deepLink: string }>("/pairing/start", { method: "POST" }),
  sessions: () => api<SessionSummary[]>("/sessions"),
  createSession: (workspace: string, name: string) => api<SessionSummary>("/sessions", { method: "POST", body: JSON.stringify({ workspace, name }) }),
  importSession: (sourcePath: string, workspace: string, name: string) => api<SessionSummary>("/sessions/import", { method: "POST", body: JSON.stringify({ sourcePath, workspace, name }) }),
  resumeSession: (id: string) => api<SessionSummary>(`/sessions/${id}/resume`, { method: "POST" }),
  stopSession: (id: string) => api(`/sessions/${id}/stop`, { method: "POST" }),
  deleteSession: (id: string) => api<void>(`/sessions/${id}`, { method: "DELETE" }),
  subagentRuns: (id:string) => api<any[]>(`/sessions/${id}/subagent-runs`),
  subagents: (id: string) => api<SubagentProfile[]>(`/sessions/${id}/subagents`),
  command: <T = unknown>(id: string, command: string, payload: Record<string, unknown> = {}) =>
    api<{ result: T }>(`/sessions/${id}/commands`, { method: "POST", body: JSON.stringify({ command, payload } satisfies SessionCommand) }).then((value) => value.result),
  questions: () => api<UserQuestion[]>("/questions"),
  answerQuestion: (id: string, answers: UserAnswer[]) => api<UserQuestion>(`/questions/${id}/answer`, { method: "POST", body: JSON.stringify({ answers }) }),
  cancelQuestion: (id: string) => api<UserQuestion>(`/questions/${id}/cancel`, { method: "POST" }),
  approvals: () => api<Approval[]>("/approvals"),
  decideApproval: (id: string, approve: boolean) => api<Approval>(`/approvals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision: approve ? "approve" : "reject" }) }),
  scope: (sessionId?: string) => api<{patterns:string[];resolved:string[];models:Array<{id:string;provider:string}>;catalogAvailable:boolean;diagnostics:Array<{message:string}>}>(`/settings/pi/scope${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`),
  saveScope: (patterns:string[], expected:string[]) => api("/settings/pi/scope", {method:"PUT",body:JSON.stringify({patterns,expected})}),
  directories: (path: string) => api<{ path: string; parent: string | null; directories: Array<{name: string; path: string}> }>(`/directories?path=${encodeURIComponent(path)}`),
  openRider: (path: string) => api("/files/open-rider", { method: "POST", body: JSON.stringify({ path }) }),
};

export function connectEvents(after: number, onEvent: (event: PiEvent) => void, onState: (connected: boolean) => void): () => void {
  let stopped = false;
  let socket: WebSocket | undefined;
  let timer: number | undefined;
  const connect = () => {
    if (stopped) return;
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    socket = token
      ? new WebSocket(`${scheme}://${location.host}/api/v1/events?after=${after}`, ["pi-web", token])
      : new WebSocket(`${scheme}://${location.host}/api/v1/events?after=${after}`);
    socket.onopen = () => onState(true);
    socket.onmessage = (message) => {
      const event = JSON.parse(message.data) as PiEvent;
      after = Math.max(after, event.seq);
      onEvent(event);
    };
    socket.onclose = () => {
      onState(false);
      if (!stopped) timer = window.setTimeout(connect, 1500);
    };
  };
  connect();
  return () => { stopped = true; if (timer) clearTimeout(timer); socket?.close(); };
}
