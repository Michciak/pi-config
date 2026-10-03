#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const root = new URL("../", import.meta.url);
const capabilitiesPath = new URL("../settings/model-capabilities.json", import.meta.url);
const settingsPath = `${process.env.HOME}/.pi/agent/settings.json`;

// Loaded lazily on every route() call so `pi /reload` and scope edits apply
// without restarting the process. Never cached at module top level.
function loadCapabilities() {
  return JSON.parse(fs.readFileSync(capabilitiesPath));
}

function loadScope() {
  const settings = JSON.parse(fs.readFileSync(settingsPath));
  return new Set(settings.enabledModels ?? []);
}

function runtimeStateFor(id, runtime) {
  if (runtime[id]) return runtime[id];
  const provider = id.split("/", 1)[0];
  return runtime[provider] ?? {};
}

function eligible(id, meta, task, runtime, scope) {
  const state = runtimeStateFor(id, runtime);
  if (!scope.has(id) || !meta.enabled || !meta.verified) return false;
  if (state.authConfigured === false) return false;
  if (state.healthy === false) return false;
  if (state.quotaKnown && Number(state.quotaRemaining) <= 0) return false;
  // Remote/OpenRouter models are reserved for explicitly simple work.
  if (!meta.local && task.taskClass !== "simple") return false;
  if (task.localOnly && !meta.local) return false;
  if (task.role && !meta.roles.includes(task.role)) return false;
  if (task.vision && !meta.vision) return false;
  if (task.reasoning && !meta.reasoning) return false;
  if (task.toolCalling && !meta.toolCalling) return false;
  if (task.context && meta.contextWindow < task.context) return false;
  return true;
}

function score(id, meta, task, runtime) {
  const state = runtimeStateFor(id, runtime);
  let value = meta.priority ?? 0;
  if (task.role && meta.roles.includes(task.role)) value += 30;
  if (task.taskClass === "simple" && !meta.local) value += 5;
  if (task.localPreferred && meta.local) value += 20;
  if (task.latency === "low" && meta.latencyClass === "fast-local") value += 20;
  if (task.cost === "low" && meta.costClass === "local") value += 20;
  if (task.quality === "high" && !meta.local) value += 15;
  // Quota is a gate (see eligible()), not a scoring bonus: remaining mixes
  // units across providers (dollars vs percent), so it must not dominate
  // priority. Cost preference lives in curated priority (sync-models.mjs).
  return value;
}

export function route(task = {}, runtime = {}) {
  const capabilities = loadCapabilities();
  const scope = loadScope();
  if (task.override) {
    if (!scope.has(task.override)) throw new Error(`Manual override is outside enabledModels: ${task.override}`);
    const meta = capabilities[task.override];
    if (!meta || !eligible(task.override, meta, task, runtime, scope)) {
      throw new Error(`Manual override is unavailable: ${task.override}`);
    }
    return { selected: task.override, attempts: [task.override], reason: "manual override" };
  }
  const candidates = Object.entries(capabilities)
    .filter(([id, meta]) => eligible(id, meta, task, runtime, scope))
    .map(([id, meta]) => ({ id, score: score(id, meta, task, runtime) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const attempts = candidates.slice(0, Math.min(task.maxAttempts ?? 3, 3)).map((entry) => entry.id);
  if (!attempts.length) throw new Error("No eligible model inside enabledModels");
  return { selected: attempts[0], attempts, reason: "capability and runtime policy" };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  let runtime = input.runtime ?? {};
  const runtimeIndex = process.argv.indexOf("--runtime-file");
  if (runtimeIndex >= 0 && process.argv[runtimeIndex + 1]) {
    runtime = JSON.parse(fs.readFileSync(process.argv[runtimeIndex + 1], "utf8"));
  }
  try { console.log(JSON.stringify(route(input.task ?? input, runtime), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
