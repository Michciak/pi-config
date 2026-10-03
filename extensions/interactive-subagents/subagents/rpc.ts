/**
 * Headless RPC subagent backend — no tmux, no terminal required.
 *
 * Spawns `pi --mode rpc` as a child process with piped JSONL stdio
 * (protocol verified live 2026-10-03 against local Qwen: spawn → prompt →
 * tools → agent_settled → final message). The parent drives the run with
 * prompt()/steer() and detects completion via `agent_settled`.
 *
 * Result extraction reuses the session-file helpers in session.ts, so the
 * summary/stats path is identical to the legacy tmux backend.
 *
 * Optional observer window (Hyprland only): `foot tail -F <sessionFile>`
 * so the user can watch the transcript live. Zero tmux involvement.
 */

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface PollResult {
  reason: "done" | "sentinel" | "error";
  exitCode: number;
  errorMessage?: string;
}

type LineListener = (rec: Record<string, unknown>) => void;

export interface RpcHandle {
  child: ChildProcess;
  sessionFile: string;
  listeners: Set<LineListener>;
  buffer: string;
  settledResult: PollResult | null;
  steerCount: number;
  monitorPid?: number;
  done: boolean;
  stderrTail: string;
}

/** RPC is the default backend. tmux panes only with PI_SUBAGENT_SURFACE=tmux. */
export function useRpcBackend(): boolean {
  return process.env.PI_SUBAGENT_SURFACE?.toLowerCase() !== "tmux";
}

/** Observer window: on under Hyprland, off elsewhere, env override both ways. */
export function wantMonitorWindow(): boolean {
  const explicit = process.env.PI_SUBAGENT_WINDOW?.toLowerCase();
  if (explicit === "0" || explicit === "false" || explicit === "no") return false;
  if (explicit === "1" || explicit === "true" || explicit === "yes") return true;
  return Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE) && Boolean(process.env.WAYLAND_DISPLAY);
}

function hasCommand(command: string): boolean {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    return true;
  } catch { return false; }
}

function findTerminal(): string | undefined {
  const preferred = process.env.PI_TERMINAL?.trim();
  if (preferred && hasCommand(preferred)) return preferred;
  for (const candidate of ["foot", "kitty", "alacritty", "wezterm"]) {
    if (hasCommand(candidate)) return candidate;
  }
  return undefined;
}

// ── Monitor window (observer only, never a control path) ──

function openMonitorWindow(name: string, sessionFile: string): number | undefined {
  if (!wantMonitorWindow()) return undefined;
  const terminal = findTerminal();
  if (!terminal) return undefined;
  const safeName = (name || "subagent").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
  // Formatted live transcript (scripts/session-view.mjs) instead of raw JSONL.
  const viewer = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "session-view.mjs");
  const viewArgs = ["node", viewer, sessionFile];
  const argv =
    terminal === "alacritty" ? [terminal, "--title", safeName, "-e", ...viewArgs]
    : terminal === "wezterm" ? [terminal, "start", "--", ...viewArgs]
    : [terminal, "--title", safeName, ...viewArgs]; // foot, kitty
  try {
    const proc = spawn(argv[0], argv.slice(1), { detached: true, stdio: "ignore", env: process.env });
    proc.unref();
    return proc.pid;
  } catch { return undefined; }
}

function closeMonitorWindow(pid: number | undefined): void {
  if (!pid) return;
  try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
}

// ── Spawn ──

export interface SpawnRpcOptions {
  argv: string[]; // raw argv, NO shell escaping: ["pi","--session",file,...]
  cwd?: string;
  env?: Record<string, string>;
  sessionFile: string;
  monitorName?: string;
}

function pumpLine(handle: RpcHandle, line: string): void {
  if (!line.trim()) return;
  let rec: Record<string, unknown>;
  try { rec = JSON.parse(line); } catch { return; }
  for (const listener of [...handle.listeners]) {
    try { listener(rec); } catch { /* listener errors must not break the pump */ }
  }
}

export function spawnRpcSubagent(options: SpawnRpcOptions): RpcHandle {
  // The shared argv builder produces an interactive-CLI command. RPC mode
  // needs adjustments (single choke point for launch + resume):
  //   --mode rpc injected (positional @file args are rejected in RPC mode;
  //   task content travels via deliverInitialPrompts instead).
  const argv = [...options.argv];
  if (!argv.includes("--mode")) argv.splice(1, 0, "--mode", "rpc");
  const filtered = [argv[0]];
  for (const arg of argv.slice(1)) {
    if (arg.startsWith("@")) continue;
    filtered.push(arg);
  }
  const child = spawn(filtered[0], filtered.slice(1), {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const handle: RpcHandle = {
    child, sessionFile: options.sessionFile, listeners: new Set(),
    buffer: "", settledResult: null, steerCount: 0, done: false, stderrTail: "",
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    handle.buffer += chunk.toString("utf8");
    const lines = handle.buffer.split("\n");
    handle.buffer = lines.pop() ?? "";
    for (const line of lines) pumpLine(handle, line);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    handle.stderrTail = (handle.stderrTail + chunk.toString("utf8")).slice(-2000);
  });
  child.on("error", (err) => {
    if (!handle.done) {
      handle.done = true;
      handle.settledResult = { reason: "error", exitCode: 1, errorMessage: `RPC child failed to spawn: ${err.message}` };
    }
  });
  child.on("exit", (code) => {
    if (!handle.done) {
      handle.done = true;
      const tail = handle.stderrTail.trim().split("\n").slice(-3).join(" | ");
      handle.settledResult = code === 0
        ? { reason: "done", exitCode: 0 }
        : { reason: "error", exitCode: code ?? 1, errorMessage: `RPC child exited code ${code}${tail ? `: ${tail}` : ""}` };
    }
  });

  if (options.monitorName) handle.monitorPid = openMonitorWindow(options.monitorName, options.sessionFile);
  // Spawn diagnostics: argv + early fate, so a stillborn child is debuggable
  // without attaching to the parent session.
  try {
    appendFileSync("/tmp/pi-rpc-spawn.log", `${new Date().toISOString()} spawn pid=${child.pid ?? "?"} argv=${JSON.stringify(filtered)}\n`);
  } catch { /* diagnostics must never break spawning */ }
  return handle;
}

// ── Prompt / steer ──

let requestSeq = 0;

function sendRecord(handle: RpcHandle, record: Record<string, unknown>): void {
  handle.child.stdin?.write(JSON.stringify(record) + "\n");
}

/**
 * Deliver initial messages preserving CLI order: the first starts the run,
 * the rest queue behind it as follow-ups (mirrors Pi CLI messages[1..]).
 * Empty separator entries (CLI positional shifting) are dropped.
 */
export async function deliverInitialPrompts(handle: RpcHandle, messages: string[]): Promise<void> {
  // RPC mode rejects @file positional arguments: inline artifact files.
  const queue = messages.map((m) => m.trim()).filter(Boolean).map((m) => {
    if (m.startsWith("@")) {
      const filePath = m.slice(1);
      try {
        if (existsSync(filePath)) return readFileSync(filePath, "utf8");
      } catch { /* fall through to raw */ }
      throw new Error(`RPC prompt references missing artifact file: ${filePath}`);
    }
    return m;
  });
  if (queue.length === 0) throw new Error("No prompt to deliver to RPC subagent");
  // Install the accept-listener BEFORE sending (fast completions).
  await sendPromptAndAccept(handle, queue[0], undefined);
  for (const message of queue.slice(1)) await sendPromptAndAccept(handle, message, "followUp");
}

function sendPromptAndAccept(handle: RpcHandle, message: string, streamingBehavior?: "steer" | "followUp"): Promise<void> {
  return new Promise((resolve, reject) => {
    requestSeq += 1;
    const id = `prompt-${Date.now().toString(36)}-${requestSeq}`;
    const done = (fn: () => void): void => {
      handle.listeners.delete(listener);
      clearInterval(exitPoll);
      fn();
    };
    const listener: LineListener = (rec) => {
      if (rec.type === "response" && rec.id === id) {
        if (rec.success) done(resolve);
        else done(() => reject(new Error(`RPC prompt rejected: ${String(rec.error ?? "unknown")}`)));
      }
    };
    // Never hang when the child dies before answering: surface the exit.
    const exitPoll = setInterval(() => {
      if (handle.settledResult) {
        const r = handle.settledResult;
        done(() => reject(new Error(
          r.reason === "error"
            ? `RPC child exited before accepting prompt: ${r.errorMessage ?? `code ${r.exitCode}`}`
            : "RPC child exited before accepting prompt",
        )));
      }
    }, 500);
    handle.listeners.add(listener);
    try {
      sendRecord(handle, { id, type: "prompt", message, ...(streamingBehavior ? { streamingBehavior } : {}) });
    } catch (err) {
      done(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

export function steerRpcSubagent(handle: RpcHandle, message: string): void {
  handle.steerCount += 1;
  requestSeq += 1;
  sendRecord(handle, { id: `steer-${Date.now().toString(36)}-${requestSeq}`, type: "steer", message });
}

// ── Wait ──

/**
 * Wait until the run settles with no pending steers, mirroring pollForExit's
 * "stay open while work arrives". A steer that lands mid-run re-arms the wait.
 */
export async function waitRpcSubagent(
  handle: RpcHandle,
  signal: AbortSignal,
  options: { sessionFile?: string; onTick?: (elapsed: number) => void },
): Promise<PollResult> {
  const start = Date.now();
  const tickTimer = setInterval(() => {
    options.onTick?.(Math.floor((Date.now() - start) / 1000));
  }, 1000);
  try {
    let waitedSteers = 0;
    for (;;) {
      if (signal.aborted) throw new Error("Aborted while waiting for RPC subagent");
      const result = await waitForSettle(handle, signal);
      if (result.reason === "error") return result;
      if (handle.steerCount !== waitedSteers) { waitedSteers = handle.steerCount; continue; }
      // .exit sidecar (subagent-done.ts error path) wins over a clean settle.
      if (options.sessionFile) {
        try {
          const exitFile = `${options.sessionFile}.exit`;
          if (existsSync(exitFile)) {
            const data = JSON.parse(readFileSync(exitFile, "utf-8"));
            rmSync(exitFile, { force: true });
            if (data?.type === "error") {
              const msg = typeof data.errorMessage === "string" && data.errorMessage.trim() !== ""
                ? data.errorMessage : "Subagent exited with stopReason=error.";
              return { reason: "error", exitCode: 1, errorMessage: msg };
            }
          }
        } catch { /* fall through */ }
      }
      return { reason: "sentinel", exitCode: 0 };
    }
  } finally {
    clearInterval(tickTimer);
  }
}

function waitForSettle(handle: RpcHandle, signal: AbortSignal): Promise<PollResult> {
  // Fast path: process already exited.
  if (handle.settledResult) return Promise.resolve(handle.settledResult);
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      handle.listeners.delete(listener);
      clearInterval(pollExit);
      reject(new Error("Aborted while waiting for RPC subagent"));
    };
    const listener: LineListener = (rec) => {
      if (rec.type === "agent_settled") {
        handle.listeners.delete(listener);
        signal.removeEventListener("abort", onAbort);
        clearInterval(pollExit);
        resolve({ reason: "sentinel", exitCode: 0 });
      }
    };
    // Fallback: child exited without agent_settled (crash/kill path).
    const pollExit = setInterval(() => {
      if (handle.settledResult) {
        handle.listeners.delete(listener);
        signal.removeEventListener("abort", onAbort);
        clearInterval(pollExit);
        resolve(handle.settledResult);
      }
    }, 500);
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener("abort", onAbort, { once: true });
    handle.listeners.add(listener);
  });
}

export function closeRpcSubagent(handle: RpcHandle): void {
  closeMonitorWindow(handle.monitorPid);
  handle.monitorPid = undefined;
  try { handle.child.stdin?.end(); } catch { /* already closed */ }
  if (!handle.done) {
    const timer = setTimeout(() => {
      try {
        if (handle.child.exitCode === null) handle.child.kill("SIGKILL");
      } catch { /* already gone */ }
      if (!handle.done) {
        handle.done = true;
        handle.settledResult = { reason: "done", exitCode: 0 };
      }
    }, 3000);
    timer.unref();
  }
}
