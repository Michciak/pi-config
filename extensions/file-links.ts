import { statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resetCapabilitiesCache } from "@earendil-works/pi-tui";

function localFile(reference: string, cwd: string): string | undefined {
  try {
    const value = reference.replace(/:\d+(?::\d+)?$/, "");
    if (/^[a-z][\w+.-]*:/i.test(value) && !value.startsWith("file://")) return;
    const path = value.startsWith("file://") ? fileURLToPath(value)
      : resolve(cwd, value.startsWith("~/") ? homedir() + value.slice(1) : value);
    return statSync(path).isFile() ? pathToFileURL(path).href : undefined;
  } catch { return; }
}

/** Display-only transformation: never changes saved messages or executable code. */
export function linkFiles(markdown: string, cwd: string): string {
  let fence: { marker: string; length: number } | undefined;
  // Protect existing links, inline code and URLs before considering bare paths.
  const tokens = /!?\[[^\]\n]*\]\((?:<[^>\n]*>|[^)\n]*)\)|`+[^`\n]*`+|[a-zA-Z][\w+.-]*:\/\/[^\s<>]+|(?<![\w/])(?:[~./\p{L}\p{N}_@+-]+\/)*[\p{L}\p{N}_@+-]+\.[\p{L}\p{N}_.+-]+(?::\d+(?::\d+)?)?/gu;
  return markdown.split("\n").map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = undefined;
      return line;
    }
    if (marker) { fence = { marker: marker[1][0], length: marker[1].length }; return line; }
    if (/^( {4}|\t)/.test(line)) return line;
    return line.replace(tokens, token => {
      if (token.startsWith("![")) return token;
      if (token.startsWith("[")) {
        const link = /^(\[[^\]\n]*\])\((?:<([^>]+)>|([^\s)]+))\)$/.exec(token);
        if (!link) return token;
        let target = link[2] ?? link[3];
        if (!target.startsWith("file://")) {
          try { target = decodeURIComponent(target); } catch { return token; }
        }
        const url = localFile(target, cwd);
        return url ? `${link[1]}(<${url}>)` : token;
      }
      if (/^[a-zA-Z][\w+.-]*:\/\//.test(token)) return token;
      const code = token.startsWith("`");
      const reference = code ? token.replace(/^`+|`+$/g, "") : token.replace(/[.,;]+$/, "");
      const url = localFile(reference, cwd);
      if (!url) return token;
      const label = code ? token : reference.replace(/[\\[\]]/g, "\\$&");
      return `[${label}](<${url}>)` + (code ? "" : token.slice(reference.length));
    });
  }).join("\n");
}

export default function fileLinks(pi: ExtensionAPI) {
  let cwd = process.cwd();
  pi.on("session_start", (_event, ctx) => { cwd = ctx.cwd; resetCapabilitiesCache(); });
  pi.on("before_agent_start", (event, ctx) => {
    cwd = ctx.cwd;
    return { systemPrompt: event.systemPrompt + "\nWhen mentioning a local file in prose, use a Markdown link with its complete absolute path as the destination and a readable filename as the label. Use an unambiguous existing project-relative path when the absolute path is unknown. Do not invent paths or insert Markdown links into code examples." };
  });
  pi.registerMarkdownTransformer((text, context) => context.messageType === "assistant" ? linkFiles(text, cwd) : text);
}
