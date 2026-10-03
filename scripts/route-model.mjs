#!/usr/bin/env node
import fs from "node:fs/promises";
import { dirname } from "node:path";
import { route } from "./router.mjs";
import { collectRuntimeState } from "./runtime-state.mjs";

const telemetryPath = `${process.env.HOME}/.local/state/pi-config/router-decisions.jsonl`;

export async function routeLive(task = {}, options = {}) {
  const runtime = options.runtime ?? await collectRuntimeState();
  const result = route(task, runtime);
  return { ...result, runtime, selectedMeta: { runtime: runtime[result.selected] ?? runtime[result.selected.split("/", 1)[0]] ?? {} } };
}

async function recordDecision(task, result) {
  await fs.mkdir(dirname(telemetryPath), { recursive: true });
  const event = {
    timestamp: new Date().toISOString(), task: { ...task, override: task.override ? "present" : undefined },
    selected: result.selected, attempts: result.attempts, reason: result.reason,
    runtime: Object.fromEntries(Object.entries(result.runtime).map(([id, state]) => [id, {
      healthy: state.healthy, authConfigured: state.authConfigured,
      quotaKnown: state.quotaKnown, quotaRemaining: state.quotaRemaining,
    }])),
  };
  await fs.appendFile(telemetryPath, JSON.stringify(event) + "\n");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const input = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  try {
    const result = await routeLive(input.task ?? input);
    await recordDecision(input.task ?? input, result);
    console.log(JSON.stringify({ selected: result.selected, attempts: result.attempts, reason: result.reason, runtime: result.runtime }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
