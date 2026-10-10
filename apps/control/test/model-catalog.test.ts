import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cursorModelIds, loadStoredModels, mergeModelCatalog } from "../src/model-catalog.js";

test("cursor catalog keeps variant ids that Pi stores in scope", () => {
  const ids = cursorModelIds([
    { id: "grok-4.7", parameters: [{ id: "context", values: [{ value: "256k" }, { value: "500k" }] }, { id: "fast", values: [{ value: "true" }, { value: "false" }] }] },
    { id: "composer-2.5", aliases: ["composer-latest"], parameters: [{ id: "fast", values: [{ value: "true" }] }] },
    { id: "claude-opus-5", aliases: ["opus"], parameters: [] },
    { id: "claude-opus-4-5", aliases: ["opus"], parameters: [] },
  ]);
  assert.ok(ids.includes("grok-4.7@256k:slow"));
  assert.ok(ids.includes("composer-latest"));
  assert.equal(ids.includes("opus"), false);
});

test("stored catalogs include models that are outside the current scope", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-catalog-"));
  writeFileSync(join(dir, "models-store.json"), JSON.stringify({
    openrouter: { models: [{ provider: "openrouter", id: "openrouter/auto" }, { provider: "openrouter", id: "moonshotai/kimi-k2" }] },
  }));
  writeFileSync(join(dir, "cursor-sdk-model-list.json"), JSON.stringify({
    models: [{ id: "grok-4.7", parameters: [{ id: "context", values: [{ value: "256k" }] }, { id: "fast", values: [{ value: "false" }] }] }],
  }));
  const models = loadStoredModels(dir);
  const refs = models.map((model) => `${model.provider}/${model.id}`);
  assert.ok(refs.includes("openrouter/moonshotai/kimi-k2"));
  assert.ok(refs.includes("cursor/grok-4.7@256k:slow"));
  assert.deepEqual(mergeModelCatalog(models, [{ provider: "cursor", id: "grok-4.7@256k:slow" }, { provider: "openai-codex", id: "gpt-5.5" }]).length, models.length + 1);
});
