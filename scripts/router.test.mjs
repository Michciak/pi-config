import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { route } from "./router.mjs";

const qwen = "local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M";
const glm = "local-glm/ggml-org/GLM-4.7-Flash-GGUF:Q4_K";
const auto = "openrouter/auto";
const scope = new Set(JSON.parse(fs.readFileSync(`${process.env.HOME}/.pi/agent/settings.json`, "utf8")).enabledModels ?? []);

test("local orchestrator stays inside scope", () => {
  assert.equal(route({ role: "orchestrator", localOnly: true }).selected, qwen);
});

test("unhealthy Qwen falls back without leaving scope", () => {
  const result = route({}, { [qwen]: { healthy: false } });
  assert.notEqual(result.selected, qwen);
  assert.ok(result.attempts.every((id) => scope.has(id)));
});

test("exhausted quota is filtered", () => {
  const result = route({ taskClass: "simple" }, { [qwen]: { quotaKnown: true, quotaRemaining: 0 }, [glm]: { healthy: false } });
  assert.notEqual(result.selected, qwen);
  assert.ok(!result.attempts.includes(qwen));
  assert.ok(result.attempts.every((id) => scope.has(id)));
});

test("OpenRouter is excluded from complex-task fallback", () => {
  assert.throws(() => route({}, { [qwen]: { healthy: false }, [glm]: { healthy: false } }), /No eligible/);
});

test("remote models are available only for explicitly simple tasks", () => {
  const result = route({ taskClass: "simple" }, { [qwen]: { healthy: false }, [glm]: { healthy: false } });
  assert.ok(!result.selected.startsWith("local-"));
  assert.ok(result.attempts.every((id) => scope.has(id)));
});

test("manual override is respected", () => {
  assert.deepEqual(route({ override: glm }), { selected: glm, attempts: [glm], reason: "manual override" });
});

test("manual override cannot escape scope", () => {
  assert.throws(() => route({ override: "openrouter/anthropic/secret-model" }), /outside enabledModels/);
});

test("provider runtime state is inherited by scoped model ids", () => {
  const runtime = {
    [qwen]: { healthy: false },
    [glm]: { healthy: false },
    "openrouter/auto": { healthy: false, quotaKnown: true, quotaRemaining: 0 },
    "github-copilot": { healthy: false, authConfigured: true },
    "openai-codex": { healthy: true, authConfigured: true },
    cursor: { healthy: false, authConfigured: true },
    "opencode-go": { healthy: false, authConfigured: true },
  };
  const result = route({ taskClass: "simple", role: "coding" }, runtime);
  assert.equal(result.selected, "openai-codex/gpt-5.6-luna");
});

test("provider without auth is excluded even when capabilities are present", () => {
  const runtime = {
    [qwen]: { healthy: false },
    [glm]: { healthy: false },
    "openrouter/auto": { healthy: false },
    "github-copilot": { authConfigured: false },
    "openai-codex": { authConfigured: false },
    cursor: { authConfigured: false },
    "opencode-go": { authConfigured: false },
  };
  assert.throws(() => route({ taskClass: "simple" }, runtime), /No eligible/);
});

test("known zero quota is excluded without treating unknown quota as zero", () => {
  const result = route({ taskClass: "simple" }, {
    [qwen]: { healthy: false },
    [glm]: { healthy: false },
    "openrouter/auto": { healthy: true, authConfigured: true, quotaKnown: true, quotaRemaining: 0 },
    "openai-codex": { healthy: true, authConfigured: true, quotaKnown: false },
    "github-copilot": { authConfigured: false },
    cursor: { authConfigured: false },
    "opencode-go": { authConfigured: false },
  });
  assert.equal(result.selected, "openai-codex/gpt-5.6-luna");
  assert.ok(!result.attempts.includes(auto));
});
