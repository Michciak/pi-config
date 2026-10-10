// Exercise the deployed service over its non-loopback LAN address with ephemeral auth.
import {networkInterfaces,homedir,tmpdir} from "node:os";
import {mkdtempSync} from "node:fs";
import {join} from "node:path";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import assert from "node:assert/strict";
const address=Object.values(networkInterfaces()).flat().find(item=>item&&!item.internal&&item.family==="IPv4")?.address;
if(!address)throw new Error("No LAN IPv4 interface available; use contract tests instead");
// Diagnostics must not instantiate server lifecycle objects or run migrations.
const runtime=join(homedir(),".pi/agent/web-control"),db=new DatabaseSync(join(runtime,"state.sqlite"));
db.exec("PRAGMA busy_timeout=5000");
const hash=value=>createHash("sha256").update(value).digest("hex");
const raw=randomBytes(32).toString("base64url"),token=randomBytes(32).toString("base64url"),device="postdeploy-smoke-"+randomUUID();
const before=db.prepare("SELECT id,status,updated_at FROM sessions ORDER BY id").all();
const pendingBefore=db.prepare("SELECT id,status FROM questions WHERE status='pending' ORDER BY id").all();
const directory=mkdtempSync(join(tmpdir(),"pi-remote-denied-"));
db.prepare("INSERT INTO web_tokens(token_hash,device_id,expires_at,exchanged_at,session_hash,session_expires_at) VALUES(?,?,?,?,?,?)").run(hash(raw),device,Date.now()+60000,Date.now(),hash(token),Date.now()+60000);
const request=async(method,path,body)=>{const response=await fetch(`http://${address}:3784/api/v1${path}`,{method,headers:{authorization:"Bearer "+token,"content-type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};};
try{
  const caps=await request("GET","/capabilities");assert.equal(caps.status,200);assert.equal(caps.data.localAdmin,false);assert.equal(caps.data.terminal,false);
  const status=await request("GET","/status");const session=status.data.sessions.find(item=>item.status==="idle");
  const probes=[["POST","/terminals",{cwd:directory}],["PUT","/workspace/document",{workspace:directory,path:"denied.txt",content:"probe"}],["POST","/workspace/upload",{workspace:directory,name:"denied.txt",base64:"eA=="}],["POST","/git/action",{workspace:directory,action:"commit",message:"denied probe"}],["POST","/plugins/install",{source:directory}],["PUT","/providers",{providers:{}}]];
  probes.push(["POST","/control/restart",{}]);
  if(session){probes.push(["POST",`/sessions/${session.id}/commands`,{command:"bash",payload:{command:":"}}]);probes.push(["POST",`/sessions/${session.id}/commands`,{command:"reload_extensions"}]);}
  for(const [method,path,body] of probes){const result=await request(method,path,body);if(path==="/terminals"&&result.status===200&&result.data.id)await fetch(`http://127.0.0.1:3784/api/v1/terminals/${result.data.id}`,{method:"DELETE"});assert.equal(result.status,403,path);assert.equal(result.data.code,"LOCAL_ADMIN_REQUIRED",path);}
  console.log(JSON.stringify({ok:true,authenticatedLanClient:true,privilegedProbesDenied:probes.length,protocolVersion:status.data.protocolVersion}));
}finally{
  db.prepare("DELETE FROM web_tokens WHERE token_hash=? AND device_id=?").run(hash(raw),device);
  // This smoke sends no agent prompts and must leave lifecycle state untouched.
  try{
    assert.deepEqual(db.prepare("SELECT id,status,updated_at FROM sessions ORDER BY id").all(),before);
    assert.deepEqual(db.prepare("SELECT id,status FROM questions WHERE status='pending' ORDER BY id").all(),pendingBefore);
  }finally{db.close();}
}
