import { readFileSync } from "node:fs";

const qwen = "local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M";
const scope = new Set<string>(JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/settings.json`, "utf8")).enabledModels ?? []);
const capabilities = JSON.parse(readFileSync(new URL("../../settings/model-capabilities.json", import.meta.url), "utf8")) as Record<string, { local?: boolean; enabled?: boolean; verified?: boolean }>;

export type AgentTaskClass = "simple" | "complex";

/** Central model policy for subagents. Remote OpenRouter is never a default. */
export function selectAgentModel(input: {
  requested?: string;
  taskClass?: AgentTaskClass;
}): string {
  const taskClass = input.taskClass ?? "complex";
  const requested = input.requested;
  if (requested) {
    if (!scope.has(requested) || !capabilities[requested]?.enabled || !capabilities[requested]?.verified) {
      throw new Error(`Agent model is outside the curated scope: ${requested}`);
    }
    if (!capabilities[requested]?.local && taskClass !== "simple") {
      throw new Error("OpenRouter models are restricted to simple agent tasks");
    }
    return requested;
  }
  if (!scope.has(qwen) || !capabilities[qwen]?.enabled || !capabilities[qwen]?.verified) {
    throw new Error("Local Qwen orchestrator model is not available in the curated scope");
  }
  return qwen;
}
