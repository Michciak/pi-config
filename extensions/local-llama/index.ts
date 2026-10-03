import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const QWEN_PORT = 8081;
const QWEN_SERVICE = "llama-qwen36.service";
const GLM_SERVICE = "llama-glm47.service";
const KEY_FILE = "/etc/llama-server/glm-api-key";
// Qwen 35B Q4 needs ~20 GiB; refuse autostart below this free-memory floor.
const MIN_AVAILABLE_GIB = Number(process.env.PI_QWEN_MIN_AVAILABLE_GIB ?? 16);
// Set PI_QWEN_AUTOSTOP=0 to keep the server running after Pi exits.
const AUTO_STOP = process.env.PI_QWEN_AUTOSTOP !== "0";

let startedByUs = false;

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: "utf8" }).trim();
}

function serviceActive(service: string): boolean {
  try {
    return run("systemctl", ["--user", "is-active", service]) === "active";
  } catch {
    return false;
  }
}

function availableGiB(): number | null {
  try {
    const meminfo = readFileSync("/proc/meminfo", "utf8");
    const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    if (!match) return null;
    return Number(match[1]) / 1024 / 1024;
  } catch {
    return null;
  }
}

function apiKey(): string | null {
  try {
    return readFileSync(KEY_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
}

async function qwenHealthy(): Promise<boolean> {
  try {
    const key = apiKey();
    const response = await fetch(`http://127.0.0.1:${QWEN_PORT}/v1/models`, {
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: AbortSignal.timeout(2500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitHealthy(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await qwenHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return qwenHealthy();
}

async function ensureQwen(notify: (msg: string, level: "info" | "warning" | "error") => void): Promise<string> {
  if (await qwenHealthy()) return "Qwen endpoint already healthy (8081).";
  if (serviceActive(QWEN_SERVICE)) {
    const ok = await waitHealthy(60_000);
    return ok ? "Qwen service active; endpoint became healthy." : "Qwen service active but endpoint not responding.";
  }
  // VRAM/RAM safety: never start a second large model alongside GLM.
  if (serviceActive(GLM_SERVICE)) {
    return "Qwen not started: GLM service is active (mutual Conflicts=, VRAM safety). Stop GLM first.";
  }
  const free = availableGiB();
  if (free !== null && free < MIN_AVAILABLE_GIB) {
    return `Qwen not started: only ${free.toFixed(1)} GiB available, need ${MIN_AVAILABLE_GIB} GiB (VRAM/RAM safety).`;
  }
  try {
    run("systemctl", ["--user", "start", QWEN_SERVICE]);
  } catch (error) {
    return `Qwen start failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  startedByUs = true;
  const ok = await waitHealthy(120_000);
  return ok ? "Qwen started on demand (8081) and is healthy." : "Qwen service started but endpoint not healthy after 120s.";
}

function otherPiRunning(): boolean {
  try {
    const out = run("pgrep", ["-c", "-x", "pi"]);
    return Number(out) > 1;
  } catch {
    return false;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    try {
      const msg = await ensureQwen((text, level) => ctx.ui.notify(text, level));
      if (!msg.includes("already healthy")) ctx.ui.notify(`[local-llama] ${msg}`, "info");
    } catch (error) {
      ctx.ui.notify(`[local-llama] ensure failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
    }
  });

  pi.on("session_shutdown", () => {
    if (!AUTO_STOP || !startedByUs) return;
    if (otherPiRunning()) return; // another Pi session still needs it
    try {
      run("systemctl", ["--user", "stop", QWEN_SERVICE]);
    } catch {
      // best-effort cleanup; never fail shutdown
    }
    startedByUs = false;
  });

  pi.registerCommand("qwen-ensure", {
    description: "Ensure the local Qwen endpoint is running (with VRAM/RAM safety checks)",
    handler: async (_args, ctx) => {
      ctx.ui.notify(`[local-llama] ${await ensureQwen((text, level) => ctx.ui.notify(text, level))}`, "info");
    },
  });

  pi.registerCommand("qwen-stop", {
    description: "Stop the local Qwen service",
    handler: async (_args, ctx) => {
      try {
        run("systemctl", ["--user", "stop", QWEN_SERVICE]);
        startedByUs = false;
        ctx.ui.notify("[local-llama] Qwen service stopped.", "info");
      } catch (error) {
        ctx.ui.notify(`[local-llama] stop failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("qwen-status", {
    description: "Show Qwen service state, memory headroom and endpoint health",
    handler: async (_args, ctx) => {
      const free = availableGiB();
      const lines = [
        `service: ${serviceActive(QWEN_SERVICE) ? "active" : "inactive"} (auto-stop: ${AUTO_STOP ? "on" : "off"})`,
        `memory available: ${free === null ? "unknown" : `${free.toFixed(1)} GiB (floor ${MIN_AVAILABLE_GIB} GiB)`}`,
        `endpoint 8081: ${await qwenHealthy() ? "healthy" : "unreachable"}`,
        `GLM service: ${serviceActive(GLM_SERVICE) ? "active (Qwen autostart blocked)" : "inactive"}`,
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
