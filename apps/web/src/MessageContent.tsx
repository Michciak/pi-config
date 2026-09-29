import { Markdown } from './Markdown.js';

export function MessageContent({message, workspace}: {message: any; workspace: string}) {
  const parts = typeof message.content === 'string' ? [{type:'text', text:message.content}] : message.content ?? [];
  if (message.role === 'toolResult') return <details className={`tool-output ${message.isError ? 'failed' : ''}`}>
    <summary><strong>{message.toolName ?? 'Narzędzie'}</strong> · {message.isError ? 'Błąd' : 'Wynik'}</summary>
    <pre>{parts.map((p:any) => p.text ?? '[Załącznik]').join('\n')}</pre>
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
