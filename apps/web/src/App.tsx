import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Approval, PiEvent, ServerStatus, SessionSummary, UserQuestion } from "@pi-local/protocol";
import type { PromptSnippet } from "@pi-local/prompt-snippets";
import { ApiError, connectEvents, controlApi, exchangeHashToken, type SubagentProfile } from "./api.js";
import { commandSuggestions, selectSlashCommand, type SlashCommand } from "./commandPalette.js";
import { Markdown, messageText } from "./Markdown.js";
import { QuestionCard } from "./QuestionCard.js";
import { reduceLiveBlocks, toolEventText, type LiveBlocks } from "./stream.js";

type Model = { provider: string; id: string };

export default function App() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [importPath, setImportPath] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [messages, setMessages] = useState<any[]>([]);
  const [sessionState, setSessionState] = useState<any>();
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
  const endRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const selectedRef = useRef<string | undefined>(undefined);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const selected = status?.sessions.find((session) => session.id === selectedId);
  const interactionTarget = new URLSearchParams(location.search).get("interaction");

  useEffect(() => { selectedRef.current = selectedId; }, [selectedId]);

  async function refresh() {
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
    const [nextMessages, nextState, nextModels, nextCommands, nextSubagents] = await Promise.all([
      controlApi.command<any[]>(id, "get_messages"),
      controlApi.command(id, "get_state"),
      controlApi.command<Model[]>(id, "get_available_models"),
      controlApi.command<SlashCommand[]>(id, "get_commands"),
      controlApi.subagents(id).catch(() => []),
    ]);
    setMessages(nextMessages); setSessionState(nextState); setModels(nextModels); setCommands(nextCommands); setSubagents(nextSubagents);
  }

  async function loadSession(id: string, resumeIfNeeded = true) {
    const switchingSession = selectedRef.current !== id;
    setSelectedId(id);
    if (switchingSession) {
      setLiveBlocks({}); setLiveUsage(undefined); setQueue({ steering: [], followUp: [] });
      setAdvanced(false);
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
    void (async () => {
      try {
        await exchangeHashToken();
        const [config, availableSnippets] = await Promise.all([controlApi.config(), controlApi.snippets()]);
        setWorkspaceRoot(config.workspaceRoot); setWorkspace(config.workspaceRoot);
        setSnippets(availableSnippets);
        await refresh();
        disconnect = connectEvents(0, (event) => {
          setEvents((current) => [...current.slice(-499), event]);
          if (event.type === "engine.status_changed" || event.type.startsWith("session.")) void refresh();
          if (event.type.startsWith("user_question.") || event.type.startsWith("approval.")) void refresh();
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
    return () => disconnect();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, liveBlocks]);
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
  const targetFirst = <T extends { id: string }>(items: T[]) => [...items].sort((left, right) =>
    left.id === interactionTarget ? -1 : right.id === interactionTarget ? 1 : 0);
  const pendingQuestions = targetFirst(questions.filter((item) => item.status === "pending"));
  const pendingApprovals = targetFirst(approvals.filter((item) => item.status === "pending"));
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
    try {
      const session = await controlApi.createSession(workspace, sessionName);
      showSession(session); setSessionName(""); await loadSession(session.id);
    } catch (cause) { setError(String(cause)); }
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
    const active = snippets.filter((item) => enabledSnippets.has(item.id));
    const message = [
      ...active.filter((item) => item.placement === "prepend").map((item) => item.body),
      composer,
      ...active.filter((item) => item.placement === "append").map((item) => item.body),
    ].join("\n\n");
    const original = composer; setComposer(""); setEnabledSnippets(new Set());
    try { await controlApi.command(selectedId, delivery, { message, images }); setImages([]); await refresh(); }
    catch (cause) { setComposer(original); setError(String(cause)); }
  }

  async function inspect(command: string, payload: Record<string, unknown> = {}) {
    if (!selectedId) return;
    try { setInspection(await controlApi.command(selectedId, command, payload)); }
    catch (cause) { setError(String(cause)); }
  }

  async function changeModel(value: string) {
    if (!selectedId || !value) return;
    const [provider, ...modelId] = value.split("/");
    try {
      await controlApi.command(selectedId, "set_model", { provider, modelId: modelId.join("/") });
      setSessionState(await controlApi.command(selectedId, "get_state"));
      setError("");
    } catch (cause) { setError(String(cause)); }
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
        <span className={`dot ${connected ? "ok" : "bad"}`} />Control
        <span className={`pill ${status?.engine}`}>{status?.engine ?? "offline"}</span>
        <button className="ghost" onClick={startPairing}>Telefon</button>
        <button onClick={() => engineAction("start")} disabled={status?.engine === "running"}>Start</button>
        <button className="ghost" onClick={() => engineAction("restart")} disabled={status?.engine !== "running"}>Restart</button>
        <button className="danger ghost" onClick={() => engineAction("stop")} disabled={status?.engine === "stopped"}>Stop</button>
        <button className="ghost" title="Control Service uruchomi się ponownie przez launchd" onClick={() => void controlApi.restartControl()}>↻ Control</button>
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
          <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder={workspaceRoot} />
          <input value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder="Nazwa sesji" />
          <button onClick={createSession} disabled={status?.engine !== "running"}>＋ Nowa sesja</button>
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
              <div className="session-kicker"><span><i className={`session-dot ${selected.status}`} />Aktywna sesja</span><b>{selected.status}</b></div>
              <h1>{selected.name}</h1>
              <p title={selected.workspace}><span>⌁</span>{selected.workspace}</p>
            </div>
            <div className="session-controls">
              <label><span>Model</span><select aria-label="Model" value={sessionState?.model ? `${sessionState.model.provider}/${sessionState.model.id}` : ""}
                onChange={(event) => void changeModel(event.target.value)}>
                <option value="">Wybierz model</option>{models.map((model) => <option key={`${model.provider}/${model.id}`}>{model.provider}/{model.id}</option>)}
              </select></label>
              <label className="thinking-control"><span>Myślenie</span><select aria-label="Poziom myślenia" value={sessionState?.thinkingLevel ?? "medium"} onChange={(event) => void inspect("set_thinking_level", { level: event.target.value })}>
                {['off','minimal','low','medium','high','xhigh','max'].map((level) => <option key={level}>{level}</option>)}
              </select></label>
              <button className={`tools-toggle ghost ${advanced ? "active" : ""}`} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><span>⌘</span>Narzędzia</button>
            </div>
          </div>

          {(skills.length > 0 || subagents.length > 0) && <nav className="capability-toolbar" aria-label="Szybkie wywołania skilli i subagentów">
            {skills.length > 0 && <div className="capability-group"><span>Skills</span><div>{skills.map((skill) => <button key={skill.name} title={skill.description} onClick={() => chooseSkill(skill)}>
              <i>✦</i>{skill.name.replace(/^skill:/, "")}
            </button>)}</div></div>}
            {skills.length > 0 && subagents.length > 0 && <span className="capability-divider" />}
            {subagents.length > 0 && <div className="capability-group"><span>Subagenci</span><div>{subagents.map((profile) => <button key={profile.name} title={profile.description} onClick={() => chooseSubagent(profile)}>
              <i>◎</i>{profile.name}
            </button>)}</div></div>}
          </nav>}

          {(extensionUi.statuses.length > 0 || extensionUi.widgets.length > 0 || extensionUi.notices.length > 0) && <section className="extension-ui">
            {extensionUi.statuses.map(([key, value]) => <div className="extension-status" key={key}><small>{key}</small><span>{value}</span></div>)}
            {extensionUi.widgets.map(([key, lines]) => <pre key={key}>{lines.join("\n")}</pre>)}
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

          <section className="messages">
            {messages.map((message, index) => <article className={`message ${message.role ?? "system"}`} key={message.id ?? index}>
              <div className="role">{message.role ?? message.type}</div><Markdown workspace={selected.workspace}>{messageText(message)}</Markdown>
            </article>)}
            {liveEvents.filter((event) => event.type.includes("tool_execution")).map((event) => <article className="tool-event" key={event.seq}>
              <div><code>{event.type.replace("pi.", "")}</code><span>{String((event.payload as any)?.toolName ?? "")}</span></div>
              {toolEventText(event.payload) && <pre>{toolEventText(event.payload)}</pre>}
            </article>)}
            {Object.keys(liveBlocks).length > 0 && <article className="message assistant live-message">
              <div className="role">assistant · streaming{liveUsage?.totalTokens ? ` · ${liveUsage.totalTokens} tokens` : ""}</div>
              {Object.entries(liveBlocks).sort(([left], [right]) => Number(left) - Number(right)).map(([index, block]) =>
                block.type === "thinking"
                  ? <details className="reasoning" open key={index}><summary>Reasoning</summary><Markdown workspace={selected.workspace}>{block.content}</Markdown></details>
                  : block.type === "toolcall"
                    ? <div className="live-tool" key={index}><strong>Tool: {block.toolName ?? "pending"}</strong><pre>{block.content}</pre></div>
                    : <Markdown workspace={selected.workspace} key={index}>{block.content}</Markdown>)}
            </article>}
            <div ref={endRef} />
          </section>

          <section className="composer">
            {(queue.steering.length > 0 || queue.followUp.length > 0) && <div className="queue-state">
              {queue.steering.map((item, index) => <span key={`s-${index}`}>Steer: {item}</span>)}
              {queue.followUp.map((item, index) => <span key={`f-${index}`}>Follow-up: {item}</span>)}
            </div>}
            {images.length > 0 && <div className="attachments">{images.length} obraz(y)</div>}
            <div className="composer-input">
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
              <textarea ref={composerRef} value={composer} rows={3} placeholder="Napisz do Pi…  Wpisz /, aby zobaczyć komendy" onChange={(event) => { setComposer(event.target.value); setSlashDismissed(false); }}
                aria-autocomplete="list" aria-controls={showSuggestions ? "slash-suggestions" : undefined}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); return; }
                  if (!showSuggestions) return;
                  if (event.key === "ArrowDown") { event.preventDefault(); setSuggestionIndex((current) => (current + 1) % suggestions.length); }
                  else if (event.key === "ArrowUp") { event.preventDefault(); setSuggestionIndex((current) => (current - 1 + suggestions.length) % suggestions.length); }
                  else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); chooseCommand(suggestions[suggestionIndex] ?? suggestions[0]!); }
                  else if (event.key === "Escape") { event.preventDefault(); setSlashDismissed(true); }
                }} />
            </div>
            <div><label className="attach">＋ Obraz<input type="file" accept="image/*" multiple onChange={(event) => void chooseImages(event.target.files)} /></label>
              <select value={delivery} onChange={(event) => setDelivery(event.target.value as any)}><option value="prompt">Prompt</option><option value="steer">Steer</option><option value="follow_up">Follow-up</option></select>
              <button className="danger ghost" onClick={() => inspect("abort")}>Przerwij</button><button onClick={send}>Wyślij ⌘↵</button></div>
          </section>
        </> : <div className="empty"><span>π</span><div className="eyebrow">READY WHEN YOU ARE</div><h1>Wybierz lub utwórz sesję</h1><p>{status?.engine === "running" ? "Pi Engine działa. Otwórz sesję z panelu lub rozpocznij nową." : "Uruchom Pi Engine, aby rozpocząć pracę."}</p></div>}
      </main>

      <aside className="interaction-panel">
        <div className="panel-heading attention-heading"><div><span>INBOX</span><h2>Wymaga uwagi</h2></div><b>{pendingQuestions.length + pendingApprovals.length}</b></div>
        {pendingApprovals.map((approval) => <article id={`interaction-${approval.id}`} className="interaction approval" key={approval.id}>
          <div className="interaction-tag">ZATWIERDZENIE</div><h3>{approval.title}</h3><pre>{approval.message}</pre>
          <div className="interaction-actions"><button className="danger ghost" onClick={() => controlApi.decideApproval(approval.id, false).then(refresh)}>Odrzuć</button>
            <button onClick={() => controlApi.decideApproval(approval.id, true).then(refresh)}>Zatwierdź</button></div>
        </article>)}
        {pendingQuestions.map((question) => <QuestionCard key={question.id} question={question}
          onAnswer={(answers) => controlApi.answerQuestion(question.id, answers).then(() => refresh())}
          onCancel={() => controlApi.cancelQuestion(question.id).then(() => refresh())} />)}
        {pendingQuestions.length + pendingApprovals.length === 0 && <p className="muted">Brak oczekujących pytań.</p>}
        {(questions.some((item) => item.status !== "pending") || approvals.some((item) => item.status !== "pending")) &&
          <details className="interaction-history"><summary>Ostatnio rozstrzygnięte</summary>
            {[...questions.filter((item) => item.status !== "pending"), ...approvals.filter((item) => item.status !== "pending")]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20).map((item) =>
                <div key={item.id}><span>{"question" in item ? item.question : item.title}</span><small>{item.status}</small></div>)}
          </details>}
      </aside>
    </div>
  </div>;
}
