import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import * as pty from "node-pty";
import type { TerminalSession } from "@pi-local/protocol";
import { preparePtyHelper } from "./pty-helper.js";

interface ManagedTerminal {
  summary: TerminalSession;
  process: pty.IPty;
  listeners: Set<(packet: unknown) => void>;
  scrollback: string[];
  bytes: number;
}

function size(value: number, fallback: number, max: number): number {
  return Number.isFinite(value) ? Math.max(2, Math.min(max, Math.floor(value))) : fallback;
}

export class TerminalManager {
  private readonly terminals = new Map<string, ManagedTerminal>();

  list(): TerminalSession[] { return [...this.terminals.values()].map((item) => item.summary); }
  processIds(): number[] { return [...this.terminals.values()].filter(item=>item.summary.status==="running").map(item=>item.process.pid); }

  create(cwd: string, title?: string, cols = 100, rows = 30): TerminalSession {
    preparePtyHelper();
    cols = size(cols, 100, 500); rows = size(rows, 30, 200);
    const path = realpathSync(cwd);
    if (!statSync(path).isDirectory()) throw Object.assign(new Error("Terminal cwd must be a directory"), { statusCode: 400 });
    if (this.terminals.size >= 16) throw Object.assign(new Error("Terminal limit reached"), { statusCode: 409 });
    const id = randomUUID();
    const shell = process.env.SHELL || "/bin/zsh";
    const proc = pty.spawn(shell, ["-l"], { cwd: path, cols: Math.max(20, cols), rows: Math.max(5, rows), name: "xterm-256color", env: { ...process.env, TERM: "xterm-256color" } as Record<string, string> });
    const summary: TerminalSession = { id, title: title?.trim() || basename(path) || "Terminal", cwd: path, cols, rows, status: "running" };
    const managed: ManagedTerminal = { summary, process: proc, listeners: new Set(), scrollback: [], bytes: 0 };
    proc.onData((data) => {
      managed.scrollback.push(data);
      managed.bytes += Buffer.byteLength(data);
      while (managed.bytes > 2 * 1024 * 1024 && managed.scrollback.length > 1) managed.bytes -= Buffer.byteLength(managed.scrollback.shift()!);
      for (const listener of managed.listeners) listener({ type: "data", data });
    });
    proc.onExit(({ exitCode }) => {
      summary.status = "exited"; summary.exitCode = exitCode;
      for (const listener of managed.listeners) listener({ type: "exit", exitCode });
    });
    this.terminals.set(id, managed);
    return summary;
  }

  attach(id: string, listener: (packet: unknown) => void): () => void {
    const item = this.terminals.get(id);
    if (!item) throw Object.assign(new Error("Terminal not found"), { statusCode: 404 });
    listener({ type: "snapshot", terminal: item.summary, data: item.scrollback.join("") });
    item.listeners.add(listener);
    return () => item.listeners.delete(listener);
  }

  input(id: string, data: string): void { this.require(id).process.write(data); }
  resize(id: string, cols: number, rows: number): void {
    cols = size(cols, 100, 500); rows = size(rows, 30, 200);
    const item = this.require(id); item.process.resize(cols, rows);
    item.summary.cols = cols; item.summary.rows = rows;
  }
  rename(id: string, title: string): TerminalSession { const item = this.require(id); item.summary.title = title.trim() || item.summary.title; return item.summary; }
  close(id: string): void { const item = this.require(id); try { if (item.summary.status === "running") item.process.kill("SIGKILL"); } finally { this.terminals.delete(id); } }
  closeAll(): void { for (const id of [...this.terminals.keys()]) this.close(id); }

  private require(id: string): ManagedTerminal {
    const item = this.terminals.get(id);
    if (!item) throw Object.assign(new Error("Terminal not found"), { statusCode: 404 });
    return item;
  }
}
