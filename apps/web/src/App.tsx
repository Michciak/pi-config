import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Approval, PiEvent, SessionSummary, UserQuestion } from "@pi-local/protocol";
import type { PromptSnippet } from "@pi-local/prompt-snippets";
import { ApiError, connectEvents, controlApi, exchangeHashToken, type ControlStatus, type SubagentProfile } from "./api.js";
import { webCommands, commandSuggestions, selectSlashCommand, type SlashCommand } from "./commandPalette.js";
import { Markdown } from "./Markdown.js";
import { QuestionCard } from "./QuestionCard.js";
import { reduceLiveBlocks, toolEventText, type LiveBlocks } from "./stream.js";

import { promptHistory, historyStep } from "./promptHistory.js";
import { MessageContent } from "./MessageContent.js";

type Model = { provider: string; id: string };

export default function App() {
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [importPath, setImportPath] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [childRuns,setChildRuns] = useState<any[]>([]);
  const [chatTab,setChatTab] = useState("main");
  const [conversationStats,setConversationStats] = useState<any>();
  const [editorHeight,setEditorHeight] = useState(100);
  const [messages, setMessages] = useState<any[]>([]);
  const [sessionState, setSessionState] = useState<any>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("application");
  const [scope, setScope] = useState<{patterns:string[];resolved:string[];models:Model[];catalogAvailable:boolean;diagnostics:Array<{message:string}>}>({patterns:[],resolved:[],models:[],catalogAvailable:false,diagnostics:[]});
  const [scopeSelection, setScopeSelection] = useState<string[]>([]);
  const [scopeQuery, setScopeQuery] = useState("");
  const [scopeAll, setScopeAll] = useState(false);
  const [scopeNotice, setScopeNotice] = useState("");
  const [scopeGroup, setScopeGroup] = useState("scope");
  const [thinkingLevels, setThinkingLevels] = useState<string[]>([]);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [modelPicker, setModelPicker] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelProvider, setModelProvider] = useState("");
  const [creating, setCreating] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [folders, setFolders] = useState<Awaited<ReturnType<typeof controlApi.directories>>>();
  const folderRequest = useRef(0);
  const [folderError, setFolderError] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [subagents, setSubagents] = useState<SubagentProfile[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [enabledSnippets, setEnabledSnippets] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<UserQuestion[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<PiEvent[]>([]);
  const [liveBlocks, setLiveBlocks] = useState<LiveBlocks>({});
  const [liveUsage, setLiveUsage] = useState<any>();
  const [queue, setQueue] = useState<{ steering: string[]; followUp: string[] }>({ steering: [], followUp: [] });
  const [connected, setConnected] = useState(false);
  const historyPosition = useRef(-1);
  const historyDraft = useRef("");
  const [sentPrompts, setSentPrompts] = useState<Record<string, string[]>>({});
  const [composer, setComposer] = useState("");
  const [delivery, setDelivery] = useState<"prompt" | "steer" | "follow_up">("prompt");
  const [images, setImages] = useState<Array<{ type: "image"; data: string; mimeType: string }>>([]);
  const [bash, setBash] = useState("");
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
  const selectedRef = useRef<string | undefined>(undefined);
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

  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  const refreshing = useRef<Promise<void> | undefined>(undefined);
  const loadingSessions = useRef(new Map<string, Promise<void>>());
  function refresh(): Promise<void> {
    if (refreshing.current) return refreshing.current;
    const task = refreshNow().finally(() => { refreshing.current = undefined; });
    refreshing.current = task;
    return task;
  }
  async function refreshNow() {
    const [nextStatus, nextQuestions, nextApprovals] = await Promise.all([
      controlApi.status(), controlApi.questions(), controlApi.approvals(),
    ]);
    setStatus(nextStatus);
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
    setSelectedId(undefined);
    setMessages([]); setSessionState(undefined); setModels([]); setCommands([]); setSubagents([]);
    setLiveBlocks({}); setLiveUsage(undefined); setQueue({ steering: [], followUp: [] });
  }

  async function readSession(id: string) {
    const [nextMessages, nextState, nextModels, nextCommands, nextSubagents, nextThinkingLevels] = await Promise.all([
      controlApi.command<any[]>(id, "get_messages"),
      controlApi.command(id, "get_state"),
      controlApi.command<Model[]>(id, "get_available_models"),
      controlApi.command<SlashCommand[]>(id, "get_commands"),
      controlApi.subagents(id).catch(() => []),
      controlApi.command<string[]>(id, "get_available_thinking_levels"),
    ]);
    const [nextScope, children, stats] = await Promise.all([controlApi.scope(id), controlApi.subagentRuns(id), controlApi.command(id,"get_session_stats")]);
    if (selectedRef.current !== id) return;
    setScope(nextScope); setChildRuns(children); setConversationStats(stats); setThinkingLevels(nextThinkingLevels); setMessages(nextMessages); setSessionState(nextState); setModels(nextModels); setCommands([...nextCommands,...webCommands.filter(item=>!nextCommands.some(command=>command.name===item.name))]); setSubagents(nextSubagents);
  }

  function loadSession(id: string, resumeIfNeeded = true): Promise<void> {
    const pending = loadingSessions.current.get(id);
    if (pending) return pending;
    const task = loadSessionNow(id, resumeIfNeeded).finally(() => loadingSessions.current.delete(id));
    loadingSessions.current.set(id, task);
    return task;
  }
  async function loadSessionNow(id: string, resumeIfNeeded = true) {
    const switchingSession = selectedRef.current !== id;
    selectedRef.current = id;
    setSelectedId(id);
    if (switchingSession) {
      setChatTab("main"); setChildRuns([]); setLiveBlocks({}); setLiveUsage(undefined); setQueue({ steering: [], followUp: [] });
      setAdvanced(false); historyPosition.current = -1; historyDraft.current = ""; setComposer("");
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
        const [config, availableSnippets] = await Promise.all([controlApi.config(), controlApi.snippets()]);
        setWorkspaceRoot(config.workspaceRoot); setWorkspace(config.workspaceRoot);
        setSnippets(availableSnippets);
        await refresh();
        disconnect = connectEvents(0, (event) => {
          if(event.type === "subagent.updated") scheduleRefresh();
          setEvents((current) => [...current.slice(-499), event]);
          if (event.type === "engine.status_changed" || event.type.startsWith("session.")) scheduleRefresh();
          if (event.type.startsWith("user_question.") || event.type.startsWith("approval.")) scheduleRefresh();
          if (event.type === "ui.setTitle" && typeof (event.payload as any)?.title === "string") document.title = (event.payload as any).title;
          if (event.type === "ui.set_editor_text" && event.sessionId === selectedRef.current) setComposer(String((event.payload as any)?.text ?? ""));
          if (event.sessionId === selectedRef.current && event.type === "pi.message_start") {
            setLiveBlocks({}); setLiveUsage(undefined);
          }
          if (event.sessionId === selectedRef.current && event.type === "pi.message_update") {
            const payload = event.payload as any;
            setLiveBlocks((current) => reduceLiveBlocks(current, payload.assistantMessageEvent));
            setLiveUsage(payload.usage);
          }
          if (event.sessionId === selectedRef.current && event.type === "pi.queue_update") {
            const payload = event.payload as any;
            setQueue({ steering: payload.steering ?? [], followUp: payload.followUp ?? [] });
          }
          if (event.sessionId && event.sessionId === selectedRef.current && ["pi.agent_settled", "pi.message_end", "pi.tool_execution_end"].includes(event.type)) {
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
        });
      } catch (cause) { setError(String(cause)); }
    })();
    return () => { disconnect(); if (refreshTimer) clearTimeout(refreshTimer); };
  }, []);

  useEffect(() => { followOutput.current && endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, liveBlocks]);
  useEffect(() => {
    if (interactionTarget) document.getElementById(`interaction-${interactionTarget}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [questions, approvals, interactionTarget]);

  const liveEvents = useMemo(() => events.filter((event) => event.sessionId === selectedId).slice(-50), [events, selectedId]);
  const extensionUi = useMemo(() => {
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
  }, [events, selectedId]);
  const metrics = useMemo(() => {
    const rows=extensionUi.widgets.find(([key])=>key==="remote-metrics")?.[1];
    try{return JSON.parse(rows?.[0] ?? "{}");}catch{return {};}
  },[extensionUi]);
  const viewedChild=childRuns.find(item=>item.id===chatTab);
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
  const suggestions = useMemo(() => commandSuggestions(commands, composer), [commands, composer]);
  const showSuggestions = !slashDismissed && suggestions.length > 0;

  useEffect(() => { setSuggestionIndex(0); }, [composer]);

  async function engineAction(action: "start" | "stop" | "restart") {
    try { await controlApi.engine(action); await refresh(); } catch (cause) { setError(String(cause)); }
  }

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

  function focusComposer() {
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      const end = composerRef.current?.value.length ?? 0;
      composerRef.current?.setSelectionRange(end, end);
    });
  }

  function chooseCommand(command: SlashCommand) {
    setComposer(selectSlashCommand(command.name));
    setSlashDismissed(true);
    focusComposer();
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
    if (!selectedId || !composer.trim()) return;
    const builtin=composer.trim();
    if(webCommands.some(item=>`/${item.name}`===builtin)) {
      setComposer("");
      if(builtin==="/model"){setModelPicker(true);return;}
      if(builtin==="/settings" || builtin==="/scope"){if(builtin==="/scope")setSettingsTab("pi");void openSettings();return;}
      if(builtin==="/new"){setNewSessionOpen(true);void browseFolders(workspace||workspaceRoot);return;}
      const command=({"/compact":"compact","/stats":"get_session_stats","/export":"export_html","/tree":"get_tree","/abort":"abort"} as Record<string,string>)[builtin];
      if(command){setAdvanced(true);void inspect(command);return;}
    }
    const active = snippets.filter((item) => enabledSnippets.has(item.id));
    const message = [
      ...active.filter((item) => item.placement === "prepend").map((item) => item.body),
      composer,
      ...active.filter((item) => item.placement === "append").map((item) => item.body),
    ].join("\n\n");
    const original = composer; historyPosition.current = -1; setComposer(""); setEnabledSnippets(new Set());
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
    try { const data = await controlApi.scope(selected?.status === "running" || selected?.status === "idle" ? selectedId : undefined); setScope(data); setScopeSelection(data.patterns); setScopeAll(!data.patterns.length); setScopeQuery(""); setScopeNotice(""); setSettingsOpen(true); }
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
    catch { if (request === folderRequest.current) setFolderError("Nie można otworzyć folderu. Wybierz katalog wewnątrz dozwolonego workspace."); }
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

  return <div className="app-shell">
    <header className="app-header">
      <div className="brand"><span className="logo">π</span><span className="brand-copy"><strong>Pi Remote</strong><small>Local AI workspace</small></span></div>
      <div className="status-row">
        <span className={`engine-status ${engineState}`} title={status ? "Control Service dostępny" : "Brak połączenia z Control Service"}>
          <i className="dot" /><span>Pi Engine</span><b>{engineLabel}</b>
        </span>
        <button className="ghost" onClick={() => void openSettings()}>Ustawienia</button>

      </div>
    </header>

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
    {settingsOpen && <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}><section className="selection-modal settings-modal" role="dialog" aria-modal="true" aria-label="Ustawienia" onClick={event => event.stopPropagation()} onKeyDown={event => {if(event.key === "Escape") setSettingsOpen(false);}}>
      <div className="selection-title"><h2>Ustawienia</h2><button className="ghost" onClick={() => setSettingsOpen(false)}>Zamknij</button></div>
      <nav className="settings-tabs">{[["application","Aplikacja"],["pi","Pi · Modele i scope"],["diagnostics","Pi · Diagnostyka"]].map(([id,label]) => <button className={settingsTab === id ? "" : "ghost"} key={id} onClick={() => setSettingsTab(id!)}>{label}</button>)}</nav>
      {settingsTab === "application" && <><h3>Usługi</h3><div className="folder-actions">        <button onClick={() => engineAction("start")} disabled={status?.engine === "running"}>Start</button>
        <button className="ghost" onClick={() => engineAction("restart")} disabled={status?.engine !== "running"}>Restart</button>
        <button className="danger ghost" onClick={() => engineAction("stop")} disabled={status?.engine === "stopped"}>Stop</button>
        <button className="ghost" title="Control Service uruchomi się ponownie przez launchd" onClick={() => void controlApi.restartControl()}>↻ Control</button></div><h3>Telefon i powiadomienia</h3><button onClick={() => {setSettingsOpen(false); void startPairing();}}>Sparuj telefon</button>              <article className="tool-card notification-card">
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
</>}
      {settingsTab === "pi" && <><h3>Globalny scope modeli</h3><label className="scope-option"><input type="checkbox" checked={scopeAll} onChange={event => setScopeAll(event.target.checked)} />Wszystkie dostępne modele</label>
      <input aria-label="Szukaj w scope" placeholder="Filtruj modele i dostawców…" value={scopeQuery} onChange={event => setScopeQuery(event.target.value)} />
      {!scope.catalogAvailable && <p role="status">Katalog modeli nie jest jeszcze dostępny. Otwórz lub wznów sesję Pi, a następnie ponownie otwórz ustawienia. Zapisane pozycje scope pozostają zachowane.</p>}
      <div className="scope-selector">{[...new Set([...scope.patterns,...scope.models.map(m => `${m.provider}/${m.id}`)])].filter(ref => ref.toLowerCase().includes(scopeQuery.toLowerCase())).sort().map(ref => <label className="scope-option" key={ref}><input type="checkbox" disabled={scopeAll} checked={scopeAll || scopeSelection.includes(ref)} onChange={event => setScopeSelection(current => event.target.checked ? [...current,ref] : current.filter(item => item !== ref))} /><span>{ref}<small>{ref.includes("*") ? "Zapisany wzorzec Pi" : !scope.models.some(m => `${m.provider}/${m.id}` === ref) ? "Zapisana pozycja · brak w bieżącym katalogu" : ref.split("/")[0]}</small></span></label>)}</div>
      <small>{scopeAll ? "Cały katalog" : `${scopeSelection.length} wybranych pozycji`}</small>
      <button onClick={() => void saveModelScope()}>Zapisz scope</button>{scopeNotice && <p role="status">{scopeNotice}</p>}
      {scope.diagnostics.map((item,index) => <p key={index}>{item.message}</p>)}
      <p>Model i poziom myślenia wybierasz osobno w nagłówku sesji. Retry i kompakcja dotyczą aktywnej sesji i pozostają w jej narzędziach.</p></>}
      {settingsTab === "diagnostics" && <><h3>Rozszerzenia aktywnej sesji</h3>            {extensionUi.statuses.length > 0 && <details className="extension-diagnostics"><summary>Status rozszerzeń</summary>{extensionUi.statuses.map(([key,value]) => <div key={key}><strong>{key}</strong>: {value}</div>)}</details>}<p>Status Cursor informuje o backendzie i trybie fast; nie jest ustawieniem poziomu myślenia.</p></>}
    </section></div>}
    {modelPicker && <div className="modal-backdrop" onClick={() => setModelPicker(false)}><section className="selection-modal" role="dialog" aria-modal="true" aria-label="Wybierz model" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") setModelPicker(false); }}>
      <div className="selection-title"><h2>Wybierz model</h2><button className="ghost" onClick={() => setModelPicker(false)}>Zamknij</button></div>
      <input autoFocus aria-label="Szukaj modelu" placeholder="Szukaj po nazwie lub dostawcy…" value={modelQuery} onChange={event => setModelQuery(event.target.value)} />
      <select aria-label="Dostawca modeli" value={modelProvider} onChange={event => setModelProvider(event.target.value)}><option value="">Wszyscy dostawcy</option>{[...new Set(models.map(m => m.provider))].sort().map(provider => <option key={provider}>{provider}</option>)}</select>
      <select aria-label="Grupa modeli" value={scopeGroup} onChange={event => setScopeGroup(event.target.value)}><option value="scope">Globalny scope Pi ({scope.resolved.length})</option><option value="all">Wszystkie modele ({models.length})</option><option value="outside">Poza scope</option></select>
      <div className="selection-list">{models.filter(m => (scopeGroup === "all" || (scopeGroup === "scope" ? scope.resolved.includes(`${m.provider}/${m.id}`) : !scope.resolved.includes(`${m.provider}/${m.id}`))) && (!modelProvider || m.provider === modelProvider) && `${m.provider}/${m.id}`.toLowerCase().includes(modelQuery.toLowerCase())).map(m => <button className="ghost" disabled={settingsBusy} key={`${m.provider}/${m.id}`} onClick={() => void changeModel(`${m.provider}/${m.id}`)}><strong>{m.id}</strong><small>{m.provider}{sessionState?.model?.id === m.id && sessionState?.model?.provider === m.provider ? " · Wybrany" : ""}</small></button>)}</div>
    </section></div>}
    {newSessionOpen && <div className="modal-backdrop" onClick={() => !creating && setNewSessionOpen(false)}><section className="selection-modal" role="dialog" aria-modal="true" aria-label="Nowa sesja" onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape" && !creating) setNewSessionOpen(false); }}>
      <div className="selection-title"><h2>Nowa sesja</h2><button className="ghost" disabled={creating} onClick={() => setNewSessionOpen(false)}>Anuluj</button></div>
      <label>Nazwa sesji<input autoFocus value={sessionName} onChange={event => setSessionName(event.target.value)} placeholder="Nazwa sesji" /></label>
      <label>Katalog sesji<input value={workspace} onChange={event => setWorkspace(event.target.value)} placeholder={workspaceRoot} /></label>
      <button className="ghost" onClick={() => void browseFolders(workspace || workspaceRoot)}>Przeglądaj folder</button>
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
    <div className="layout">
      <aside className="sessions-panel">
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

      <main className="conversation">
        {selected ? <>
          <div className="conversation-head">
            <div className="session-identity">
              <div className="session-kicker"><span><i className={`session-dot ${selected.status}`} />Aktywna sesja</span><b>{sessionActivity}</b></div>
              <h1>{selected.name}</h1>
              <p title={selected.workspace}><span>⌁</span>{selected.workspace}</p>
            </div>
            <div className="session-controls">
              <label><span>Model</span><button className="model-picker-trigger ghost" disabled={settingsBusy} onClick={() => { setModelPicker(true); setModelQuery(""); setModelProvider(""); }}>{sessionState?.model ? `${sessionState.model.provider} / ${sessionState.model.id}` : "Wybierz model"} ▾</button></label>
              <label className="thinking-control"><span>Myślenie</span><select aria-label="Poziom myślenia" disabled={settingsBusy || thinkingLevels.length < 2} value={sessionState?.thinkingLevel ?? "off"} onChange={event => void changeSetting("set_thinking_level", {level:event.target.value})}>
                {thinkingLevels.length ? thinkingLevels.map(level => <option key={level}>{level}</option>) : <option value="off">Niedostępne</option>}
              </select>{thinkingLevels.length < 2 && <span className="thinking-info" tabIndex={0} aria-label="Informacja o myśleniu" title="Bieżący katalog modelu nie udostępnia regulacji myślenia. W przypadku Cursor może to wynikać z wersji rozszerzenia lub jego katalogu modeli.">ⓘ</span>}</label>
              <button className={`tools-toggle ghost ${advanced ? "active" : ""}`} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><span>⌘</span>Narzędzia</button>
            </div>
          </div>

          {!advanced && (skills.length > 0 || subagents.length > 0) && <nav className="capability-toolbar" aria-label="Szybkie wywołania skilli i subagentów">
            {skills.length > 0 && <div className="capability-group"><span>Skills</span><div>{skills.map((skill) => <button key={skill.name} title={skill.description} onClick={() => chooseSkill(skill)}>
              <i>✦</i>{skill.name.replace(/^skill:/, "")}
            </button>)}</div></div>}
            {skills.length > 0 && subagents.length > 0 && <span className="capability-divider" />}
            {subagents.length > 0 && <div className="capability-group"><span>Subagenci</span><div>{subagents.map((profile) => <button key={profile.name} title={profile.description} onClick={() => chooseSubagent(profile)}>
              <i>◎</i>{profile.name}
            </button>)}</div></div>}
          </nav>}

          {(extensionUi.statuses.length > 0 || extensionUi.widgets.length > 0 || extensionUi.notices.length > 0) && <section className="extension-ui">

            {extensionUi.widgets.filter(([key]) => key !== "remote-metrics" && key !== "rpc-subagents").map(([key, lines]) => <pre key={key}>{lines.join("\n")}</pre>)}
            {extensionUi.notices.map((notice) => <div className={`extension-notice ${notice.kind}`} key={notice.seq}>{notice.message}</div>)}
          </section>}

          {advanced && <section className="advanced">
            <header className="advanced-head">
              <div><span className="advanced-icon">⌘</span><span><b>Narzędzia sesji</b><small>Operacje, automatyzacja i diagnostyka</small></span></div>
              <button className="ghost" aria-label="Zamknij panel narzędzi" onClick={() => setAdvanced(false)}>×</button>
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
                  <button onClick={() => inspect("set_auto_compaction", { enabled: true })}><span><i>◈</i><b>Auto compaction</b></span><em>Włącz</em></button>
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
              <article className="tool-card terminal-card">
                <div className="tool-card-head"><span>Bezpośredni bash</span><small>Uruchom w workspace sesji</small></div>
                <div className="terminal-input"><span>$</span><input value={bash} onChange={(event) => setBash(event.target.value)} placeholder="Wpisz komendę…" /></div>
                <div className="terminal-actions"><button onClick={() => inspect("bash", { command: bash })}>Uruchom</button><button className="ghost" onClick={() => inspect("abort_bash")}>Przerwij</button></div>
              </article>
            </div>
            {inspection !== undefined && <div className="inspection-result"><header><span>Wynik operacji</span><button className="ghost" onClick={() => setInspection(undefined)}>×</button></header><pre>{JSON.stringify(inspection, null, 2)}</pre></div>}
            <details className="command-reference"><summary><span>Komendy slash</span><small>{commands.length} dostępnych</small></summary><ul>{commands.map((command) => <li key={command.name}>
              <button onClick={() => { chooseCommand(command); setAdvanced(false); }}><code>/{command.name}</code><span>{command.description}</span><em>{command.source}</em></button>
            </li>)}</ul></details>
          </section>}

          <nav className="chat-tabs" aria-label="Karty czatu" role="tablist">
            <button role="tab" aria-selected={chatTab === "main"} className="chat-tab" onClick={()=>setChatTab("main")}><span className="chat-tab-title">Orchestrator</span><small>Główna rozmowa</small></button>
            {childRuns.map(child=><button role="tab" aria-selected={chatTab===child.id} className="chat-tab" key={child.id} onClick={()=>setChatTab(child.id)}>
              <span className="chat-tab-title"><span className={`agent-dot ${child.status}`} />{child.name}<span className="agent-state">{({running:"Pracuje",starting:"Startuje",waiting:"Czeka",completed:"Gotowe",error:"Błąd",interrupted:"Przerwano"} as Record<string,string>)[child.status] ?? child.status}</span></span>
              <small title={child.model}>{child.model || "Model niedostępny"}</small>
            </button>)}
          </nav>
          {viewedChild && <section className="messages child-messages"><div className="child-heading">{viewedChild.name} · {viewedChild.model} · {viewedChild.status}<p>Podgląd subagenta. Wiadomości z pola poniżej trafiają do orchestratora.</p></div>{viewedChild.messages.map((message:any,index:number)=><article className="message" key={index}><div className="role">{message.toolName ?? message.role}</div><MessageContent message={message} workspace={selected.workspace} /></article>)}{viewedChild.liveMessage && <article className="message"><MessageContent message={viewedChild.liveMessage} workspace={selected.workspace}/></article>}</section>}
          <section className="messages" style={{display:viewedChild ? "none" : undefined}} onScroll={event => { const el = event.currentTarget; followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100; }}>
            {messages.map((message, index) => <article className={`message ${message.role ?? "system"}`} key={message.id ?? index}>
              <div className="role">{({user:"Ty", assistant:"Pi", toolResult:"Narzędzie", system:"System"} as Record<string,string>)[message.role] ?? message.role ?? message.type}</div><MessageContent message={message} workspace={selected.workspace} />
            </article>)}
            {[...new Map(liveEvents.filter(event => event.type.includes("tool_execution")).map(event => [String((event.payload as any)?.toolCallId ?? event.seq), event])).values()].filter(event => !messages.some(message => message.role === "toolResult" && message.toolCallId === (event.payload as any)?.toolCallId)).map(event => <details className="tool-output" key={(event.payload as any)?.toolCallId ?? event.seq}>
              <summary><strong>{String((event.payload as any)?.toolName ?? "Narzędzie")}</strong> · {event.type.endsWith("_end") ? "Zakończono" : "W toku"}</summary>
              <pre>{toolEventText(event.payload)}</pre>
            </details>)}
            {Object.keys(liveBlocks).length > 0 && <article className="message assistant live-message">
              <div className="role">assistant · streaming{liveUsage?.totalTokens ? ` · ${liveUsage.totalTokens} tokens` : ""}</div>
              {Object.entries(liveBlocks).sort(([left], [right]) => Number(left) - Number(right)).map(([index, block]) =>
                block.type === "thinking"
                  ? <details className="reasoning" key={index}><summary>Myślenie · w toku</summary><Markdown workspace={selected.workspace}>{block.content}</Markdown></details>
                  : block.type === "toolcall"
                    ? <div className="live-tool" key={index}><strong>Tool: {block.toolName ?? "pending"}</strong><pre>{block.content}</pre></div>
                    : <Markdown workspace={selected.workspace} key={index}>{block.content}</Markdown>)}
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
              {queue.steering.map((item, index) => <span key={`s-${index}`}>Steer: {item}</span>)}
              {queue.followUp.map((item, index) => <span key={`f-${index}`}>Follow-up: {item}</span>)}
            </div>}
            {images.length > 0 && <div className="attachments">{images.length} obraz(y)</div>}
            <div className="composer-input" style={{display:awaitingHuman ? "none" : undefined}}>
              <div className="composer-resizer" role="separator" aria-label="Wysokość pola wiadomości" aria-orientation="horizontal" tabIndex={0} onKeyDown={event=>{if(event.key==="ArrowUp"||event.key==="ArrowDown"){event.preventDefault();setEditorHeight(h=>Math.max(72,Math.min(400,h+(event.key==="ArrowUp"?20:-20))));}}} onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.dataset.startY=String(event.clientY);event.currentTarget.dataset.height=String(editorHeight);}} onPointerMove={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))setEditorHeight(Math.max(72,Math.min(400,Number(event.currentTarget.dataset.height)+Number(event.currentTarget.dataset.startY)-event.clientY)));}} onPointerUp={event=>event.currentTarget.releasePointerCapture(event.pointerId)} title="Przeciągnij w górę, aby powiększyć pole">◢</div>
              {showSuggestions && <div id="slash-suggestions" className="slash-suggestions" role="listbox" aria-label="Dostępne komendy slash">
                <header><span>Komendy Pi</span><small>↑↓ wybierz · Enter zatwierdź · Esc zamknij</small></header>
                {suggestions.map((command, index) => <button type="button" role="option" aria-selected={index === suggestionIndex}
                  className={index === suggestionIndex ? "active" : ""} key={command.name}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => chooseCommand(command)}>
                  <span className={`command-source ${command.source}`}>{command.source === "skill" ? "✦" : command.source === "prompt" ? "▤" : "⌘"}</span>
                  <span><strong>/{command.name}</strong><small>{command.description || "Brak opisu"}</small></span>
                  <em>{command.source === "skill" ? "skill" : command.source === "prompt" ? "prompt" : "extension"}</em>
                </button>)}
              </div>}
              <textarea style={{height:editorHeight,resize:"none"}} ref={composerRef} value={composer} rows={3} placeholder="Napisz do Pi…  / komendy · ↑↓ historia" onChange={(event) => { setComposer(event.target.value); historyPosition.current = -1; setSlashDismissed(false); }}
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
            <div className="composer-footer" style={{display:awaitingHuman ? "none" : undefined}}><div className="usage-summary"><span title="Szacowane użycie kontekstu z Pi">Kontekst: {(metrics.context ?? conversationStats?.contextUsage)?.tokens == null ? "—" : (metrics.context ?? conversationStats?.contextUsage).tokens.toLocaleString()} / {(metrics.context ?? conversationStats?.contextUsage)?.contextWindow?.toLocaleString() ?? sessionState?.model?.contextWindow?.toLocaleString() ?? "—"}</span><span>Rozmowa: {messages.length} wiadomości · {conversationStats?.tokens?.total?.toLocaleString() ?? "—"} tok.</span><button className="ghost quota-status" title="Quota providera; kliknij, aby odświeżyć" onClick={()=>selectedId && controlApi.command(selectedId,"prompt",{message:"/quota"}).catch(cause=>setError(String(cause)))}>Quota: {metrics.quota?.state === "available" ? metrics.quota.remaining == null ? "bez limitu klucza" : `$${Number(metrics.quota.remaining).toFixed(2)}` : "brak danych"}</button></div><label className="attach">＋ Obraz<input type="file" accept="image/*" multiple onChange={(event) => void chooseImages(event.target.files)} /></label>
              <select value={delivery} onChange={(event) => setDelivery(event.target.value as any)}><option value="prompt">Prompt</option><option value="steer">Steer</option><option value="follow_up">Follow-up</option></select>
              <button className="danger ghost" onClick={() => inspect("abort")}>Przerwij</button><button onClick={send}>Wyślij ⌘↵</button></div>
          </section>
        </> : <div className="empty"><span>π</span><div className="eyebrow">READY WHEN YOU ARE</div><h1>Wybierz lub utwórz sesję</h1><p>{status?.engine === "running" ? "Pi Engine działa. Otwórz sesję z panelu lub rozpocznij nową." : "Uruchom Pi Engine, aby rozpocząć pracę."}</p></div>}
      </main>


    </div>
  </div>;
}
