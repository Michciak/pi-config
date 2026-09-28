import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../src/events.js";
import { InteractionBroker } from "../src/interactions.js";
import { StateStore } from "../src/store.js";
import { buildServer } from "../src/server.js";

test("serves OpenAPI and applies exactly-once question responses", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-api-"));
  const store = new StateStore(join(directory, "state.sqlite"));
  const events = new EventBus(store);
  const notifier = { status: () => "disabled", send: async () => {} } as any;
  const interactions = new InteractionBroker(store, events, notifier);
  const engine = { status: () => "stopped", sessions: () => [] } as any;
  const config = { host: "127.0.0.1", port: 3784, runtimeDir: directory,
    databasePath: join(directory, "state.sqlite"), socketPath: join(directory, "socket"),
    sessionsDir: join(directory, "sessions"), workspaceRoot: directory,
    webAssets: join(directory, "missing"), firebaseKeychainService: "test", snippetsDir: join(directory, "snippets") };
  const app = await buildServer({ config, store, events, notifier, interactions, engine });
  try {
    const openapi = await app.inject({ method: "GET", url: "/api/v1/openapi.json", headers: { host: "127.0.0.1:3784" } });
    assert.equal(openapi.statusCode, 200);
    assert.equal(openapi.json().info.title, "Pi Local Control API");
    const question = interactions.createQuestion({ sessionId: "session", source: { kind: "orchestrator" }, question: "Q",
      mode: "text", options: [], allowOther: false });
    const first = await app.inject({ method: "POST", url: `/api/v1/questions/${question.id}/answer`, headers: { host: "127.0.0.1:3784" },
      payload: { answers: [{ type: "text", label: "", value: "" }] } });
    const second = await app.inject({ method: "POST", url: `/api/v1/questions/${question.id}/answer`, headers: { host: "127.0.0.1:3784" },
      payload: { answers: [{ type: "text", label: "late", value: "late" }] } });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 409);
  } finally { await app.close(); store.close(); }
});
