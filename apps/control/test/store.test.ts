import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../src/events.ts";
import { StateStore } from "../src/store.ts";

function store(): StateStore {
  const directory = mkdtempSync(join(tmpdir(), "pi-store-"));
  return new StateStore(join(directory, "state.sqlite"));
}

test("persists ordered events and supports cursor resume", () => {
  const state = store();
  try {
    const first = state.appendEvent("one", { value: 1 });
    const second = state.appendEvent("two", { value: 2 }, "session");
    assert.deepEqual(state.eventsAfter(first.seq).map((item) => item.seq), [second.seq]);
    assert.equal(state.eventsAfter(0)[1]?.sessionId, "session");
  } finally { state.close(); }
});

test("can stream a full event while persisting only metadata", () => {
  const state = store();
  try {
    const events = new EventBus(state);
    let received: any;
    const unsubscribe = events.subscribe((event) => { received = event.payload; });
    const event = events.publish("pi.message_update", { secret: "conversation text" }, "session",
      { type: "message_update", contentStoredInSessionFile: true });
    unsubscribe();
    assert.deepEqual(received, { secret: "conversation text" });
    assert.deepEqual(state.event(event.seq)?.payload, { type: "message_update", contentStoredInSessionFile: true });
  } finally { state.close(); }
});

test("resolves a question exactly once and preserves FIFO", () => {
  const state = store();
  try {
    const base = {
      sessionId: "session", source: { kind: "orchestrator" as const }, question: "Q",
      mode: "text" as const, options: [], allowOther: false, status: "pending" as const, answers: [],
    };
    state.createQuestion({ ...base, id: "first", createdAt: "2026-01-01T00:00:00.000Z" });
    state.createQuestion({ ...base, id: "second", createdAt: "2026-01-01T00:00:01.000Z" });
    assert.equal(state.firstPendingQuestion("session")?.id, "first");
    assert.equal(state.resolveQuestion("first", "answered", [{ type: "text", label: "", value: "" }]), true);
    assert.equal(state.resolveQuestion("first", "cancelled"), false);
    assert.equal(state.firstPendingQuestion("session")?.id, "second");
  } finally { state.close(); }
});
