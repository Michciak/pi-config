import test from 'node:test';
import assert from 'node:assert/strict';
import {EngineManager} from '../src/engine.js';

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
