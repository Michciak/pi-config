import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../src/events.js";
import { InteractionBroker } from "../src/interactions.js";
import { StateStore } from "../src/store.js";

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "pi-interactions-"));
  const store = new StateStore(join(directory, "state.sqlite"));
  const events = new EventBus(store);
  const notifier = { send: async () => {} } as any;
  return { store, events, broker: new InteractionBroker(store, events, notifier) };
}

function textQuestion(broker: InteractionBroker, sessionId: string, question: string) {
  return broker.createQuestion({ sessionId, source: { kind: "orchestrator" }, question,
    mode: "text", options: [], allowOther: false });
}

test("enforces FIFO inside a session while allowing another session to answer", () => {
  const { store, broker } = setup();
  try {
    const first = textQuestion(broker, "one", "First");
    const second = textQuestion(broker, "one", "Second");
    const parallel = textQuestion(broker, "two", "Parallel");
    assert.throws(() => broker.answerQuestion(second.id, [{ type: "text", label: "later", value: "later" }]), /earlier/i);
    assert.equal(broker.answerQuestion(parallel.id, [{ type: "text", label: "now", value: "now" }]).status, "answered");
    broker.answerQuestion(first.id, [{ type: "text", label: "", value: "" }]);
    assert.equal(broker.answerQuestion(second.id, [{ type: "text", label: "done", value: "done" }]).status, "answered");
  } finally { store.close(); }
});

test("first response wins and pending state survives a web reconnect", () => {
  const { store, broker } = setup();
  try {
    const question = textQuestion(broker, "session", "Question");
    assert.equal(store.questions("pending")[0]?.id, question.id);
    broker.cancelQuestion(question.id);
    assert.throws(() => broker.answerQuestion(question.id, [{ type: "text", label: "late", value: "late" }]), /no longer pending/i);
  } finally { store.close(); }
});

test("engine restart invalidates questions and approvals", () => {
  const { store, broker } = setup();
  try {
    const question = textQuestion(broker, "session", "Question");
    const approval = broker.createApproval({ sessionId: "session", externalRequestId: "rpc-1", title: "Run?", message: "git push", responder: () => {} });
    broker.invalidateAll("Engine restarted");
    assert.equal(store.question(question.id)?.status, "invalidated");
    assert.equal(store.approval(approval.id)?.status, "invalidated");
  } finally { store.close(); }
});
