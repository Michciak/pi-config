// No model requests: exercise real installed commands and bridge snapshots in isolation.
import {RpcClient} from "@earendil-works/pi-coding-agent";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,cpSync,existsSync} from "node:fs";
import {join,dirname,resolve} from "node:path";
import {homedir,tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import assert from "node:assert/strict";

const repo=resolve(import.meta.dirname,"..");
const root=mkdtempSync(join(tmpdir(),"pi-runtime-smoke-"));
const agent=join(root,"agent");mkdirSync(agent,{mode:0o700});
const installed=join(homedir(),".pi/agent");
const settings=JSON.parse(readFileSync(join(installed,"settings.json"),"utf8"));
settings.packages=settings.packages.map(source=>source.startsWith("npm:")?join(installed,"npm/node_modules",source.slice(4)):source);
settings.extensions=[...(settings.extensions??[]),join(repo,"extensions/remote-integrations.ts")];
writeFileSync(join(agent,"settings.json"),JSON.stringify(settings),{mode:0o600});
for(const name of ["auth.json","models.json"])if(existsSync(join(installed,name)))cpSync(join(installed,name),join(agent,name));
const cliPath=join(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))),"cli.js");
const client=new RpcClient({cliPath,cwd:root,args:["--session-dir",join(root,"sessions")],env:{PI_CODING_AGENT_DIR:agent,PI_WEB_SESSION_ID:"smoke",PI_WEB_RUNTIME_DIR:root}});
const snapshots=[];
client.onEvent(event=>{if(event.type==="extension_ui_request"&&event.widgetKey==="remote-integrations")snapshots.push(event);});
try{
  await client.start();
  const state=await client.getState();
  const commands=await client.getCommands();
  const names=commands.map(item=>item.name);
  for(const name of ["goal","todos","workflows","simplify","acp","acp-cache","acp-rule"])assert.ok(names.includes(name),"Missing command "+name);
  await client.prompt("/goal status");
  await client.prompt("/todos");
  await client.prompt("/acp-cache");
  await client.getMessages();
  assert.ok(snapshots.length>0,"Bridge snapshot missing");
  await client.setAutoCompaction(false);
  assert.equal((await client.getState()).autoCompactionEnabled,false);
  console.log(JSON.stringify({ok:true,commandCount:names.length,commands:names,bridgeSnapshots:snapshots.length,sessionFile:state.sessionFile,privateTestDirectory:root},null,2));
}finally{await client.stop();}
