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

test("marks resumable sessions interrupted when Control Service restarts", () => {
  const directory = mkdtempSync(join(tmpdir(), "pi-store-restart-"));
  const path = join(directory, "state.sqlite");
  const first = new StateStore(path);
  first.upsertSession({ id: "idle", name: "Idle", workspace: directory, status: "idle",
    createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() });
  first.close();
  const reopened = new StateStore(path);
  try { assert.equal(reopened.session("idle")?.status, "interrupted"); }
  finally { reopened.close(); }
});

test("deletes a session and its associated control records", () => {
  const state = store();
  const timestamp = new Date(0).toISOString();
  try {
    state.upsertSession({ id: "deleted", name: "Deleted", workspace: "/workspace", status: "idle",
      createdAt: timestamp, updatedAt: timestamp });
    state.upsertSession({ id: "kept", name: "Kept", workspace: "/workspace", status: "idle",
      createdAt: timestamp, updatedAt: timestamp });
    state.createQuestion({ id: "question", sessionId: "deleted", source: { kind: "orchestrator" }, question: "Q",
      mode: "text", options: [], allowOther: false, status: "pending", answers: [], createdAt: timestamp });
    state.createApproval({ id: "approval", sessionId: "deleted", title: "Run?", message: "command",
      status: "pending", createdAt: timestamp });
    state.appendEvent("session.test", { value: 1 }, "deleted");
    state.appendEvent("session.test", { value: 2 }, "kept");

    assert.equal(state.deleteSession("deleted"), true);
    assert.equal(state.session("deleted"), undefined);
    assert.equal(state.question("question"), undefined);
    assert.equal(state.approval("approval"), undefined);
    assert.deepEqual(state.eventsAfter(0).map((event) => event.sessionId), ["kept"]);
    assert.equal(state.session("kept")?.name, "Kept");
    assert.equal(state.deleteSession("deleted"), false);
  } finally { state.close(); }
});
