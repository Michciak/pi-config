import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { insideWorkspace, readDocument, writeDocument, uploadFile, searchWorkspace } from "../src/cockpit-workspace.js";
import { gitActions, gitSnapshot } from "../src/git.js";
import { PluginStore } from "../src/extensions.js";
import { TerminalManager } from "../src/terminals.js";
import { applyExtensionEvent, sanitizeTerminalText } from "../src/extension-adapters.js";
import { StateStore } from "../src/store.js";
import { EventBus } from "../src/events.js";
import { InteractionBroker } from "../src/interactions.js";
import { buildServer } from "../src/server.js";

const temp = () => mkdtempSync(join(tmpdir(),"pi-cockpit-"));
test("Git treats a non-repository directory as an empty state but preserves other errors", async()=>{
  const root=temp();
  const snapshot=await gitSnapshot(root);
  assert.equal(snapshot.repository,false);
  assert.deepEqual(snapshot.files,[]);
  assert.equal(await gitActions.branches(root),"");
  assert.equal(statSync(root).isDirectory(),true);
  await assert.rejects(()=>gitSnapshot(join(root,"missing")));
  execFileSync("git",["-C",root,"init","-q"]);
  assert.equal((await gitSnapshot(root)).repository,true);
});
test("workspace content search yields to other work and never searches credentials or escaped symlinks", async () => {
  const root=temp(),outside=temp();
  writeFileSync(join(root,"notes.txt"),"first\nneedle here");
  writeFileSync(join(root,".env"),"needle private");
  writeFileSync(join(outside,"escape.txt"),"needle outside");
  symlinkSync(outside,join(root,"link"));
  let yielded=false;queueMicrotask(()=>{yielded=true;});
  const result=await searchWorkspace(root,"needle",true);
  assert.equal(yielded,true);
  assert.deepEqual(result.results.map(item=>[item.path,item.line]),[["notes.txt",2]]);
});

test("ANSI stripping retains visible text between OSC hyperlinks terminated with ST", () => {
  assert.equal(sanitizeTerminalText("before \x1b]8;;https://example.invalid\x1b\\visible\x1b]8;;\x1b\\ after"),"before visible after");
});
test("workspace rejects traversal, symlink escape, missing ETag, stale ETag, secrets and overwrite uploads", () => {
  const root=temp(),outside=temp();
  writeFileSync(join(root,"a.txt"),"original",{mode:0o755});
  symlinkSync(outside,join(root,"link"));
  assert.throws(()=>insideWorkspace(root,"../outside"));
  assert.throws(()=>insideWorkspace(root,"link"));
  const doc=readDocument(root,"a.txt",false);
  assert.throws(()=>writeDocument(root,"a.txt","new"),{statusCode:428});
  writeFileSync(join(root,"a.txt"),"external");
  assert.throws(()=>writeDocument(root,"a.txt","new",doc.etag),{statusCode:409});
  const current=readDocument(root,"a.txt",false);
  writeDocument(root,"a.txt","saved",current.etag);
  assert.equal(statSync(join(root,"a.txt")).mode&0o777,0o755);
  assert.throws(()=>writeDocument(root,".env","secret"),{statusCode:403});
  assert.throws(()=>uploadFile(root,".","a.txt",Buffer.from("overwrite").toString("base64")),{statusCode:409});
  writeFileSync(join(root,"big.txt"),Buffer.alloc(2*1024*1024+1));
  assert.throws(()=>readDocument(root,"big.txt",false),{statusCode:413});
});

test("Git handles unusual paths, renames, staging and option-like branch names without shell",async()=>{
  const root=temp();
  const git=(...args:string[])=>execFileSync("git",["-C",root,...args]);
  git("init","-q"); git("config","user.name","Test"); git("config","user.email","test@example.invalid");
  writeFileSync(join(root,"a.txt"),"one"); git("add","."); git("commit","-qm","initial");
  git("mv","a.txt","weird ; $().txt");
  const snapshot=await gitSnapshot(root);
  assert.equal(snapshot.files.length,1);
  assert.equal(snapshot.files[0].path,"weird ; $().txt");
  await assert.rejects(async()=>gitActions.switchBranch(root,"--detach"),{statusCode:400});
  await gitActions.commit(root,"rename");
  assert.equal((await gitSnapshot(root)).files.length,0);
  writeFileSync(join(root,"untracked ; $().txt"),"new content\n");
  assert.match(await gitActions.diff(root,false,"untracked ; $().txt"),/\+new content/);
});

test("plugin upgrade preserves config and rollback restores previous version",()=>{
  const runtime=temp(),source=temp(); const store=new PluginStore(runtime);
  const manifest=(version:string)=>writeFileSync(join(source,"manifest.json"),JSON.stringify({id:"demo",name:"Demo",version,permissions:["ui"]}));
  manifest("1"); const preview=store.inspect(source); store.install(source,preview.digest);
  writeFileSync(join(store.root,"demo/config.json"),'{"custom":true}');
  writeFileSync(join(store.root,"demo/storage.json"),'{"settings":{"kept":true}}');
  writeFileSync(join(store.root,"demo/secrets.bin"),"encrypted-fixture");
  manifest("2"); assert.throws(()=>store.install(source,preview.digest),{statusCode:409});
  store.install(source,store.inspect(source).digest);
  assert.equal(store.list()[0].version,"2");
  assert.equal(JSON.parse(readFileSync(join(store.root,"demo/config.json"),"utf8")).custom,true);
  assert.equal(JSON.parse(readFileSync(join(store.root,"demo/storage.json"),"utf8")).settings.kept,true);
  assert.equal(readFileSync(join(store.root,"demo/secrets.bin"),"utf8"),"encrypted-fixture");
  assert.equal(store.rollback("demo").version,"1");
  symlinkSync("/tmp",join(source,"escape"));
  assert.throws(()=>store.inspect(source),{statusCode:400});
});

test("extension snapshots survive reopening the database and remove deleted tasks",()=>{
  const root=temp(); const path=join(root,"state.sqlite");
  let store=new StateStore(path);
  const state=store.extensionUiState("test");
  assert.ok(applyExtensionEvent(state,{toolName:"todo",result:{details:{action:"list",tasks:[{id:1,subject:"Real task",status:"in_progress",activeForm:"testing"},{id:2,subject:"deleted",status:"deleted"}],nextId:3}}}));
  assert.ok(applyExtensionEvent(state,{method:"setWidget",widgetKey:"remote-integrations",widgetLines:[JSON.stringify({goal:{id:"g",text:"Ship",status:"active",tokenBudget:1000,tokensUsed:80},workflows:[{runId:"r",workflowName:"Review",status:"paused",phase:"test",agents:2,tokens:200,cost:0.01}]})]}));
  store.saveExtensionUiState("test",state);store.close();store=new StateStore(path);
  assert.equal(store.extensionUiState("test").todo.items.length,1);
  assert.equal(store.extensionUiState("test").goal.tokensUsed,80);
  assert.equal(store.extensionUiState("test").workflows[0].phase,"test");
  assert.equal(sanitizeTerminalText("\x1b[32mCursor fast\x1b[0m\x1b]0;title\x07"),"Cursor fast");
  store.close();
});

test("remote clients retain Android contracts but cannot use privileged API or unknown workspace",async()=>{
  const root=temp(),store=new StateStore(join(root,"state.sqlite")),events=new EventBus(store);
  const notifier={status:()=>"disabled",diagnostics:()=>({state:"disabled"}),send:async()=>({attempted:false})} as any;
  const interactions=new InteractionBroker(store,events,notifier);
  const engine={sessions:()=>[],status:()=>"stopped",execute:async()=>null} as any;
  const config={runtimeDir:root,workspaceRoot:root,webAssets:join(root,"missing"),port:3784,snippetsDir:root} as any;
  store.createWebToken("test","exchange",Date.now()+10000);
  const token=store.exchangeWebToken("exchange")!;
  const app=await buildServer({config,store,events,notifier,interactions,engine});
  const remote=(method:any,url:string,payload?:any)=>app.inject({method,url,payload,remoteAddress:"192.168.1.10",headers:{host:"127.0.0.1:3784",authorization:"Bearer "+token}});
  try {
    assert.equal((await remote("GET","/api/v1/status")).json().protocolVersion,2);
    assert.equal((await remote("GET","/api/v1/capabilities")).json().terminal,false);
    for(const [url,payload] of [
      ["/api/v1/terminals",{cwd:root}],["/api/v1/workspace/document",{workspace:root,path:"new.txt",content:"x"}],
      ["/api/v1/workspace/upload",{workspace:root}],["/api/v1/git/action",{workspace:root,action:"commit",message:"x"}],
      ["/api/v1/plugins/install",{source:root}],["/api/v1/sessions/test/commands",{command:"bash",payload:{command:"touch forbidden"}}],
      ["/api/v1/sessions/test/commands",{command:"reload_extensions"}],
      ["/api/v1/control/restart",{}],
    ] as const) {
      const response=await remote(url.endsWith("document")?"PUT":"POST",url,payload);
      assert.equal(response.statusCode,403,url);assert.equal(response.json().code,"LOCAL_ADMIN_REQUIRED");
    }
    assert.equal((await remote("GET","/api/v1/workspace/tree?workspace="+encodeURIComponent("/"))).statusCode,403);
    assert.equal((await app.inject({method:"GET",url:"/api/v1/terminals/x/socket",headers:{host:"127.0.0.1:3784",origin:"http://evil.invalid",upgrade:"websocket"}})).statusCode,403);
  } finally {await app.close();store.close();}
});

test("PTY create, input, resize, replay and close kill the shell",async()=>{
  const manager=new TerminalManager();
  try {
    const terminal=manager.create(temp(),"Test",80,24);
    const output:string[]=[];
    const detach=manager.attach(terminal.id,(packet:any)=>{if(packet.data)output.push(packet.data);});
    manager.resize(terminal.id,120,40);
    assert.equal(manager.list()[0].cols,120);
    manager.input(terminal.id,"printf 'PI_PTY_TEST_OK\n'\r");
    await new Promise<void>((resolve,reject)=>{let count=0;const interval=setInterval(()=>{if(output.join("").includes("PI_PTY_TEST_OK")){clearInterval(interval);resolve();}else if(++count>100){clearInterval(interval);reject(new Error("PTY output timeout"));}},30);});
    detach();manager.close(terminal.id);assert.equal(manager.list().length,0);
  } finally {manager.closeAll();}
});
