import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../../extensions/model-router.ts';
import {selectSubagentModel,rankedModels,classify} from '../../extensions/interactive-subagents/routing.ts';
function setup() {
 const commands={},messages=[],decisions=[],notices=[];
 const api={registerCommand:(n,c)=>commands[n]=c,getActiveTools:()=>['subagent'],setModel:()=>{throw Error('Coordinator must not change')},sendUserMessage:t=>messages.push(t),appendEntry:(n,d)=>decisions.push(d)};
 router(api);
 const ctx={model:{provider:'openai-codex',id:'coordinator'},scopedModels:['one','two'].map(id=>({model:{provider:'cursor',id}})),modelRegistry:{hasConfiguredAuth:()=>true},ui:{notify:t=>notices.push(t)}};
 return {commands,ctx,messages,decisions,notices,api};
}
process.env.TMUX='/tmp/pi-routing-test,1,0';
test('route dispatches coordinator instruction exactly once without changing its model',async()=>{const x=setup();await x.commands.route.handler('--explain Napraw błąd',x.ctx);assert.equal(x.messages.length,1);assert.match(x.messages[0],/subagent tool/);assert.equal(x.decisions[0].coordinator,'openai-codex/coordinator');assert.equal(x.decisions[0].role,'coding')});
test('explain-only does not start work',async()=>{const x=setup();await x.commands.route.handler('--explain-only Porównaj źródła',x.ctx);assert.equal(x.messages.length,0);assert.equal(x.decisions[0].role,'research')});
test('missing tool reports actionable failure',async()=>{const x=setup();x.api.getActiveTools=()=>[];await x.commands.route.handler('hello',x.ctx);assert.equal(x.messages.length,0);assert.match(x.notices[0],/not active/)});
test('empty scope fails closed',()=>{const x=setup();x.ctx.scopedModels=[];assert.throws(()=>selectSubagentModel('fix',x.ctx),/No eligible/)});
test('out-of-scope explicit override rejected',()=>{const x=setup();assert.throws(()=>selectSubagentModel('fix',x.ctx,'coder','other/model'),/outside/)});
test('explicit eligible choice honored',()=>{const x=setup();assert.equal(selectSubagentModel('fix',x.ctx,'coder','cursor/two'),'cursor/two')});
test('models without auth excluded',()=>{const x=setup();x.ctx.modelRegistry.hasConfiguredAuth=()=>false;assert.deepEqual(rankedModels('fix',x.ctx),[])});
test('known unsupported spark excluded even with configured auth',()=>{const x=setup();x.ctx.scopedModels=[{model:{provider:'openai-codex',id:'gpt-5.3-codex-spark'}}];assert.deepEqual(rankedModels('hi',x.ctx),[])});
test('role uses reasoning capability before provider preference',()=>{const x=setup();x.ctx.scopedModels=[{model:{provider:'openai-codex',id:'plain'}},{model:{provider:'cursor',id:'reasoner',reasoning:true}}];assert.equal(selectSubagentModel('task',x.ctx,'planner'),'cursor/reasoner')});
test('scout uses nonzero catalog estimates, not zero subscription price',()=>{const x=setup();x.ctx.scopedModels=[{model:{provider:'cursor',id:'unknown',cost:{input:0,output:0}}},{model:{provider:'openrouter',id:'cheap',cost:{input:1,output:1}}},{model:{provider:'openrouter',id:'dear',cost:{input:5,output:5}}}];assert.equal(selectSubagentModel('task',x.ctx,'scout'),'openrouter/cheap')});
test('unknown flag cannot dispatch',async()=>{const x=setup();await x.commands.route.handler('--explain-typo hello',x.ctx);assert.equal(x.messages.length,0)});
test('dispatch error is not replayed',async()=>{const x=setup();let n=0;x.api.sendUserMessage=()=>{n++;throw Error('dispatch')};await assert.rejects(()=>x.commands.route.handler('hello',x.ctx));assert.equal(n,1)});
test('Polish classification',()=>assert.equal(classify('Zaprojektuj architekturę'),'reasoning'));
