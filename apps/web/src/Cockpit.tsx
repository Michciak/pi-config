import { useEffect, useRef, useState, type Ref } from "react";
import type { ClientCapabilities, ExtensionUiState, FileDocument, GitSnapshot, PluginManifest, TerminalSession } from "@pi-local/protocol";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { ApiError, authenticatedSocket, controlApi, mediaUrl } from "./api.js";
import { Markdown } from "./Markdown.js";
import {pluginModule} from "./pluginRuntime.js";
import {Icon, type IconName} from "./Icon.js";

type AuxiliaryTab = "models" | "tools" | "settings";
type ChildSummary = {id:string;name:string;status:string;model?:string};
type Props = { workspace: string; sessionId?: string; activity?:string; capabilities?: ClientCapabilities; extensionUi?: ExtensionUiState; children?:ChildSummary[]; onChild?(id:string):void; onCommand(message: string): void; onError(message: string): void; auxiliary?:AuxiliaryTab; auxiliaryRef?:Ref<HTMLDivElement>; onAuxiliaryChange?(tab?:AuxiliaryTab):void };
type Tab = "overview" | "files" | "git" | "extensions" | "plugins";

export function Cockpit({ workspace, sessionId, activity, busy=false, capabilities, extensionUi, children=[], onChild, onCommand, onError,auxiliary,auxiliaryRef,onAuxiliaryChange }: Props & {busy?:boolean}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [dirty, setDirty] = useState(false);
  const [pluginView,setPluginView]=useState<string>();
  const changeTab = (next: Tab) => {
    if(next===tab){onAuxiliaryChange?.();return;}
    if (dirty && !confirm("Odrzucić niezapisane zmiany?")) return;
    setDirty(false); setTab(next);onAuxiliaryChange?.();
  };
  useEffect(()=>{const open=(event:Event)=>{if(dirty&&!confirm("Odrzucić niezapisane zmiany?"))return;setDirty(false);setPluginView(String((event as CustomEvent).detail));setTab("plugins");};window.addEventListener("pi-plugin-view",open);return()=>window.removeEventListener("pi-plugin-view",open);},[dirty]);
  useEffect(()=>{if(!sessionId&&tab==="git")setTab("overview");},[sessionId,tab]);
  return <aside className="cockpit-panel">
    <nav className="cockpit-tabs" role="tablist" aria-label="Panele workspace">{([["overview", "Przegląd", "overview"], ["files", "Pliki", "folder"], ["git", "Git", "git"], ["extensions", "Dodatki", "extensions"], ["plugins", "Pluginy", "plugins"]] as Array<[Tab,string,IconName]>).map(([id, label, icon]) =>
      <button role="tab" aria-label={label} title={label} aria-selected={!auxiliary&&tab===id} disabled={id==="git"&&!sessionId} key={id} className={!auxiliary&&tab === id ? "active" : ""} onClick={() => changeTab(id)}><Icon name={icon}/></button>)}
      {onAuxiliaryChange&&([["models","Modele"],["tools","Narzędzia"],["settings","Ustawienia"]] as const).map(([id,label])=><button role="tab" aria-label={label} title={label} aria-selected={auxiliary===id} disabled={id!=="settings"&&!sessionId} className={auxiliary===id?"active":""} key={id} onClick={()=>onAuxiliaryChange(id)}><Icon name={id}/></button>)}
    </nav>
    <div className="cockpit-core" hidden={!!auxiliary}>
    {tab === "overview" && <OverviewPanel sessionId={sessionId} activity={activity} busy={busy} state={extensionUi} children={children} onChild={onChild} onCommand={onCommand}/>}
    {tab === "files" && <FilesPanel workspace={workspace} writable={!!capabilities?.workspaceWrite} onDirty={setDirty} onError={onError} />}
    {tab === "git" && sessionId && <GitPanel workspace={workspace} writable={!!capabilities?.gitWrite} sessionId={sessionId} onCommand={onCommand} onError={onError} />}
    {tab === "extensions" && <ExtensionsPanel sessionId={sessionId} state={extensionUi} localAdmin={!!capabilities?.localAdmin} onCommand={onCommand} onError={onError} />}
    {tab === "plugins" && <PluginsPanel activeView={pluginView} writable={!!capabilities?.pluginsWrite} onError={onError} />}
    </div><div ref={auxiliaryRef} className="auxiliary-slot" hidden={!auxiliary}/>
  </aside>;
}

export function LocalPanel({onError}:{onError(message:string):void}) {
  const [processes,setProcesses]=useState<Awaited<ReturnType<typeof controlApi.processes>>>([]);
  const [versions,setVersions]=useState<any[]>([]);
  const [providers,setProviders]=useState("");
  const [id,setId]=useState(""),[key,setKey]=useState("");
  const [busy,setBusy]=useState(false);
  const refresh=()=>controlApi.processes().then(setProcesses).catch(error=>onError(String(error)));
  return <section className="cockpit-body system-settings"><details onToggle={event=>{if(event.currentTarget.open)void refresh();}}><summary>Procesy lokalne</summary><button onClick={()=>void refresh()}>Odśwież</button>{processes.map(item=><div className="extension-state" key={item.pid}><b>{item.pid} · {item.command}</b><span>{item.ports.join(", ")}</span><button onClick={()=>controlApi.stopProcess(item.pid).then(refresh).catch(error=>onError(String(error)))}>Stop</button></div>)}</details>
    <details><summary>Aktualizacje dodatków</summary><button disabled={busy} onClick={()=>{setBusy(true);controlApi.extensionVersions().then(setVersions).catch(error=>onError(String(error))).finally(()=>setBusy(false));}}>Sprawdź aktualizacje</button>{versions.map(item=><div className="extension-state" key={item.source}><b>{item.name}</b><span>{item.version} → {item.latest??"nieznana"}</span>{item.latest&&item.latest!==item.version&&<button disabled={busy} onClick={()=>{setBusy(true);controlApi.updateExtension(item.source).then(()=>onError("Rozszerzenie zaktualizowane. Otwórz sesję ponownie.")).catch(error=>onError(String(error))).finally(()=>setBusy(false));}}>Aktualizuj z backupem</button>}</div>)}</details>
    <details><summary>Providerzy i klucze</summary><button onClick={()=>controlApi.providers().then(value=>setProviders(JSON.stringify(value,null,2))).catch(error=>onError(String(error)))}>Otwórz konfigurację</button>{providers&&<div className="config-editor"><textarea aria-label="Konfiguracja providerów" value={providers} onChange={event=>setProviders(event.target.value)}/><button onClick={()=>{try {controlApi.saveProviders(JSON.parse(providers)).catch(error=>onError(String(error)));}catch(error){onError(String(error));}}}>Zapisz providerów</button></div>}
    <h4>Nowy klucz providera</h4><input placeholder="ID providera" value={id} onChange={event=>setId(event.target.value)}/><input type="password" autoComplete="new-password" placeholder="Nowy klucz" value={key} onChange={event=>setKey(event.target.value)}/><button disabled={!id||!key} onClick={()=>controlApi.saveProviderKey(id,key).then(()=>setKey("")).catch(error=>onError(String(error)))}>Zapisz klucz lokalnie</button>
    </details></section>;
}

function FilesPanel({ workspace, writable, onDirty, onError }: { workspace: string; writable: boolean; onDirty(dirty: boolean): void; onError(message: string): void }) {
  const [path, setPath] = useState(".");
  const [tree, setTree] = useState<any>();
  const [document, setDocument] = useState<FileDocument>();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [searchContents, setSearchContents] = useState(false);
  const [hex, setHex] = useState<Awaited<ReturnType<typeof controlApi.hex>>>();
  const [results, setResults] = useState<any[]>([]);
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [media, setMedia] = useState<{ url: string; path: string }>();
  const generation = useRef(0);
  const mediaRef = useRef<string | undefined>(undefined);
  const draftRevision = useRef(0);
  const draftRef = useRef(draft); draftRef.current=draft;
  const openRevision = useRef(0);
  const changeDirty = (value: boolean) => { setDirty(value); onDirty(value); };
  const loadTree = async (next = path) => {
    try { const value = await controlApi.workspaceTree(workspace, next); setPath(value.path); setTree(value); }
    catch (error) { onError(String(error)); }
  };
  useEffect(() => {
    generation.current++; openRevision.current++; setDocument(undefined); setMedia(undefined); setHex(undefined); changeDirty(false); void loadTree(".");
    return () => { generation.current++; if (mediaRef.current) URL.revokeObjectURL(mediaRef.current); };
  }, [workspace]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    const sessionGuard = (event: Event) => {if(dirty && !confirm("Odrzucić niezapisane zmiany?"))event.preventDefault();};
    window.addEventListener("beforeunload", guard);
    window.addEventListener("pi-before-session-switch",sessionGuard);
    return () => {window.removeEventListener("beforeunload", guard);window.removeEventListener("pi-before-session-switch",sessionGuard);};
  }, [dirty]);
  useEffect(() => {
    const version = ++generation.current;
    const timer = setTimeout(() => {
      if (!query.trim()) { setResults([]); return; }
      controlApi.workspaceSearch(workspace, query,searchContents).then(value => { if (generation.current === version) setResults(value.results); }).catch(error => onError(String(error)));
    }, 200);
    return () => clearTimeout(timer);
  }, [workspace, query,searchContents]);
  const open = async (file: string) => {
    if (dirty && !confirm("Odrzucić niezapisane zmiany?")) return;
    const revision = ++openRevision.current;
    setHex(undefined);
    try {
      if (mediaRef.current) URL.revokeObjectURL(mediaRef.current);
      if (/\.(png|jpe?g|gif|webp|mp4|webm|mp3|wav|ogg)$/i.test(file)) {
        const url = await mediaUrl(workspace, file); mediaRef.current = url;
        if (revision !== openRevision.current) { URL.revokeObjectURL(url); return; }
        setMedia({ url, path: file }); setDocument(undefined);
      } else {
        const value = await controlApi.document(workspace, file);
        if (revision !== openRevision.current) return;
        setDocument(value); setDraft(value.content); setMedia(undefined); setPreview(false);
      }
      changeDirty(false);
    } catch (error) {
      if(error instanceof ApiError && (error.status===415 || error.status===413)) {
        try {const value=await controlApi.hex(workspace,file);if(revision===openRevision.current){setHex(value);setDocument(undefined);setMedia(undefined);changeDirty(false);}}
        catch(cause){onError(String(cause));}
      } else onError(String(error));
    }
  };
  const save = async () => {
    if (!document || !writable || document.readOnly || saving) return;
    const revision = draftRevision.current, opened = openRevision.current;
    setSaving(true);
    try {
      const value = await controlApi.saveDocument(workspace, document.path, draft, document.etag);
      if (opened !== openRevision.current) return;
      setDocument(value);
      // Updating the ETag is necessary even when typing continued during the request.
      if (revision === draftRevision.current) { setDraft(value.content); changeDirty(false); }
      else changeDirty(draftRef.current !== value.content);
    } catch (error) { onError(String(error)); } finally { setSaving(false); }
  };
  const upload = async (files: FileList | null) => {
    if (!files || !writable) return;
    for (const file of [...files]) {
      if (file.size > 100 * 1024 * 1024) { onError("Upload: limit 100 MiB"); continue; }
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = reject;
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.readAsDataURL(file);
        });
        await controlApi.upload(workspace, path, file.name, base64);
      } catch (error) { onError(String(error)); }
    }
    await loadTree();
  };
  return <section className="cockpit-body files-panel"
    onDragOver={event => { if (writable) event.preventDefault(); }}
    onDrop={event => { event.preventDefault(); void upload(event.dataTransfer.files); }}
    onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); } }}>
    <h2 className="context-title">Pliki</h2>
    <div className="workspace-heading" title={workspace}><Icon name="folder" /><strong>{workspace.split("/").filter(Boolean).at(-1) ?? "Workspace"}</strong><span>{tree?.entries?.length ?? "—"}</span></div>
    <div className="panel-toolbar"><label className="file-search"><Icon name="search" /><input aria-label="Szukaj plików" placeholder="Szukaj plików…" value={query} onChange={event => setQuery(event.target.value)} /></label><button className="icon-button" aria-label="Folder nadrzędny" title="Folder nadrzędny" onClick={() => void loadTree(path.split("/").slice(0, -1).join("/") || ".")}><Icon name="up" /></button><button className="icon-button" aria-label="Odśwież pliki" title="Odśwież" onClick={() => void loadTree()}><Icon name="refresh" /></button></div>
    <div className="file-options"><label><input type="checkbox" checked={searchContents} onChange={event=>setSearchContents(event.target.checked)}/> Szukaj w treści</label>
    {writable && <label className="attach" title="Prześlij pliki"><Icon name="upload" />Upload<input type="file" multiple onChange={event => void upload(event.target.files)} /></label>}</div>
    <div className="path-crumb"><button title="Katalog projektu" onClick={()=>void loadTree(".")}>{workspace.split("/").filter(Boolean).at(-1)}</button>{path!=="." && <><Icon name="chevron" /><span>{path}</span></>}</div>
    <div className="file-list workspace-file-list">{(query ? results : tree?.entries ?? []).map((item: any) =>
      <button key={item.path} title={item.path} aria-pressed={document?.path===item.path} onClick={() => item.kind === "directory" ? void loadTree(item.path) : void open(item.path)}><Icon name={item.kind === "directory" ? "folder" : "file"} className={item.kind === "directory" ? "folder" : "file"} /><span className="file-name">{query ? item.path : item.name}</span><small>{item.kind!=="directory" && item.size != null ? formatBytes(item.size) : ""}</small></button>)}</div>
    {document && <div className="editor-shell"><div className="editor-head"><b>{document.path}{dirty ? " •" : ""}</b><button onClick={() => setPreview(value => !value)}>{preview ? "Kod" : "Podgląd"}</button><button disabled={!dirty || !writable || saving} onClick={() => void save()}>Zapisz</button><button onClick={() => { if (!dirty || confirm("Odrzucić niezapisane zmiany?")) { openRevision.current++; setDocument(undefined); changeDirty(false); } }}>×</button></div>
      {preview ? <div className="editor-preview">{/\.md$/i.test(document.path) ? <Markdown workspace={workspace}>{draft}</Markdown> : /\.html?$/i.test(document.path) ? <iframe title={document.path} sandbox="" srcDoc={draft} /> : <pre>{draft}</pre>}</div>
        : <textarea aria-label="Edytor pliku" readOnly={!writable || document.readOnly} value={draft} onChange={event => { draftRevision.current++; setDraft(event.target.value); changeDirty(event.target.value !== document.content); }} />}</div>}
    {media && <div className="editor-preview">{/\.(mp4|webm)$/i.test(media.path) ? <video controls src={media.url} /> : /\.(mp3|wav|ogg)$/i.test(media.path) ? <audio controls src={media.url} /> : <img alt={media.path} src={media.url} />}</div>}
    {hex && <div className="editor-preview"><b>{hex.path} · hex · {formatBytes(hex.size)}</b>{hex.truncated&&<p>Pierwsze 64 KiB</p>}<pre>{hex.content}</pre></div>}
  </section>;
}

function GitPanel({ workspace, writable, sessionId, onCommand, onError }: { workspace: string; writable: boolean; sessionId?: string; onCommand(message: string): void; onError(message: string): void }) {
  const [state, setState] = useState<GitSnapshot>();
  const [output, setOutput] = useState("");
  const [outputTitle,setOutputTitle]=useState("Repozytorium");
  const [message, setMessage] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const gitWorkspace=useRef(workspace);gitWorkspace.current=workspace;
  const diffRevision=useRef(0),statusRevision=useRef(0);
  const refresh = async () => {
    const revision=++statusRevision.current;
    try { const [next, refs] = await Promise.all([controlApi.gitStatus(workspace), controlApi.gitBranches(workspace)]); if(gitWorkspace.current!==workspace||revision!==statusRevision.current)return;setState(next); setBranches(refs.branches); }
    catch (error) { if(gitWorkspace.current===workspace&&revision===statusRevision.current)onError(String(error)); }
  };
  useEffect(() => { setOutput("");setSelected("");setState(undefined);setBranches([]);setBusy(false);diffRevision.current++;void refresh();return()=>{statusRevision.current++;diffRevision.current++;}; }, [workspace]);
  const action = async (name: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try { const next=await controlApi.gitAction(workspace, name, extra);if(gitWorkspace.current!==workspace)return;setState(next);setOutput("");diffRevision.current++;if (name === "commit") setMessage("");void refresh(); }
    catch (error) { if(gitWorkspace.current===workspace)onError(String(error)); } finally { if(gitWorkspace.current===workspace)setBusy(false); }
  };
  const diff = async (path?: string, staged = false) => {
    const revision=++diffRevision.current;
    try{const value=await controlApi.gitDiff(workspace,path,staged);if(gitWorkspace.current!==workspace||revision!==diffRevision.current)return;setSelected(path??"");setOutputTitle((path??"Repozytorium")+(staged?" · Staged":""));setOutput(value.diff||"Brak różnic w wybranym zakresie.");}
    catch(error){if(gitWorkspace.current===workspace&&revision===diffRevision.current)onError(String(error));}
  };
  const history=async()=>{const revision=++diffRevision.current;try{const value=await controlApi.gitLog(workspace);if(gitWorkspace.current!==workspace||revision!==diffRevision.current)return;setOutputTitle("Historia");setOutput(value.log||"Brak commitów.");}catch(error){if(gitWorkspace.current===workspace&&revision===diffRevision.current)onError(String(error));}};
  if(state?.repository===false) return <section className="cockpit-body git-panel"><h2 className="context-title">Git</h2><div className="panel-empty"><Icon name="git"/><h3>Brak repozytorium</h3><p>Folder tej sesji nie jest repozytorium Git. Wybierz sesję otwartą w katalogu projektu z Git.</p><small title={workspace}>{workspace}</small><button className="ghost" onClick={()=>void refresh()}>Sprawdź ponownie</button></div></section>;
  return <section className="cockpit-body git-panel"><h2 className="context-title">Git</h2><div className="git-head"><b title={state?.branch}>{state?.branch ?? "Git"}</b><span>{state?.head} ↑{state?.ahead ?? 0} ↓{state?.behind ?? 0}</span><button aria-label="Odśwież Git" onClick={() => void refresh()}><Icon name="refresh"/></button></div>
    {writable && <select aria-label="Gałąź Git" value={state?.branch ?? ""} disabled={busy} onChange={event => void action("switch", { branch: event.target.value })}><option value="">Gałęzie</option>{branches.map(branch => <option key={branch}>{branch}</option>)}</select>}
    <div className="git-changes">{([false,true] as const).map(staged=>{const files=state?.files.filter(file=>staged ? file.index!==" "&&file.index!=="?" : file.workingTree!==" ")??[];return <section className="git-group" key={String(staged)}><header>{staged?"Staged":"Zmiany"}<span>{files.length}</span></header><div className="file-list">{files.map(file=><div className="git-file" key={file.path}><button className="git-file-path" title={file.path} aria-pressed={selected===file.path} onClick={()=>{setSelected(file.path);void diff(file.path,staged);}}><code>{staged?file.index:file.workingTree}</code><span>{file.path}</span></button>{writable&&<button className="git-stage" disabled={busy} aria-label={`${staged?"Unstage":"Stage"} ${file.path}`} title={staged?"Unstage":"Stage"} onClick={()=>void action(staged?"unstage":"stage",{path:file.path})}>{staged?"−":"+"}</button>}</div>)}</div></section>;})}{state?.files.length===0&&<p className="git-clean">Brak zmian w repozytorium.</p>}</div>
    <div className="panel-actions"><button onClick={() => void diff()}>Diff</button><button onClick={() => void diff(undefined, true)}>Staged diff</button><button onClick={() => void history()}>Historia</button>{writable && <><button disabled={busy} onClick={() => void action("pull")}>Pull</button><button disabled={busy} onClick={() => void action("push")}>Push</button></>}</div>
    {writable && <div className="commit-row"><input placeholder="Commit message" value={message} onChange={event => setMessage(event.target.value)} /><button disabled={busy || !message.trim()} onClick={() => void action("commit", { message })}>Commit</button></div>}
    <details><summary>Simplify</summary><div className="panel-actions"><button disabled={!sessionId} onClick={() => onCommand("/simplify")}>Wszystkie</button><button disabled={!sessionId} onClick={() => onCommand("/simplify --staged")}>Staged</button><button disabled={!sessionId || !selected} onClick={() => onCommand("/simplify " + selected)}>Wybrany plik</button></div><input placeholder="Ref (np. HEAD~1)" value={ref} onChange={event => setRef(event.target.value)} /><button disabled={!sessionId || !ref} onClick={() => onCommand("/simplify --ref=" + ref)}>Ref</button></details>
    {output && <div className="git-diff-view"><header><span>{outputTitle}</span><button aria-label="Zamknij podgląd Git" onClick={()=>{diffRevision.current++;setOutput("");}}>×</button></header><pre className="git-output">{output.split("\n").map((line,index)=><span key={index} className={line.startsWith("+")?"diff-add":line.startsWith("-")?"diff-remove":""}>{line}{"\n"}</span>)}</pre></div>}
  </section>;
}

function OverviewPanel({sessionId,activity,busy,state,children,onChild,onCommand}:{sessionId?:string;activity?:string;busy?:boolean;state?:ExtensionUiState;children:ChildSummary[];onChild?(id:string):void;onCommand(message:string):void}) {
  const active=children.filter(child=>["starting","running","waiting"].includes(child.status));
  const acp=active.filter(child=>child.id.startsWith("acp:"));
  const [objective,setObjective]=useState("");
  const [budget,setBudget]=useState("");
  const clearWork=(kind:"goal"|"todos")=>{
    if(window.confirm(kind==="goal"?"Wyczyścić cel tej sesji? Historia pozostanie zachowana.":"Wyczyścić wszystkie TODO tej sesji? Historia pozostanie zachowana."))onCommand(kind==="goal"?"/goal clear":"/todos clear");
  };
  const goalCommand=(edit=false)=>{if(objective.trim())onCommand("/goal "+(edit?"edit ":"")+(budget?"--tokens "+budget+" ":"")+objective);};
  return <section className="cockpit-body overview-panel"><h2 className="context-title">Przegląd</h2>
    {!sessionId?<p className="notification-help">Wybierz sesję, aby zobaczyć cel, zadania i agentów.</p>:<>
    <p className="notification-help" role="status">{activity}</p>
    {(state?.goal || !!state?.todo?.items.length)&&<div className="panel-actions work-clear-actions">{state?.goal&&<button className="ghost" disabled={busy} onClick={()=>clearWork("goal")}>Wyczyść cel</button>}{!!state?.todo?.items.length&&<button className="ghost" disabled={busy} onClick={()=>clearWork("todos")}>Wyczyść TODO</button>}</div>}
    <section className="overview-section"><h3>Agenci <small>{active.length} aktywnych · {children.length} łącznie</small></h3><div className="agent-counts"><span>Subagenci <b>{active.length-acp.length}</b></span><span>ACP <b>{acp.length}</b></span></div>{active.map(child=><button className="overview-agent" key={child.id} onClick={()=>onChild?.(child.id)} title={`${child.name} · ${child.model??""}`}><span className={`agent-dot ${child.status}`}/><span>{child.name}</span><small>{child.status==="waiting"?"Czeka":"Pracuje"}</small></button>)}</section>
    <section className="overview-section"><h3>Cel <small>{state?.goal?.status??"brak"}</small></h3>{state?.goal?<><p>{state.goal.objective}</p><small>{state.goal.tokensUsed?.toLocaleString()??0} / {state.goal.tokenBudget?.toLocaleString()??"∞"} tokenów</small>{!!state.goal.tokenBudget&&<progress value={state.goal.tokensUsed??0} max={state.goal.tokenBudget}/>}<div className="panel-actions"><button disabled={!sessionId} onClick={()=>onCommand(state.goal?.status==="active"?"/goal pause":"/goal resume")}>{state.goal.status==="active"?"Wstrzymaj":"Wznów"}</button><button className="ghost" onClick={()=>onCommand("/goal status")}>Status</button></div></>:<p className="notification-help">Brak ustawionego celu.</p>}<details><summary>{state?.goal?"Zarządzaj celem":"Ustaw cel"}</summary><input aria-label="Cel" placeholder="Cel" value={objective} onChange={event=>setObjective(event.target.value)}/><input aria-label="Budżet celu" placeholder="Budżet tokenów (opcjonalny)" value={budget} onChange={event=>setBudget(event.target.value)}/><div className="panel-actions"><button disabled={!objective.trim()} onClick={()=>goalCommand(!!state?.goal)}>{state?.goal?"Zmień":"Ustaw"}</button>{state?.goal&&<button className="ghost" onClick={()=>onCommand("/goal clear")}>Usuń cel</button>}</div></details></section>
    <section className="overview-section"><h3>TODO <small>{state?.todo?.completed??0}/{state?.todo?.total??0}</small></h3>{state?.todo?.items.length?<ul className="task-list">{state.todo.items.map(item=><li className={item.status} key={item.id}><span>{item.status==="completed"?"✓":item.status==="in_progress"?"◉":"○"}</span><span>{item.subject}{item.activity&&<small>{item.activity}</small>}{!!item.blockedBy?.length&&<small>Zależności: {item.blockedBy.join(", ")}</small>}</span></li>)}</ul>:<p className="notification-help">Brak zadań.</p>}</section>
    {!!state?.workflows?.length&&<section className="overview-section"><h3>Workflow</h3>{state.workflows.map(run=><div className="extension-state" key={run.id}><b>{run.name??run.id}</b><span>{run.status} · {run.phase} · {run.agents??0} agentów</span><div className="panel-actions">{["pause","resume","stop","status"].map(action=><button key={action} onClick={()=>onCommand("/workflows "+action+" "+run.id)}>{action}</button>)}</div></div>)}</section>}
    {Object.entries(state?.statuses??{}).length>0&&<section className="overview-section"><h3>Status rozszerzeń</h3>{Object.entries(state?.statuses??{}).map(([key,value])=><div className="extension-state" key={key}><b>{key}</b><span>{value}</span></div>)}</section>}
    {Object.entries(state?.widgets??{}).filter(([key])=>!key.startsWith("remote-")&&key!=="rpc-subagents"&&!/goal|todo/i.test(key)).map(([key,lines])=><details className="extension-widget" key={key}><summary>{key}</summary><pre>{lines.join("\n")}</pre></details>)}
    {!!state?.notices?.length&&<section className="overview-section"><h3>Ostatnie komunikaty</h3>{state.notices.slice(-5).map(notice=><p className={`extension-notice ${notice.kind}`} key={notice.id}>{notice.message}</p>)}</section>}
    </>}</section>;
}

function ExtensionsPanel({ sessionId, state, localAdmin, onCommand, onError }: { sessionId?: string; state?: ExtensionUiState; localAdmin: boolean; onCommand(message: string): void; onError(message: string): void }) {
  const [items, setItems] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>();
  const [json, setJson] = useState("");
  useEffect(() => { controlApi.extensions().then(setItems).catch(error => onError(String(error))); }, []);
  const config = (name: string) => controlApi.extensionConfig(name).then(value => { setEditing(value); setJson(JSON.stringify(value.config, null, 2)); }).catch(error => onError(String(error)));
  const save = async () => {
    try { const value = await controlApi.saveExtensionConfig(editing.name, JSON.parse(json)); setEditing(value); setJson(JSON.stringify(value.config, null, 2)); }
    catch (error) { onError(String(error)); }
  };
  return <section className="cockpit-body extension-panel">
    <h2 className="context-title">Dodatki</h2>
    <h4>ACP / cache</h4><div className="extension-actions">{["acp", "acp-cache", "acp-rule"].map(command => <button key={command} disabled={!sessionId} onClick={() => onCommand("/" + command)}>{command}</button>)}</div>
    <h4>Zainstalowane</h4>{items.map(item => <button className="extension-package" key={item.source} onClick={() => void config(item.name)}><b>{item.name}</b><span>{item.version}</span><small>{item.description}</small></button>)}
    {editing && <div className="config-editor"><b>{editing.name}</b><p>{editing.editable ? "Zmiany obowiązują po ponownym otwarciu sesji." : "To rozszerzenie zarządza konfiguracją przez własne komendy Pi."}</p><textarea value={json} readOnly={!editing.editable || !localAdmin} onChange={event => setJson(event.target.value)} />{editing.editable && localAdmin && <button onClick={() => void save()}>Zapisz konfigurację</button>}<details><summary>Domyślne opcje</summary><pre>{JSON.stringify(editing.defaults, null, 2)}</pre></details></div>}
  </section>;
}

function PluginsPanel({ activeView,writable, onError }: { activeView?:string;writable: boolean; onError(message: string): void }) {
  const [catalog,setCatalog]=useState<Awaited<ReturnType<typeof controlApi.pluginCatalog>>>([]);
  const [grants,setGrants]=useState<any>();
  const [items, setItems] = useState<PluginManifest[]>([]);
  const [source, setSource] = useState("");
  const [review, setReview] = useState<Awaited<ReturnType<typeof controlApi.previewPlugin>>>();
  const [selected, setSelected] = useState<PluginManifest>();
  const [config, setConfig] = useState("");
  const refresh = () => controlApi.plugins().then(setItems).catch(error => onError(String(error)));
  useEffect(() => { void refresh(); }, []);
  useEffect(()=>{const item=items.find(value=>value.id===activeView?.replace(/^plugin:/,""));if(item){setConfig("");setSelected(item);}},[activeView,items]);
  useEffect(()=>{const open=(event:Event)=>{const id=String((event as CustomEvent).detail).replace(/^plugin:/,"");const item=items.find(value=>value.id===id);if(item){setConfig("");setSelected(item);}};window.addEventListener("pi-plugin-view",open);return()=>window.removeEventListener("pi-plugin-view",open);},[items]);
  return <section className="cockpit-body plugins-panel">
    <h2 className="context-title">Pluginy</h2>
    <section className="plugin-section"><h3>Zainstalowane <small>{items.length}</small></h3>{!items.length&&<p className="notification-help">Nie ma zainstalowanych pluginów.</p>}
    {items.map(item => <div className="plugin-row" key={item.id}><b>{item.name}</b><span>{item.version}</span><small>{item.permissions.join(", ") || "bez uprawnień"}</small>{writable && <div className="panel-actions">{item.client && <button onClick={() => { setConfig(""); setSelected(item); }}>Otwórz</button>}<button onClick={() => controlApi.pluginConfig(item.id).then(value => { setSelected(item); setConfig(JSON.stringify(value, null, 2)); }).catch(error => onError(String(error)))}>Ustawienia</button><button onClick={() => controlApi.rollbackPlugin(item.id).then(refresh).catch(error => onError(String(error)))}>Rollback</button></div>}</div>)}
    </section>
    <section className="plugin-section"><h3>Dostęp i katalog</h3>
    {writable&&<details><summary onClick={()=>controlApi.pluginGrants().then(setGrants).catch(error=>onError(String(error)))}>Zgody i dostęp</summary>{grants&&<><p className="notification-help">{grants.pending?.length??0} oczekujących próśb · {(grants.paths?.length??0)+(grants.permissions?.length??0)} zapisanych zgód</p>{grants.paths?.map((grant:any)=><div className="plugin-row" key={grant.pluginId}><b>{grant.pluginId}</b><small>Dostęp do plików</small><button className="ghost" onClick={()=>controlApi.revokePluginGrant(grant.pluginId,"path").then(()=>controlApi.pluginGrants()).then(setGrants).catch(error=>onError(String(error)))}>Cofnij dostęp</button></div>)}{grants.permissions?.map((grant:any,index:number)=><div className="plugin-row" key={index}><b>{grant.pluginId}</b><small>{grant.family}</small><button className="ghost" onClick={()=>controlApi.revokePluginGrant(grant.pluginId,grant.family).then(()=>controlApi.pluginGrants()).then(setGrants).catch(error=>onError(String(error)))}>Cofnij zgodę</button></div>)}</>}</details>}
    {writable&&items.filter((item:any)=>item.wantsDom).map((item:any)=><div className="plugin-row" key={`dom:${item.id}`}><b>{item.name} · pełny DOM</b><p>Dostęp do całego interfejsu i danych strony. Włączaj tylko dla zaufanego źródła.</p><button onClick={()=>{if(item.domGranted||confirm(`Zezwolić pluginowi ${item.name} na pełny dostęp do DOM?`))void controlApi.domConsent(item.id,!item.domGranted).then(refresh).catch(error=>onError(String(error)));}}>{item.domGranted?"Cofnij DOM":"Zezwól na DOM"}</button></div>)}
    <details><summary onClick={()=>{if(!catalog.length)void controlApi.pluginCatalog().then(setCatalog).catch(error=>onError(String(error)));}}>Katalog · pi-web-ui 0.97.0</summary><p>Katalog nie instaluje nic automatycznie. Pobierz i sprawdź źródło lokalnie. SDK 0.97.0 obejmuje LLM, sieć/proxy, harmonogramy i zgody DOM. Pluginy serwerowe są zaufanym kodem lokalnym.</p>{catalog.map(item=><div className="plugin-row" key={item.id}><a href={item.homepage} target="_blank" rel="noreferrer">{item.name}</a><small>{item.description}</small><code>{item.source}</code></div>)}</details>
    </section>
    {writable ? <section className="plugin-section plugin-install"><h3>Dodaj z dysku</h3><p className="notification-help">Najpierw sprawdź manifest i wymagane uprawnienia.</p><label>Folder pluginu<input aria-label="Folder pluginu" placeholder="/lokalna/ścieżka/pluginu" value={source} onChange={event => { setSource(event.target.value); setReview(undefined); }} /></label><button className="ghost" disabled={!source.trim()} onClick={() => controlApi.previewPlugin(source).then(setReview).catch(error => onError(String(error)))}>Sprawdź manifest</button>{review && <><p>Źródło: {review.source}</p><pre>{JSON.stringify(review.manifest, null, 2)}</pre><p>Plugin serwerowy działa jako zaufany kod na tym Macu.</p><button onClick={() => controlApi.installPlugin(review.source, review.digest).then(() => { setSource(""); setReview(undefined); return refresh(); }).catch(error => onError(String(error)))}>Zainstaluj z tymi uprawnieniami</button></>}</section> : <p>Pluginy są zarządzane lokalnie na Macu.</p>}
    {selected && writable && <><h4>{selected.name}</h4>{config ? <><textarea aria-label="Konfiguracja pluginu" value={config} onChange={event => setConfig(event.target.value)} /><button onClick={() => { try { controlApi.savePluginConfig(selected.id, JSON.parse(config)).catch(error => onError(String(error))); } catch (error) { onError(String(error)); } }}>Zapisz</button></> : selected.client && <PluginView manifest={selected} onError={onError} />}</>}
  </section>;
}

function PluginView({ manifest, onError }: { manifest: PluginManifest; onError(message: string): void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false; let cleanup: any;
    const listeners = new Set<(payload: unknown) => void>();
    const receive = (event: Event) => { const data = (event as CustomEvent).detail; if (data.pluginId === manifest.id) for (const listener of listeners) listener(data.payload); };
    window.addEventListener("pi-plugin-data", receive);
    pluginModule(manifest).then(module => {
      if (!disposed && host.current && typeof module.mount==="function") cleanup = module.mount(host.current, {
        send: (payload: unknown) => controlApi.pluginMessage(manifest.id, payload).catch(error => onError(String(error))),
        onData: (listener: (payload: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      });
    }).catch(error => onError(String(error)));
    return () => { disposed = true; window.removeEventListener("pi-plugin-data", receive); if (typeof cleanup === "function") cleanup(); };
  }, [manifest.id, manifest.version, (manifest as any).epoch]);
  return <div className="plugin-view" ref={host} />;
}

export function TerminalDock({ workspace, enabled, onError }: { workspace: string; enabled: boolean; onError(message: string): void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TerminalSession[]>([]);
  const [active, setActive] = useState<string>();
  useEffect(() => { if (enabled) controlApi.terminals().then(value => { setItems(value); setActive(value[0]?.id); }).catch(error => onError(String(error))); }, [enabled]);
  if (!enabled) return null;
  const close = async (id: string) => {
    try { await controlApi.closeTerminal(id); const remaining = items.filter(item => item.id !== id); setItems(remaining); if (active === id) setActive(remaining[0]?.id); if(!remaining.length)setOpen(false); }
    catch (error) { onError(String(error)); }
  };
  const rename = async (item: TerminalSession) => {
    const title = prompt("Nazwa terminala", item.title); if (!title) return;
    try { const next = await controlApi.renameTerminal(item.id, title); setItems(value => value.map(row => row.id === item.id ? next : row)); }
    catch (error) { onError(String(error)); }
  };
  return <section className={"terminal-dock " + (open && active ? "open" : "")}><header><button aria-expanded={open} onClick={() => setOpen(value => !value)}>Terminal · {items.length}</button>
    {open && items.length>0 && <nav aria-label="Karty terminala">{items.map(item => <span className="terminal-tab" key={item.id}><button className={active === item.id ? "active" : ""} onDoubleClick={() => void rename(item)} onClick={() => setActive(item.id)}>{item.title}{item.status === "exited" ? " [" + item.exitCode + "]" : ""}</button><button aria-label={"Zamknij terminal " + item.title} onClick={() => void close(item.id)}>×</button></span>)}</nav>}
    <button aria-label="Nowy terminal" onClick={() => controlApi.createTerminal(workspace).then(item => { setItems(value => [...value, item]); setActive(item.id); setOpen(true); }).catch(error => onError(String(error)))}>＋</button></header>
    {open && active && <TerminalView id={active} onExit={code => setItems(value => value.map(item => item.id === active ? { ...item, status: "exited", exitCode: code } : item))} onError={onError} />}
  </section>;
}

function TerminalView({ id, onExit, onError }: { id: string; onExit(code: number): void; onError(message: string): void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const terminal = new Terminal({ fontSize: 12, scrollback: 8000, fontFamily: "SFMono-Regular, Menlo, monospace", theme: { background: "#08090d", foreground: "#d7d9df", cursor: "#a695ff" } });
    const theme=()=>{const css=getComputedStyle(document.documentElement),get=(name:string,fallback:string)=>css.getPropertyValue(name).trim()||fallback;terminal.options.theme={background:get("--term-bg",get("--bg","#08090d")),foreground:get("--term-fg",get("--text","#d7d9df")),cursor:get("--term-cursor",get("--purple","#a695ff"))};};theme();window.addEventListener("pi-theme-changed",theme);
    const fit = new FitAddon(); terminal.loadAddon(fit); terminal.open(host.current);
    let socket: WebSocket; let timer: ReturnType<typeof setTimeout>; let stopped = false;
    const resize = () => { fit.fit(); if (socket?.readyState === 1) socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows })); };
    const connect = () => {
      socket = authenticatedSocket("/terminals/" + id + "/socket");
      socket.onopen = resize;
      socket.onmessage = event => {
        const packet = JSON.parse(event.data);
        if (packet.type === "snapshot") { terminal.reset(); terminal.write(packet.data ?? ""); if (packet.terminal?.status === "exited") onExit(packet.terminal.exitCode); }
        if (packet.type === "data") terminal.write(packet.data ?? "");
        if (packet.type === "exit") { terminal.writeln("\r\n[process exited " + packet.exitCode + "]"); onExit(packet.exitCode); }
      };
      socket.onerror = () => onError("Połączenie terminala zostało przerwane");
      socket.onclose = () => { if (!stopped) timer = setTimeout(connect, 1500); };
    };
    connect();
    const input = terminal.onData(data => { if (socket.readyState === 1) socket.send(JSON.stringify({ type: "input", data })); });
    const observer = new ResizeObserver(resize); observer.observe(host.current);
    return () => { stopped = true; clearTimeout(timer);window.removeEventListener("pi-theme-changed",theme); observer.disconnect(); input.dispose(); socket.close(); terminal.dispose(); };
  }, [id]);
  return <div className="xterm-host" ref={host} />;
}

function formatBytes(size: number) { return size < 1024 ? size + " B" : size < 1024 * 1024 ? (size / 1024).toFixed(1) + " KB" : (size / 1024 / 1024).toFixed(1) + " MB"; }
