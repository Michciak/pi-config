#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const root = new URL("../", import.meta.url);
const capabilities = JSON.parse(fs.readFileSync(new URL("../settings/model-capabilities.json", import.meta.url)));
const settings = JSON.parse(fs.readFileSync(`${process.env.HOME}/.pi/agent/settings.json`));
const scope = new Set(settings.enabledModels ?? []);

function eligible(id, meta, task, runtime) {
  const state = runtime[id] ?? {};
  if (!scope.has(id) || !meta.enabled || !meta.verified) return false;
  if (state.healthy === false) return false;
  if (state.quotaKnown && state.quotaRemaining <= 0) return false;
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
  const state = runtime[id] ?? {};
  let value = meta.priority ?? 0;
  if (task.role && meta.roles.includes(task.role)) value += 30;
  if (task.taskClass === "simple" && !meta.local) value += 5;
  if (task.localPreferred && meta.local) value += 20;
  if (task.latency === "low" && meta.latencyClass === "fast-local") value += 20;
  if (task.cost === "low" && meta.costClass === "local") value += 20;
  if (task.quality === "high" && !meta.local) value += 15;
  if (state.quotaKnown) value += Math.round(Math.max(0, state.quotaRemaining) * 10);
  return value;
}

export function route(task = {}, runtime = {}) {
  if (task.override) {
    if (!scope.has(task.override)) throw new Error(`Manual override is outside enabledModels: ${task.override}`);
    const meta = capabilities[task.override];
    if (!meta || !eligible(task.override, meta, task, runtime)) {
      throw new Error(`Manual override is unavailable: ${task.override}`);
    }
    return { selected: task.override, attempts: [task.override], reason: "manual override" };
  }
  const candidates = Object.entries(capabilities)
    .filter(([id, meta]) => eligible(id, meta, task, runtime))
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
