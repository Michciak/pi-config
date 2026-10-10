import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,appendFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {childTranscript} from "../src/child-transcripts.js";
test("child polling caches unchanged transcripts, refreshes appends and bounds messages",async()=>{
  const root=mkdtempSync(join(tmpdir(),"pi-transcript-")),file=join(root,"child.jsonl");
  writeFileSync(file,Array.from({length:400},(_,i)=>JSON.stringify({type:"message",message:{content:String(i)}})).join("\n")+"\n");
  const first=await childTranscript(root,file),second=await childTranscript(root,file);
  assert.equal(first,second);assert.equal(first.messages.length,200);assert.equal(first.messages[0].content,"200");
  appendFileSync(file,JSON.stringify({type:"model_change",provider:"test",modelId:"new"})+"\n"+JSON.stringify({type:"message",message:{content:"new"}})+"\n");
  const third=await childTranscript(root,file);
  assert.notEqual(third,first);assert.equal(third.model,"test/new");assert.equal(third.messages.at(-1).content,"new");
  assert.deepEqual(await childTranscript(join(root,"missing"),file),{messages:[]});
});
