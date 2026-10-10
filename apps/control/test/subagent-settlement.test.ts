import test from "node:test";
import assert from "node:assert/strict";
import {createSettlement} from "../../../extensions/interactive-subagents/settlement.ts";
test("early child exit is safe before the orchestrator awaits settlement",async()=>{
  const {outcome,finish}=createSettlement();const error=new Error("Nested Pi exited before settling (null)");
  finish(error);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await outcome,error);
  finish();assert.equal(await outcome,error);
});
test("normal settlement wins over the later client.stop exit",async()=>{
  const {outcome,finish}=createSettlement();finish();finish(new Error("SIGTERM"));assert.equal(await outcome,undefined);
});
