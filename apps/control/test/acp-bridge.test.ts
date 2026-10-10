import test from "node:test";
import assert from "node:assert/strict";
import remoteIntegrations from "../../../extensions/remote-integrations.ts";
test("native ACP fleet publishes live child lifecycle through the shared widget channel",async()=>{
 const key=Symbol.for("pi-remote.acp-fleet"),previousFleet=(globalThis as any)[key],previousId=process.env.PI_WEB_SESSION_ID;
 process.env.PI_WEB_SESSION_ID="fixture-parent";
 const handlers=new Map<string,Function>(),widgets=new Map<string,string[]>();let status="running";
 (globalThis as any)[key]=()=>[{runId:"del_fixture_1234",agent:"reviewer",status,sessionFile:"/tmp/acp-delegate/del_fixture_1234.session.jsonl"}];
 const pi={on:(name:string,handler:Function)=>handlers.set(name,handler),events:{on(){}},registerTool(){},registerCommand(){}} as any;
 const context={cwd:"/tmp/acp-bridge-fixture",sessionManager:{getBranch:()=>[],getSessionId:()=>"fixture"},ui:{setWidget:(name:string,lines:string[])=>widgets.set(name,lines)}} as any;
 try {
  remoteIntegrations(pi);await handlers.get("session_start")!({},context);
  let child=JSON.parse(widgets.get("remote-subagent:acp:del_fixture_1234")![0]!);
  assert.equal(child.transport,"acp");assert.equal(child.status,"running");assert.equal(child.name,"ACP · reviewer · 1234");
  status="failed";await handlers.get("tool_result")!();await new Promise(resolve=>setImmediate(resolve));
  child=JSON.parse(widgets.get("remote-subagent:acp:del_fixture_1234")![0]!);assert.equal(child.status,"error");
 } finally {await handlers.get("session_shutdown")?.();if(previousId===undefined)delete process.env.PI_WEB_SESSION_ID;else process.env.PI_WEB_SESSION_ID=previousId;if(previousFleet===undefined)delete (globalThis as any)[key];else (globalThis as any)[key]=previousFleet;}
});
