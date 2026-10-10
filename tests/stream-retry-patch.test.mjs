import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {patchStreamRetry} from "../scripts/stream-retry-patch.mjs";
test("truncated Codex streams use native bounded retry, without retrying quota or cancellation", async()=>{
  const source=readFileSync(new URL("../node_modules/@earendil-works/pi-ai/dist/utils/retry.js",import.meta.url),"utf8");
  const original=await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
  const patched=await import("data:text/javascript;base64,"+Buffer.from(patchStreamRetry(source,"1.0.3")).toString("base64"));
  const message={stopReason:"error",errorMessage:"Codex error: upstream stream ended before a completion event; this turn may be incomplete"};
  assert.equal(original.isRetryableAssistantError(message),false);
  assert.equal(patched.isRetryableAssistantError(message),true);
  for(const errorMessage of ["insufficient_quota", "Monthly usage limit reached", "invalid API key"])
    assert.equal(patched.isRetryableAssistantError({...message,errorMessage}),false);
  assert.equal(patched.isRetryableAssistantError({...message,stopReason:"aborted"}),false);
  let calls=0;
  await patched.retryAssistantCall(async()=>{calls++;return message;},{enabled:true,maxRetries:2,baseDelayMs:1});
  assert.equal(calls,3);
  assert.throws(()=>patchStreamRetry(source,"2.0"));
});
