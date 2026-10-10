import { existsSync, openSync, fstatSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";

export interface ServiceLog {
  name: string;
  text: string;
  lineCount: number;
  uniqueLineCount: number;
}

const LOGS: Array<[string, string]> = [
  ["session-launch.log", "Start sesji Pi"],
  ["session-runtime.log", "Błędy i ponawianie tur Pi"],
  ["control.stderr.log", "Control Service · stderr"],
  ["control.stdout.log", "Control Service · stdout"],
];

export function redactLog(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/(api[_-]?key|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1$2[redacted]");
}

export function collapseRepeatedLines(lines: string[]): string[] {
  const groups: Array<{line:string;count:number}> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const last=groups.at(-1);
    if(last?.line===line) last.count++;
    else groups.push({line,count:1});
  }
  return groups.map(({line,count}) => {
    return count > 1 ? `[×${count}] ${line}` : line;
  });
}

export function readServiceLogs(runtimeDir: string, maxLines = 160): ServiceLog[] {
  return LOGS.map(([file, name]) => {
    const path = join(runtimeDir, file);
    if (!existsSync(path)) return { name, text: "Brak wpisów.", lineCount: 0, uniqueLineCount: 0 };
    const fd = openSync(path, "r");
    let tail: string;
    try {
      const size = fstatSync(fd).size;
      const offset = Math.max(0, size - 1024 * 1024);
      const buffer = Buffer.alloc(size - offset);
      const bytes = readSync(fd, buffer, 0, buffer.length, offset);
      tail = buffer.subarray(0, bytes).toString("utf8");
      if (offset) tail = tail.slice(tail.indexOf("\n") + 1);
    } finally { closeSync(fd); }
    const lines = tail.split(/\r?\n/).filter((line) => line.trim()).slice(-maxLines);
    const compact = collapseRepeatedLines(lines);
    const text = redactLog(compact.join("\n")).slice(-20_000).trim();
    return { name, text: text || "Brak wpisów.", lineCount: lines.length, uniqueLineCount: compact.length };
  });
}
