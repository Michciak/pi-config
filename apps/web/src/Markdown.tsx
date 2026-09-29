import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { useState } from "react";
import { controlApi } from "./api.js";
import { linkLocalReferences, localFilePath } from "./fileReferences.js";

export function Markdown({ children, workspace }: { children: string; workspace?: string }) {
  const [error, setError] = useState("");
  return <><ReactMarkdown urlTransform={url => url.startsWith("file://") ? url : defaultUrlTransform(url)} components={{
    a({ href = "", children: label }) {
      const path = localFilePath(href, workspace);
      if (path) return <button className="file-link" title={path} onClick={() => { setError(""); void controlApi.openRider(path).catch(() => setError(`Nie udało się otworzyć w Riderze: ${path}`)); }}>{label}</button>;
      return <a href={href} target="_blank" rel="noreferrer">{label}</a>;
    },
  }}>{linkLocalReferences(children, workspace)}</ReactMarkdown>{error && <p role="alert" className="file-error">{error}</p>}</>;
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
