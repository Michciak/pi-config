#!/usr/bin/env node
import fs from "node:fs/promises";

const qwen = "local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M";
const glm = "local-glm/ggml-org/GLM-4.7-Flash-GGUF:Q4_K";
const keyFile = "/etc/llama-server/glm-api-key";
const authPath = `${process.env.HOME}/.pi/agent/auth.json`;
import { checkQuotas } from "./quota-check.mjs";

async function auth(provider) {
  try { return JSON.parse(await fs.readFile(authPath, "utf8"))[provider] ?? null; }
  catch { return null; }
}

async function localState(model, port) {
  const state = { provider: model.split("/", 1)[0], healthy: false, quotaKnown: false, authConfigured: true, updatedAt: new Date().toISOString() };
  try {
    const key = await fs.readFile(keyFile, "utf8");
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { authorization: `Bearer ${key.trim()}` }, signal: AbortSignal.timeout(2500),
    });
    state.healthy = response.ok;
  } catch { /* unavailable is represented as healthy=false */ }
  return state;
}

async function remoteState(provider, quota) {
  const record = await auth(provider);
  // quota-check may prove auth invalid (e.g. expired Copilot license -> 401).
  // Invalid auth excludes the whole provider, with auto-recovery on renewal.
  const authInvalid = quota?.authValid === false;
  const state = {
    provider, authConfigured: !authInvalid && Boolean(record?.key || record?.access || record?.refresh),
    healthy: undefined, quotaKnown: quota?.quotaKnown ?? false,
    quotaRemaining: quota?.remaining ?? null, updatedAt: new Date().toISOString(),
  };
  if (!state.authConfigured) return { ...state, healthy: false, reason: "missing auth" };

  // OpenRouter has a stable authenticated catalog endpoint. The other OAuth/API
  // providers deliberately remain unknown here: auth presence is not proof that
  // a particular model can infer, and no stable generic health endpoint exists.
  if (provider === "openrouter" && record.key) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${record.key}` }, signal: AbortSignal.timeout(5000),
      });
      return { ...state, healthy: response.ok, httpStatus: response.status };
    } catch (error) {
      return { ...state, healthy: false, reason: error instanceof Error ? error.message : "request failed" };
    }
  }
  if (provider === "github-copilot" && record.access) {
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${record.access}`, Accept: "application/vnd.github+json", "User-Agent": "pi-config" },
        signal: AbortSignal.timeout(5000),
      });
      return { ...state, healthy: response.ok, httpStatus: response.status, check: "github-auth" };
    } catch (error) {
      return { ...state, healthy: false, reason: error instanceof Error ? error.message : "request failed" };
    }
  }
  return { ...state, check: "auth-only; provider inference endpoint unavailable" };
}

export async function collectRuntimeState() {
  const quotas = await checkQuotas();
  const [qwenState, glmState, openrouterState, copilotState, codexState, cursorState, opencodeState] = await Promise.all([
    localState(qwen, 8081), localState(glm, 8080),
    remoteState("openrouter", quotas.openrouter),
    remoteState("github-copilot", quotas["github-copilot"]),
    remoteState("openai-codex", quotas["openai-codex"]),
    remoteState("cursor", quotas.cursor),
    remoteState("opencode-go", quotas["opencode-go"]),
  ]);
  return {
    [qwen]: qwenState, [glm]: glmState,
    "openrouter/auto": openrouterState,
    "github-copilot": copilotState,
    "openai-codex": codexState,
    cursor: cursorState,
    "opencode-go": opencodeState,
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await collectRuntimeState(), null, 2));
}
