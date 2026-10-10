import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {EngineManager} from "../src/engine.js";
import {StateStore} from "../src/store.js";
test("provider failures and bounded retry attempts enter timestamped redacted diagnostics",()=>{
 const root=mkdtempSync(join(tmpdir(),"pi-runtime-errors-")),store=new StateStore(":memory:");
 const engine=Object.create(EngineManager.prototype) as any;
 Object.assign(engine,{store,config:{runtimeDir:root},events:{publish(){}}});
 try {
  engine.handleEvent("fixture",{}, {type:"message_end",message:{role:"assistant",stopReason:"error",errorMessage:"upstream failed api_key=sk-secretvalue"}});
  engine.handleEvent("fixture",{}, {type:"auto_retry_start",attempt:1,errorMessage:"upstream failed"});
  engine.handleEvent("fixture",{}, {type:"auto_retry_end",attempt:1,success:true});
  const text=readFileSync(join(root,"session-runtime.log"),"utf8"),entries=text.trim().split("\n").map(line=>JSON.parse(line));
  assert.equal(entries.length,3);assert.ok(entries.every(entry=>entry.timestamp&&entry.sessionId==="fixture"));
  assert.equal(text.includes("sk-secretvalue"),false);assert.equal(entries[2].success,true);
 } finally {store.close();}
});
