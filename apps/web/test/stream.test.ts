import assert from "node:assert/strict";
import test from "node:test";
import { reduceLiveBlocks, toolEventText } from "../src/stream.js";

test("reconstructs streamed text and reasoning blocks", () => {
  let blocks = reduceLiveBlocks({}, { type: "text_delta", contentIndex: 0, delta: "Hello " });
  blocks = reduceLiveBlocks(blocks, { type: "text_delta", contentIndex: 0, delta: "world" });
  blocks = reduceLiveBlocks(blocks, { type: "thinking_start", contentIndex: 1 });
  blocks = reduceLiveBlocks(blocks, { type: "thinking_delta", contentIndex: 1, delta: "Check inputs" });
  blocks = reduceLiveBlocks(blocks, { type: "thinking_end", contentIndex: 1, content: "Check inputs carefully" });
  assert.deepEqual(blocks, {
    0: { type: "text", content: "Hello world" },
    1: { type: "thinking", content: "Check inputs carefully" },
  });
});

test("uses authoritative tool calls and extracts partial tool output", () => {
  let blocks = reduceLiveBlocks({}, { type: "toolcall_start", contentIndex: 2, toolName: "bash" });
  blocks = reduceLiveBlocks(blocks, { type: "toolcall_delta", contentIndex: 2, delta: '{"command":"pwd"}' });
  blocks = reduceLiveBlocks(blocks, { type: "toolcall_end", contentIndex: 2,
    toolCall: { name: "bash", arguments: { command: "pwd" } } });
  assert.equal(blocks[2]?.toolName, "bash");
  assert.match(blocks[2]?.content ?? "", /"pwd"/);
  assert.equal(toolEventText({ partialResult: { content: [{ type: "text", text: "line 1" }] } }), "line 1");
});
