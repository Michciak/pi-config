// Verify the production entry point, not merely in-process server fixtures.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync,statSync} from "node:fs";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";

const release=resolve(process.argv[2]||join(import.meta.dirname,"../.releases/latest"));
const runtime=mkdtempSync(join(tmpdir(),"pi-startup-smoke-"));
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,"127.0.0.1",resolve));
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const env={...process.env,PI_WEB_RUNTIME_DIR:runtime,PI_WEB_WORKSPACE_ROOT:runtime,
  PI_WEB_HOST:"127.0.0.1",PI_WEB_PORT:String(port),PI_WEB_ASSETS:join(release,"apps/web/dist"),
  PI_WEB_FIREBASE_KEYCHAIN_SERVICE:"pi-remote-nonexistent-test-key",PI_WEB_LOG_LEVEL:"error"};
const children=[];
function start(){const child=spawn(process.execPath,[join(release,"apps/control/dist/index.js")],{env,stdio:["ignore","pipe","pipe"]});children.push(child);child.output="";child.stdout.on("data",data=>child.output+=data);child.stderr.on("data",data=>child.output+=data);child.done=new Promise(resolve=>child.once("exit",(code,signal)=>resolve({code,signal})));return child;}
async function ready(child){const deadline=Date.now()+15000;while(Date.now()<deadline){if(child.exitCode!==null)throw Error(child.output);try{const response=await fetch(`http://127.0.0.1:${port}/api/v1/status`,{signal:AbortSignal.timeout(1000)});if(response.ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}throw Error("Startup timeout: "+child.output);}
async function stop(child){if(child.exitCode!==null)return;child.kill("SIGTERM");await Promise.race([child.done,new Promise((_,reject)=>setTimeout(()=>reject(Error("Shutdown timeout")),5000).unref())]);}
let db;
try{
  const first=start();await ready(first);
  db=new DatabaseSync(join(runtime,"state.sqlite"));db.exec("PRAGMA busy_timeout=5000");
  db.prepare("INSERT INTO sessions(id,name,workspace,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("fixture","Idle fixture",runtime,"idle","before","before");
  const inode=statSync(join(runtime,"interactions.sock")).ino;
  const duplicate=start();const result=await duplicate.done;
  assert.equal(result.code,1);assert.match(duplicate.output,/ELOCKED/);
  assert.equal(db.prepare("SELECT status FROM sessions WHERE id='fixture'").get().status,"idle");
  assert.equal(statSync(join(runtime,"interactions.sock")).ino,inode);
  await stop(first);
  const restarted=start();await ready(restarted);
  assert.equal(db.prepare("SELECT status FROM sessions WHERE id='fixture'").get().status,"interrupted");
  await stop(restarted);
  console.log(JSON.stringify({ok:true,duplicateInstanceDenied:true,databaseUntouchedByDuplicate:true,unixSocketUntouched:true,explicitRestartRecovery:true}));
}finally{for(const child of children)if(child.exitCode===null)child.kill("SIGKILL");db?.close();}
