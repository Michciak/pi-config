import { Markdown } from './Markdown.js';

export function MessageContent({message, workspace,undoPath,onUndo}: {message: any; workspace: string;undoPath?:string;onUndo?(path:string):void}) {
  const parts = typeof message.content === 'string' ? [{type:'text', text:message.content}] : message.content ?? [];
  if (message.role === 'toolResult') return <details className={`tool-output ${message.isError ? 'failed' : ''}`}>
    <summary><strong>{message.toolName ?? 'Narzędzie'}</strong> · {message.isError ? 'Błąd' : 'Wynik'}</summary>
    {message.details?.diff ? <><div className="message-meta">{message.details.path??undoPath} · {message.details.classification}{message.details.snapshotId && ` · undo snapshot ${message.details.snapshotId}`}{undoPath&&onUndo&&message.toolName!=="undo_last_edit"&&<button title="Przygotuje polecenie undo_last_edit. Wyślij je, aby Pi wykonało cofnięcie (wywołanie modelu)." onClick={()=>onUndo(undoPath)}>Cofnij przez Pi</button>}</div><pre className="edit-diff">{String(message.details.diff).split('\n').map((line:string,index:number)=><span className={line.startsWith('+')?'diff-added':line.startsWith('-')?'diff-removed':''} key={index}>{line}{'\n'}</span>)}</pre></> : <pre>{parts.map((p:any) => p.text ?? '[Załącznik]').join('\n')}</pre>}
  </details>;
  const thoughts = parts.filter((p:any) => p.type === 'thinking').map((p:any) => p.thinking ?? p.text ?? '').join('\n\n');
  return <>
    {thoughts && <details className="reasoning"><summary>Myślenie</summary><Markdown workspace={workspace}>{thoughts}</Markdown></details>}
    {parts.filter((p:any) => p.type !== 'thinking').map((p:any, i:number) => p.type === 'toolCall'
      ? <details className="tool-output" key={i}><summary>Wywołanie · <strong>{p.name}</strong></summary><pre>{JSON.stringify(p.arguments ?? p.args, null, 2)}</pre></details>
      : p.type === 'text' ? <Markdown key={i} workspace={workspace}>{p.text}</Markdown>
      : <p key={i}>Załącznik: {p.type}</p>)}
  </>;
}
