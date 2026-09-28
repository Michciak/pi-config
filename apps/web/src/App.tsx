import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Approval, PiEvent, ServerStatus, UserQuestion } from "@pi-local/protocol";
import type { PromptSnippet } from "@pi-local/prompt-snippets";
import { connectEvents, controlApi, exchangeHashToken } from "./api.js";
import { Markdown, messageText } from "./Markdown.js";
import { QuestionCard } from "./QuestionCard.js";

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
  const [commands, setCommands] = useState<any[]>([]);
  const [snippets, setSnippets] = useState<PromptSnippet[]>([]);
  const [enabledSnippets, setEnabledSnippets] = useState<Set<string>>(new Set());
  const [questions, setQuestions] = useState<UserQuestion[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<PiEvent[]>([]);
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
  const endRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | undefined>(undefined);
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

  async function loadSession(id: string) {
    setSelectedId(id);
    try {
      const [nextMessages, nextState, nextModels, nextCommands] = await Promise.all([
        controlApi.command<any[]>(id, "get_messages"),
        controlApi.command(id, "get_state"),
        controlApi.command<Model[]>(id, "get_available_models"),
        controlApi.command<any[]>(id, "get_commands"),
      ]);
      setMessages(nextMessages); setSessionState(nextState); setModels(nextModels); setCommands(nextCommands);
    } catch (cause) { setError(String(cause)); }
  }

  useEffect(() => {
    let disconnect = () => {};
    void (async () => {
      try {
        await exchangeHashToken();
        const [config, availableSnippets] = await Promise.all([controlApi.config(), controlApi.snippets()]);
        setWorkspaceRoot(config.workspaceRoot); setWorkspace(config.workspaceRoot);
        setSnippets(availableSnippets);
        await refresh();
        disconnect = connectEvents(0, (event) => {
          setEvents((current) => [...current.slice(-499), event]);
          if (event.type === "engine.status_changed" || event.type === "session.status_changed") void refresh();
          if (event.type.startsWith("user_question.") || event.type.startsWith("approval.")) void refresh();
          if (event.type === "ui.setTitle" && typeof (event.payload as any)?.title === "string") document.title = (event.payload as any).title;
          if (event.type === "ui.set_editor_text" && event.sessionId === selectedRef.current) setComposer(String((event.payload as any)?.text ?? ""));
          if (event.sessionId === selectedRef.current && ["pi.agent_settled", "pi.message_end", "pi.tool_execution_end"].includes(event.type)) void loadSession(event.sessionId);
        }, setConnected);
      } catch (cause) { setError(String(cause)); }
    })();
    return () => disconnect();
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, events]);
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

  async function engineAction(action: "start" | "stop" | "restart") {
    try { await controlApi.engine(action); await refresh(); } catch (cause) { setError(String(cause)); }
  }

  async function startPairing() {
    try { setPairing(await controlApi.startPairing()); } catch (cause) { setError(String(cause)); }
  }

  async function createSession() {
    try {
      const session = await controlApi.createSession(workspace, sessionName);
      await refresh(); await loadSession(session.id); setSessionName("");
    } catch (cause) { setError(String(cause)); }
  }

  async function importSession() {
    if (!importPath.trim()) return;
    try {
      const session = await controlApi.importSession(importPath, workspace, sessionName);
      setImportPath(""); setSessionName(""); await refresh(); await loadSession(session.id);
    } catch (cause) { setError(String(cause)); }
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
    <header>
      <div><span className="logo">π</span><strong>Pi Remote</strong></div>
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
    <div className="layout">
      <aside className="sessions-panel">
        <h2>Sesje</h2>
        <div className="new-session">
          <input value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder={workspaceRoot} />
          <input value={sessionName} onChange={(event) => setSessionName(event.target.value)} placeholder="Nazwa sesji" />
          <button onClick={createSession} disabled={status?.engine !== "running"}>Nowa sesja</button>
          <details className="import-session"><summary>Import kopii sesji terminalowej</summary>
            <input value={importPath} onChange={(event) => setImportPath(event.target.value)} placeholder="~/.pi/agent/sessions/…jsonl" />
            <button className="ghost" onClick={importSession} disabled={status?.engine !== "running"}>Importuj kopię</button>
          </details>
        </div>
        <nav>{status?.sessions.map((session) => <button key={session.id}
          className={`session-row ${selectedId === session.id ? "active" : ""}`}
          onClick={() => session.status === "interrupted" ? controlApi.resumeSession(session.id).then(() => loadSession(session.id)) : loadSession(session.id)}>
          <span>{session.name}</span><small><i className={`session-dot ${session.status}`} />{session.status}</small>
        </button>)}</nav>
      </aside>

      <main className="conversation">
        {selected ? <>
          <div className="conversation-head">
            <div><h1>{selected.name}</h1><p>{selected.workspace}</p></div>
            <div className="model-controls">
              <select value={sessionState?.model ? `${sessionState.model.provider}/${sessionState.model.id}` : ""}
                onChange={(event) => { const [provider, ...id] = event.target.value.split("/"); void inspect("set_model", { provider, modelId: id.join("/") }); }}>
                <option value="">Model</option>{models.map((model) => <option key={`${model.provider}/${model.id}`}>{model.provider}/{model.id}</option>)}
              </select>
              <select value={sessionState?.thinkingLevel ?? "medium"} onChange={(event) => void inspect("set_thinking_level", { level: event.target.value })}>
                {['off','minimal','low','medium','high','xhigh','max'].map((level) => <option key={level}>{level}</option>)}
              </select>
              <button className="ghost" onClick={() => setAdvanced(!advanced)}>Narzędzia</button>
            </div>
          </div>

          {(extensionUi.statuses.length > 0 || extensionUi.widgets.length > 0 || extensionUi.notices.length > 0) && <section className="extension-ui">
            {extensionUi.statuses.map(([key, value]) => <div className="extension-status" key={key}><small>{key}</small><span>{value}</span></div>)}
            {extensionUi.widgets.map(([key, lines]) => <pre key={key}>{lines.join("\n")}</pre>)}
            {extensionUi.notices.map((notice) => <div className={`extension-notice ${notice.kind}`} key={notice.seq}>{notice.message}</div>)}
          </section>}

          {advanced && <section className="advanced">
            {snippets.length > 0 && <details className="snippet-picker"><summary>Prompt snippets ({enabledSnippets.size})</summary>
              <div>{snippets.map((snippet) => <label key={snippet.id}>
                <input type="checkbox" checked={enabledSnippets.has(snippet.id)} onChange={() => setEnabledSnippets((current) => {
                  const next = new Set(current); next.has(snippet.id) ? next.delete(snippet.id) : next.add(snippet.id); return next;
                })} />
                <span><strong>{snippet.name}</strong><small>{snippet.placement} · {snippet.description}</small></span>
              </label>)}</div>
            </details>}
            <div className="button-grid">
              {[["Statystyki","get_session_stats"],["Drzewo","get_tree"],["Forki","get_fork_messages"],["Komendy","get_commands"],["Eksport HTML","export_html"],["Kompaktuj","compact"]].map(([label, command]) =>
                <button className="ghost" key={command} onClick={() => inspect(command)}>{label}</button>)}
              <button className="ghost" onClick={() => inspect("clone")}>Klonuj sesję</button>
              <button className="ghost" onClick={() => inspect("clear_queue")}>Wyczyść kolejkę</button>
              <button className="ghost" onClick={() => inspect("set_auto_retry", { enabled: true })}>Auto retry: włącz</button>
              <button className="ghost" onClick={() => inspect("abort_retry")}>Przerwij retry</button>
              <button className="ghost" onClick={() => inspect("set_auto_compaction", { enabled: true })}>Auto compaction: włącz</button>
              <button className="danger ghost" onClick={() => selectedId && controlApi.stopSession(selectedId).then(refresh)}>Zatrzymaj sesję</button>
            </div>
            <div className="bash-row"><input value={rename} onChange={(event) => setRename(event.target.value)} placeholder={selected.name} />
              <button className="ghost" onClick={() => inspect("set_session_name", { name: rename }).then(() => { setRename(""); void refresh(); })}>Zmień nazwę</button></div>
            <div className="bash-row"><input value={entryId} onChange={(event) => setEntryId(event.target.value)} placeholder="ID wpisu dla fork" />
              <button className="ghost" onClick={() => inspect("fork", { entryId })}>Fork od wpisu</button></div>
            <div className="bash-row"><input value={bash} onChange={(event) => setBash(event.target.value)} placeholder="Bezpośrednia komenda bash" />
              <button onClick={() => inspect("bash", { command: bash })}>Uruchom</button><button className="ghost" onClick={() => inspect("abort_bash")}>Przerwij</button></div>
            {inspection !== undefined && <pre>{JSON.stringify(inspection, null, 2)}</pre>}
            <details><summary>Dostępne komendy slash ({commands.length})</summary><ul>{commands.map((command: any) => <li key={command.name}><code>/{command.name}</code> {command.description}</li>)}</ul></details>
          </section>}

          <section className="messages">
            {messages.map((message, index) => <article className={`message ${message.role ?? "system"}`} key={message.id ?? index}>
              <div className="role">{message.role ?? message.type}</div><Markdown>{messageText(message)}</Markdown>
            </article>)}
            {liveEvents.filter((event) => event.type.includes("tool_execution")).map((event) => <article className="tool-event" key={event.seq}>
              <code>{event.type.replace("pi.", "")}</code><span>{String((event.payload as any)?.toolName ?? "")}</span>
            </article>)}
            <div ref={endRef} />
          </section>

          <section className="composer">
            {images.length > 0 && <div className="attachments">{images.length} obraz(y)</div>}
            <textarea value={composer} rows={3} placeholder="Napisz do Pi…" onChange={(event) => setComposer(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send(); }} />
            <div><label className="attach">＋ Obraz<input type="file" accept="image/*" multiple onChange={(event) => void chooseImages(event.target.files)} /></label>
              <select value={delivery} onChange={(event) => setDelivery(event.target.value as any)}><option value="prompt">Prompt</option><option value="steer">Steer</option><option value="follow_up">Follow-up</option></select>
              <button className="danger ghost" onClick={() => inspect("abort")}>Przerwij</button><button onClick={send}>Wyślij ⌘↵</button></div>
          </section>
        </> : <div className="empty"><span>π</span><h1>Wybierz lub utwórz sesję</h1><p>Pi Engine pozostaje wyłączony, dopóki go nie uruchomisz.</p></div>}
      </main>

      <aside className="interaction-panel">
        <h2>Wymaga uwagi <span>{pendingQuestions.length + pendingApprovals.length}</span></h2>
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
