import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createServer} from "node:http";
import {PluginHost} from "../src/plugin-host.js";
import {PluginStore} from "../src/extensions.js";
import {StateStore} from "../src/store.js";
import {EventBus} from "../src/events.js";
import {InteractionBroker} from "../src/interactions.js";
import {buildServer} from "../src/server.js";
import {WebSocket,WebSocketServer} from "ws";
import {completeWithIsolatedSession,llmInflight} from "../src/vendor/pi-web-ui/plugin-llm.js";

test("complete 0.97 SDK: fs boundaries, encrypted secrets, net grants, schedules, guards, HTTP, proxy and cleanup",async()=>{
  const root=mkdtempSync(join(tmpdir(),"pi-sdk-")),source=join(root,"source"),workspace=join(root,"workspace"),outside=join(root,"outside");
  mkdirSync(source);mkdirSync(workspace);mkdirSync(outside);writeFileSync(join(workspace,"file.txt"),"hello");writeFileSync(join(outside,"secret.txt"),"outside");
  const upstream=createServer((_req,res)=>res.end("proxy-ok"));await new Promise<void>(resolve=>upstream.listen(0,"127.0.0.1",resolve));const port=(upstream.address() as any).port;
  writeFileSync(join(source,"manifest.json"),JSON.stringify({id:"sdk",name:"SDK fixture",version:"1.0.0",apiVersion:2,permissions:["fs","ui","tools","http","net","llm","chat","dom"],settings:[{key:"tone",type:"text",default:"short"}]}));
  writeFileSync(join(source,"index.mjs"),`export default {async activate(host){
    host.secrets.set("test","private-fixture");
    host.ui.register({id:"view",slot:"topbar.primary",label:"SDK",kind:"view",view:"plugin:sdk"});
    host.registerCommand({name:"sdk_command",run:args=>args});
    host.onToolPre(req=>req.params?.deny?{decision:"deny",reason:"fixture"}:undefined);
    host.route("GET","/health",(_req,res)=>res.json({ok:true}));
    host.registerProxy("/sdk-proxy",${port});
    host.schedule(60000,()=>{}, {id:"heartbeat",persistent:true,label:"SDK timer"});
    host.registerAgentTool({name:"sdk_probe",description:"fixture",parameters:{type:"object"},async execute(_id,p){
      if(p.action==="read")return host.fs.readText(p.path);
      if(p.action==="net")return host.net.fetch(p.url);
      if(p.action==="grant")return host.requestPermission({family:"net",hosts:["127.0.0.1"],reason:"fixture"});
      if(p.action==="llm")return host.llm.complete({prompt:""});
      return {methods:Object.keys(host),secret:host.secrets.has("test"),tone:host.getSettings().tone};
    }});
    return ()=>host.storage.set("disposed",true);
  }};`);
  const store=new StateStore(join(root,"state.sqlite")),events=new EventBus(store),plugins=new PluginStore(root),host=new PluginHost(plugins,events,workspace);
  const manifest=plugins.install(source,plugins.inspect(source).digest);
  try{
    await host.load();
    const probe=await host.tool("sdk","sdk_probe","call",{});
    for(const name of ["fs","secrets","schedule","llm","net","registerProxy","requestPermission","onToolPre","onToolPost","project","conversations","models","bash","events"])assert.ok(probe.methods.includes(name),name);
    assert.equal(probe.tone,"short");assert.equal(probe.secret,true);
    assert.equal(host.ui("sdk")[0]?.slot,"topbar.primary");
    assert.equal(await host.tool("sdk","sdk_probe","call",{action:"read",path:"file.txt"}),"hello");
    await assert.rejects(host.tool("sdk","sdk_probe","call",{action:"read",path:"../outside/secret.txt"}));
    assert.equal((await host.tool("sdk","sdk_probe","call",{action:"net",url:`http://127.0.0.1:${port}`})).ok,false);
    const pending=host.tool("sdk","sdk_probe","call",{action:"grant"});
    assert.equal(host.grants().pending.length,1);host.decide(host.grants().pending[0]!.id,true,true);assert.equal(await pending,true);
    assert.equal((await host.tool("sdk","sdk_probe","call",{action:"net",url:`http://127.0.0.1:${port}`})).text,"proxy-ok");
    assert.equal((await host.tool("sdk","sdk_probe","call",{action:"llm"})).ok,false);
    assert.equal((await host.manager.evaluateToolPre({toolName:"bash",params:{deny:true}})).verdict.decision,"deny");
    assert.equal(host.commands()[0].name,"sdk_command");assert.equal(await host.command("sdk","sdk_command","echo"),"echo");
    assert.ok(host.blocked("sdk"));await host.dom("sdk",true);assert.equal(host.blocked("sdk"),false);
    await host.saveConfig("sdk",{tone:"full"});assert.equal(host.config("sdk").tone,"full");
    assert.ok(existsSync(join(plugins.root,"sdk/schedules.json")));
    assert.ok(!readFileSync(join(plugins.root,"sdk/storage.json"),"utf8").includes("private-fixture"));
    await host.close();assert.equal(host.manager.getAgentTools().length,0);assert.equal(host.manager.proxyRoutes.size,0);
    assert.equal(JSON.parse(readFileSync(join(plugins.root,"sdk/storage.json"),"utf8")).disposed,true);
  }finally{await host.close();store.close();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});

test("isolated LLM completion uses Pi 1.0 SDK without tools, extensions or paid providers",async()=>{
  const root=mkdtempSync(join(tmpdir(),"pi-sdk-llm-"));let body:any;
  const upstream=createServer((req,res)=>{let text="";req.on("data",chunk=>text+=chunk);req.on("end",()=>{body=JSON.parse(text);res.writeHead(200,{"content-type":"text/event-stream"});res.end('data: {"id":"fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"isolated fixture"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\ndata: [DONE]\n\n');});});
  await new Promise<void>(resolve=>upstream.listen(0,"127.0.0.1",resolve));const port=(upstream.address() as any).port;
  writeFileSync(join(root,"auth.json"),JSON.stringify({fixture:{type:"api_key",key:"not-a-provider-key"}}),{mode:0o600});
  writeFileSync(join(root,"models.json"),JSON.stringify({providers:{fixture:{baseUrl:`http://127.0.0.1:${port}/v1`,api:"openai-completions",models:[{id:"local",name:"Local fixture",reasoning:false,input:["text"],contextWindow:32000,maxTokens:256,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}),{mode:0o600});
  try{const result=await completeWithIsolatedSession({cwd:root,agentDir:root},{prompt:"fixture",model:"fixture/local",maxChars:8});assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.text,"isolated");assert.ok(!body.tools?.length);assert.equal(llmInflight(),0);}
  finally{await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});

test("SDK prompt, targeted chat and selected-conversation callbacks preserve Pi semantics",async()=>{
  const root=mkdtempSync(join(tmpdir(),"pi-sdk-chat-")),source=join(root,"source");mkdirSync(source);
  writeFileSync(join(source,"manifest.json"),JSON.stringify({id:"chat",name:"Chat",version:"1",apiVersion:2,permissions:["chat","tools"]}));
  writeFileSync(join(source,"index.mjs"),`export default {activate(host){host.registerAgentTool({name:"chat_probe",description:"fixture",parameters:{type:"object"},async execute(_id,p){if(p.action==="prompt")return host.prompt("one",{text:p.text});if(p.action==="chat")return host.chat({conversationId:"one",text:p.text});if(p.action==="models")return host.models.list();return host.getActiveConversation();}});}};`);
  const calls:any[]=[];const engine={sessions:()=>[{id:"one",name:"Selected",workspace:root,status:"running"}],resumeSession:async()=>engine.sessions()[0],execute:async(id:string,req:any)=>{calls.push({id,...req});return req.command==="get_messages_page"?{messages:[{role:"user",content:"existing"}],start:0,end:1,total:1}:req.command==="get_state"?{model:{provider:"fixture",id:"local"}}:req.command==="get_available_models"?[{provider:"fixture",id:"local"}]:{};}} as any;
  const store=new StateStore(join(root,"state.sqlite")),events=new EventBus(store),plugins=new PluginStore(root),host=new PluginHost(plugins,events,root,engine);plugins.install(source,plugins.inspect(source).digest);
  try{await host.load();await host.attach("one");assert.equal((await host.tool("chat","chat_probe","call",{})).conversationId,"one");assert.equal((await host.tool("chat","chat_probe","call",{})).messages[0].content,"existing");await host.tool("chat","chat_probe","call",{action:"prompt",text:"not blank"});assert.equal(calls.at(-1).payload.message,"not blank");await host.tool("chat","chat_probe","call",{action:"chat",text:"steer text"});assert.equal(calls.at(-1).command,"steer");assert.equal((await host.tool("chat","chat_probe","call",{action:"models"}))[0].id,"local");}
  finally{await host.close();store.close();}
});

test("plugin HTTP and proxy are localhost-only, including GET and cross-origin requests",async()=>{
  const root=mkdtempSync(join(tmpdir(),"pi-sdk-http-")),source=join(root,"source");mkdirSync(source);
  const upstream=createServer((_req,res)=>res.end("proxy-ok"));await new Promise<void>(resolve=>upstream.listen(0,"127.0.0.1",resolve));const port=(upstream.address() as any).port;
  const wsServer=new WebSocketServer({noServer:true});upstream.on("upgrade",(request,socket,head)=>wsServer.handleUpgrade(request,socket,head,ws=>ws.on("message",data=>ws.send(data))));
  writeFileSync(join(source,"manifest.json"),JSON.stringify({id:"http",name:"HTTP fixture",version:"1.0.0",apiVersion:2,permissions:["http"]}));
  writeFileSync(join(source,"index.mjs"),`export default {activate(host){host.route("GET","/health",(_req,res)=>res.json({ok:true}));host.registerProxy("/sdk-proxy",${port});}};`);
  const plugins=new PluginStore(root);plugins.install(source,plugins.inspect(source).digest);
  const store=new StateStore(join(root,"state.sqlite")),events=new EventBus(store),notifier={status:()=>"disabled",diagnostics:()=>({}),send:async()=>({})} as any;
  const interactions=new InteractionBroker(store,events,notifier),engine={sessions:()=>[],status:()=>"stopped"} as any;
  const app=await buildServer({plugins,store,events,interactions,notifier,engine,config:{runtimeDir:root,workspaceRoot:root,webAssets:join(root,"missing"),port:3784} as any});
  try{
    assert.equal((await app.inject({url:"/plugins-api/http/health"})).json().ok,true);
    assert.equal((await app.inject({url:"/plugins-api/http/health",remoteAddress:"192.168.1.20"})).statusCode,403);
    assert.equal((await app.inject({url:"/plugins-api/http/health",headers:{origin:"http://evil.invalid"}})).statusCode,403);
    assert.equal((await app.inject({url:"/sdk-proxy/",remoteAddress:"192.168.1.20"})).statusCode,403);
    await app.listen({host:"127.0.0.1",port:0});const local=(app.server.address() as any).port;
    assert.equal(await (await fetch(`http://127.0.0.1:${local}/sdk-proxy/`)).text(),"proxy-ok");
    await new Promise<void>((resolve,reject)=>{const ws=new WebSocket(`ws://127.0.0.1:${local}/sdk-proxy/socket`);const timeout=setTimeout(()=>{ws.terminate();reject(new Error("Proxy WS timeout"));},5000);ws.on("open",()=>ws.send("proxy-ws-ok"));ws.on("message",data=>{try{assert.equal(data.toString(),"proxy-ws-ok");clearTimeout(timeout);ws.close();resolve();}catch(error){reject(error);}});ws.on("error",reject);});
  }finally{await app.close();store.close();await new Promise<void>(resolve=>upstream.close(()=>resolve()));}
});
