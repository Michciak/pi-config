import {readFileSync,writeFileSync,renameSync} from "node:fs";
import {dirname,join} from "node:path";
import {homedir} from "node:os";
import {randomUUID} from "node:crypto";
import type {PluginManifest} from "@pi-local/protocol";
import type {EngineManager} from "./engine.js";
import type {EventBus} from "./events.js";
import {PluginStore} from "./extensions.js";
import {PluginManager} from "./vendor/pi-web-ui/plugins.js";
import {completeWithIsolatedSession} from "./vendor/pi-web-ui/plugin-llm.js";

type GrantRequest={id:string;pluginId:string;kind:"path"|"permission";request:any;createdAt:string};
/** Adapter for the complete MIT 0.97 SDK. No second server or persistent agent runtime. */
export class PluginHost {
  readonly manager:any;
  private pending=new Map<string,{value:GrantRequest;finish(value:any):void}>();
  private active?:string;
  private snapshot:any=null;
  private llmCalls=new Set<AbortController>();
  private detach:()=>void;
  private detachSender:()=>void;
  constructor(private store:PluginStore,private events:EventBus,private cwd:string,private engine?:EngineManager){
    this.manager=new PluginManager(dirname(store.root),cwd);
    const m=this.manager;
    m.onAgentToolsChanged=()=>this.saveIndex();m.onCommandsChanged=()=>this.saveIndex();
    this.detachSender=m.addSender((packet:any)=>{
      const type=packet.type==="plugin_data"?"plugin.data":packet.type==="notice"?"plugin.notify":"plugin.sdk";
      this.events.publish(type,packet,undefined,{type:packet.type,pluginId:packet.pluginId});
    },()=>"local");
    m.permissionRequester=(id:string,request:any)=>this.request(id,"permission",request);
    m.pathAccessRequester=async(id:string,path:string,reason:string)=>!!(await this.request(id,"path",{path,reason})).ok;
    m.conversationProvider=()=>this.snapshot;
    m.conversationLister=()=>this.engine?.sessions().map(item=>({id:item.id,title:item.name,cwd:item.workspace,kind:"pi",isStreaming:item.status==="running"}))??[];
    m.conversationSearcher=async(query:string,limit=50)=>(await m.conversationLister()).filter((item:any)=>item.title.toLowerCase().includes(query.toLowerCase())).slice(0,Math.max(1,Math.min(100,limit)));
    m.conversationWriter=async(id:string,text:string,attachments?:any[])=>{
      if(attachments?.length)return {ok:false,error:"Plugin prompt attachments require inline Pi images; file references are not silently discarded."};
      return this.agentAction(id,"prompt",{message:text});
    };
    m.runSteerer=(id:string,text:string)=>this.agentAction(id,"steer",{message:text});
    m.runAborter=(id:string)=>this.agentAction(id,"abort",{});
    m.modelLister=async()=>{const id=this.active??this.engine?.sessions()[0]?.id;return id&&this.engine?this.engine.execute(id,{command:"get_available_models"}).catch(()=>[]):[];};
    m.chatProvider=async(pluginId:string,request:any)=>{
      if(!this.engine)throw new Error("Pi runtime is unavailable");
      const session=request.conversationId?await this.engine.resumeSession(request.conversationId):await this.engine.createSession({workspace:request.cwd||m.cwdValue,name:"Plugin · "+pluginId});
      if(request.model){const split=request.model.indexOf("/");if(split<1)throw new Error("Expected provider/model");await this.engine.execute(session.id,{command:"set_model",payload:{provider:request.model.slice(0,split),modelId:request.model.slice(split+1)}});}
      if(request.thinkingLevel)await this.engine.execute(session.id,{command:"set_thinking_level",payload:{level:request.thinkingLevel}});
      await this.engine.execute(session.id,{command:["running","waiting"].includes(session.status)?"steer":"prompt",payload:{message:String(request.text??"")}});
      return {ok:true,conversationId:session.id};
    };
    m.llmProvider=async(_id:string,request:any)=>{const controller=new AbortController();this.llmCalls.add(controller);try{return await completeWithIsolatedSession({cwd:m.cwdValue,agentDir:join(homedir(),".pi/agent"),signal:controller.signal},request);}finally{this.llmCalls.delete(controller);}};
    this.detach=events.subscribe(event=>{
      const packet=event.payload as any;
      if(event.sessionId&&event.type.startsWith("pi.")){
        if(!this.active)this.active=event.sessionId;
        if(event.type==="pi.message_end"&&this.active===event.sessionId){const messages=this.snapshot?.conversationId===event.sessionId?this.snapshot.messages??[]:[];this.snapshot={...this.snapshot,conversationId:event.sessionId,messages:[...messages,packet.message].slice(-200)};m.emitConversationChanged();}
        if(event.type.includes("tool_execution"))m.emitToolEvent({...packet,type:event.type.replace("pi.",""),conversationId:event.sessionId});
        if(event.type==="pi.agent_start"||event.type==="pi.agent_end")m.emitRunEvent({...packet,type:event.type.endsWith("start")?"run_start":"run_end",conversationId:event.sessionId});
        if(event.type==="pi.message_update"&&packet.assistantMessageEvent?.delta)m.emitStreaming({conversationId:event.sessionId,delta:packet.assistantMessageEvent.delta});
      }
      if(event.type==="extension.snapshot"&&event.sessionId===this.active)m.emitStats(packet);
    });
  }
  private saveIndex(){const path=join(dirname(this.store.root),"plugin-bridge.json"),temp=path+"."+randomUUID()+".tmp";writeFileSync(temp,JSON.stringify({tools:this.tools(),commands:this.commands()}),{mode:0o600});renameSync(temp,path);}
  private request(pluginId:string,kind:GrantRequest["kind"],request:any):Promise<any>{
    if(this.pending.size>=32)return Promise.resolve({ok:false});
    const id=randomUUID(),value={id,pluginId,kind,request,createdAt:new Date().toISOString()};
    return new Promise(resolve=>{const timer=setTimeout(()=>finish({ok:false}),120000);timer.unref();const finish=(answer:any)=>{clearTimeout(timer);this.pending.delete(id);resolve(answer);};this.pending.set(id,{value,finish});this.events.publish("plugin.grant_request",value,undefined,{id,pluginId});});
  }
  grants(){return {pending:[...this.pending.values()].map(item=>item.value),paths:this.manager.grants.list(),permissions:this.manager.permGrants.list(),dom:this.manager.domConsentStore.list()};}
  decide(id:string,ok:boolean,remember=false){const item=this.pending.get(id);if(!item)throw Object.assign(new Error("Permission request expired"),{statusCode:409});item.finish({ok,remember});return {decided:true};}
  revoke(pluginId:string,family:string,path?:string){if(family==="dom")return this.manager.setDomConsent(pluginId,false);if(family==="path")return this.manager.grants.revoke(pluginId,path);return this.manager.permGrants.revoke(pluginId,family);}
  dom(id:string,granted:boolean){return this.manager.setDomConsent(id,granted);}
  blocked(id:string){return this.manager.isDomBundleBlocked(id);}
  async agentAction(id:string,command:string,payload:any){try{if(!this.engine)throw new Error("Pi runtime is unavailable");await this.engine.resumeSession(id);await this.engine.execute(id,{command,payload});return {ok:true};}catch(error){return {ok:false,error:String(error)};}}
  async load(){await this.manager.ensureLoaded(()=>"en");this.saveIndex();}
  async list(){const upstream=await this.manager.ensureLoaded(()=>"en");return this.store.list().map(item=>({...item,...upstream.find((value:any)=>value.id===item.id),ui:this.ui(item.id),epoch:this.manager.epoch,domBlocked:this.blocked(item.id)}));}
  async activate(manifest:PluginManifest){await this.deactivate(manifest.id);await this.manager.ensureLoaded(()=>"en");const info=this.manager.loaded.get(manifest.id)?.info;if(info?.error&&!(info.wantsDom&&!info.domGranted&&String(info.error).includes("DOM")))throw new Error(info.error);this.manager.notifyAttach("local");this.saveIndex();}
  async deactivate(id:string){for(const item of this.pending.values())if(item.value.pluginId===id)item.finish({ok:false});const item=this.manager.loaded.get(id);if(item)this.manager.deactivateEntry(id,item);this.saveIndex();}
  async close(){for(const controller of this.llmCalls)controller.abort();for(const item of this.pending.values())item.finish({ok:false});this.detach();this.detachSender();this.manager.dispose();this.saveIndex();}
  commands(){return [...this.manager.pluginCommands.entries()].flatMap(([pluginId,entries]:any)=>[...entries.values()].map((item:any)=>({name:item.name,description:item.description,pluginId,source:"plugin"})));}
  tools(){return this.manager.getAgentTools().map(({execute,...item}:any)=>item);}
  ui(id:string){return this.manager.uiOf(id)?.items??[];}
  async tool(id:string,name:string,callId:string,params:any){const tool=this.manager.agentTools.get(id)?.get(name);if(!tool)throw Object.assign(new Error("Plugin tool not found"),{statusCode:404});return tool.execute(callId,params);}
  async command(id:string,name:string,args:string){const command=this.manager.pluginCommands.get(id)?.get(name);if(!command)throw Object.assign(new Error("Plugin command not found"),{statusCode:404});return command.run(args,{clientId:"local"});}
  async message(id:string,payload:any){if(!this.manager.loaded.has(id))throw Object.assign(new Error("Plugin not active"),{statusCode:404});this.manager.handleMessage(id,payload,"local");}
  config(id:string){const item=this.manager.loaded.get(id);if(item?.info.settingsSchema?.length)return item.info.settingsValues??{};try{return JSON.parse(readFileSync(join(this.store.directory(id),"storage.json"),"utf8")).settings??{};}catch{return {};}}
  async saveConfig(id:string,patch:any){
    if(!patch||typeof patch!=="object"||Array.isArray(patch))throw Object.assign(new Error("Invalid plugin settings"),{statusCode:400});
    const item=this.manager.loaded.get(id);
    if(item?.info.settingsSchema?.length){const result=this.manager.savePluginSettings(id,patch,()=>"en");if(result.error)throw Object.assign(new Error(result.error),{statusCode:400});const scanned=(await this.manager.scan(()=>"en")).find((value:any)=>value.id===id);item.info.settingsValues=scanned?.settingsValues??{};return this.config(id);}
    const path=join(this.store.directory(id),"storage.json"),temp=path+"."+randomUUID()+".tmp";let data:any={};try{data=JSON.parse(readFileSync(path,"utf8"));}catch{}
    data.settings={...data.settings,...patch};writeFileSync(temp,JSON.stringify(data,null,2),{mode:0o600});renameSync(temp,path);for(const handler of item?.settingsHandlers??[])handler(data.settings);return data.settings;
  }
  async attach(sessionId?:string){
    if(sessionId&&this.engine){const session=this.engine.sessions().find(item=>item.id===sessionId);if(!session)throw Object.assign(new Error("Session not found"),{statusCode:404});const [page,state,stats]=await Promise.all([this.engine.execute(sessionId,{command:"get_messages_page",payload:{limit:160}}),this.engine.execute(sessionId,{command:"get_state"}),this.engine.execute(sessionId,{command:"get_session_stats"})]) as any[];this.active=sessionId;this.snapshot={conversationId:sessionId,title:session.name,cwd:session.workspace,sessionFile:session.sessionFile,sessionId:state.sessionId,model:state.model?`${state.model.provider}/${state.model.id}`:undefined,isStreaming:!!state.isStreaming,at:Date.now(),stats,messages:Array.isArray(page.messages)?page.messages:[],historyPage:{start:page.start,end:page.end,total:page.total}};this.manager.notifyCwd(session.workspace);this.manager.emitConversationChanged();}
    this.manager.notifyAttach("local");
  }
}
