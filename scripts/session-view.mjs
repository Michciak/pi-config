#!/usr/bin/env node
/**
 * session-view.mjs — czytelny, kolorowany podgląd transkryptu sesji Pi.
 *
 * Użycie w oknie obserwatora subagenta (zamiast surowego `tail -F` JSONL):
 *   node scripts/session-view.mjs <sessionFile>
 *
 * Zachowanie jak tail -F: czeka na plik, czyta od początku, dopisuje na
 * żywo, resetuje przy skróceniu pliku. Ctrl-C / SIGTERM kończy (exit 0).
 *
 * Format (kolory ANSI, szanuje NO_COLOR):
 *   ▶ user ............ zielony, tekst
 *   ● assistant ....... domyślny, tekst
 *   … thinking ........ przygaszony, 1 linia (PI_MONITOR_THINKING=1 → 5)
 *   ⚙ tool(args) ...... żółty
 *   ↳ wynik ........... przygaszony, podgląd
 *   ◆ model ........... cyjan (zmiana modelu)
 *   ▽ compaction ...... przygaszony, 1 linia
 *   ⬢ customType ...... magenta
 *   ✖ błąd ............ czerwony
 */
import fs from "node:fs";

const NO_COLOR = Boolean(process.env.NO_COLOR) || process.argv.includes("--no-color");
const SHOW_THINKING_LINES = process.env.PI_MONITOR_THINKING === "1" ? 5 : 1;
const MAX_LINES_PER_RECORD = 12;

const C = NO_COLOR
  ? { reset: "", green: "", blue: "", yellow: "", dim: "", cyan: "", magenta: "", red: "", bold: "" }
  : {
    reset: "\x1b[0m", green: "\x1b[32m", blue: "\x1b[34m", yellow: "\x1b[33m",
    dim: "\x1b[2m", cyan: "\x1b[36m", magenta: "\x1b[35m", red: "\x1b[31m", bold: "\x1b[1m",
  };

const file = process.argv[2];
if (!file) {
  console.error("usage: session-view.mjs <sessionFile>");
  process.exit(2);
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((p) => p && p.type === "text").map((p) => String(p.text ?? "")).join("\n");
  }
  return "";
}

function summarizeArgs(toolName, args) {
  if (!args || typeof args !== "object") return "";
  const picks = ["path", "message", "task", "agent", "name", "command", "pattern", "url", "file"];
  for (const k of picks) {
    if (typeof args[k] === "string" && args[k].trim()) {
      const v = args[k].replace(/\s+/g, " ").trim();
      return v.length > 100 ? v.slice(0, 100) + "…" : v;
    }
  }
  try {
    const s = JSON.stringify(args).replace(/\s+/g, " ");
    return s.length > 100 ? s.slice(0, 100) + "…" : s;
  } catch { return ""; }
}

function emit(lines) {
  for (const line of lines) process.stdout.write(line + "\n");
}

function render(entry) {
  if (!entry || typeof entry !== "object") return;
  if (entry.type === "message") {
    const msg = entry.message ?? {};
    const role = msg.role;
    if (role === "system") return; // boilerplate system prompt — za długi, bez wartości
    if (role === "user") {
      const text = textOf(msg.content).trim();
      if (!text) return;
      emit([`${C.green}▶ ${C.reset}${clip(text)}`]);
      return;
    }
    if (role === "assistant") {
      const parts = Array.isArray(msg.content) ? msg.content : [];
      for (const part of parts) {
        if (part.type === "thinking") {
          const lines = String(part.thinking ?? "").trim().split("\n").filter(Boolean);
          if (!lines.length) continue;
          const shown = lines.slice(0, SHOW_THINKING_LINES);
          emit([`${C.dim}… ${shown.join(" / ").slice(0, 300)}${lines.length > shown.length ? ` (+${lines.length - shown.length})` : ""}${C.reset}`]);
        } else if (part.type === "text") {
          const text = String(part.text ?? "").trim();
          if (text) emit([`${C.blue}●${C.reset} ${clip(text)}`]);
        } else if (part.type === "toolCall" || part.name) {
          const name = part.name ?? part.type;
          const preview = summarizeArgs(name, part.arguments ?? part.input ?? part.params);
          emit([`${C.yellow}⚙ ${name}${preview ? `(${preview})` : ""}${C.reset}`]);
        }
      }
      return;
    }
    if (role === "toolResult") {
      const text = textOf(msg.content).trim().replace(/\s+/g, " ");
      const name = msg.toolName ? ` ${msg.toolName}` : "";
      emit([`${C.dim}  ↳${name}: ${text.slice(0, 300)}${text.length > 300 ? " …" : ""}${C.reset}`]);
      return;
    }
    return;
  }
  if (entry.type === "model_change") {
    emit([`${C.cyan}◆ ${entry.provider ?? ""}/${entry.modelId ?? entry.model ?? "?"}${C.reset}`]);
    return;
  }
  if (entry.type === "compaction") {
    const first = String(entry.summary ?? "").split("\n")[0] ?? "";
    emit([`${C.dim}▽ compaction: ${first.slice(0, 160)}${C.reset}`]);
    return;
  }
  if (entry.customType) {
    const text = typeof entry.content === "string" ? entry.content : textOf(entry.content);
    emit([`${C.magenta}⬢ ${entry.customType}: ${text.replace(/\s+/g, " ").slice(0, 200)}${C.reset}`]);
    return;
  }
  if (entry.type === "error" || entry.error) {
    emit([`${C.red}✖ ${String(entry.error ?? entry.message ?? "error").slice(0, 200)}${C.reset}`]);
  }
}

function clip(text) {
  const lines = text.split("\n");
  if (lines.length <= MAX_LINES_PER_RECORD) return text;
  return lines.slice(0, MAX_LINES_PER_RECORD).join("\n") + `\n${C.dim}… (+${lines.length - MAX_LINES_PER_RECORD} lines)${C.reset}`;
}

let offset = 0;
function poll() {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    setTimeout(poll, 1000); // ref'd celowo: utrzymuje proces przy życiu
    return;
  }
  if (stat.size < offset) offset = 0; // rotacja/skrócenie
  if (stat.size > offset) {
    const fd = fs.openSync(file, "r");
    try {
      const len = stat.size - offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      let text = buf.toString("utf8");
      // Niekompletny ostatni wiersz zostaje na następny poll.
      const endsComplete = text.endsWith("\n");
      const lines = text.split("\n");
      const rest = endsComplete ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (!line.trim()) continue;
        try { render(JSON.parse(line)); } catch { /* zniekształcony wpis — pomijamy */ }
      }
      offset = stat.size - Buffer.byteLength(rest);
    } finally {
      fs.closeSync(fd);
    }
  }
  setTimeout(poll, 1000); // ref'd celowo: utrzymuje proces przy życiu
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
console.log(`${C.dim}— session view: ${file}${C.reset}`);
poll();
