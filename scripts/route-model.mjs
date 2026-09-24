#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const root = new URL("../", import.meta.url);
const capabilities = JSON.parse(fs.readFileSync(new URL("settings/model-capabilities.json", root)));
const settingsPath = `${process.env.HOME}/.pi/agent/settings.json`;
const settings = JSON.parse(fs.readFileSync(settingsPath));
const scope = new Set(settings.enabledModels ?? []);

export function select(task = {}) {
  const candidates = Object.entries(capabilities)
    .filter(([id, meta]) => scope.has(id) && meta.enabled && meta.verified)
    .filter(([, meta]) => !task.localOnly || meta.local)
    .filter(([, meta]) => !task.role || meta.roles.includes(task.role))
    .filter(([, meta]) => !task.vision || meta.vision)
    .filter(([, meta]) => !task.reasoning || meta.reasoning)
    .filter(([, meta]) => !task.context || meta.contextWindow >= task.context)
    .sort((a, b) => (b[1].priority ?? 0) - (a[1].priority ?? 0));
  return candidates[0]?.[0] ?? null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const task = process.argv[2] ? JSON.parse(process.argv[2]) : {};
  const result = select(task);
  if (!result) process.exitCode = 1;
  console.log(result ?? "NO_SCOPED_MODEL");
}
