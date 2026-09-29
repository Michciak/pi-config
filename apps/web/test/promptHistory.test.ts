import test from 'node:test';
import assert from 'node:assert/strict';
import {promptHistory,historyStep} from '../src/promptHistory.js';
test('history uses user text, includes new submissions and removes duplicates', () => {
 assert.deepEqual(promptHistory([{role:'assistant',content:'no'},{role:'user',content:[{type:'text',text:'old'}]},{role:'user',content:'new'}],['new']), ['new','old']);
});
test('arrows preserve multiline editing and navigate recalled multiline prompts', () => {
 assert.equal(historyStep('ArrowUp',-1,2,'a\nb',3,3),null);
 assert.equal(historyStep('ArrowUp',-1,2,'draft',0,0),0);
 assert.equal(historyStep('ArrowUp',0,2,'a\nb',3,3),1);
 assert.equal(historyStep('ArrowUp',1,2,'a',1,1),null);
 assert.equal(historyStep('ArrowDown',0,2,'a\nb',3,3),-1);
 assert.equal(historyStep('ArrowUp',-1,0,'',0,0),null);
 assert.equal(historyStep('ArrowUp',-1,2,'select',0,3),null);
});
