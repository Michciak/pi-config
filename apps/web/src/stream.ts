export interface LiveBlock {
  type: "text" | "thinking" | "toolcall";
  content: string;
  toolName?: string;
}

export type LiveBlocks = Record<number, LiveBlock>;

export function reduceLiveBlocks(current: LiveBlocks, raw: any): LiveBlocks {
  const index = Number(raw?.contentIndex);
  if (!Number.isInteger(index) || index < 0) return current;
  const next = { ...current };
  if (raw.type === "text_start") next[index] = { type: "text", content: "" };
  else if (raw.type === "thinking_start") next[index] = { type: "thinking", content: "" };
  else if (raw.type === "toolcall_start") next[index] = { type: "toolcall", content: "", toolName: raw.toolName };
  else if (raw.type === "text_delta" || raw.type === "thinking_delta" || raw.type === "toolcall_delta") {
    const fallbackType = raw.type.startsWith("thinking") ? "thinking" : raw.type.startsWith("toolcall") ? "toolcall" : "text";
    const previous = next[index] ?? { type: fallbackType, content: "" };
    next[index] = { ...previous, content: previous.content + String(raw.delta ?? "") };
  } else if (raw.type === "text_end" || raw.type === "thinking_end") {
    const type = raw.type.startsWith("thinking") ? "thinking" : "text";
    next[index] = { type, content: String(raw.content ?? next[index]?.content ?? "") };
  } else if (raw.type === "toolcall_end") {
    const toolCall = raw.toolCall ?? {};
    next[index] = {
      type: "toolcall",
      toolName: toolCall.name ?? toolCall.toolName ?? next[index]?.toolName,
      content: JSON.stringify(toolCall.arguments ?? toolCall.args ?? toolCall, null, 2),
    };
  }
  return next;
}

export function toolEventText(payload: any): string {
  const value = payload?.partialResult ?? payload?.result ?? payload?.args;
  if (value === undefined) return "";
  if (Array.isArray(value?.content)) {
    return value.content.map((part: any) => part?.text ?? JSON.stringify(part)).join("\n");
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
