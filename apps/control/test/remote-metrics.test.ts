import test from 'node:test';
import assert from 'node:assert/strict';
import metrics from '../../../extensions/remote-metrics.ts';

function fakeJwt(plan: string): string {
  const enc = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({alg:'RS256',typ:'JWT'})}.${enc({'https://api.openai.com/auth':{chatgpt_plan_type:plan}})}.sig`;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body));
}

async function runQuota(provider: string, registry: any, fetchImpl: (url: any, options: any) => Promise<Response>,hook?:string) {
  const previousEnv = process.env.PI_WEB_SESSION_ID;
  process.env.PI_WEB_SESSION_ID = 'test';
  const oldFetch = globalThis.fetch;
  const hooks: any = {};
  const commands: any = {};
  let value: any;
  let notified = '';
  try {
    globalThis.fetch = fetchImpl as any;
    metrics({on:(name:string,handler:any)=>hooks[name]=handler,registerCommand:(name:string,def:any)=>commands[name]=def} as any);
    const ctx:any = {
      model:{provider},
      modelRegistry:registry,
      getContextUsage:()=>({tokens:100,contextWindow:1000,percent:10}),
      ui:{
        setWidget:(_key:string,rows:string[])=>value=JSON.parse(rows[0]!),
        notify:(message:string)=>{notified=message;},
      },
    };
    if(hook)await hooks[hook]({type:hook},ctx);
    else await commands.quota.handler('',ctx);
    return {value, notified};
  } finally {
    await hooks.session_shutdown?.();
    globalThis.fetch = oldFetch;
    if (previousEnv === undefined) delete process.env.PI_WEB_SESSION_ID;
    else process.env.PI_WEB_SESSION_ID = previousEnv;
  }
}

test('pasywne hooki używają kontekstu Pi i publikują quota bez komendy',async()=>{
  for(const hook of ['session_start','agent_end','turn_end','model_select']){
    const {value,notified}=await runQuota('openrouter',{getApiKeyForProvider:async()=> 'secret'},async()=>jsonResponse({data:{limit:10,limit_remaining:6,usage:4}}),hook);
    assert.equal(value.quota.remaining,6,hook);assert.equal(value.context.tokens,100,hook);assert.equal(notified,'');
    assert.ok(!JSON.stringify(value).includes('secret'));
  }
});

test('quota odświeża się podczas bezczynności i zatrzymuje timer po zamknięciu',async(t)=>{
  const previousEnv=process.env.PI_WEB_SESSION_ID;process.env.PI_WEB_SESSION_ID='test';
  const hooks:any={};const snapshots:any[]=[];
  t.mock.timers.enable({apis:['setInterval','Date'],now:100000});
  try{
    metrics({on:(name:string,handler:any)=>hooks[name]=handler,registerCommand:()=>{}} as any);
    const ctx:any={model:{provider:'cursor'},modelRegistry:{getProviderAuthStatus:()=>({configured:true})},getContextUsage:()=>({tokens:50}),ui:{setWidget:(_key:string,rows:string[])=>snapshots.push(JSON.parse(rows[0]!)),notify:()=>assert.fail('Idle refresh must not notify')}};
    await hooks.session_start({type:'session_start'},ctx);
    const first=snapshots[0].quota.checkedAt;
    t.mock.timers.tick(65000);for(let i=0;i<12;i++)await Promise.resolve();
    assert.equal(snapshots.length,2);assert.notEqual(snapshots[1].quota.checkedAt,first);
    await hooks.session_shutdown({type:'session_shutdown'},ctx);
    t.mock.timers.tick(65000);for(let i=0;i<12;i++)await Promise.resolve();assert.equal(snapshots.length,2);
  }finally{await hooks.session_shutdown?.();t.mock.timers.reset();if(previousEnv===undefined)delete process.env.PI_WEB_SESSION_ID;else process.env.PI_WEB_SESSION_ID=previousEnv;}
});

test('openrouter publikuje liczby i nigdy sekrety', async () => {
  const {value, notified} = await runQuota('openrouter',
    {getApiKeyForProvider:async()=> 'test-secret'},
    async (url:any,options:any)=>{
      assert.equal(url,'https://openrouter.ai/api/v1/key');
      assert.equal(options.headers.Authorization,'Bearer test-secret');
      return jsonResponse({data:{limit:10,limit_remaining:7,usage:3}});
    });
  assert.equal(value.quota.state,'available');
  assert.equal(value.quota.remaining,7);
  assert.equal(value.quota.limit,10);
  assert.equal(value.quota.used,3);
  assert.equal(value.context.tokens,100);
  assert.ok(!JSON.stringify(value).includes('test-secret'));
  assert.match(notified, /\$7\.00/);
});

test('openrouter bez klucza zgłasza no-auth', async () => {
  const {value} = await runQuota('openrouter',
    {getApiKeyForProvider:async()=> undefined},
    async () => { throw new Error('fetch nie powinien być wołany'); });
  assert.equal(value.quota.state,'no-auth');
});

test('opencode-go publikuje limity zen', async () => {
  const {value, notified} = await runQuota('opencode-go',
    {getApiKeyForProvider:async()=> 'oc_sk_test'},
    async (url:any)=>{
      assert.equal(url,'https://opencode.ai/zen/go/v1/usage');
      return jsonResponse({usage:{
        rolling:{status:'ok',percent:12,resetsAt:'2026-09-30T12:00:00.000Z'},
        weekly:{status:'ok',percent:3,resetsAt:'2026-10-05T00:00:00.000Z'},
        monthly:{status:'ok',percent:1,resetsAt:'2026-10-30T00:00:00.000Z'},
      }});
    });
  assert.equal(value.quota.state,'available');
  assert.equal(value.quota.buckets.rolling.percent,12);
  assert.equal(value.quota.buckets.monthly.resetsAt,'2026-10-30T00:00:00.000Z');
  assert.ok(!JSON.stringify(value).includes('oc_sk_test'));
  assert.match(notified, /rolling 12%/);
});

test('openai-codex pokazuje plan z JWT bez wołania sieci', async () => {
  const jwt = fakeJwt('plus');
  const {value, notified} = await runQuota('openai-codex',
    {getProviderAuth:async()=>({auth:{apiKey:jwt}}), getApiKeyForProvider:async()=>jwt},
    async () => { throw new Error('fetch nie powinien być wołany'); });
  assert.equal(value.quota.state,'subscription');
  assert.equal(value.quota.plan,'ChatGPT Plus');
  assert.ok(!JSON.stringify(value).includes(jwt.slice(0,20)));
  assert.match(notified, /ChatGPT Plus/);
});

test('github-copilot weryfikuje token i pokazuje tier z sku', async () => {
  const token = 'tid=abc123;exp=1790837219;sku=copilot_pro';
  const {value, notified} = await runQuota('github-copilot',
    {getProviderAuth:async()=>({auth:{apiKey:token}})},
    async (url:any,options:any)=>{
      assert.equal(url,'https://api.githubcopilot.com/models');
      assert.equal(options.headers.Authorization,`Bearer ${token}`);
      return jsonResponse({data:[]});
    });
  assert.equal(value.quota.state,'subscription');
  assert.equal(value.quota.plan,'Copilot Pro');
  assert.ok(!JSON.stringify(value).includes('abc123'));
  assert.match(notified, /Copilot Pro/);
});

test('openai weryfikuje klucz (PAYG, brak endpointu quota)', async () => {
  const {value, notified} = await runQuota('openai',
    {getApiKeyForProvider:async()=> 'sk-test'},
    async (url:any)=>{
      assert.equal(url,'https://api.openai.com/v1/models');
      return jsonResponse({data:[]});
    });
  assert.equal(value.quota.state,'key-ok');
  assert.match(notified, /klucz działa/);
});

test('cursor raportuje subskrypcję z podpowiedzią dashboardu', async () => {
  const {value, notified} = await runQuota('cursor',
    {getProviderAuthStatus:()=>({configured:true})},
    async () => { throw new Error('fetch nie powinien być wołany'); });
  assert.equal(value.quota.state,'subscription');
  assert.match(notified, /cursor\.com/);
});

test('nieznany provider bez autoryzacji zgłasza no-auth', async () => {
  const {value} = await runQuota('ollama',
    {getProviderAuthStatus:()=>({configured:false})},
    async () => { throw new Error('fetch nie powinien być wołany'); });
  assert.equal(value.quota.state,'no-auth');
});

test('nieznany provider z autoryzacją zgłasza unavailable', async () => {
  const {value} = await runQuota('ollama',
    {getProviderAuthStatus:()=>({configured:true})},
    async () => { throw new Error('fetch nie powinien być wołany'); });
  assert.equal(value.quota.state,'unavailable');
});

test('/quota działa w CLI bez sesji webowej (fetch + notify, bez widgetu)', async () => {
  const previousEnv = process.env.PI_WEB_SESSION_ID;
  delete process.env.PI_WEB_SESSION_ID;
  const oldFetch = globalThis.fetch;
  const commands: any = {};
  let widgets = 0;
  let notified = '';
  try {
    globalThis.fetch = (async (url: any) => {
      assert.equal(url,'https://opencode.ai/zen/go/v1/usage');
      return jsonResponse({usage:{rolling:{status:'ok',percent:5}}});
    }) as any;
    metrics({on:()=>{},registerCommand:(name:string,def:any)=>commands[name]=def} as any);
    await commands.quota.handler('',{
      model:{provider:'opencode-go'},
      modelRegistry:{getApiKeyForProvider:async()=> 'oc_sk_test'},
      getContextUsage:()=>undefined,
      ui:{setWidget:()=>{widgets++;}, notify:(message:string)=>{notified=message;}},
    });
    assert.equal(widgets,0);
    assert.match(notified, /rolling 5%/);
  } finally {
    globalThis.fetch = oldFetch;
    if (previousEnv !== undefined) process.env.PI_WEB_SESSION_ID = previousEnv;
  }
});

test('openrouter bez limitu pokazuje rosnące użycie', async () => {
  const {value, notified} = await runQuota('openrouter',
    {getApiKeyForProvider:async()=> 'test-secret'},
    async () => jsonResponse({data:{limit:null,limit_remaining:null,usage:3.5}}));
  assert.equal(value.quota.state,'available');
  assert.equal(value.quota.remaining,null);
  assert.equal(value.quota.used,3.5);
  assert.match(notified, /użyto \$3\.50/);
});

test('nagłówki odpowiedzi API zasilają quota bez dodatkowych requestów', async () => {
  const previousEnv = process.env.PI_WEB_SESSION_ID;
  process.env.PI_WEB_SESSION_ID = 'test';
  const oldFetch = globalThis.fetch;
  const hooks: any = {};
  let value: any;
  let fetchCalls = 0;
  try {
    globalThis.fetch = (async () => { fetchCalls++; throw new Error('sieć niepotrzebna'); }) as any;
    metrics({on:(name:string,handler:any)=>hooks[name]=handler,registerCommand:()=>{}} as any);
    const ctx:any = {
      model:{provider:'openai'},
      modelRegistry:{getProviderAuthStatus:()=>({configured:true}), getApiKeyForProvider:async()=>undefined},
      getContextUsage:()=>undefined,
      ui:{setWidget:(_key:string,rows:string[])=>value=JSON.parse(rows[0]!), notify:()=>{}},
    };
    await hooks.after_provider_response({type:'after_provider_response',status:200,headers:{
      'x-ratelimit-remaining-requests':'97','x-ratelimit-limit-requests':'100',
      'x-ratelimit-reset-requests':'6m0s','content-type':'application/json',
    }},ctx);
    assert.equal(value.quota.rate.remainingRequests,97);
    assert.equal(value.quota.rate.resetRequests,'6m0s');
    assert.ok(!('content-type' in (value.quota.rate.raw ?? {})));
    assert.ok(!JSON.stringify(value).includes('test-secret'));
  } finally {
    globalThis.fetch = oldFetch;
    if (previousEnv === undefined) delete process.env.PI_WEB_SESSION_ID;
    else process.env.PI_WEB_SESSION_ID = previousEnv;
  }
});

test('opencode-go z niezerowym użyciem pokazuje limity Go', async () => {
  const {value, notified} = await runQuota('opencode-go',
    {getApiKeyForProvider:async()=> 'oc_sk_test'},
    async () => jsonResponse({usage:{rolling:{status:'ok',percent:1},weekly:{status:'ok',percent:0}}}));
  assert.equal(value.quota.state,'available');
  assert.equal(value.quota.buckets.rolling.percent,1);
  assert.match(notified, /Go \(opencode-go\): zużycie rolling 1%/);
  assert.ok(!JSON.stringify(value).includes('oc_sk_test'));
});

test('opencode-go same zera traktuje jako brak sygnału (odesłanie do konsoli)', async () => {
  const {value, notified} = await runQuota('opencode-go',
    {getApiKeyForProvider:async()=> 'oc_sk_test'},
    async () => jsonResponse({usage:{
      rolling:{status:'ok',percent:0},weekly:{status:'ok',percent:0},monthly:{status:'ok',percent:0}}}));
  assert.equal(value.quota.state,'key-ok');
  assert.match(notified, /konsoli opencode\.ai/);
});
