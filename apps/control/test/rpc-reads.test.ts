import test from "node:test";
import assert from "node:assert/strict";
import {sharedRpcRead,rpcTimeoutError} from "../src/rpc-reads.js";
import {mkdtempSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {buildServer} from "../src/server.js";
import {StateStore} from "../src/store.js";
import {EventBus} from "../src/events.js";
import {InteractionBroker} from "../src/interactions.js";
test("simultaneous identical reads share RPC without caching state or sharing across clients",async()=>{
 const client={},other={};let calls=0,resolve!:(value:number)=>void;
 const read=()=>{calls++;return new Promise<number>(r=>resolve=r);};
 const first=sharedRpcRead(client,"state",read),second=sharedRpcRead(client,"state",read);
 assert.equal(first,second);await Promise.resolve();assert.equal(calls,1);resolve(1);await first;
 const next=sharedRpcRead(client,"state",async()=>2);assert.equal(await next,2);
 assert.equal(await sharedRpcRead(other,"state",async()=>3),3);
 await assert.rejects(sharedRpcRead(client,"bad",async()=>{throw Error("failure");}));
 assert.equal(await sharedRpcRead(client,"bad",async()=>4),4);
});
test("HTTP exposes safe timeout codes but keeps unrelated failures generic",async()=>{
 const root=mkdtempSync(join(tmpdir(),"pi-rpc-http-")),store=new StateStore(":memory:"),events=new EventBus(store);
 const notifier={status:()=>"disabled",diagnostics:()=>({}),send:async()=>({})} as any;
 const interactions=new InteractionBroker(store,events,notifier);
 let failure:any=rpcTimeoutError(new Error("Timeout waiting for response to get_state. Stderr: private-value"));
 const engine={sessions:()=>[],status:()=>"running",execute:async()=>{throw failure;}} as any;
 const config={runtimeDir:root,workspaceRoot:root,webAssets:join(root,"missing"),port:3784,snippetsDir:root} as any;
 const app=await buildServer({config,store,events,notifier,interactions,engine});
 const request=()=>app.inject({method:"POST",url:"/api/v1/sessions/fixture/commands",headers:{host:"127.0.0.1:3784"},payload:{command:"get_state"}});
 try {
  const timeout=await request();assert.equal(timeout.statusCode,504);assert.equal(timeout.json().code,"PI_RPC_TIMEOUT");
  assert.match(timeout.json().error,/30 sekund/);assert.equal(timeout.body.includes("private-value"),false);
  failure=new Error("private-value");const internal=await request();assert.equal(internal.statusCode,500);assert.equal(internal.json().error,"Internal server error");
 } finally {await app.close();store.close();}
});
test("RPC timeout mapping is safe and leaves unrelated errors private",()=>{
 const error=rpcTimeoutError(new Error("Timeout waiting for response to get_messages. Stderr: token=secret")) as any;
 assert.equal(error.statusCode,504);assert.equal(error.code,"PI_RPC_TIMEOUT");assert.equal(error.message.includes("secret"),false);
 const other=new Error("private failure");assert.equal(rpcTimeoutError(other),other);
 const mutation=rpcTimeoutError(new Error("Timeout waiting for response to prompt"),false) as any;
 assert.equal(mutation.code,"PI_RPC_MUTATION_TIMEOUT");assert.match(mutation.message,/mogła już zostać wykonana/);
});
