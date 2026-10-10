import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {createPortal} from "react-dom";
import { PI_REMOTE_PROTOCOL_VERSION, type Approval, type ClientCapabilities, type ExtensionUiState, type PiEvent, type SessionSummary, type UserQuestion } from "@pi-local/protocol";
import type { PromptSnippet } from "@pi-local/prompt-snippets";
import { ApiError, connectEvents, controlApi, exchangeHashToken, type ControlStatus, type SubagentProfile, type NotificationPreferences } from "./api.js";
import {LocalPanel} from "./Cockpit.js";
import { webCommands, commandSuggestions, selectSlashCommand, type SlashCommand } from "./commandPalette.js";
import { Markdown } from "./Markdown.js";
import { QuestionCard } from "./QuestionCard.js";
import { reduceLiveBlocks, toolEventText, type LiveBlocks } from "./stream.js";

import { promptHistory, historyStep } from "./promptHistory.js";
import { MessageContent } from "./MessageContent.js";
import { Cockpit, TerminalDock } from "./Cockpit.js";
import {PluginRuntime} from "./pluginRuntime.js";
import {ChatStore, useChatField} from "./chatStore.js";
import {Icon} from "./Icon.js";
import {fileReferenceQuery,argumentQuery} from "./completions.js";
import {contextUsagePercent, quotaUsagePercent, usageSeverity, usageHint} from "./usageIndicators.js";

type Model = { provider: string; id: string };
type Suggestion=SlashCommand&{insertion?:string;start?:number;end?:number;directory?:boolean};

const HIDDEN_CHILD_CHATS_KEY = "pi-remote:hidden-child-chats";

function readHiddenChildChats(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(HIDDEN_CHILD_CHATS_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export default function App() {
  const [chatStore] = useState(() => new ChatStore(readHiddenChildChats()));
  const [status, setStatus] = useChatField(chatStore, "status");
  const [capabilities, setCapabilities] = useChatField(chatStore, "capabilities");
  const [extensionSnapshot, setExtensionSnapshot] = useChatField(chatStore, "extensionSnapshot");
  const [mobileView, setMobileView] = useState("chat");
  const [chatQuery, setChatQuery] = useState("");
  const [childQuery, setChildQuery] = useState("");
  const [reaskTarget, setReaskTarget] = useState<{entryId:string;text:string}>();
  const [reasking, setReasking] = useState(false);
  const [shellUpdate, setShellUpdate] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("pi-remote:theme") ?? "dark");
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("pi-remote:theme", theme); window.dispatchEvent(new Event("pi-theme-changed")); }, [theme]);
  useEffect(() => {
    const update = () => setShellUpdate(true);
    window.addEventListener("pi-shell-update", update);
    return () => window.removeEventListener("pi-shell-update", update);
  }, []);
  useEffect(()=>{const open=()=>{setSettingsOpen(false);setModelPicker(false);setAdvanced(false);setMobileView("context");};window.addEventListener("pi-plugin-view",open);return()=>window.removeEventListener("pi-plugin-view",open);},[]);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [importPath, setImportPath] = useState("");
  const [selectedId, setSelectedId] = useChatField(chatStore, "selectedId");
  const [childRuns,setChildRuns] = useChatField(chatStore, "childRuns");
  const [chatTab,setChatTab] = useChatField(chatStore, "chatTab");
  const [hiddenChildChats,setHiddenChildChats] = useChatField(chatStore, "hiddenChildChats");
  const [messageWindow,setMessageWindow] = useState(160);
  const [historyBefore,setHistoryBefore] = useState(0);
  const [loadingHistory,setLoadingHistory] = useState(false);
  const historyRange=useRef<{id:string;start:number;end:number}|undefined>(undefined);
  const [conversationStats,setConversationStats] = useChatField(chatStore, "conversationStats");
  const [editorHeight,setEditorHeight] = useState(52);
  const [editorMaxHeight,setEditorMaxHeight] = useState(320);
  const [shortcutsOpen,setShortcutsOpen] = useState(false);
  const [messages, setMessages] = useChatField(chatStore, "messages");
  const [sessionState, setSessionState] = useChatField(chatStore, "sessionState");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [scope, setScope] = useState<{patterns:string[];resolved:string[];models:Model[];catalogAvailable:boolean;diagnostics:Array<{message:string}>}>({patterns:[],resolved:[],models:[],catalogAvailable:false,diagnostics:[]});
  const [scopeSelection, setScopeSelection] = useState<string[]>([]);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeAll, setScopeAll] = useState(false);
  const [scopeNotice, setScopeNotice] = useState("");
  const [scopeProvider, setScopeProvider] = useState("");
  const [serviceLogs, setServiceLogs] = useState<Array<{name:string;text:string;lineCount?:number;uniqueLineCount?:number}>>([]);
  const [scopeGroup, setScopeGroup] = useState("scope");
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [serviceBusy,setServiceBusy]=useState(false);
  const [quotaBusy,setQuotaBusy]=useState(false);
  const [modelPicker, setModelPicker] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelProvider, setModelProvider] = useState("");
  const [creating, setCreating] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [folders, setFolders] = useState<Awaited<ReturnType<typeof controlApi.directories>>>();
  const folderRequest = useRef(0);
  const [folderError, setFolderError] = useState("");
  const [models, setModels] = useChatField(chatStore, "models");
  const [commands, setCommands] = useChatField(chatStore, "commands");
  const [subagents, setSubagents] = useState<SubagentProfile[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [enabledSnippets, setEnabledSnippets] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useChatField(chatStore, "questions");
  const [approvals, setApprovals] = useChatField(chatStore, "approvals");
  const [events, setEvents] = useChatField(chatStore, "events");
  const [liveBlocks, setLiveBlocks] = useChatField(chatStore, "liveBlocks");
  const [liveUsage, setLiveUsage] = useChatField(chatStore, "liveUsage");
  const [queue, setQueue] = useChatField(chatStore, "queue");
  const [connected, setConnected] = useChatField(chatStore, "connected");
  const historyPosition = useRef(-1);
  const historyDraft = useRef("");
  const [sentPrompts, setSentPrompts] = useState<Record<string, string[]>>({});
  const [composer, setComposer] = useState("");
  const [caret,setCaret]=useState(0);
  const [contextSuggestions,setContextSuggestions]=useState<Suggestion[]>([]);
  const [delivery, setDelivery] = useState<"prompt" | "steer" | "follow_up">("prompt");
  const [images, setImages] = useState<Array<{ type: "image"; data: string; mimeType: string }>>([]);
  const [entryId, setEntryId] = useState("");
  const [rename, setRename] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [inspection, setInspection] = useState<any>();
  const [error, setError] = useState("");
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number; host: string; deepLink: string }>();
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary>();
  const followOutput = useRef(true);
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = conversationRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setEditorMaxHeight(Math.max(52, Math.min(320, Math.floor(entry.contentRect.height * .45) - 80)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const contextRef = useRef<HTMLDivElement>(null);
  const auxiliaryOpen = settingsOpen || modelPicker || advanced;
  const auxiliaryPanel=settingsOpen?"settings":modelPicker?"models":advanced?"tools":undefined;
  function changeAuxiliary(tab?:"models"|"tools"|"settings") {
    if(tab==="models"){openModelPicker();return;}
    if(tab==="settings"){void openSettings();return;}
    setSettingsOpen(false);setModelPicker(false);setAdvanced(tab==="tools");
  }
  useEffect(()=>{if(auxiliaryOpen)setMobileView("context");},[auxiliaryOpen]);
  function openModelPicker(){setSettingsOpen(false);setAdvanced(false);setModelPicker(true);setModelQuery("");setModelProvider("");}
  const selectedRef = useRef<string | undefined>(undefined);
  const eventCursor = useRef(0);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const activeChildren = childRuns.filter(item => ["starting","running","waiting"].includes(item.status));
  const selected = status?.sessions.find((session) => session.id === selectedId);
  const interactionTarget = new URLSearchParams(location.search).get("interaction");
  const engineState = status?.engine ?? "offline";
  const engineLabel = {
    offline: "Offline", stopped: "Zatrzymany", starting: "Uruchamianie",
    running: "Działa", stopping: "Zatrzymywanie", crashed: "Błąd",
  }[engineState];
  const notificationState = status?.notifications?.state ?? status?.firebase ?? "disabled";
  const notificationLabel = { enabled: "Aktywne", disabled: "Nieskonfigurowane", error: "Błąd konfiguracji" }[notificationState];
  async function savePhonePreference(key: keyof NotificationPreferences, enabled: boolean) {
    const previous=status?.notifications?.preferences;
    if(!previous || settingsBusy)return;
    const update=(preferences:NotificationPreferences)=>setStatus(current=>current?.notifications?{...current,notifications:{...current.notifications,preferences}}:current);
    const next={...previous,[key]:enabled};update(next);setSettingsBusy(true);
    try{update(await controlApi.saveNotifications(next));}
    catch(cause){update(previous);setError(String(cause));}
    finally{setSettingsBusy(false);}
  }

  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);
  useEffect(() => {
    try { window.localStorage.setItem(HIDDEN_CHILD_CHATS_KEY, JSON.stringify(hiddenChildChats)); }
    catch { /* Private browsing or a full storage quota must not break the chat. */ }
  }, [hiddenChildChats]);

  const refreshing = useRef<Promise<void> | undefined>(undefined);
  const refreshAgain = useRef(false);
  const loadingSessions = useRef(new Map<string, Promise<void>>());
  const reloadSessions = useRef(new Set<string>());
  const sessionRevisions = useRef(new Map<string, number>());
  function refresh(): Promise<void> {
    if (refreshing.current) { refreshAgain.current=true; return refreshing.current; }
    const task = (async()=>{do { refreshAgain.current=false; await refreshNow(); } while(refreshAgain.current);})().finally(() => { refreshing.current = undefined; });
    refreshing.current = task;
    return task;
  }
  async function refreshNow() {
    const [nextStatus, nextQuestions, nextApprovals] = await Promise.all([
      controlApi.status(), controlApi.questions(), controlApi.approvals(),
    ]);
    setStatus(nextStatus);
    eventCursor.current = nextStatus.eventCursor ?? eventCursor.current;
    setQuestions(nextQuestions);
    setApprovals(nextApprovals);
  }

  function showSession(session: SessionSummary) {
    setStatus((current) => current ? {
      ...current,
      sessions: [session, ...current.sessions.filter((item) => item.id !== session.id)],
    } : current);
  }

  function clearSessionView() {
    selectedRef.current = undefined;
    chatStore.selectSession(); setSubagents([]);
  }

  async function readSession(id: string) {
    const revision = sessionRevisions.current.get(id) ?? 0;
    const [nextMessages, nextState, nextModels, nextCommands, nextSubagents, nextThinkingLevels] = await Promise.all([
      controlApi.command<{messages:any[];start:number;end:number;total:number}>(id, "get_messages_page",{limit:160}),
      controlApi.command(id, "get_state"),
      controlApi.command<Model[]>(id, "get_available_models"),
      controlApi.command<SlashCommand[]>(id, "get_commands"),
      controlApi.subagents(id).catch(() => []),
      controlApi.command<string[]>(id, "get_available_thinking_levels"),
    ]);
    const [nextScope, children, stats, nextExtensionUi] = await Promise.all([controlApi.scope(id), controlApi.subagentRuns(id), controlApi.command(id,"get_session_stats"), controlApi.extensionUi(id)]);
    if (selectedRef.current !== id) return;
    if (revision !== (sessionRevisions.current.get(id) ?? 0)) { reloadSessions.current.add(id); return; }
    if ((nextState as any)?.pendingMessageCount===0) setQueue({steering:[],followUp:[]});
    const prior=historyRange.current;
    const retain=prior?.id===id&&prior.start<nextMessages.start&&prior.end>=nextMessages.start&&prior.end<=nextMessages.total;
    const older=retain?chatStore.get().messages.slice(0,nextMessages.start-prior!.start):[];
    const start=retain?prior!.start:nextMessages.start;
    historyRange.current={id,start,end:nextMessages.end??nextMessages.total};setHistoryBefore(start);
    setScope(nextScope); setChildRuns(children); setConversationStats(stats); setExtensionSnapshot(nextExtensionUi); setThinkingLevels(nextThinkingLevels); setMessages([...older,...nextMessages.messages]); setSessionState(nextState); setModels(nextModels); setCommands([...nextCommands,...webCommands.filter(item=>!nextCommands.some(command=>command.name===item.name))]); setSubagents(nextSubagents);
    if(chatStore.get().capabilities?.localAdmin)void controlApi.attachPlugins(id).catch(()=>{});
  }

  function loadSession(id: string, resumeIfNeeded = true): Promise<void> {
    const pending = loadingSessions.current.get(id);
    if (pending) { reloadSessions.current.add(id); return pending; }
    const task = (async()=>{
      do { reloadSessions.current.delete(id); await loadSessionNow(id,resumeIfNeeded); }
      while(reloadSessions.current.has(id) && selectedRef.current===id);
    })().finally(() => { loadingSessions.current.delete(id); reloadSessions.current.delete(id); });
    loadingSessions.current.set(id, task);
    return task;
  }
  async function loadSessionNow(id: string, resumeIfNeeded = true) {
    const switchingSession = selectedRef.current !== id;
    if (switchingSession && !window.dispatchEvent(new Event("pi-before-session-switch",{cancelable:true}))) return;
    selectedRef.current = id;
    if (switchingSession) chatStore.selectSession(id);
    else setSelectedId(id);
    setMobileView("chat");
    if (switchingSession) {
      setChatTab("main"); setChildRuns([]); setLiveBlocks({}); setLiveUsage(undefined); setQueue({ steering: [], followUp: [] });
      setAdvanced(false); setMessageWindow(160);setHistoryBefore(0); historyPosition.current = -1; historyDraft.current = ""; setComposer("");
    }
    try {
      await readSession(id);
      setError("");
    } catch (cause) {
      if (resumeIfNeeded && cause instanceof ApiError && cause.status === 409 && cause.message === "Session is not running") {
        try {
          await controlApi.resumeSession(id);
          await refresh();
          await readSession(id);
          setError("");
          return;
        } catch (resumeCause) {
          setError(String(resumeCause));
          return;
        }
      }
      setError(String(cause));
    }
  }

  useEffect(() => {
    let cancelled = false;
    let disconnect = () => {};
    let connectedOnce = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh().catch(cause => setError(String(cause))); const id = selectedRef.current; if (id) void controlApi.subagentRuns(id).then(rows => { if (selectedRef.current === id) setChildRuns(rows); }).catch(() => {}); }, 250);
    };
    void (async () => {
      try {
        await exchangeHashToken();
        if (cancelled) return;
        const [config, availableSnippets, nextCapabilities] = await Promise.all([controlApi.config(), controlApi.snippets(), controlApi.capabilities()]);
        if (cancelled) return;
        setWorkspaceRoot(config.workspaceRoot); setWorkspace(config.workspaceRoot);
        setSnippets(availableSnippets);
        setCapabilities(nextCapabilities);
        await refresh();
        if (cancelled) return;
        disconnect = connectEvents(eventCursor.current, (event) => {
          if (event.type === "server.replay_truncated" && selectedRef.current) void loadSession(selectedRef.current);
          if(event.type === "subagent.updated") scheduleRefresh();
          setEvents((current) => [...current.slice(-499), event]);
          if (event.type === "plugin.data") window.dispatchEvent(new CustomEvent("pi-plugin-data",{detail:event.payload}));
          if (event.type.startsWith("plugin.")&&event.type!=="plugin.data")window.dispatchEvent(new CustomEvent("pi-plugin-sdk",{detail:event.payload}));
          if(event.type==="plugin.notify")setError(String((event.payload as any).textEn??(event.payload as any).text??""));
          if (document.visibilityState !== "visible" && "Notification" in window && Notification.permission==="granted" && ["user_question.created","approval.created","pi.agent_settled"].includes(event.type)) {
            const notification=new Notification("Pi Remote",{body:event.type==="pi.agent_settled"?"Pi zakończyło odpowiedź":"Pi czeka na Twoją odpowiedź",tag:event.type+":"+event.sessionId});
            notification.onclick=()=>{window.focus();notification.close();if(event.sessionId)void loadSession(event.sessionId);};
          }
          if (event.type === "engine.status_changed" || event.type.startsWith("session.")) scheduleRefresh();
          if (event.type.startsWith("user_question.") || event.type.startsWith("approval.")) scheduleRefresh();
          if (event.type === "ui.setTitle" && typeof (event.payload as any)?.title === "string") document.title = (event.payload as any).title;
          if (event.type === "ui.set_editor_text" && event.sessionId === selectedRef.current) setComposer(String((event.payload as any)?.text ?? ""));
          if (event.sessionId === selectedRef.current && event.type === "extension.snapshot") setExtensionSnapshot(event.payload as ExtensionUiState);
          if (event.sessionId === selectedRef.current && event.type === "pi.message_start") {
            setLiveBlocks({}); setLiveUsage(undefined);
          }
          if (event.sessionId === selectedRef.current && event.type === "pi.message_update") {
            const payload = event.payload as any;
            setLiveBlocks((current) => reduceLiveBlocks(current, payload.assistantMessageEvent));
            setLiveUsage(payload.usage);
          }
          if (event.sessionId === selectedRef.current && event.type === "pi.queue_update") {
            sessionRevisions.current.set(event.sessionId!, (sessionRevisions.current.get(event.sessionId!)??0)+1);
            const payload = event.payload as any;
            setQueue({ steering: payload.steering ?? [], followUp: payload.followUp ?? [] });
          }
          if (event.sessionId && event.sessionId === selectedRef.current && ["pi.agent_start", "pi.agent_settled", "pi.message_end", "pi.tool_execution_end"].includes(event.type)) {
            sessionRevisions.current.set(event.sessionId, (sessionRevisions.current.get(event.sessionId)??0)+1);
            if (event.type === "pi.message_end") { setLiveBlocks({}); setLiveUsage(undefined); }
            void loadSession(event.sessionId);
          }
        }, (isConnected) => {
          setConnected(isConnected);
          if (isConnected && connectedOnce && selectedRef.current) {
            setLiveBlocks({}); setLiveUsage(undefined);
            void loadSession(selectedRef.current);
          }
          if (isConnected) connectedOnce = true;
          if (isConnected) window.dispatchEvent(new Event("pi-plugin-reconnect"));
        });
      } catch (cause) { if (!cancelled) setError(String(cause)); }
    })();
    return () => { cancelled = true; disconnect(); if (refreshTimer) clearTimeout(refreshTimer); };
  }, []);

  useEffect(() => { followOutput.current && endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, liveBlocks]);
  useEffect(() => {
    if (interactionTarget) document.getElementById(`interaction-${interactionTarget}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const target=[...questions,...approvals].find(item=>item.id===interactionTarget);
    if(target && selectedRef.current!==target.sessionId) void loadSession(target.sessionId);
  }, [questions, approvals, interactionTarget]);

  const liveEvents = useMemo(() => events.filter((event) => event.sessionId === selectedId).slice(-50), [events, selectedId]);
  const extensionUi = useMemo(() => {
    if (extensionSnapshot && extensionSnapshot.sessionId === selectedId) return {
      statuses:Object.entries(extensionSnapshot.statuses), widgets:Object.entries(extensionSnapshot.widgets),
      notices:extensionSnapshot.notices.slice(-5).map((notice,index)=>({seq:index,message:notice.message,kind:notice.kind})),
    };
    const statuses = new Map<string, string>();
    const widgets = new Map<string, string[]>();
    const notices: Array<{ seq: number; message: string; kind: string }> = [];
    for (const event of events.filter((item) => item.sessionId === selectedId)) {
      const payload = event.payload as any;
      if (event.type === "ui.setStatus") payload.statusText ? statuses.set(payload.statusKey, payload.statusText) : statuses.delete(payload.statusKey);
      if (event.type === "ui.setWidget") payload.widgetLines ? widgets.set(payload.widgetKey, payload.widgetLines) : widgets.delete(payload.widgetKey);
      if (event.type === "ui.notify") notices.push({ seq: event.seq, message: String(payload.message ?? ""), kind: String(payload.notifyType ?? "info") });
    }
    return { statuses: [...statuses], widgets: [...widgets], notices: notices.slice(-5) };
  }, [events, selectedId, extensionSnapshot]);
  const metrics = useMemo(() => {
    const rows=extensionUi.widgets.find(([key])=>key==="remote-metrics")?.[1];
    try{return JSON.parse(rows?.[0] ?? "{}");}catch{return {};}
  },[extensionUi]);
  const hiddenChildIds = new Set(hiddenChildChats[selectedId ?? ""] ?? []);
  const visibleChildRuns = childRuns.filter(item => !hiddenChildIds.has(item.id) && (!childQuery || `${item.name} ${item.model} ${item.status}`.toLowerCase().includes(childQuery.toLowerCase())));
  const hiddenChildRuns = childRuns.filter(item => hiddenChildIds.has(item.id));
  const viewedChild=visibleChildRuns.find(item=>item.id===chatTab);
  const messageStart = Math.max(0, messages.length - messageWindow);
  async function loadEarlierHistory() {
    const id=selectedRef.current,revision=id?(sessionRevisions.current.get(id)??0):0;
    if(!id||loadingHistory)return;
    if(messageStart>0){setMessageWindow(current=>current+160);return;}
    if(!historyBefore)return;
    setLoadingHistory(true);
    try {
      const page=await controlApi.command<{messages:any[];start:number}>(id,"get_messages_page",{before:historyBefore,limit:160});
      if(selectedRef.current!==id||revision!==(sessionRevisions.current.get(id)??0)||historyRange.current?.start!==historyBefore)return;
      if(historyRange.current)historyRange.current.start=page.start;
      setMessages([...page.messages,...chatStore.get().messages]);setHistoryBefore(page.start);setMessageWindow(current=>current+160);
    }catch(error){setError(String(error));}finally{setLoadingHistory(false);}
  }
  const visibleMessages = chatQuery ? messages.filter(message => JSON.stringify(message.content).toLowerCase().includes(chatQuery.toLowerCase())) : messages.slice(messageStart);
  const protocolMismatch = status?.protocolVersion != null && status.protocolVersion !== PI_REMOTE_PROTOCOL_VERSION;

  function extensionCommand(message: string) {
    if (selectedId && !protocolMismatch) void controlApi.command(selectedId, "prompt", { message }).catch(cause => setError(String(cause)));
  }
  async function editAndReask(message:any) {
    if (!selectedId) return;
    try {
      const result=await controlApi.command<any>(selectedId,"get_entries");
      const entry=result.entries?.find((item:any)=>item.type==="message" && item.message.role==="user" && item.message.timestamp===message.timestamp && JSON.stringify(item.message.content)===JSON.stringify(message.content));
      if (!entry) throw new Error("Nie znaleziono wpisu Pi do utworzenia forka.");
      const text=typeof message.content==="string"?message.content:message.content.filter((part:any)=>part.type==="text").map((part:any)=>part.text).join("\n");
      setReaskTarget({entryId:entry.id,text});
    } catch(error){setError(String(error));}
  }
  async function dropQueued(kind: "steering" | "followUp", index: number, recall = false) {
    if (!selectedId) return;
    const text = queue[kind][index];
    if (text === undefined) return;
    try {
      const next = await controlApi.command<{steering:string[];followUp:string[]}>(selectedId, "clear_queue");
      // Work from the authoritative returned queue, not a possibly stale WebSocket view.
      const actualIndex = next[kind].indexOf(text);
      if (actualIndex >= 0) next[kind].splice(actualIndex, 1);
      for (const message of next.steering) await controlApi.command(selectedId, "steer", { message });
      for (const message of next.followUp) await controlApi.command(selectedId, "follow_up", { message });
      setQueue(next);
      if (recall && actualIndex >= 0) { setComposer(text ?? ""); focusComposer(); }
    } catch (cause) { setError(String(cause)); }
  }

  function setChildChatHidden(childId: string, hidden: boolean) {
    if (!selectedId) return;
    setHiddenChildChats(current => {
      const ids = new Set(current[selectedId] ?? []);
      hidden ? ids.add(childId) : ids.delete(childId);
      return { ...current, [selectedId]: [...ids] };
    });
    if (hidden && chatTab === childId) setChatTab("main");
  }
  const sessionActivity = [...questions,...approvals].some(item=>item.sessionId===selectedId && item.status==="pending") ? "Czeka na Twoją odpowiedź" : activeChildren.length ? `Subagenci pracują (${activeChildren.length})` : selected?.status === "running" ? "Pi pracuje" : "Gotowa";
  const targetFirst = <T extends { id: string }>(items: T[]) => [...items].sort((left, right) =>
    left.id === interactionTarget ? -1 : right.id === interactionTarget ? 1 : 0);
  const pendingQuestions = targetFirst(questions.filter((item) => item.status === "pending"));
  const pendingApprovals = targetFirst(approvals.filter((item) => item.status === "pending"));
  const awaitingHuman = [...pendingApprovals,...pendingQuestions].some(item=>item.sessionId === selectedId);
  const previousAwaiting = useRef(false);
  useEffect(() => {
    if(awaitingHuman) requestAnimationFrame(()=>document.querySelector<HTMLElement>(".composer-interactions input, .composer-interactions textarea, .composer-interactions button")?.focus());
    else if(previousAwaiting.current) focusComposer();
    previousAwaiting.current=awaitingHuman;
  },[awaitingHuman]);
  const skills = useMemo(() => commands.filter((command) => command.source === "skill"), [commands]);
  const fileQuery=useMemo(()=>fileReferenceQuery(composer,caret),[composer,caret]);
  const argsQuery=useMemo(()=>argumentQuery(composer,caret),[composer,caret]);
  const suggestions:Suggestion[] = fileQuery||argsQuery?contextSuggestions:commandSuggestions(commands,composer);
  useEffect(()=>{
    setContextSuggestions([]);let cancelled=false;
    if(!selectedId||(!fileQuery&&!argsQuery))return;
    const timer=setTimeout(()=>{void(async()=>{
      try {
        let items:Suggestion[]=[];
        if(fileQuery&&selected){
          const query=fileQuery.query;const slash=query.lastIndexOf("/");
          const result=slash>=0||!query?await controlApi.workspaceTree(selected.workspace,slash>=0?query.slice(0,slash)||".":"."):await controlApi.workspaceSearch(selected.workspace,query);
          const rows=result.entries??result.results??[];
          items=rows.filter((item:any)=>item.path.toLowerCase().includes(query.toLowerCase())).slice(0,50).map((item:any)=>({name:item.path,description:item.kind==="directory"?"Folder":"Załącz plik",source:"file",insertion:`@[${item.path}${item.kind==="directory"?"/":"] "}`,directory:item.kind==="directory",start:fileQuery.start,end:fileQuery.end}));
        }else if(argsQuery){
          const result=await controlApi.command<{items:Array<{value:string;label:string;description?:string}>}>(selectedId,"get_completions",argsQuery);
          items=(result?.items??[]).map(item=>({name:item.label,description:item.description,source:"argument",insertion:`/${argsQuery.name} ${item.value}`,start:0,end:argsQuery.end}));
        }
        if(!cancelled)setContextSuggestions(items);
      }catch{if(!cancelled)setContextSuggestions([]);}
    })();},160);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[fileQuery,argsQuery,selectedId,selected?.workspace]);

  async function refreshCommands(id=selectedRef.current){
    if(!id)return;
    try{const rows=await controlApi.command<SlashCommand[]>(id,"get_commands");if(selectedRef.current===id)setCommands([...rows,...webCommands.filter(item=>!rows.some(row=>row.name===item.name))]);}catch{}
  }
  useEffect(()=>{
    if(!selectedId)return;
    const update=()=>void refreshCommands(selectedId);
    update();const timer=setInterval(update,15000);window.addEventListener("focus",update);
    return()=>{clearInterval(timer);window.removeEventListener("focus",update);};
  },[selectedId]);
  const scopeEntries = useMemo(() => {
    const refs = [...new Set([...scope.patterns, ...scope.models.map((model) => `${model.provider}/${model.id}`)])]
      .filter((ref) => (!scopeProvider || ref.startsWith(`${scopeProvider}/`)) && ref.toLowerCase().includes(scopeQuery.toLowerCase()))
      .sort();
    const groups = new Map<string, string[]>();
    for (const ref of refs) groups.set(ref.split("/")[0] || "inne", [...(groups.get(ref.split("/")[0] || "inne") ?? []), ref]);
    return [...groups].sort(([left], [right]) => left.localeCompare(right));
  }, [scope, scopeProvider, scopeQuery]);
  const showSuggestions = !slashDismissed && suggestions.length > 0;
  useEffect(()=>{
    if(!showSuggestions)return;
    const list=document.getElementById("slash-suggestions");
    const option=list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if(!list||!option)return;
    const bounds=list.getBoundingClientRect(),row=option.getBoundingClientRect();
    const header=list.querySelector("header")?.getBoundingClientRect().height??0;
    if(row.bottom>bounds.bottom)list.scrollTop+=row.bottom-bounds.bottom+4;
    else if(row.top<bounds.top+header)list.scrollTop-=bounds.top+header-row.top+4;
  },[suggestionIndex,showSuggestions,suggestions]);

  useEffect(() => { setSuggestionIndex(0); }, [composer,contextSuggestions]);

  async function engineAction(action: "start" | "stop" | "restart") {
    setServiceBusy(true);
    try { await controlApi.engine(action); await refresh(); } catch (cause) { setError(String(cause)); }finally{setServiceBusy(false);}
  }
  async function restartControl(){setServiceBusy(true);try{await controlApi.restartControl();}catch(cause){setError(String(cause));}finally{setServiceBusy(false);}}
  async function reloadPi(){if(!selectedId)return;setServiceBusy(true);try{await controlApi.command(selectedId,"reload_extensions");await readSession(selectedId);}catch(cause){setError(String(cause));}finally{setServiceBusy(false);}}
  async function refreshQuota(){if(!selectedId||quotaBusy)return;setQuotaBusy(true);try{await controlApi.command(selectedId,"prompt",{message:"/quota"});const snapshot=await controlApi.extensionUi(selectedId);if(selectedRef.current===selectedId)setExtensionSnapshot(snapshot);}catch(cause){setError(String(cause));}finally{setQuotaBusy(false);}}

  async function startPairing() {
    try { setPairing(await controlApi.startPairing()); } catch (cause) { setError(String(cause)); }
  }

  async function createSession() {
    setCreating(true);
    try {
      const session = await controlApi.createSession(workspace, sessionName);
      showSession(session); setSessionName(""); setNewSessionOpen(false); await loadSession(session.id);
    } catch (cause) { setError(String(cause)); } finally { setCreating(false); }
  }

  async function importSession() {
    if (!importPath.trim()) return;
    try {
      const session = await controlApi.importSession(importPath, workspace, sessionName);
      setImportPath(""); setSessionName(""); showSession(session); await loadSession(session.id);
    } catch (cause) { setError(String(cause)); }
  }

  async function deleteSession() {
    if (!deleteTarget) return;
    const session = deleteTarget;
    try {
      await controlApi.deleteSession(session.id);
      setStatus((current) => current ? { ...current, sessions: current.sessions.filter((item) => item.id !== session.id) } : current);
      if (selectedRef.current === session.id) clearSessionView();
      setDeleteTarget(undefined);
      setError("");
      await refresh();
    } catch (cause) { setError(String(cause)); }
  }

  function focusComposer(position?:number) {
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      const end = position ?? composerRef.current?.value.length ?? 0;
      composerRef.current?.setSelectionRange(end, end);
    });
  }

  function chooseCommand(command: Suggestion) {
    const text=command.insertion!==undefined?composer.slice(0,command.start??0)+command.insertion+composer.slice(command.end??composer.length):selectSlashCommand(command.name);
    const position=command.insertion!==undefined?(command.start??0)+command.insertion.length:text.length;
    setComposer(text);setCaret(position);
    setSlashDismissed(!command.directory);
    focusComposer(position);
  }

  function chooseSkill(command: SlashCommand) {
    const existing = composer.trim();
    setComposer(`${selectSlashCommand(command.name)}${existing}`);
    setSlashDismissed(true);
    focusComposer();
  }

  function chooseSubagent(profile: SubagentProfile) {
    const lead = `Użyj narzędzia subagent z profilem "${profile.name}", aby wykonać zadanie: `;
    setComposer(`${lead}${composer.trim()}`);
    setSlashDismissed(true);
    focusComposer();
  }

  async function send() {
    if (!selectedId || (!composer.trim()&&!images.length)) return;
    const builtin=composer.trim();
    if(builtin.startsWith("/model ")){const value=builtin.slice(7).trim(),matches=models.filter(m=>m.id===value||`${m.provider}/${m.id}`===value);if(matches.length===1){setComposer("");await changeModel(`${matches[0]!.provider}/${matches[0]!.id}`);}else{openModelPicker();setModelQuery(value);}return;}
    if(builtin.startsWith("/thinking ")){const level=builtin.slice(10).trim();if(!thinkingLevels.includes(level)){setError("Nieznany poziom myślenia");return;}setComposer("");await changeSetting("set_thinking_level",{level});return;}
    if(builtin==="/reload"){if(!capabilities?.localAdmin){setError("Przeładowanie rozszerzeń wymaga lokalnego administratora");return;}try{await controlApi.command(selectedId,"reload_extensions");setComposer("");await readSession(selectedId);}catch(cause){setError(String(cause));}return;}
    if(webCommands.some(item=>`/${item.name}`===builtin)) {
      setComposer("");
      if(builtin==="/model"){openModelPicker();return;}
      if(builtin==="/thinking"){document.querySelector<HTMLSelectElement>(".thinking-select")?.focus();return;}
      if(builtin==="/settings" || builtin==="/scope"){void openSettings();return;}
      if(builtin==="/new"){setNewSessionOpen(true);void browseFolders(workspace||workspaceRoot);return;}
      const command=({"/compact":"compact","/stats":"get_session_stats","/export":"export_html","/tree":"get_tree","/abort":"abort"} as Record<string,string>)[builtin];
      if(command){setSettingsOpen(false);setModelPicker(false);setAdvanced(true);void inspect(command);return;}
    }
    const active = snippets.filter((item) => enabledSnippets.has(item.id));
    const message = [
      ...active.filter((item) => item.placement === "prepend").map((item) => item.body),
      composer,
      ...active.filter((item) => item.placement === "append").map((item) => item.body),
    ].join("\n\n");
    const original = composer; historyPosition.current = -1; setComposer(""); setEditorHeight(52); setEnabledSnippets(new Set());
    try { await controlApi.command(selectedId, delivery, { message, images }); setImages([]); setSentPrompts(current => ({...current, [selectedId]: [...(current[selectedId] ?? []), original]})); await refresh(); }
    catch (cause) { setComposer(original); setError(String(cause)); }
  }

  async function inspect(command: string, payload: Record<string, unknown> = {}) {
    if (!selectedId) return;
    try { setInspection(await controlApi.command(selectedId, command, payload)); }
    catch (cause) { setError(String(cause)); }
  }

  async function testNotification() {
    try { setInspection(await controlApi.testNotification()); await refresh(); }
    catch (cause) { setError(String(cause)); await refresh(); }
  }

  async function openSettings() {
    setModelPicker(false);setAdvanced(false);
    try {
      const data = await controlApi.scope(selected?.status === "running" || selected?.status === "idle" ? selectedId : undefined);
      setScope(data); setScopeSelection(data.patterns); setScopeAll(!data.patterns.length); setScopeQuery(""); setScopeProvider(""); setScopeNotice(""); setSettingsOpen(true);
      try { setServiceLogs((await controlApi.diagnostics()).logs); } catch (cause) { setServiceLogs([{name:"Logi", text:String(cause)}]); }
    }
    catch(cause) { setError(String(cause)); }
  }
  async function saveModelScope() {
    if (!scopeAll && !scopeSelection.length) { setScopeNotice("Wybierz przynajmniej jeden model albo opcję Wszystkie modele."); return; }
    try {
      await controlApi.saveScope(scopeAll ? [] : scopeSelection, scope.patterns);
      setScope(await controlApi.scope(selectedId));
      setScopeNotice("Zapisano globalny scope Pi. Uruchom nową sesję lub zatrzymaj i wznów obecną, aby zastosować go również do orchestratora i subagentów.");
    } catch(cause) { setScopeNotice(String(cause)); }
  }

  async function browseFolders(path: string) {
    const request = ++folderRequest.current;
    setFolderError("");
    try { const result = await controlApi.directories(path); if (request === folderRequest.current) setFolders(result); }
    catch { if (request === folderRequest.current) setFolderError("Nie można otworzyć folderu. Podaj istniejący katalog, np. /Users/nazwa/Projekty albo ~/Projekty."); }
  }

  async function changeSetting(command: string, payload: Record<string, unknown>) {
    if (!selectedId || settingsBusy) return;
    const id = selectedId;
    setSettingsBusy(true);
    try {
      await controlApi.command(id, command, payload);
      const [state, levels] = await Promise.all([controlApi.command(id, "get_state"), controlApi.command<string[]>(id, "get_available_thinking_levels")]);
      if (command === "set_thinking_level" && (state as any)?.thinkingLevel !== payload.level) throw new Error("Pi nie zastosował wybranego poziomu myślenia.");
      if (selectedRef.current === id) { setSessionState(state); setThinkingLevels(levels); }
      setModelPicker(false); setError("");
    } catch (cause) { setError(String(cause)); }
    finally { setSettingsBusy(false); }
  }

  async function changeModel(value: string) {
    const [provider, ...modelId] = value.split("/");
    await changeSetting("set_model", {provider, modelId: modelId.join("/")});
  }

  async function chooseImages(files: FileList | null) {
    const selectedFiles = [...(files ?? [])].slice(0, 4);
    const loaded = await Promise.all(selectedFiles.map((file) => new Promise<{ type: "image"; data: string; mimeType: string }>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve({ type: "image", data: String(reader.result).split(",")[1] ?? "", mimeType: file.type });
      reader.readAsDataURL(file);
    })));
    setImages(loaded);
  }

  function quotaLabel(quota: any): string {
    if (!quota || typeof quota !== "object") return "brak danych";
    if (quota.state === "available") {
      if (quota.buckets) {
        const usageName = quota.provider === "opencode-go" ? "Go" : "Zen";
        const percents = [quota.buckets.rolling, quota.buckets.weekly, quota.buckets.monthly]
          .map((bucket: any) => bucket?.percent).filter((value: any) => typeof value === "number");
        return percents.length ? `${usageName} ${Math.max(...percents)}%` : `${usageName} OK`;
      }
      if (quota.remaining != null) return `$${Number(quota.remaining).toFixed(2)}`;
      if (quota.used != null) return `użyto $${Number(quota.used).toFixed(2)}`;
      return "bez limitu klucza";
    }
    if (quota.rate?.remainingRequests != null) return `${quota.rate.remainingRequests} zapytań`;
    if (quota.state === "subscription") return quota.plan ?? "subskrypcja";
    if (quota.state === "key-ok") return "klucz OK";
    if (quota.state === "no-auth") return "brak logowania";
    return "brak danych";
  }

  function quotaTitle(quota: any): string {
    if (!quota || typeof quota !== "object") return "Quota providera; kliknij, aby odświeżyć";
    const parts: string[] = [];
    if (quota.provider) parts.push(`Provider: ${quota.provider}`);
    if (quota.buckets) for (const [label, bucket] of Object.entries(quota.buckets) as Array<[string, any]>) {
      if (bucket?.percent != null) parts.push(`${label}: ${bucket.percent}%${bucket.resetsAt ? ` (reset ${String(bucket.resetsAt).slice(0, 10)})` : ""}`);
    }
    if (quota.state === "available" && quota.remaining != null) parts.push(`Pozostało $${Number(quota.remaining).toFixed(2)} z $${Number(quota.limit ?? 0).toFixed(2)}`);
    if (quota.state === "available" && quota.remaining == null && quota.used != null) parts.push(`Użyto $${Number(quota.used).toFixed(2)} (klucz bez limitu)`);
    if (quota.rate) {
      if (quota.rate.remainingRequests != null) parts.push(`API: ${quota.rate.remainingRequests} zapytań${quota.rate.limitRequests != null ? ` z ${quota.rate.limitRequests}` : ""}${quota.rate.resetRequests ? ` (reset ${quota.rate.resetRequests})` : ""}`);
      else if (quota.rate.remainingTokens != null) parts.push(`API: ${quota.rate.remainingTokens} tokenów`);
    }
    if (quota.plan) parts.push(quota.plan);
    if (quota.detail) parts.push(quota.detail);
    if (quota.checkedAt) {
      const age = Math.max(0, Math.round((Date.now() - new Date(quota.checkedAt).getTime()) / 1000));
      parts.push(`sprawdzono ${age < 60 ? `${age} s` : `${Math.round(age / 60)} min`} temu`);
    }
    parts.push("Kliknij, aby odświeżyć (/quota)");
    return parts.join(" · ");
  }

  const contextUsage = metrics.context ?? conversationStats?.contextUsage;
  const contextPercent = contextUsagePercent(contextUsage, sessionState?.model?.contextWindow);
  const quotaPercent = quotaUsagePercent(metrics.quota);
  return <div className="app-shell" data-mobile-view={mobileView}>
    <header className="app-header">
      <div className="brand"><span className="logo">π</span><span className="brand-copy"><strong>Pi Remote</strong><small>Local AI workspace</small></span></div>
      <div className="status-row">
        <span className={`engine-status ${engineState}`} title={status ? "Control Service dostępny" : "Brak połączenia z Control Service"}>
          <i className="dot" /><span>Pi Engine</span><b>{engineLabel}</b>
        </span>
        {capabilities?.localAdmin&&<><button className="ghost service-control reload" aria-label="Pi reload" disabled={serviceBusy||!selectedId||engineState!=="running"||sessionState?.isStreaming||sessionState?.isCompacting} onClick={()=>void reloadPi()} title="Pi reload · Przeładuj rozszerzenia aktywnej sesji"><Icon name="refresh" /></button><button className="ghost service-control restart" aria-label="Control restart" disabled={serviceBusy} onClick={()=>void restartControl()} title="Control restart · Restart Control i automatyczny start Pi Engine"><Icon name="restart" /></button><button className={`ghost service-control ${engineState==="running"?"stop":"start"}`} aria-label={engineState==="running"?"Stop Pi":"Start Pi"} title={engineState==="running"?"Zatrzymaj Pi Engine":"Uruchom Pi Engine"} disabled={serviceBusy||!["running","stopped","crashed"].includes(engineState)} onClick={()=>void engineAction(engineState==="running"?"stop":"start")}><Icon name={engineState==="running"?"stop":"play"} /></button></>}
        <select aria-label="Motyw" value={theme} onChange={e => setTheme(e.target.value)}><option value="dark">Ciemny</option><option value="light">Jasny</option><option value="forest">Forest</option><option value="tokyo-night">Tokyo Night</option><option value="catppuccin">Catppuccin Mocha</option><option value="solarized-light">Solarized Light</option><option value="kanagawa-lotus">Kanagawa Lotus</option></select>

      </div>
    </header>
    {(protocolMismatch || shellUpdate) && <div className="update-banner">Dostępna jest nowa wersja Pi Remote. <button onClick={() => { navigator.serviceWorker?.getRegistration().then(registration => registration?.waiting?.postMessage("activate")); location.reload(); }}>Odśwież aplikację</button></div>}
    <nav className="mobile-views" aria-label="Widok mobilny">{[["sessions","Sesje"],["chat","Chat"],["context","Cockpit"]].map(([value,label]) => <button key={value} aria-pressed={mobileView===value} onClick={()=>setMobileView(value!)}>{label}</button>)}</nav>

    {error && <div className="error-banner" onClick={() => setError("")}>{error}<span>×</span></div>}
    {pairing && <div className="modal-backdrop" onClick={() => setPairing(undefined)}>
      <section className="pairing-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close ghost" onClick={() => setPairing(undefined)}>×</button>
        <h2>Sparuj Pi Remote</h2>
        <p>Zeskanuj kod telefonem w tej samej zaufanej sieci LAN.</p>
        <div className="qr"><QRCodeSVG value={pairing.deepLink} size={220} bgColor="#ffffff" fgColor="#080b11" /></div>
        <strong className="pair-code">{pairing.code}</strong>
        <small>{pairing.host}:3784 · kod ważny do {new Date(pairing.expiresAt).toLocaleTimeString()}</small>
        <a href={pairing.deepLink}>Otwórz w Pi Remote</a>
      </section>
    </div>}
    {settingsOpen && contextRef.current && createPortal(<section className="integrated-panel settings-panel" role="region" aria-label="Ustawienia" onKeyDown={event => {if(event.key === "Escape") setSettingsOpen(false);}}>
      <div className="selection-title"><h2>Ustawienia</h2></div>
      <section className="settings-category"><h3>Usługi</h3><div className="settings-services">
        <button className={`ghost ${engineState==="running"?"stop":"start"}`} onClick={()=>void engineAction(engineState==="running"?"stop":"start")} disabled={serviceBusy||!capabilities?.localAdmin||!["running","stopped","crashed"].includes(engineState)}><Icon name={engineState==="running"?"stop":"play"}/><span>{engineState==="running"?"Zatrzymaj silnik":"Uruchom silnik"}</span></button>
        <button className="ghost restart" onClick={()=>void engineAction("restart")} disabled={serviceBusy||!capabilities?.localAdmin||engineState!=="running"}><Icon name="restart"/><span>Restart silnika</span></button>
        <button className="ghost restart" disabled={serviceBusy||!capabilities?.localAdmin} title="Restart Control i automatyczny start Pi Engine" onClick={()=>void restartControl()}><Icon name="restart"/><span>Restart Control + Pi</span></button></div><p className="notification-help">Restart przerywa aktywne sesje. Historia pozostaje zachowana.</p></section>
      <section className="settings-category"><h3>Powiadomienia</h3>
        {"Notification" in window&&<button className="ghost" disabled={Notification.permission!=="default"} onClick={()=>Notification.requestPermission()}>{Notification.permission==="granted"?"Powiadomienia przeglądarki aktywne":Notification.permission==="denied"?"Powiadomienia zablokowane w przeglądarce":"Włącz powiadomienia przeglądarki"}</button>}
        <button onClick={() => {setSettingsOpen(false); void startPairing();}}>Sparuj telefon</button>              <article className="tool-card notification-card">
                <div className="tool-card-head"><span>Powiadomienia mobilne</span><small>Firebase Cloud Messaging</small></div>
                <div className={`notification-health ${notificationState}`}>
                  <i /><span><b>{notificationLabel}</b><small>{status?.notifications
                    ? `${status.notifications.registeredDevices} z ${status.notifications.pairedDevices} urządzeń ma token FCM`
                    : "Brak danych diagnostycznych"}</small></span>
                </div>
                {status?.notifications?.lastDelivery && <p className="delivery-result">
                  Ostatnia próba: {status.notifications.lastDelivery.successCount} dostarczono · {status.notifications.lastDelivery.failureCount} błędów
                </p>}
                <button className="ghost notification-test" disabled={notificationState !== "enabled" || !status?.notifications?.registeredDevices}
                  onClick={() => void testNotification()}>Wyślij test na telefon</button>
                {notificationState !== "enabled" && <small className="notification-help">Dodaj konto Firebase Admin do macOS Keychain i zrestartuj Control Service.</small>}
              </article>
              <div className="phone-preferences"><h3>Co wysyłać na telefon</h3><p className="notification-help">Wspólne dla sparowanych telefonów. Otwarta przeglądarka nie wycisza telefonu.</p>
              {status?.notifications?.preferences && ([["approvals","Prośby o akceptację","Zatwierdzenie lub odrzucenie operacji"],["questions","Pytania i decyzje","Pi potrzebuje Twojej odpowiedzi"],["errors","Błędy","Awarie sesji, agentów i rozszerzeń"],["engine","Stan silnika","Start, zatrzymanie i restart"],["completed","Gotowe odpowiedzi","Zakończenie odpowiedzi Pi"]] as const).map(([key,label,description])=><label className="phone-preference" key={key}><span>{label}<small>{description}</small></span><input type="checkbox" disabled={!capabilities?.localAdmin||settingsBusy} checked={status.notifications!.preferences![key]} onChange={event=>void savePhonePreference(key,event.target.checked)}/></label>)}
              </div>
</section>
      <section className="settings-category"><h3>Modele i scope</h3><article className="tool-card scope-card"><div className="tool-card-head"><span>Globalny scope modeli</span><small>{scope.catalogAvailable ? `${scope.models.length} w katalogu` : "katalog niedostępny"}</small></div>
      <label className="scope-option"><input type="checkbox" checked={scopeAll} onChange={event => setScopeAll(event.target.checked)} /><span>Wszystkie dostępne modele<small>Pusta lista enabledModels w Pi</small></span></label>
      <div className="scope-filters"><input aria-label="Szukaj w scope" placeholder="Filtruj modele i dostawców…" value={scopeQuery} onChange={event => setScopeQuery(event.target.value)} />
      <select aria-label="Dostawca w scope" value={scopeProvider} onChange={event => setScopeProvider(event.target.value)}><option value="">Wszyscy dostawcy</option>{[...new Set(scope.models.map(model => model.provider))].sort().map(provider => <option key={provider}>{provider}</option>)}</select></div>
      {!scope.catalogAvailable && <p role="status">Katalog modeli nie jest jeszcze dostępny. Zapisane pozycje scope pozostają zachowane.</p>}
      <div className="scope-selector">{scopeEntries.map(([provider, refs]) => <details className="scope-group" key={`${provider}:${scopeQuery}:${scopeProvider}`} {...(scopeQuery || scopeProvider ? {open: true} : {})}><summary><b>{provider}</b><small>{refs.filter(ref => scopeSelection.includes(ref)).length} w scope · {refs.length}</small></summary>{refs.map(ref => <label className="scope-option" key={ref}><input type="checkbox" disabled={scopeAll} checked={scopeAll || scopeSelection.includes(ref)} onChange={event => setScopeSelection(current => event.target.checked ? [...current,ref] : current.filter(item => item !== ref))} /><span>{ref}<small>{ref.includes("*") ? "Zapisany wzorzec Pi" : !scope.models.some(m => `${m.provider}/${m.id}` === ref) ? "Zapisana pozycja · brak w bieżącym katalogu" : scopeSelection.includes(ref) ? "W obecnym scope" : "Poza scope"}</small></span></label>)}</details>)}
      {!scopeEntries.length && <p>Brak modeli dla tego filtra.</p>}</div>
      <div className="scope-save"><small>{scopeAll ? "Zapis obejmie cały katalog" : `${scopeSelection.length} wybranych pozycji`}</small><button onClick={() => void saveModelScope()}>Zapisz scope</button></div>
      {scopeNotice && <p role="status">{scopeNotice}</p>}
      {scope.diagnostics.map((item,index) => <p key={index}>{item.message}</p>)}
      <p className="notification-help">Model i poziom myślenia wybierasz przy polu wiadomości. Zapis dotyczy nowych sesji oraz sesji zatrzymanych i wznowionych.</p></article></section>
      {capabilities?.localAdmin&&<section className="settings-category"><h3>Mac i providerzy</h3><LocalPanel onError={setError}/></section>}
      <section className="settings-category"><h3>Diagnostyka</h3><article className="tool-card"><div className="tool-card-head"><span>Rozszerzenia aktywnej sesji</span><small>Status, nie poziom myślenia</small></div>
      {extensionUi.statuses.length > 0 ? <div className="setting-list">{extensionUi.statuses.map(([key,value]) => <div className="diagnostic-row" key={key}><b>{key}</b><span>{value}</span></div>)} </div> : <p className="notification-help">Otwórz sesję, aby zobaczyć status rozszerzeń. Status Cursor opisuje backend i tryb fast.</p>}
      </article>
      <article className="tool-card"><div className="tool-card-head"><span>Logi usług</span><button className="ghost" onClick={() => void controlApi.diagnostics().then(data => setServiceLogs(data.logs)).catch(cause => setServiceLogs([{name:"Logi", text:String(cause)}]))}>Odśwież</button></div>
      <div className="log-list">{serviceLogs.map(log => <details className="log-panel" key={log.name} open={log.name.startsWith("Start")}><summary><b>{log.name}</b><small>{log.text === "Brak wpisów." ? "pusto" : log.lineCount != null ? `${log.lineCount} linii · ${log.uniqueLineCount} unikalnych` : `${log.text.split("\n").length} linii`}</small></summary><pre>{log.text}</pre></details>)}</div>
      </article></section>
    </section>,contextRef.current)}
    {modelPicker && contextRef.current && createPortal(<section className="integrated-panel model-panel" role="region" aria-label="Wybierz model" onKeyDown={event => { if (event.key === "Escape") setModelPicker(false); }}>
      <div className="selection-title"><h2>Wybierz model</h2></div>
      <input autoFocus aria-label="Szukaj modelu" placeholder="Szukaj po nazwie lub dostawcy…" value={modelQuery} onChange={event => setModelQuery(event.target.value)} />
      <select aria-label="Dostawca modeli" value={modelProvider} onChange={event => setModelProvider(event.target.value)}><option value="">Wszyscy dostawcy</option>{[...new Set(models.map(m => m.provider))].sort().map(provider => <option key={provider}>{provider}</option>)}</select>
      <select aria-label="Grupa modeli" value={scopeGroup} onChange={event => setScopeGroup(event.target.value)}><option value="scope">Globalny scope Pi ({scope.resolved.length})</option><option value="all">Wszystkie modele ({models.length})</option><option value="outside">Poza scope</option></select>
      <div className="selection-list">{models.filter(m => (scopeGroup === "all" || (scopeGroup === "scope" ? scope.resolved.includes(`${m.provider}/${m.id}`) : !scope.resolved.includes(`${m.provider}/${m.id}`))) && (!modelProvider || m.provider === modelProvider) && `${m.provider}/${m.id}`.toLowerCase().includes(modelQuery.toLowerCase())).map(m => <button className="ghost" disabled={settingsBusy} key={`${m.provider}/${m.id}`} onClick={() => void changeModel(`${m.provider}/${m.id}`)}><strong>{m.id}</strong><small>{m.provider}{sessionState?.model?.id === m.id && sessionState?.model?.provider === m.provider ? " · Wybrany" : ""}</small></button>)}</div>
    </section>,contextRef.current)}
    {newSessionOpen && <div className="modal-backdrop" onClick={() => !creating && setNewSessionOpen(false)}><section className="selection-modal" role="dialog" aria-modal="true" aria-label="Nowa sesja" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape" && !creating) setNewSessionOpen(false); }}>
      <div className="selection-title"><h2>Nowa sesja</h2><button className="ghost" disabled={creating} onClick={() => setNewSessionOpen(false)}>Anuluj</button></div>
      <label>Nazwa sesji<input autoFocus value={sessionName} onChange={event => setSessionName(event.target.value)} placeholder="Nazwa sesji" /></label>
      <label>Katalog sesji (dowolny folder, domyślnie: {workspaceRoot || "…"})<input value={workspace} onChange={event => setWorkspace(event.target.value)} placeholder={workspaceRoot} /></label>
      <div className="folder-actions"><button className="ghost" onClick={() => void browseFolders(workspace || workspaceRoot)}>Przeglądaj folder</button><button className="ghost" disabled={!workspaceRoot || workspace === workspaceRoot} onClick={() => { setWorkspace(workspaceRoot); void browseFolders(workspaceRoot); }}>Użyj domyślnego</button></div>
      {folderError && <p role="alert">{folderError}</p>}
      {folders && <><div className="folder-location">{folders.path}</div><div className="folder-actions"><button className="ghost" disabled={!folders.parent} onClick={() => void browseFolders(folders.parent!)}>↑ Poziom wyżej</button><button onClick={() => setWorkspace(folders.path)}>Wybierz ten folder</button></div>
      <div className="selection-list folder-list">{folders.directories.map(folder => <button className="ghost" key={folder.name} onClick={() => void browseFolders(folder.path)}>▸ {folder.name}</button>)}{!folders.directories.length && <p>Brak podfolderów</p>}</div></>}
      <button disabled={creating || !workspace.trim()} onClick={() => void createSession()}>{creating ? "Tworzenie…" : "Utwórz sesję"}</button>
    </section></div>}
    {deleteTarget && <div className="modal-backdrop" onClick={() => setDeleteTarget(undefined)}>
      <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-session-title" onClick={(event) => event.stopPropagation()}>
        <div className="confirm-icon">×</div>
        <span className="eyebrow">DELETE SESSION</span>
        <h2 id="delete-session-title">Usunąć „{deleteTarget.name}”?</h2>
        <p>Sesja i jej lokalna kopia rozmowy zostaną usunięte. Tej operacji nie można cofnąć.</p>
        <div className="confirm-actions">
          <button className="ghost" onClick={() => setDeleteTarget(undefined)}>Anuluj</button>
          <button className="danger solid" onClick={() => void deleteSession()}>Usuń sesję</button>
        </div>
      </section>
    </div>}
    <div className="layout" data-context-panel={auxiliaryOpen}>
      <aside className="sessions-panel">
        {[...pendingQuestions,...pendingApprovals].filter(item=>item.sessionId!==selectedId).map(item=><button className="ghost other-session-question" key={item.id} onClick={()=>void loadSession(item.sessionId)}>Wymaga uwagi · {status?.sessions.find(session=>session.id===item.sessionId)?.name??item.sessionId}</button>)}
        <div className="panel-heading"><div><span>WORKSPACE</span><h2>Sesje</h2></div><b>{status?.sessions.length ?? 0}</b></div>
        <div className="new-session">
          <button onClick={() => { setNewSessionOpen(true); setFolders(undefined); void browseFolders(workspace || workspaceRoot); }} disabled={status?.engine !== "running"}>＋ Nowa sesja</button>
          <details className="import-session"><summary>Import kopii sesji terminalowej</summary>
            <input value={importPath} onChange={(event) => setImportPath(event.target.value)} placeholder="~/.pi/agent/sessions/…jsonl" />
            <button className="ghost" onClick={importSession} disabled={status?.engine !== "running"}>Importuj kopię</button>
          </details>
        </div>
        <nav>{status?.sessions.map((session) => <div className={`session-item ${selectedId === session.id ? "active" : ""}`} key={session.id}>
          <button className="session-row" onClick={() => void loadSession(session.id)}>
            <span>{session.name}</span><small><i className={`session-dot ${session.status}`} />{session.status}</small>
          </button>
          <button className="session-delete" aria-label={`Usuń sesję ${session.name}`} title="Usuń sesję" onClick={() => setDeleteTarget(session)}>×</button>
        </div>)}</nav>
      </aside>

      <main className="conversation" ref={conversationRef}>
        {selected ? <>
          <div className="conversation-head">
            <div className="session-identity">
              <i className={`session-dot ${selected.status}`} />
              <h1>{selected.name}</h1>
              <span className="session-location" title={selected.workspace}>{selected.workspace.split("/").filter(Boolean).at(-1)}</span>
            </div>
            <span className="session-activity">{sessionActivity}</span>
            <div className="header-actions">
              <button className="ghost" aria-expanded={shortcutsOpen} onClick={()=>setShortcutsOpen(open=>!open)}>Skróty</button>
              <button className={`tools-toggle ghost ${advanced ? "active" : ""}`} aria-expanded={advanced} onClick={() => {setSettingsOpen(false);setModelPicker(false);setAdvanced(!advanced);}}><span>⌘</span>Narzędzia</button>
            </div>
          </div>

          {!advanced && shortcutsOpen && (skills.length > 0 || subagents.length > 0) && <nav className="capability-toolbar" aria-label="Szybkie wywołania skilli i subagentów">
            {skills.length > 0 && <div className="capability-group"><span>Skills</span><div>{skills.map((skill) => <button key={skill.name} title={skill.description} onClick={() => chooseSkill(skill)}>
              <i>✦</i>{skill.name.replace(/^skill:/, "")}
            </button>)}</div></div>}
            {skills.length > 0 && subagents.length > 0 && <span className="capability-divider" />}
            {subagents.length > 0 && <div className="capability-group"><span>Subagenci</span><div>{subagents.map((profile) => <button key={profile.name} title={profile.description} onClick={() => chooseSubagent(profile)}>
              <i>◎</i>{profile.name}
            </button>)}</div></div>}
          </nav>}

          {advanced && contextRef.current && createPortal(<section className="advanced integrated-panel">
            <header className="advanced-head">
              <div><span className="advanced-icon">⌘</span><span><b>Narzędzia sesji</b><small>Operacje, automatyzacja i diagnostyka</small></span></div>
            </header>
            <div className="tools-dashboard">
              <article className="tool-card operations-card">
                <div className="tool-card-head"><span>Operacje</span><small>Stan i historia sesji</small></div>
                <div className="tool-actions">
                  {([["◔","Statystyki","get_session_stats"],["⌘","Drzewo","get_tree"],["⑂","Forki","get_fork_messages"],["⇩","Eksport","export_html"],["◫","Kompaktuj","compact"]] as const).map(([icon, label, command]) =>
                    <button className="tool-action" key={command} onClick={() => inspect(command)}><i>{icon}</i><span>{label}</span></button>)}
                  <button className="tool-action" onClick={() => inspect("clone")}><i>◇</i><span>Klonuj</span></button>
                </div>
              </article>
              <article className="tool-card automation-card">
                <div className="tool-card-head"><span>Automatyzacja</span><small>Odzyskiwanie i kolejka</small></div>
                <div className="setting-list">
                  <button onClick={() => inspect("set_auto_retry", { enabled: true })}><span><i>↻</i><b>Auto retry</b></span><em>Włącz</em></button>
                  <button onClick={() => inspect("set_auto_compaction", { enabled: false })}><span><i>◈</i><b>Auto compaction</b></span><em>Wyłącz · ACP zarządza kontekstem</em></button>
                  <button onClick={() => inspect("clear_queue")}><span><i>≡</i><b>Kolejka</b></span><em>Wyczyść</em></button>
                  <button className="danger-row" onClick={() => inspect("abort_retry")}><span><i>×</i><b>Aktywny retry</b></span><em>Przerwij</em></button>
                </div>
              </article>
              {snippets.length > 0 && <article className="tool-card snippets-card">
                <div className="tool-card-head"><span>Prompt snippets</span><small>{enabledSnippets.size} aktywne</small></div>
                <div className="snippet-list">{snippets.map((snippet) => <label key={snippet.id}>
                  <input type="checkbox" checked={enabledSnippets.has(snippet.id)} onChange={() => setEnabledSnippets((current) => {
                    const next = new Set(current); next.has(snippet.id) ? next.delete(snippet.id) : next.add(snippet.id); return next;
                  })} />
                  <span><strong>{snippet.name}</strong><small>{snippet.placement} · {snippet.description}</small></span>
                </label>)}</div>
              </article>}
              <article className="tool-card session-edit-card">
                <div className="tool-card-head"><span>Sesja</span><small>Nazwa, fork i proces</small></div>
                <label className="tool-field"><span>Nazwa</span><div><input value={rename} onChange={(event) => setRename(event.target.value)} placeholder={selected.name} />
                  <button onClick={() => inspect("set_session_name", { name: rename }).then(() => { setRename(""); void refresh(); })}>Zapisz</button></div></label>
                <label className="tool-field"><span>Fork od ID wpisu</span><div><input value={entryId} onChange={(event) => setEntryId(event.target.value)} placeholder="entry-id" />
                  <button className="ghost" onClick={() => inspect("fork", { entryId })}>Utwórz</button></div></label>
                <button className="stop-session" onClick={() => selectedId && controlApi.stopSession(selectedId).then(refresh)}>Zatrzymaj proces sesji</button>
              </article>
            </div>
            {inspection !== undefined && <div className="inspection-result"><header><span>Wynik operacji</span><button className="ghost" onClick={() => setInspection(undefined)}>×</button></header><pre>{JSON.stringify(inspection, null, 2)}</pre></div>}
            <details className="command-reference"><summary><span>Komendy slash</span><small>{commands.length} dostępnych</small></summary><ul>{commands.map((command) => <li key={command.name}>
              <button onClick={() => { chooseCommand(command); setAdvanced(false); }}><code>/{command.name}</code><span>{command.description}</span><em>{command.source}</em></button>
            </li>)}</ul></details>
          </section>,contextRef.current)}

          <nav className="chat-tabs" aria-label="Karty czatu" role="tablist">
            <button role="tab" aria-selected={chatTab === "main"} className="chat-tab" title="Główna rozmowa" onClick={()=>setChatTab("main")}><span className="chat-tab-title">Orchestrator</span></button>
            {visibleChildRuns.map(child=><span className="chat-tab-shell" key={child.id}>
              <button role="tab" aria-selected={chatTab===child.id} className="chat-tab" title={`${child.name} · ${child.status} · ${child.model || "Model niedostępny"}`} onClick={()=>setChatTab(child.id)}>
                <span className="chat-tab-title"><span className={`agent-dot ${child.status}`} />{child.name}<span className="agent-state">{({running:"Pracuje",starting:"Startuje",waiting:"Czeka",completed:"Gotowe",error:"Błąd",interrupted:"Przerwano"} as Record<string,string>)[child.status] ?? child.status}</span></span>
                <small className="chat-tab-model" title={child.model}>{(child.model?.split("/").pop()??"Model niedostępny").replace(/-contributor$/,"·ctr")}</small>
              </button>
              <button className="chat-tab-hide" aria-label={`Ukryj chat subagenta ${child.name}`} title="Ukryj chat" onClick={()=>setChildChatHidden(child.id,true)}>×</button>
            </span>)}
            {hiddenChildRuns.length > 0 && <details className="hidden-chat-menu">
              <summary>Ukryte · {hiddenChildRuns.length}</summary>
              <div>{hiddenChildRuns.map(child=><button className="ghost" key={child.id} onClick={()=>setChildChatHidden(child.id,false)}><span className={`agent-dot ${child.status}`} />{child.name}<small>Przywróć</small></button>)}</div>
            </details>}
          </nav>
          <div className="chat-search"><input aria-label="Szukaj w rozmowie" placeholder="Szukaj w rozmowie…" value={chatQuery} onChange={e=>setChatQuery(e.target.value)}/>{chatQuery && <span>{visibleMessages.length} wyników</span>}{childRuns.length>0 && <input aria-label="Filtr subagentów" placeholder="Subagenci…" value={childQuery} onChange={e=>setChildQuery(e.target.value)}/>}</div>
          {viewedChild && <section className="messages terminal-transcript child-messages"><div className="child-heading"><b>{viewedChild.name}</b><span>{viewedChild.model} · {viewedChild.status}</span><p>Podgląd subagenta. Pole polecenia pozostaje połączone z orchestratorem.</p></div>{viewedChild.messages.map((message:any,index:number)=><article className={`message ${message.role ?? "system"}`} key={index}><div className="role">{({user:"›",assistant:"π",toolResult:"◆",system:"·"} as Record<string,string>)[message.role] ?? "·"}<span>{message.toolName ?? message.role}</span></div><div className="terminal-message-body"><MessageContent message={message} workspace={selected.workspace} /></div></article>)}{viewedChild.liveMessage && <article className="message assistant live-message"><div className="role">π<span>assistant · streaming</span></div><div className="terminal-message-body"><MessageContent message={viewedChild.liveMessage} workspace={selected.workspace}/></div></article>}</section>}
          <section className="messages terminal-transcript" style={{display:viewedChild ? "none" : undefined}} onScroll={event => { const el = event.currentTarget; followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
            {!chatQuery && (messageStart > 0 || historyBefore>0) && <button className="history-more" disabled={loadingHistory} onClick={()=>void loadEarlierHistory()}>↑ Pokaż wcześniejsze wiadomości ({messageStart+historyBefore})</button>}
            {visibleMessages.map((message, index) => <article className={`message ${message.role ?? "system"}`} key={message.id ?? messageStart + index}>
              {message.role==="user" && <button className="reask-button ghost" disabled={protocolMismatch || sessionState?.isStreaming} onClick={()=>void editAndReask(message)}>Edytuj i zapytaj w forku</button>}
              <div className="role">{({user:"›", assistant:"π", toolResult:"◆", system:"·"} as Record<string,string>)[message.role] ?? "·"}<span>{({user:"user", assistant:"assistant", toolResult:"tool", system:"system"} as Record<string,string>)[message.role] ?? message.role ?? message.type}</span></div>
              <div className="terminal-message-body"><div className="message-meta">{message.model && <span>{message.provider}/{message.model}</span>}{message.timestamp && <time>{new Date(message.timestamp).toLocaleString()}</time>}<button onClick={()=>navigator.clipboard.writeText(typeof message.content==="string"?message.content:(message.content??[]).map((part:any)=>part.text??part.thinking??"").join("\n")).catch(cause=>setError(String(cause)))}>Kopiuj</button></div>
                <MessageContent message={message} workspace={selected.workspace}
                  undoPath={message.details?.path??messages.flatMap(item=>Array.isArray(item.content)?item.content:[]).find((part:any)=>part.type==="toolCall"&&part.id===message.toolCallId)?.arguments?.path}
                  onUndo={capabilities?.localAdmin&&!sessionState?.isStreaming?(path)=>{setComposer(`Cofnij ostatnią edycję pliku ${JSON.stringify(path)} używając narzędzia undo_last_edit. Nie wykonuj innych zmian.`);composerRef.current?.focus();}:undefined}/>
              </div>
            </article>)}
            {[...new Map(liveEvents.filter(event => event.type.includes("tool_execution")).map(event => [String((event.payload as any)?.toolCallId ?? event.seq), event])).values()].filter(event => !messages.some(message => message.role === "toolResult" && message.toolCallId === (event.payload as any)?.toolCallId)).map(event => <details className="tool-output" key={(event.payload as any)?.toolCallId ?? event.seq}>
              <summary><strong>{String((event.payload as any)?.toolName ?? "Narzędzie")}</strong> · {event.type.endsWith("_end") ? "Zakończono" : "W toku"}</summary>
              <pre>{toolEventText(event.payload)}</pre>
            </details>)}
            {Object.keys(liveBlocks).length > 0 && <article className="message assistant live-message">
              <div className="role">π<span>assistant · streaming{liveUsage?.totalTokens ? ` · ${liveUsage.totalTokens} tokens` : ""}</span></div><div className="terminal-message-body">
              {Object.entries(liveBlocks).sort(([left], [right]) => Number(left) - Number(right)).map(([index, block]) =>
                block.type === "thinking"
                  ? <details className="reasoning" key={index}><summary>Myślenie · w toku</summary><Markdown workspace={selected.workspace}>{block.content}</Markdown></details>
                  : block.type === "toolcall"
                    ? <div className="live-tool" key={index}><strong>Tool: {block.toolName ?? "pending"}</strong><pre>{block.content}</pre></div>
                    : <Markdown workspace={selected.workspace} key={index}>{block.content}</Markdown>)}
              </div>
            </article>}
            <div ref={endRef} />
          </section>

          <section className="composer">
            {[...pendingQuestions,...pendingApprovals].some(item=>item.sessionId===selectedId) && <>      <div className="composer-interactions">
        <div className="panel-heading attention-heading"><div><span>ODPOWIEDZ, ABY KONTYNUOWAĆ</span><h2>Wymaga uwagi</h2></div><b>{[...pendingQuestions,...pendingApprovals].filter(item=>item.sessionId===selectedId).length}</b></div>
        {pendingApprovals.filter(item => item.sessionId === selectedId).map((approval) => <article id={`interaction-${approval.id}`} className="interaction approval" key={approval.id}>
          <div className="interaction-tag">ZATWIERDZENIE</div><h3>{approval.title}</h3><pre>{approval.message}</pre>
          <div className="interaction-actions"><button className="danger ghost" onClick={() => controlApi.decideApproval(approval.id, false).then(refresh)}>Odrzuć</button>
            <button onClick={() => controlApi.decideApproval(approval.id, true).then(refresh)}>Zatwierdź</button></div>
        </article>)}
        {pendingQuestions.filter(item => item.sessionId === selectedId).map((question) => <QuestionCard key={question.id} question={question}
          onAnswer={(answers) => controlApi.answerQuestion(question.id, answers).then(() => refresh())}
          onCancel={() => controlApi.cancelQuestion(question.id).then(() => refresh())} />)}
      </div></>}
            {[...pendingQuestions,...pendingApprovals].filter(item=>item.sessionId!==selectedId).map(item => <button className="ghost other-session-question" key={item.id} onClick={()=>void loadSession(item.sessionId)}>Pytanie w sesji {status?.sessions.find(s=>s.id===item.sessionId)?.name ?? item.sessionId} →</button>)}
            {(queue.steering.length > 0 || queue.followUp.length > 0) && <div className="queue-state">
              {queue.steering.map((item, index) => <span key={`s-${index}`}>Steer: {item}<button onClick={()=>void dropQueued("steering",index,true)}>Recall</button><button onClick={()=>void dropQueued("steering",index)}>×</button></span>)}
              {queue.followUp.map((item, index) => <span key={`f-${index}`}>Follow-up: {item}<button onClick={()=>void dropQueued("followUp",index,true)}>Recall</button><button onClick={()=>void dropQueued("followUp",index)}>×</button></span>)}
            </div>}
            {images.length > 0 && <div className="attachments">{images.length} obraz(y)</div>}
            <div className="composer-input" style={{display:awaitingHuman ? "none" : undefined}}>
              <div className="composer-resizer" role="separator" aria-label="Wysokość pola wiadomości" aria-orientation="horizontal" tabIndex={0} onKeyDown={event=>{if(event.key==="ArrowUp"||event.key==="ArrowDown"){event.preventDefault();setEditorHeight(h=>Math.max(44,Math.min(320,h+(event.key==="ArrowUp"?20:-20))));}}} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.dataset.startY=String(event.clientY);event.currentTarget.dataset.height=String(editorHeight);}} onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))setEditorHeight(Math.max(44,Math.min(320,Number(event.currentTarget.dataset.height)+Number(event.currentTarget.dataset.startY)-event.clientY)));}} onPointerUp={event=>event.currentTarget.releasePointerCapture(event.pointerId)} title="Przeciągnij w górę, aby powiększyć pole" />
              {showSuggestions && <div id="slash-suggestions" className="slash-suggestions" role="listbox" aria-label="Podpowiedzi Pi">
                <header><span>{fileQuery?"Pliki workspace":argsQuery?"Argumenty komendy":"Komendy Pi"}</span><small>↑↓ wybierz · Enter zatwierdź · Esc zamknij</small></header>
                {suggestions.map((command, index) => <button type="button" role="option" aria-selected={index === suggestionIndex}
                  className={index === suggestionIndex ? "active" : ""} key={command.name}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => chooseCommand(command)}>
                  <span className={`command-source ${command.source}`}>{command.source === "skill" ? "✦" : command.source === "prompt" ? "▤" : "⌘"}</span>
                  <span><strong>{command.insertion!==undefined?command.name:`/${command.name}`}</strong><small>{command.description || "Brak opisu"}</small></span>
                  <em>{command.source}</em>
                </button>)}
              </div>}
              <textarea aria-label="Wiadomość do Pi" style={{height:Math.min(editorHeight,editorMaxHeight),resize:"none"}} ref={composerRef} value={composer} rows={2} placeholder="Napisz wiadomość…  / komendy · @[plik]" onFocus={()=>void refreshCommands()} onSelect={event=>setCaret(event.currentTarget.selectionStart)} onChange={(event) => { setComposer(event.target.value);setCaret(event.target.selectionStart); historyPosition.current = -1; setSlashDismissed(false); const previousHeight=event.currentTarget.style.height;event.currentTarget.style.height="0px";const height=Math.max(52,Math.min(160,event.currentTarget.scrollHeight));event.currentTarget.style.height=previousHeight;setEditorHeight(height); }}
                aria-autocomplete="list" aria-controls={showSuggestions ? "slash-suggestions" : undefined}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); return; }
                  if (!showSuggestions) {
                    const input = event.currentTarget;
                    if (event.nativeEvent.isComposing || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey || input.selectionStart !== input.selectionEnd) return;
                    const history = promptHistory(messages, sentPrompts[selectedId!] ?? []);
                    const position = historyStep(event.key, historyPosition.current, history.length, input.value, input.selectionStart, input.selectionEnd);
                    if (position === null) return;
                    if (historyPosition.current === -1) historyDraft.current = composer;
                    event.preventDefault(); historyPosition.current = position;
                    setComposer(position === -1 ? historyDraft.current : history[position]!);
                    setSlashDismissed(true); focusComposer(); return;
                  }
                  if (event.key === "ArrowDown") { event.preventDefault(); setSuggestionIndex((current) => (current + 1) % suggestions.length); }
                  else if (event.key === "ArrowUp") { event.preventDefault(); setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length); }
                  else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); chooseCommand(suggestions[suggestionIndex] ?? suggestions[0]!); }
                  else if (event.key === "Escape") { event.preventDefault(); setSlashDismissed(true); }
                }} />
            </div>
            <div className="composer-footer">
              <div className="composer-tools-left" hidden={awaitingHuman}>
                <button className="model-picker-trigger ghost" aria-label="Wybierz model" title={sessionState?.model ? `${sessionState.model.provider} / ${sessionState.model.id}` : "Wybierz model"} disabled={settingsBusy} onClick={openModelPicker}>{sessionState?.model?.id ?? "Wybierz model"} <span>▾</span></button>
                <select className="thinking-select" aria-label="Poziom myślenia" title="Poziom myślenia" disabled={settingsBusy || thinkingLevels.length < 2} value={sessionState?.thinkingLevel ?? "off"} onChange={event => void changeSetting("set_thinking_level", {level:event.target.value})}>{thinkingLevels.length ? thinkingLevels.map(level => <option key={level}>{level}</option>) : <option value="off">off</option>}</select>
                <label className="attach" title="Dodaj obraz"><Icon name="attach" /><span className="sr-only">Dodaj obraz</span><input type="file" accept="image/*" multiple onChange={(event) => void chooseImages(event.target.files)} /></label>
              </div>
              <div className="composer-status"><div className="usage-summary"><span className="context-usage" data-severity={usageSeverity(contextPercent)} title={`Szacowane użycie kontekstu z Pi${contextPercent == null ? "" : ` · ${usageHint(contextPercent)}`}`}>Kontekst: {contextUsage?.tokens == null ? "—" : contextUsage.tokens.toLocaleString()} / {contextUsage?.contextWindow?.toLocaleString() ?? sessionState?.model?.contextWindow?.toLocaleString() ?? "—"}</span><span className="conversation-usage" title={`${messages.length} wiadomości · ${conversationStats?.tokens?.total?.toLocaleString() ?? "—"} tokenów`}>{messages.length} wiad.{typeof conversationStats?.cost === "number" ? ` · $${conversationStats.cost.toFixed(2)}` : ""}</span></div><button className="ghost quota-status" aria-label={`Quota: ${quotaBusy?"odświeżanie…":quotaLabel(metrics.quota)}`} aria-description={usageHint(quotaPercent)} data-severity={usageSeverity(quotaPercent)} disabled={quotaBusy} title={`${quotaTitle(metrics.quota)}${quotaPercent == null ? "" : ` · ${usageHint(quotaPercent)}`}`} onClick={()=>void refreshQuota()}>Quota: {quotaBusy?"odświeżanie…":quotaLabel(metrics.quota)}</button></div>
              <div className="composer-tools-right" hidden={awaitingHuman}>
                <select aria-label="Tryb wysyłania" value={delivery} onChange={(event) => setDelivery(event.target.value as any)}><option value="prompt">Prompt</option><option value="steer">Steer</option><option value="follow_up">Follow-up</option></select>
                {(sessionState?.isStreaming || selected.status==="running" || activeChildren.length>0) && <button className="danger ghost stop-button" aria-label="Przerwij odpowiedź" title="Przerwij odpowiedź" onClick={() => inspect("abort")}>■</button>}
                <button className="send-button" aria-label="Wyślij wiadomość" title="Wyślij · ⌘ Enter" disabled={!composer.trim() && !images.length} onClick={send}><Icon name="send" /></button>
              </div>
            </div>
          </section>
        </> : <div className="empty"><span>π</span><div className="eyebrow">READY WHEN YOU ARE</div><h1>Wybierz lub utwórz sesję</h1><p>{status?.engine === "running" ? "Pi Engine działa. Otwórz sesję z panelu lub rozpocznij nową." : "Uruchom Pi Engine, aby rozpocząć pracę."}</p></div>}
      </main>
    <aside className="context-slot">{workspaceRoot && <Cockpit
        workspace={selected?.workspace ?? workspaceRoot}
        sessionId={selectedId}
        busy={!!sessionState?.isStreaming || !!sessionState?.isCompacting || selected?.status==="running" || selected?.status==="waiting"}
        activity={sessionState?.isCompacting?"Kompakcja kontekstu · w toku":sessionActivity}
        capabilities={capabilities}
        extensionUi={extensionSnapshot}
        children={childRuns}
        onChild={id=>{setChildChatHidden(id,false);setChatTab(id);setMobileView("chat");}}
        onCommand={extensionCommand}
        onError={setError}
        auxiliary={auxiliaryPanel}
        auxiliaryRef={contextRef}
        onAuxiliaryChange={changeAuxiliary}
      />}</aside>
    </div>
    <TerminalDock workspace={selected?.workspace ?? workspaceRoot} enabled={!!capabilities?.terminal} onError={setError} />
    <PluginRuntime enabled={!!capabilities?.localAdmin} onError={setError}/>
    {reaskTarget && <div className="modal-backdrop"><section className="modal"><h2>Edytuj i zapytaj ponownie</h2><p>Pi utworzy nową sesję. Oryginalna historia pozostanie bez zmian. Załączniki nie są kopiowane do nowego pytania.</p><textarea aria-label="Edytowana wiadomość" value={reaskTarget.text} onChange={event=>setReaskTarget({...reaskTarget,text:event.target.value})}/><button disabled={reasking} onClick={()=>setReaskTarget(undefined)}>Anuluj</button><button disabled={reasking||!reaskTarget.text.trim()} onClick={async()=>{if(!selectedId)return;setReasking(true);try{const session=await controlApi.reask(selectedId,reaskTarget.entryId,reaskTarget.text);showSession(session);setReaskTarget(undefined);await loadSession(session.id);}catch(error){setError(String(error));}finally{setReasking(false);}}}>Utwórz fork i wyślij</button></section></div>}
  </div>;
}
