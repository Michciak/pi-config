import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ControlConfig } from "../src/config.js";
import { EngineManager } from "../src/engine.js";
import { EventBus } from "../src/events.js";
import { InteractionBroker } from "../src/interactions.js";
import { StateStore } from "../src/store.js";

test("deleting an imported web session removes only its managed copy", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-engine-delete-"));
  const sessionsDir = join(directory, "sessions");
  mkdirSync(sessionsDir);
  const original = join(directory, "terminal-original.jsonl");
  const managedCopy = join(sessionsDir, "imported.jsonl");
  writeFileSync(original, "original\n");
  writeFileSync(managedCopy, "copy\n");
  const config: ControlConfig = {
    host: "127.0.0.1", port: 3784, runtimeDir: directory,
    databasePath: join(directory, "state.sqlite"), socketPath: join(directory, "socket"),
    sessionsDir, workspaceRoot: directory, webAssets: join(directory, "web"),
    firebaseKeychainService: "test", snippetsDir: join(directory, "snippets"),
  };
  const store = new StateStore(config.databasePath);
  const events = new EventBus(store);
  const interactions = new InteractionBroker(store, events, { send: async () => {} } as any);
  const engine = new EngineManager(config, store, events, interactions);
  const timestamp = new Date(0).toISOString();
  store.upsertSession({ id: "imported", name: "Imported", workspace: directory, status: "idle",
    sessionFile: managedCopy, createdAt: timestamp, updatedAt: timestamp });

  try {
    await engine.deleteSession("imported");
    assert.equal(existsSync(managedCopy), false);
    assert.equal(existsSync(original), true);
    assert.equal(store.session("imported"), undefined);
    assert.equal(events.after(0).at(-1)?.type, "session.deleted");
  } finally { store.close(); }
});
