import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';
export default function(pi:ExtensionAPI) {
 let last=0; let quota:any={state:'unavailable'}; let provider='';
 async function publish(ctx:ExtensionContext, force=false) {
  if(!process.env.PI_WEB_SESSION_ID) return;
  const current=ctx.model?.provider ?? '';
  if(current!==provider){provider=current;last=0;quota={state:'unavailable',provider};}
  if(current==='openrouter' && (force || Date.now()-last>60000)) {
   last=Date.now();
   try {
    const key=await ctx.modelRegistry.getApiKeyForProvider('openrouter');
    if(!key) throw new Error('unavailable');
    const response=await fetch('https://openrouter.ai/api/v1/key',{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(8000)});
    if(!response.ok) throw new Error('unavailable');
    const {data}=await response.json() as any;
    if(provider!==current)return;
    quota={state:'available',provider:current,remaining:data.limit_remaining,limit:data.limit,used:data.usage,reset:data.limit_reset,checkedAt:new Date().toISOString()};
   }catch{if(provider!==current)return;quota={state:'error',provider:current};}
  }
  ctx.ui.setWidget('remote-metrics',[JSON.stringify({context:ctx.getContextUsage(),quota})]);
 }
 pi.on('session_start',async(_e,ctx)=>publish(ctx));
 pi.on('agent_end',async(_e,ctx)=>publish(ctx));
 pi.on('model_select',async(_e,ctx)=>publish(ctx));
 pi.registerCommand('quota',{description:'Odśwież quota providera i kontekst',handler:async(_args,ctx)=>publish(ctx,true)});
}
