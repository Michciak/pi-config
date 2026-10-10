// Verify compiled artifacts, real Pi RPC, durable snapshots, PTY and remote denial.
import {mkdtempSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
import {WebSocket} from "ws";
const release=resolve(process.argv[2]||join(import.meta.dirname,"../.releases/latest"));
const module=async(name)=>import(pathToFileURL(join(release,"apps/control/dist",name+".js")).href);
const {buildServer}=await module("server"),{StateStore}=await module("store"),{EventBus}=await module("events"),{EngineManager}=await module("engine"),{InteractionBroker}=await module("interactions"),{TerminalManager}=await module("terminals");
const root=mkdtempSync(join(tmpdir(),"pi-release-smoke-")),store=new StateStore(join(root,"state.sqlite")),events=new EventBus(store);
process.env.PI_WEB_LOG_LEVEL="error";process.env.PI_WEB_BUILD_VERSION=JSON.parse(readFileSync(join(release,"release.json"),"utf8")).version;
const notifier={status:()=>"disabled",diagnostics:()=>({}),send:async()=>({attempted:false})};
const interactions=new InteractionBroker(store,events,notifier),config={runtimeDir:root,workspaceRoot:root,webAssets:join(release,"apps/web/dist"),port:3784,sessionsDir:join(root,"sessions"),socketPath:join(root,"interactions.sock"),snippetsDir:root};
const engine=new EngineManager(config,store,events,interactions),terminals=new TerminalManager();
const app=await buildServer({config,store,events,notifier,interactions,engine,terminals});
store.createWebToken("fixture","fixture-exchange",Date.now()+10000);const token=store.exchangeWebToken("fixture-exchange");
const remote=(method,url,payload)=>app.inject({method,url,payload,remoteAddress:"192.168.1.10",headers:{host:"127.0.0.1:3784",authorization:"Bearer "+token}});
try{
  assert.equal((await app.inject("/")).statusCode,200);assert.equal((await app.inject("/api/v1/status")).json().protocolVersion,2);
  for(const [method,url,payload] of [["POST","/api/v1/terminals",{cwd:root}],["PUT","/api/v1/workspace/document",{workspace:root,path:"x",content:"x"}],["POST","/api/v1/git/action",{workspace:root,action:"commit",message:"x"}],["POST","/api/v1/plugins/install",{source:root}]]){const denied=await remote(method,url,payload);assert.equal(denied.statusCode,403);assert.equal(denied.json().code,"LOCAL_ADMIN_REQUIRED");}
  assert.equal((await remote("GET","/api/v1/capabilities")).json().terminal,false);
  await engine.start();const session=await engine.createSession({workspace:root,name:"Release smoke — no model calls"});
  const state=await engine.execute(session.id,{command:"get_state"});assert.equal(state.autoCompactionEnabled,false);
  const commands=await engine.execute(session.id,{command:"get_commands"});for(const name of ["goal","todos","workflows","simplify","acp","acp-cache","acp-rule"])assert.ok(commands.some(item=>item.name===name),name);
  await engine.execute(session.id,{command:"prompt",payload:{message:"/goal status"}});
  assert.equal((await app.inject(`/api/v1/sessions/${session.id}/extension-ui`)).statusCode,200);
  const terminal=terminals.create(root,"Release smoke");const output=[];const detach=terminals.attach(terminal.id,packet=>{if(packet.data)output.push(packet.data);});terminals.resize(terminal.id,100,30);terminals.input(terminal.id,"printf 'RELEASE_PTY_OK\\n'\r");
  const start=Date.now();while(!output.join("").includes("RELEASE_PTY_OK")){if(Date.now()-start>5000)throw new Error("PTY smoke timeout");await new Promise(resolve=>setTimeout(resolve,25));}detach();terminals.close(terminal.id);assert.equal(terminals.list().length,0);
  await app.listen({host:"127.0.0.1",port:0});const port=app.server.address().port;await new Promise((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${port}/api/v1/events?after=0`);ws.once("open",()=>{ws.close();resolve();});ws.once("error",reject);});
  console.log(JSON.stringify({ok:true,buildVersion:process.env.PI_WEB_BUILD_VERSION,pi:"1.0.3",nativeCommandCount:commands.length,extensionSnapshot:true,autoCompaction:false,localPty:true,remoteAdminDenied:true,eventWebSocket:true}));
}finally{await engine.stop();await app.close();store.close();}
