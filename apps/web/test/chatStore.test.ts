import assert from "node:assert/strict";
import test from "node:test";
import { ChatStore } from "../src/chatStore.js";

test("chat store has stable snapshots, functional updates and listener cleanup", () => {
  const store = new ChatStore();
  const original = store.get();
  let updates = 0;
  const unsubscribe = store.subscribe(() => updates++);
  store.set("connected", false);
  assert.equal(store.get(), original);
  store.set("messages", previous => [...previous, {role: "user", text: "hello"}]);
  assert.equal(updates, 1);
  assert.equal(store.get().messages.length, 1);
  unsubscribe(); store.set("connected", true);
  assert.equal(updates, 1);
});

test("session switches atomically clear transcript and extension state but retain global questions and hidden children", () => {
  const store = new ChatStore({old: ["child"]});
  store.patch({messages: [{text: "old"}], sessionState: {model: "old"}, childRuns: [{id: "child"}], liveBlocks: {0: {type: "text", content: "old"}}});
  let updates = 0; store.subscribe(() => updates++);
  store.selectSession("new");
  assert.equal(updates, 1);
  assert.equal(store.get().selectedId, "new");
  assert.deepEqual(store.get().messages, []);
  assert.deepEqual(store.get().liveBlocks, {});
  assert.equal(store.get().sessionState, undefined);
  assert.deepEqual(store.get().hiddenChildChats, {old: ["child"]});
});
