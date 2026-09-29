import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineManager} from '../src/engine.js';
test('thinking rejects unsupported levels and verifies the provider result', async () => {
 const engine = Object.create(EngineManager.prototype) as EngineManager;
 let selected='off'; let ignore=false;
 (engine as any).running=new Map([['test',{client:{getAvailableThinkingLevels:async()=>['off','high'],setThinkingLevel:async(level:string)=>{if(!ignore)selected=level;},getState:async()=>({thinkingLevel:selected})}}]]);
 await assert.rejects(engine.execute('test',{command:'set_thinking_level',payload:{level:'medium'}}),/supports/);
 assert.deepEqual(await engine.execute('test',{command:'set_thinking_level',payload:{level:'high'}}),{level:'high'});
 ignore=true;
 await assert.rejects(engine.execute('test',{command:'set_thinking_level',payload:{level:'off'}}),/not applied/);
});
