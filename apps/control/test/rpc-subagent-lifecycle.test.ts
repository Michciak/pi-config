import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {setImmediate} from "node:timers/promises";
import {registerRpcSubagents} from "../../../extensions/interactive-subagents/rpc-backend.ts";

test("RPC completion, delivery failure, child error and reload cannot crash the orchestrator",async()=>{
  const root=mkdtempSync(join(tmpdir(),"pi-rpc-lifecycle-")),previous=process.cwd();
  const oldSocket=process.env.PI_ASK_USER_SOCKET,oldSessions=process.env.PI_WEB_SUBAGENT_SESSIONS_DIR;
  const oldRemote=process.env.PI_WEB_SESSION_ID,oldCli=process.env.PI_WEB_CLI_PATH;
  mkdirSync(join(root,".pi/agents"),{recursive:true});
  writeFileSync(join(root,".pi/agents/fixture.md"),"---\nname: fixture\ntools: read\n---\nFixture only.");
  process.chdir(root);process.env.PI_ASK_USER_SOCKET=join(root,"interactions.sock");process.env.PI_WEB_SUBAGENT_SESSIONS_DIR=join(root,"subagents");
  process.env.PI_WEB_SESSION_ID="fixture";process.env.PI_WEB_CLI_PATH="/fixture/release/cli.js";
  const handlers=new Map<string,any>(),tools=new Map<string,any>(),sent:any[]=[],widgets:any[]=[];
  let listener:any,mode="completed",stale=false,brokenDelivery=false,stops=0;
  const api:any={on:(name:string,handler:any)=>handlers.set(name,handler),registerTool:(tool:any)=>tools.set(tool.name,tool),sendMessage:(...args:any[])=>{if(stale||brokenDelivery)throw Error("stale API");sent.push(args);}};
  const context:any={cwd:root,scopedModels:[{model:{provider:"fixture",id:"model"}}],ui:{setWidget:(...args:any[])=>{if(stale)throw Error("stale UI");widgets.push(args);}}};
  registerRpcSubagents(api,(options)=>{assert.equal(options?.cliPath,"/fixture/release/cli.js");return ({
    onEvent:(fn:any)=>{listener=fn;return ()=>{};},start:async()=>{},
    getState:async()=>({sessionFile:join(root,"subagents/fixture.jsonl")}),
    prompt:async()=>{if(mode!=="waiting")listener({type:"agent_settled"});},
    getMessages:async()=>[{role:"assistant",stopReason:mode==="error"?"error":"stop",errorMessage:"upstream failed"}],
    getLastAssistantText:async()=>"fixture result",getSessionStats:async()=>({}),
    stop:async()=>{stops++;listener({type:"agent_settled"});},
  }) as any;});
  const launch=()=>tools.get("subagent").execute("fixture",{agent:"fixture",task:"Fixture",model:"fixture/model"},undefined,undefined,context);
  const drain=async()=>{for(let i=0;i<10;i++)await setImmediate();};
  try {
    await handlers.get("session_start")({},context);
    await launch();await drain();assert.match(sent.at(-1)[0].content,/completed/);assert.equal(sent.at(-1)[1].triggerTurn,true);
    mode="error";await launch();await drain();assert.match(sent.at(-1)[0].content,/failed: upstream failed/);
    // Both result and fallback delivery throw. The detached job must still settle.
    mode="completed";brokenDelivery=true;await launch();await drain();brokenDelivery=false;
    const lastWidget=widgets.filter(row=>String(row[0]).startsWith("remote-subagent:")).at(-1);
    assert.equal(JSON.parse(lastWidget[1][0]).status,"completed");
    mode="waiting";await launch();await drain();const count=sent.length;
    stale=true;await handlers.get("session_shutdown")();await drain();
    assert.equal(sent.length,count);assert.ok(stops>=3);
    stale=false;await handlers.get("session_start")({},context);mode="completed";await launch();await drain();
    assert.match(sent.at(-1)[0].content,/completed/);
  } finally {
    stale=false;await handlers.get("session_shutdown")();process.chdir(previous);
    if(oldSocket===undefined)delete process.env.PI_ASK_USER_SOCKET;else process.env.PI_ASK_USER_SOCKET=oldSocket;
    if(oldSessions===undefined)delete process.env.PI_WEB_SUBAGENT_SESSIONS_DIR;else process.env.PI_WEB_SUBAGENT_SESSIONS_DIR=oldSessions;
    if(oldRemote===undefined)delete process.env.PI_WEB_SESSION_ID;else process.env.PI_WEB_SESSION_ID=oldRemote;
    if(oldCli===undefined)delete process.env.PI_WEB_CLI_PATH;else process.env.PI_WEB_CLI_PATH=oldCli;
  }
});
