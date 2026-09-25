import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../../extensions/model-router.ts';
function setup(select=async()=>true) {
 const commands={}, messages=[], decisions=[], selected=[], notices=[];
 router({registerCommand:(n,c)=>commands[n]=c, setModel:async m=>{selected.push(m.id);return select(m)}, sendUserMessage:async t=>messages.push(t), appendEntry:(n,d)=>decisions.push(d)});
 const ctx={scopedModels:['one','two','three','four'].map(id=>({model:{provider:'cursor',id}})),modelRegistry:{hasConfiguredAuth:()=>true},ui:{notify:t=>notices.push(t)}};
 return {commands,ctx,messages,decisions,selected,notices};
}
test('Polish coding request executes once after explain',async()=>{const x=setup();await x.commands.route.handler('--explain Napraw błąd i uruchom testy.',x.ctx);assert.equal(x.messages.length,1);assert.equal(x.decisions.at(-1).role,'coding')});
test('explain-only neither selects nor dispatches',async()=>{const x=setup();await x.commands.route.handler('--explain-only Porównaj źródła',x.ctx);assert.equal(x.messages.length,0);assert.equal(x.selected.length,0);assert.equal(x.decisions[0].role,'research')});
test('selection exception falls through without exposing error',async()=>{const x=setup(async m=>{if(m.id==='one')throw Error('PRIVATE');return true});await x.commands.route.handler('Napraw testy',x.ctx);assert.deepEqual(x.selected,['one','two']);assert.equal(x.messages.length,1);assert.ok(!JSON.stringify(x.decisions).includes('PRIVATE'))});
test('maximum three attempts, no task on failure',async()=>{const x=setup(async()=>false);await x.commands.route.handler('hello',x.ctx);assert.equal(x.selected.length,3);assert.equal(x.messages.length,0)});
test('empty scope never expands catalog',async()=>{const x=setup();x.ctx.scopedModels=[];await x.commands.route.handler('hello',x.ctx);assert.equal(x.selected.length,0);assert.equal(x.messages.length,0)});
test('unauthorized models never selected',async()=>{const x=setup();x.ctx.modelRegistry.hasConfiguredAuth=()=>false;await x.commands.route.handler('hello',x.ctx);assert.equal(x.selected.length,0)});
test('malformed explain option cannot execute',async()=>{const x=setup();await x.commands.route.handler('--explain-typo hello',x.ctx);assert.equal(x.messages.length,0);assert.equal(x.selected.length,0)});
test('inference dispatch error is not replayed',async()=>{const x=setup(); x.commands; router; const cmds={};let sends=0;router({registerCommand:(n,c)=>cmds[n]=c,setModel:async()=>true,appendEntry:()=>{},sendUserMessage:()=>{sends++;throw Error('dispatch failed')}});await assert.rejects(()=>cmds.route.handler('hello',x.ctx));assert.equal(sends,1)});
