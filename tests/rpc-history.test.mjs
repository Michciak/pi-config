import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {remoteHistoryPage,patchRpcHistory} from "../scripts/rpc-history-patch.mjs";
test("history pages bound display payload and preserve originals, cursors and tool arguments",()=>{
 const messages=Array.from({length:2000},(_,timestamp)=>({role:"assistant",timestamp,content:[{type:"thinking",thinking:"short",thinkingSignature:"secret".repeat(10000)},{type:"text",text:"x".repeat(30000)},{type:"toolCall",id:"id",name:"read",arguments:{path:"file"}}]}));
 const page=remoteHistoryPage(messages,undefined,160);assert.equal(page.start,1840);assert.equal(page.messages.length,160);
 assert.equal(page.messages[0].content[0].thinkingSignature,undefined);assert.equal(messages[0].content[0].thinkingSignature.length,60000);
 assert.equal(page.messages[0].content[1].text.length<25000,true);assert.deepEqual(page.messages[0].content[2].arguments,{path:"file"});
 const earlier=remoteHistoryPage(messages,page.start,160);assert.equal(earlier.end,page.start);assert.equal(earlier.start,1680);
 assert.equal(remoteHistoryPage(messages,undefined,999999).messages.length,400);
 assert.equal(remoteHistoryPage(messages,0,160).messages.length,0);
 const source=readFileSync(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/modes/rpc/rpc-mode.js",import.meta.url),"utf8");
 assert.match(patchRpcHistory(source,"1.0.3"),/get_messages_page/);assert.throws(()=>patchRpcHistory(source,"other"));
 assert.throws(()=>patchRpcHistory(patchRpcHistory(source,"1.0.3"),"1.0.3"));
});
