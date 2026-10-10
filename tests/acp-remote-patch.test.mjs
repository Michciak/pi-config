import test from "node:test";
import assert from "node:assert/strict";
import {patchAcpRemote,patchAcpLifecycle} from "../scripts/acp-remote-patch.mjs";
import vm from "node:vm";
test("ACP adapter is idempotent, gated to Remote and fails closed for unknown bundles",()=>{
 const source='function fleetRunsSnapshot(){return []}delegateStatusWidget.setContext(ctx,runningRunsSnapshot,shortcut);function one(){const send=pi2.sendUserMessage;send.call(pi2,"single",{deliverAs:"followUp"});}function batch(){const send=pi2.sendUserMessage;send.call(pi2,"batch",{deliverAs:"followUp"});}function route(args,ctx){const roleCfg={};const callModel=normalizeModelRef(args.model);return callModel;}';
 const patched=patchAcpRemote(source);
 assert.match(patched,/if\(process.env.PI_WEB_SESSION_ID\)/);
 assert.equal(patchAcpRemote(patched),patched);
 assert.throws(()=>patchAcpRemote("unknown version"),/Unsupported/);
 const makeContext=env=>({process:{env},ctx:{},runningRunsSnapshot:()=>[],shortcut:"",delegateStatusWidget:{setContext(){}}});
 const query=';typeof globalThis[Symbol.for("pi-remote.acp-fleet")]';
 assert.equal(vm.runInNewContext(patched+query,makeContext({})),"undefined");
 assert.equal(vm.runInNewContext(patched+query,makeContext({PI_WEB_SESSION_ID:"parent"})),"function");
 for(const remote of [false,true]) {
  const calls=[],context={...makeContext(remote?{PI_WEB_SESSION_ID:"parent"}:{}),normalizeModelRef:x=>x,pi2:{sendUserMessage:(...args)=>calls.push(["user",...args]),sendMessage:(...args)=>calls.push(["system",...args])}};
  vm.runInNewContext(patched+';globalThis[Symbol.for("pi-remote.delegate-model")]=()=>"provider/alternative";one();batch();',context);
  assert.equal(calls.length,2);assert.equal(calls[0][0],remote?"system":"user");
  if(remote){assert.equal(calls[0][1].customType,"subagent_result");assert.equal(calls[0][2].deliverAs,"steer");assert.equal(calls[0][2].triggerTurn,true);}
  assert.equal(vm.runInNewContext('route({}, {})',context),remote?"provider/alternative":undefined);
  assert.equal(vm.runInNewContext('route({model:"explicit/model"}, {})',context),"explicit/model");
 }
 const old=source.replace('delegateStatusWidget.setContext','if(process.env.PI_WEB_SESSION_ID)globalThis[Symbol.for("pi-remote.acp-fleet")]=()=>fleetRunsSnapshot();delegateStatusWidget.setContext');
 assert.match(patchAcpRemote(old),/pi-remote-acp-v2/);
});
test("ACP Remote awaits startup registration; terminal remains detached with handled errors",async()=>{
 const source='let agentProvidersDone=true;pi2.on("session_start",(_event,ctx)=>{if(!agentProvidersDone){}void registerTools(pi2,ctx,state2,agent,false).catch(err=>console.error(err));if(typeof pi2.getSessionName==="function"){} });';
 const patched=patchAcpLifecycle(source);
 assert.equal(patchAcpLifecycle(patched),patched);
 for(const remote of [true,false]){
  let handler,finish;const errors=[];
  const context={process:{env:remote?{PI_WEB_SESSION_ID:"fixture"}:{}},pi2:{on:(_name,fn)=>handler=fn},state2:{},agent:"pi",registerTools:()=>new Promise(resolve=>finish=resolve),console:{error:error=>errors.push(error)}};
  vm.runInNewContext(patched,context);
  let settled=false;const task=handler({},{}).then(()=>settled=true);
  await Promise.resolve();await Promise.resolve();assert.equal(settled,!remote);
  finish();await task;assert.deepEqual(errors,[]);
 }
 assert.throws(()=>patchAcpLifecycle(source.replace(';if(typeof pi2.getSessionName',';if(other')));
});
