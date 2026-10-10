import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineManager, awaitStartupState} from '../src/engine.js';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('persisted child rows cannot make a stopped session appear running',()=>{
 const engine=Object.create(EngineManager.prototype) as any;
 engine.running=new Map();engine.store={sessions:()=>[{id:'old',status:'idle'}],db:{prepare:()=>({all:()=>[{session_id:'old'}]})}};
 assert.equal(engine.sessions()[0].status,'idle');
 engine.running.set('old',{});assert.equal(engine.sessions()[0].status,'running');
});

test('concurrent resumes share one launch and failure permits an explicit retry', async () => {
  const engine = Object.create(EngineManager.prototype) as any;
  engine.launching = new Map();
  let calls = 0;
  let finish!: () => void;
  engine.launchProcess = () => { calls++; return new Promise<void>(resolve => { finish = resolve; }); };
  const first = engine.launch({id:'one'});
  const second = engine.launch({id:'one'});
  assert.equal(first, second);
  assert.equal(calls, 1);
  finish(); await first;
  assert.equal(engine.launching.size, 0);
  engine.launchProcess = async () => { throw new Error('failed'); };
  await assert.rejects(engine.launch({id:'one'}), /failed/);
  assert.equal(engine.launching.size, 0);
});

test('edit and reask forks a copy and never changes the original session file',async()=>{
  const root=mkdtempSync(join(tmpdir(),'pi-reask-')),source=join(root,'original.jsonl');writeFileSync(source,'original transcript');
  const engine=Object.create(EngineManager.prototype) as any,calls:any[]=[];
  engine.config={sessionsDir:root};engine.running=new Map([['original',{summary:{name:'Original',workspace:root},client:{getState:async()=>({sessionFile:source,isStreaming:false,pendingMessageCount:0}),getForkMessages:async()=>[{entryId:'user-entry'}]}}]]);
  engine.resolveOwnedSession=()=>source;engine.createSession=async(input:any)=>{assert.notEqual(input.sessionPath,source);assert.equal(readFileSync(input.sessionPath,'utf8'),'original transcript');return {id:'fork'};};engine.execute=async(id:string,command:any)=>{calls.push({id,...command});return {};};engine.store={session:()=>({id:'fork'})};
  assert.equal((await engine.reask('original','user-entry','edited')).id,'fork');assert.equal(readFileSync(source,'utf8'),'original transcript');assert.deepEqual(calls,[{id:'fork',command:'fork',payload:{entryId:'user-entry'}},{id:'fork',command:'prompt',payload:{message:'edited'}}]);
  await assert.rejects(engine.reask('original','missing','edited'),{statusCode:404});
});

test('startup retries only a timed-out readiness read', async () => {
  let calls = 0;
  const state = await awaitStartupState(async () => {
    calls++;
    if (calls < 3) throw new Error('Timeout waiting for response to get_state');
    return {sessionFile:'session.jsonl'};
  });
  assert.equal(calls, 3);
  assert.equal(state.sessionFile, 'session.jsonl');
  await assert.rejects(awaitStartupState(async () => { throw new Error('Agent process exited'); }), /exited/);
});
