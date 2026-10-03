import { readFileSync } from "node:fs";
import { routeLive } from "../../scripts/route-model.mjs";

const qwen = "local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M";
const settingsPath = `${process.env.HOME}/.pi/agent/settings.json`;
const capabilitiesUrl = new URL("../../settings/model-capabilities.json", import.meta.url);

// Loaded lazily on every call so `pi /reload` and scope edits apply without a
// process restart. Never cached at module top level.
function loadScope(): Set<string> {
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  return new Set<string>(settings.enabledModels ?? []);
}

function loadCapabilities(): Record<string, { local?: boolean; enabled?: boolean; verified?: boolean }> {
  return JSON.parse(readFileSync(capabilitiesUrl, "utf8"));
}

export type AgentTaskClass = "simple" | "complex";

/** Static policy check retained for configuration/unit tests. */
export function selectAgentModel(input: {
  requested?: string;
  taskClass?: AgentTaskClass;
}): string {
  const scope = loadScope();
  const capabilities = loadCapabilities();
  const taskClass = input.taskClass ?? "complex";
  const requested = input.requested;
  if (requested) {
    if (!scope.has(requested) || !capabilities[requested]?.enabled || !capabilities[requested]?.verified) {
      throw new Error(`Agent model is outside the curated scope: ${requested}`);
    }
    if (!capabilities[requested]?.local && taskClass !== "simple") {
      throw new Error("Remote models are restricted to simple agent tasks");
    }
    return requested;
  }
  if (!scope.has(qwen) || !capabilities[qwen]?.enabled || !capabilities[qwen]?.verified) {
    throw new Error("Local Qwen orchestrator model is not available in the curated scope");
  }
  return qwen;
}

/** Live policy used by subagent delegation: health, auth and known quota are evaluated before launch. */
export async function selectAgentModelLive(input: {
  requested?: string;
  taskClass?: AgentTaskClass;
  role?: string;
}): Promise<string> {
  const taskClass = input.taskClass ?? "complex";
  const result = await routeLive({
    taskClass,
    role: input.role,
    override: input.requested,
    maxAttempts: 1,
  });
  return result.selected;
}
