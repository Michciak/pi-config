// Isolated Pi RPC regression: never makes a model request or touches live sessions.
import {RpcClient} from "@earendil-works/pi-coding-agent";
import {mkdtempSync,mkdirSync,writeFileSync,readlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve,join} from "node:path";
import assert from "node:assert/strict";
const repo=resolve(import.meta.dirname,"..");
const release=process.argv[2]??join(repo,".releases",readlinkSync(join(repo,".releases/latest")));
const root=mkdtempSync(join(tmpdir(),"pi-completion-smoke-")),agent=join(root,"agent");mkdirSync(agent);
writeFileSync(join(agent,"settings.json"),JSON.stringify({extensions:[join(repo,"tests/fixtures/native-completion.ts")],packages:[]}));
const client=new RpcClient({cliPath:join(release,"node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),cwd:root,env:{PI_CODING_AGENT_DIR:agent}});
try {
  await client.start();
  const complete=(name,prefix)=>client.send({type:"get_completions",name,prefix});
  assert.deepEqual((await complete("completion-fixture","exact prefix")).data.items,[{value:"native-exact prefix",label:"Native exact prefix",description:"Same extension callback as TUI"}]);
  assert.deepEqual((await complete("null-fixture","")).data.items,[]);
  assert.deepEqual((await complete("unknown","")).data.items,[]);
  assert.equal((await complete("throw-fixture","")).success,false);
  assert.equal((await complete("slow-fixture","")).success,false);
  assert.equal((await complete("completion-fixture","x".repeat(2049))).success,false);
  assert.ok((await complete("thinking","")).data.items.length>0);
  assert.equal((await complete("model","")).success,true);
  assert.equal((await client.send({type:"reload_extensions"})).success,true);
  assert.ok((await client.getCommands()).some(c=>c.name==="completion-fixture"));
  assert.equal((await client.getMessages()).length,0);
  console.log(JSON.stringify({ok:true,release,nativeCallbacks:true,timeoutAndErrors:true,reload:true,modelRequests:0}));
} finally {await client.stop();}
