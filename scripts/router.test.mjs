import test from "node:test";
import assert from "node:assert/strict";
import { route } from "./router.mjs";

const qwen = "local-qwen36/unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M";
const glm = "local-glm/ggml-org/GLM-4.7-Flash-GGUF:Q4_K";
const auto = "openrouter/auto";

test("local orchestrator stays inside scope", () => {
  assert.equal(route({ role: "orchestrator", localOnly: true }).selected, qwen);
});

test("unhealthy Qwen falls back without leaving scope", () => {
  const result = route({}, { [qwen]: { healthy: false } });
  assert.notEqual(result.selected, qwen);
  assert.ok([glm, auto].includes(result.selected));
  assert.ok(result.attempts.every((id) => [qwen, glm, auto].includes(id)));
});

test("exhausted quota is filtered", () => {
  assert.equal(route({}, { [qwen]: { quotaKnown: true, quotaRemaining: 0 }, [glm]: { healthy: false } }).selected, auto);
});

test("manual override is respected", () => {
  assert.deepEqual(route({ override: glm }), { selected: glm, attempts: [glm], reason: "manual override" });
});

test("manual override cannot escape scope", () => {
  assert.throws(() => route({ override: "openrouter/anthropic/secret-model" }), /outside enabledModels/);
});
