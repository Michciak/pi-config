#!/usr/bin/env node
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const settings = JSON.parse(fs.readFileSync(`${process.env.HOME}/.pi/agent/settings.json`, "utf8"));
const output = execFileSync("pi", ["--list-models"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
const providers = new Set(["local-qwen36", "local-glm", "openrouter", "github-copilot", "openai-codex", "cursor", "opencode-go"]);
const listed = new Set(output.split("\n").flatMap((line) => {
  const fields = line.trim().split(/\s+/);
  return fields.length >= 2 && providers.has(fields[0]) ? [`${fields[0]}/${fields[1]}`] : [];
}));
const missing = (settings.enabledModels ?? []).filter((id) => !listed.has(id));
for (const id of settings.enabledModels ?? []) console.log(`${missing.includes(id) ? "MISSING" : "FOUND"} ${id}`);
if (missing.length) {
  console.error(`Provider smoke failed: ${missing.length} enabled model(s) absent from pi --list-models`);
  process.exitCode = 1;
} else {
  console.log(`Provider smoke passed: ${settings.enabledModels.length} enabled models catalogued`);
}
