import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,join} from "node:path";
import {patchRpcAutocomplete} from "../scripts/rpc-autocomplete-patch.mjs";

test("release-local autocomplete patch fails closed on version, anchor and double patch",()=>{
  const source=readFileSync(join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),"modes/rpc/rpc-mode.js"),"utf8");
  assert.throws(()=>patchRpcAutocomplete(source,"1.0.4"));
  assert.throws(()=>patchRpcAutocomplete("changed","1.0.3"));
  const patched=patchRpcAutocomplete(source,"1.0.3");
  assert.match(patched,/registered\.getArgumentCompletions\(prefix\)/);
  assert.match(patched,/remoteModelSearchText/);
  assert.throws(()=>patchRpcAutocomplete(patched,"1.0.3"));
});
