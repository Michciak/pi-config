import test from "node:test";
import assert from "node:assert/strict";
import {restoreAcpRuns} from "../../../extensions/shared/acp-runs.ts";
test("ACP restoration uses this session's tool calls and completion notices, never arbitrary paths",()=>{
 const branch=[
  {message:{content:[{type:"toolCall",id:"call",name:"acp_delegate",arguments:{agent:"reviewer",task:"Audit"}}]}},
  {message:{toolName:"acp_delegate",toolCallId:"call",content:[{type:"text",text:"Started (runId `del_abc_123`)"}]}},
  {message:{role:"user",content:"[acp_delegate completed] reviewer (runId del_abc_123, exit 0)"}},
  {message:{toolName:"read",content:"runId del_unrelated_123 /etc/passwd"}},
 ];
 assert.deepEqual(restoreAcpRuns(branch),[{runId:"del_abc_123",agent:"reviewer",task:"Audit",status:"completed"}]);
 assert.equal(restoreAcpRuns(branch.slice(0,2))[0].status,"interrupted");
 assert.deepEqual(restoreAcpRuns([{message:{toolName:"acp_delegate",content:"runId ../../secret"}}]),[]);
});
