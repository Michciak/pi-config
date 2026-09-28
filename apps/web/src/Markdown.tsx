import ReactMarkdown from "react-markdown";
import { controlApi } from "./api.js";

function filePath(href: string): string | null {
  try {
    if (href.startsWith("file://")) return decodeURIComponent(new URL(href).pathname);
    if (href.startsWith("/Users/")) return decodeURIComponent(href);
  } catch {}
  return null;
}

function linkAbsolutePaths(markdown: string): string {
  let fence: string | undefined;
  return markdown.split("\n").map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker?.startsWith(fence[0]!) && marker.length >= fence.length) fence = undefined;
      return line;
    }
    if (marker) { fence = marker; return line; }
    if (/^\s{4}/.test(line)) return line;
    return line.replace(/(?<![\w(<])\/Users\/[\w@+., ()\-/]+\.[\w+.-]+(?::\d+(?::\d+)?)?/g, (reference) => {
      const path = reference.replace(/:\d+(?::\d+)?$/, "");
      return `[${reference.replace(/[\[\]]/g, "\\$&")}](<${encodeURI(`file://${path}`)}>)`;
    });
  }).join("\n");
}

export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown components={{
    a({ href = "", children: label }) {
      const path = filePath(href);
      if (path) return <button className="file-link" title={path} onClick={() => void controlApi.openRider(path)}>{label}</button>;
      return <a href={href} target="_blank" rel="noreferrer">{label}</a>;
    },
  }}>{linkAbsolutePaths(children)}</ReactMarkdown>;
}

export function messageText(message: any): string {
  if (typeof message?.content === "string") return message.content;
  if (!Array.isArray(message?.content)) return JSON.stringify(message, null, 2);
  return message.content.map((part: any) => {
    if (part?.type === "text" || part?.type === "thinking") return part.text ?? part.thinking ?? "";
    if (part?.type === "toolCall") return `\n\n**Tool: ${part.name}**\n\n\`\`\`json\n${JSON.stringify(part.arguments ?? part.args, null, 2)}\n\`\`\``;
    if (part?.type === "image") return "[image]";
    return `\n\n\`\`\`json\n${JSON.stringify(part, null, 2)}\n\`\`\``;
  }).join("");
}
