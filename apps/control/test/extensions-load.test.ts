import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync,cpSync,mkdtempSync,writeFileSync,symlinkSync,rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir,tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import {patchAcpRemote} from "../../../scripts/acp-remote-patch.mjs";
import {patchTodoRemote} from "../../../scripts/todo-remote-patch.mjs";

test("Pi loader accepts patched native ACP and TODO copies before installation",async()=>{
 const agent=join(homedir(),".pi/agent/npm/node_modules"),root=mkdtempSync(join(tmpdir(),"pi-remote-patch-load-"));
 const runtime=dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
 const {loadExtensions}=await import(pathToFileURL(join(runtime,"core/extensions/loader.js")).href);
 try {
  symlinkSync(agent,join(root,"node_modules"));
  const acp=join(root,"acp"),todo=join(root,"todo");
  cpSync(join(agent,"billion-context"),acp,{recursive:true});cpSync(join(agent,"@juicesharp/rpiv-todo"),todo,{recursive:true});
  const native=join(acp,"dist/agent/pi-native.js");writeFileSync(native,patchAcpRemote(readFileSync(native,"utf8")));
  const patched=patchTodoRemote(readFileSync(join(todo,"todo.ts"),"utf8"),readFileSync(join(todo,"state/replay.ts"),"utf8"));
  writeFileSync(join(todo,"todo.ts"),patched.source);writeFileSync(join(todo,"state/replay.ts"),patched.replay);
  const result=await loadExtensions([native,join(todo,"index.ts")],root);
  assert.deepEqual(result.errors,[]);assert.equal(result.extensions.length,2);
  const previous=process.env.PI_WEB_SESSION_ID;process.env.PI_WEB_SESSION_ID="isolated-todo-fixture";
  try {
   const entries:any[]=[];result.runtime.appendEntry=(customType:string,data:any)=>entries.push({type:"custom",customType,data});
   const context={hasUI:false,sessionManager:{getSessionId:()=>"isolated-todo-fixture",getBranch:()=>entries},ui:{notify(){}}};
   const extension=result.extensions[1],execute=extension.tools.get("todo").definition.execute;
   const created=await execute("fixture",{action:"create",subject:"Fixture only"},undefined,undefined,context);
   assert.equal(created.details.tasks.length,1);
   entries.push({type:"message",message:{role:"toolResult",toolName:"todo",details:created.details}});
   await extension.commands.get("todos").handler("clear",context);
   assert.equal(entries.at(-1).customType,"remote-todo-state");
   for(const handler of extension.handlers.get("session_start")??[])await handler({},context);
   const restored=await execute("list",{action:"list"},undefined,undefined,context);
   assert.equal(restored.details.tasks.length,0);assert.equal(restored.details.nextId,1);
  } finally {if(previous===undefined)delete process.env.PI_WEB_SESSION_ID;else process.env.PI_WEB_SESSION_ID=previous;}
 } finally {rmSync(root,{recursive:true,force:true});}
});

test("Pi 1.0 loader accepts installed extensions and repository cockpit bridge",async()=>{
  const agent=join(homedir(),".pi/agent/npm/node_modules");
  const names=["pi-cursor-sdk","pi-better-edit","billion-context","@juicesharp/rpiv-todo","@schovest/pi-goal","pi-simplify","@quintinshaw/pi-dynamic-workflows"];
  const paths=[resolve(import.meta.dirname,"../../../extensions/remote-integrations.ts")];
  for(const name of names){const root=join(agent,name);if(!existsSync(join(root,"package.json")))continue;const manifest=JSON.parse(readFileSync(join(root,"package.json"),"utf8"));for(const entry of manifest.pi?.extensions??[])paths.push(resolve(root,entry));}
  const runtime=dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
  const {loadExtensions}=await import(pathToFileURL(join(runtime,"core/extensions/loader.js")).href);
  const result=await loadExtensions(paths,resolve(import.meta.dirname,"../../.."));
  assert.deepEqual(result.errors,[]);
  assert.equal(result.extensions.length,paths.length);
});
