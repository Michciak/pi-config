import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,statSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {prepareControlRestart,consumeControlRestart} from "../src/control-restart.js";
test("Control restart intent is private, one-shot, and preserves session IDs",()=>{
  const root=mkdtempSync(join(tmpdir(),"pi-control-restart-"));
  assert.equal(consumeControlRestart(root),undefined);
  prepareControlRestart(root,["one","two","one"]);
  assert.equal(statSync(join(root,"control-restart.json")).mode&0o777,0o600);
  assert.deepEqual(consumeControlRestart(root),["one","two"]);
  assert.equal(consumeControlRestart(root),undefined);
  prepareControlRestart(root,[]);assert.deepEqual(consumeControlRestart(root),[]);
  writeFileSync(join(root,"control-restart.json"),'{"version":99}');
  assert.throws(()=>consumeControlRestart(root),/Invalid/);assert.equal(consumeControlRestart(root),undefined);
});
