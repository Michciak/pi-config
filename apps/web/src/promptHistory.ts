export function promptHistory(messages: any[], sent: string[]): string[] {
  return [...messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : (m.content ?? []).filter((p:any) => p.type === 'text').map((p:any) => p.text).join('\n')), ...sent]
    .filter(Boolean).filter((item, i, all) => all.lastIndexOf(item) === i).reverse();
}
export function historyStep(key: string, position: number, count: number, value: string, start: number, end: number): number | null {
  if (start !== end) return null;
  if (key === 'ArrowUp' && position < count - 1 && (position >= 0 || !value.slice(0,start).includes('\n'))) return position + 1;
  if (key === 'ArrowDown' && position >= 0) return position - 1;
  return null;
}
