import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface PromptSnippet {
  id: string;
  name: string;
  description: string;
  placement: "prepend" | "append";
  order: number;
  body: string;
}

export function parseSnippet(filename: string, raw: string): PromptSnippet | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1]!.toLowerCase()] = kv[2]!.trim().replace(/^["']|["']$/g, "");
  }
  const body = match[2]!.trim();
  if (!body) return null;
  const parsedOrder = Number.parseInt(meta.order ?? "", 10);
  return {
    id: filename,
    name: meta.name || filename.replace(/\.md$/i, ""),
    description: meta.description ?? "",
    placement: meta.placement === "prepend" ? "prepend" : "append",
    order: Number.isFinite(parsedOrder) ? parsedOrder : 9999,
    body,
  };
}

export function loadSnippets(directory: string): PromptSnippet[] {
  if (!existsSync(directory)) return [];
  const snippets: PromptSnippet[] = [];
  for (const file of readdirSync(directory)) {
    if (!file.toLowerCase().endsWith(".md")) continue;
    try {
      const snippet = parseSnippet(file, readFileSync(join(directory, file), "utf8"));
      if (snippet) snippets.push(snippet);
    } catch {}
  }
  const byOrder = (left: PromptSnippet, right: PromptSnippet) => left.order - right.order || left.name.localeCompare(right.name);
  return [
    ...snippets.filter((item) => item.placement === "prepend").sort(byOrder),
    ...snippets.filter((item) => item.placement === "append").sort(byOrder),
  ];
}

export function applySnippets(message: string, snippets: PromptSnippet[], enabledIds: Iterable<string>): string {
  const enabled = new Set(enabledIds);
  const active = snippets.filter((item) => enabled.has(item.id));
  const prepends = active.filter((item) => item.placement === "prepend").map((item) => item.body);
  const appends = active.filter((item) => item.placement === "append").map((item) => item.body);
  return [...prepends, message, ...appends].join("\n\n");
}
