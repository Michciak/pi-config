#!/usr/bin/env node
import fs from "node:fs/promises";

const qwen = "local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M";
const glm = "local-glm/ggml-org/GLM-4.7-Flash-GGUF:Q4_K";
const keyFile = "/etc/llama-server/glm-api-key";

async function localState(model, port) {
  const state = { provider: model.split("/", 1)[0], healthy: false, quotaKnown: false, updatedAt: new Date().toISOString() };
  try {
    const key = await fs.readFile(keyFile, "utf8");
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { authorization: `Bearer ${key.trim()}` }, signal: AbortSignal.timeout(2500),
    });
    state.healthy = response.ok;
  } catch { /* unavailable is represented as healthy=false */ }
  return state;
}

export async function collectRuntimeState() {
  return {
    [qwen]: await localState(qwen, 8081),
    [glm]: await localState(glm, 8080),
    "openrouter/auto": {
      provider: "openrouter", healthy: undefined, quotaKnown: false,
      authConfigured: true, updatedAt: new Date().toISOString(),
    },
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await collectRuntimeState(), null, 2));
}
