import type { Approval, ClientCapabilities, ExtensionUiState, FileDocument, GitSnapshot, PiEvent, PluginManifest, ServerStatus, SessionCommand, SessionSummary, TerminalSession, UserAnswer, UserQuestion } from "@pi-local/protocol";
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
  skipped?: string;
}
export type NotificationPreferences = { approvals: boolean; questions: boolean; errors: boolean; engine: boolean; completed: boolean };

export type ControlStatus = ServerStatus & {
  notifications?: {
    state: "enabled" | "disabled" | "error";
    pairedDevices: number;
    registeredDevices: number;
    lastDelivery?: NotificationDelivery;
    preferences?: NotificationPreferences;
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
  saveNotifications: (preferences: NotificationPreferences) => api<NotificationPreferences>("/settings/notifications", {method:"PUT",body:JSON.stringify(preferences)}),
  startPairing: () => api<{ code: string; expiresAt: number; host: string; deepLink: string }>("/pairing/start", { method: "POST" }),
  sessions: () => api<SessionSummary[]>("/sessions"),
  createSession: (workspace: string, name: string) => api<SessionSummary>("/sessions", { method: "POST", body: JSON.stringify({ workspace, name }) }),
  importSession: (sourcePath: string, workspace: string, name: string) => api<SessionSummary>("/sessions/import", { method: "POST", body: JSON.stringify({ sourcePath, workspace, name }) }),
  resumeSession: (id: string) => api<SessionSummary>(`/sessions/${id}/resume`, { method: "POST" }),
  stopSession: (id: string) => api(`/sessions/${id}/stop`, { method: "POST" }),
  deleteSession: (id: string) => api<void>(`/sessions/${id}`, { method: "DELETE" }),
  subagentRuns: (id:string) => api<any[]>(`/sessions/${id}/subagent-runs`),
  subagents: (id: string) => api<SubagentProfile[]>(`/sessions/${id}/subagents`),
  extensionUi: (id: string) => api<ExtensionUiState>(`/sessions/${id}/extension-ui`),
  reask: (id:string,entryId:string,message:string)=>api<SessionSummary>(`/sessions/${id}/reask`,{method:"POST",body:JSON.stringify({entryId,message})}),
  command: <T = unknown>(id: string, command: string, payload: Record<string, unknown> = {}) =>
    api<{ result: T }>(`/sessions/${id}/commands`, { method: "POST", body: JSON.stringify({ command, payload } satisfies SessionCommand) }).then((value) => value.result),
  questions: () => api<UserQuestion[]>("/questions"),
  answerQuestion: (id: string, answers: UserAnswer[]) => api<UserQuestion>(`/questions/${id}/answer`, { method: "POST", body: JSON.stringify({ answers }) }),
  cancelQuestion: (id: string) => api<UserQuestion>(`/questions/${id}/cancel`, { method: "POST" }),
  approvals: () => api<Approval[]>("/approvals"),
  decideApproval: (id: string, approve: boolean) => api<Approval>(`/approvals/${id}/decision`, { method: "POST", body: JSON.stringify({ decision: approve ? "approve" : "reject" }) }),
  diagnostics: () => api<{logs:Array<{name:string;text:string}>}>("/settings/pi/diagnostics"),
  scope: (sessionId?: string) => api<{patterns:string[];resolved:string[];models:Array<{id:string;provider:string}>;catalogAvailable:boolean;diagnostics:Array<{message:string}>}>(`/settings/pi/scope${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`),
  saveScope: (patterns:string[], expected:string[]) => api("/settings/pi/scope", {method:"PUT",body:JSON.stringify({patterns,expected})}),
  directories: (path: string) => api<{ path: string; parent: string | null; directories: Array<{name: string; path: string}> }>(`/directories?path=${encodeURIComponent(path)}`),
  openRider: (path: string) => api("/files/open-rider", { method: "POST", body: JSON.stringify({ path }) }),
  capabilities: () => api<ClientCapabilities>("/capabilities"),
  extensions: () => api<Array<{source:string;name:string;version:string;description:string;extensions:string[];skills:string[]}>>("/extensions"),
  extensionVersions: () => api<any[]>("/extensions/versions"),
  updateExtension: (source:string) => api("/extensions/update",{method:"POST",body:JSON.stringify({source})}),
  providers: () => api<any>("/providers"),
  saveProviders: (value:unknown) => api("/providers",{method:"PUT",body:JSON.stringify(value)}),
  saveProviderKey: (id:string,key:string) => api(`/providers/${encodeURIComponent(id)}/key`,{method:"PUT",body:JSON.stringify({key})}),
  processes: () => api<Array<{pid:number;parent:number;command:string;ports:string[]}>>("/processes"),
  stopProcess: (pid:number) => api(`/processes/${pid}/stop`,{method:"POST"}),
  extensionConfig: (name: string) => api<any>(`/extensions/config?name=${encodeURIComponent(name)}`),
  saveExtensionConfig: (name: string, patch: Record<string, unknown>) => api<any>("/extensions/config", {method:"PUT",body:JSON.stringify({name,patch})}),
  workspaceTree: (workspace: string, path = ".") => api<any>(`/workspace/tree?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(path)}`),
  workspaceSearch: (workspace: string, query: string, contents=false) => api<any>(`/workspace/search?workspace=${encodeURIComponent(workspace)}&q=${encodeURIComponent(query)}&contents=${contents}`),
  hex: (workspace:string,path:string)=>api<{path:string;size:number;content:string;truncated:boolean}>(`/workspace/hex?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(path)}`),
  pluginCatalog:()=>api<Array<{id:string;name:string;description:string;source:string;homepage:string}>>("/plugins/catalog"),
  pluginUi:(id:string)=>api<Array<Record<string,any>>>(`/plugins/${id}/ui`),
  pluginGrants:()=>api<any>("/plugins/grants"),
  decidePluginGrant:(id:string,ok:boolean,remember=false)=>api(`/plugins/grants/${id}`,{method:"POST",body:JSON.stringify({ok,remember})}),
  domConsent:(id:string,granted:boolean)=>api(`/plugins/${id}/dom`,{method:"POST",body:JSON.stringify({granted})}),
  attachPlugins:(sessionId?:string)=>api("/plugins/attach",{method:"POST",body:JSON.stringify({sessionId})}),
  pluginBackground:()=>api<any[]>("/plugins/background"),
  stopPluginBackground:(id:string)=>api(`/plugins/background/${encodeURIComponent(id)}`,{method:"DELETE"}),
  revokePluginGrant:(id:string,family:string,path?:string)=>api(`/plugins/${id}/grants/${family}${path?`?path=${encodeURIComponent(path)}`:""}`,{method:"DELETE"}),
  document: (workspace: string, path: string) => api<FileDocument>(`/workspace/document?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(path)}`),
  saveDocument: (workspace: string, path: string, content: string, etag: string) => api<FileDocument>("/workspace/document", {method:"PUT",body:JSON.stringify({workspace,path,content,etag})}),
  upload: (workspace: string, directory: string, name: string, base64: string) => api("/workspace/upload", {method:"POST",body:JSON.stringify({workspace,directory,name,base64})}),
  gitStatus: (workspace: string) => api<GitSnapshot>(`/git/status?workspace=${encodeURIComponent(workspace)}`),
  gitDiff: (workspace: string, path?: string, staged = false) => api<{diff:string}>(`/git/diff?workspace=${encodeURIComponent(workspace)}&staged=${staged}${path ? `&path=${encodeURIComponent(path)}` : ""}`),
  gitLog: (workspace: string) => api<{log:string}>(`/git/log?workspace=${encodeURIComponent(workspace)}`),
  gitBranches: (workspace: string) => api<{branches:string[]}>(`/git/branches?workspace=${encodeURIComponent(workspace)}`),
  gitAction: (workspace: string, action: string, extra: Record<string,unknown> = {}) => api<GitSnapshot>("/git/action", {method:"POST",body:JSON.stringify({workspace,action,...extra})}),
  terminals: () => api<TerminalSession[]>("/terminals"),
  createTerminal: (cwd: string) => api<TerminalSession>("/terminals", {method:"POST",body:JSON.stringify({cwd})}),
  closeTerminal: (id: string) => api<void>(`/terminals/${id}`, {method:"DELETE"}),
  renameTerminal: (id: string, title: string) => api<TerminalSession>(`/terminals/${id}`, {method:"PATCH",body:JSON.stringify({title})}),
  plugins: () => api<PluginManifest[]>("/plugins"),
  previewPlugin: (source: string) => api<{source:string;digest:string;manifest:PluginManifest}>("/plugins/preview", {method:"POST",body:JSON.stringify({source})}),
  installPlugin: (source: string, digest: string) => api<PluginManifest>("/plugins/install", {method:"POST",body:JSON.stringify({source,digest})}),
  rollbackPlugin: (id: string) => api<PluginManifest>(`/plugins/${id}/rollback`, {method:"POST"}),
  pluginConfig: (id: string) => api<Record<string,unknown>>(`/plugins/${id}/config`),
  savePluginConfig: (id: string, config: unknown) => api(`/plugins/${id}/config`, {method:"PUT",body:JSON.stringify(config)}),
  pluginMessage: (id: string, payload: unknown) => api(`/plugins/${id}/message`, {method:"POST",body:JSON.stringify(payload)}),
};

export async function mediaUrl(workspace: string, path: string): Promise<string> {
  const response = await fetch(`/api/v1/workspace/media?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent(path)}`, {headers:token?{authorization:`Bearer ${token}`}:{}});
  if (!response.ok) throw new ApiError("Cannot preview media",response.status);
  return URL.createObjectURL(await response.blob());
}

export function authenticatedSocket(path: string): WebSocket {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return token ? new WebSocket(`${scheme}://${location.host}/api/v1${path}`, ["pi-web", token]) : new WebSocket(`${scheme}://${location.host}/api/v1${path}`);
}

export function connectEvents(after: number, onEvent: (event: PiEvent) => void, onState: (connected: boolean) => void): () => void {
  let stopped = false;
  let socket: WebSocket | undefined;
  let timer: number | undefined;
  const visibility=()=>{if(socket?.readyState===1)socket.send(JSON.stringify({type:"client.visibility",visible:document.visibilityState==="visible"}));};
  document.addEventListener("visibilitychange",visibility);
  const presence=window.setInterval(visibility,15000);
  const connect = () => {
    if (stopped) return;
    socket = authenticatedSocket(`/events?after=${after}`);
    socket.onopen = () => {onState(true);visibility();};
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
  return () => { stopped = true; if (timer) clearTimeout(timer);clearInterval(presence);document.removeEventListener("visibilitychange",visibility);socket?.close(); };
}
