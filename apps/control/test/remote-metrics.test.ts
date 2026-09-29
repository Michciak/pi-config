import test from 'node:test';
import assert from 'node:assert/strict';
import metrics from '../../../extensions/remote-metrics.ts';
test('quota publishes only numeric provider data, never authentication',async()=>{
 const previous=process.env.PI_WEB_SESSION_ID;process.env.PI_WEB_SESSION_ID='test';
 const oldFetch=globalThis.fetch;const hooks:any={};let value:any;
 try {
  globalThis.fetch=async(url:any,options:any)=>{assert.equal(url,'https://openrouter.ai/api/v1/key');assert.equal(options.headers.Authorization,'Bearer test-secret');return new Response(JSON.stringify({data:{limit:10,limit_remaining:7,usage:3}}));};
  metrics({on:(name:string,handler:any)=>hooks[name]=handler,registerCommand:()=>{}} as any);
  const ctx:any={model:{provider:'openrouter'},modelRegistry:{getApiKeyForProvider:async()=> 'test-secret'},getContextUsage:()=>({tokens:100,contextWindow:1000,percent:10}),ui:{setWidget:(_key:string,rows:string[])=>value=JSON.parse(rows[0]!)}};
  await hooks.session_start({},ctx);
  assert.equal(value.quota.remaining,7);assert.equal(value.context.tokens,100);assert.ok(!JSON.stringify(value).includes('test-secret'));
  ctx.model.provider='cursor';await hooks.model_select({},ctx);assert.equal(value.quota.state,'unavailable');
 }finally{globalThis.fetch=oldFetch;if(previous===undefined)delete process.env.PI_WEB_SESSION_ID;else process.env.PI_WEB_SESSION_ID=previous;}
});
