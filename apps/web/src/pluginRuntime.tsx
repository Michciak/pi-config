import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {controlApi} from "./api.js";

const modules=new Map<string,any>(),actions=new Map<string,Set<(id:string,value?:string)=>void>>();
export const rendererRegistry=new Map<string,{pluginId:string;render(code:string,ctx:any):HTMLElement|null}>();
export function pluginContext(id:string){return {send:(payload:unknown)=>controlApi.pluginMessage(id,payload),onData:(fn:(payload:unknown)=>void)=>{const listener=(event:Event)=>{const packet=(event as CustomEvent).detail;if(packet.pluginId===id)fn(packet.payload);};window.addEventListener("pi-plugin-data",listener);return ()=>window.removeEventListener("pi-plugin-data",listener);}};}
export async function pluginModule(manifest:any){const key=manifest.id+":"+manifest.version+":"+(manifest.epoch??0);if(modules.has(key))return modules.get(key);const url=`/plugins/${encodeURIComponent(manifest.id)}/client/${(manifest.client??"client/entry.mjs").replace(/^client\//,"")}?e=${manifest.epoch??0}`;const module=await import(/* @vite-ignore */url);const definition=module.default??module;modules.set(key,definition);for(const [language,render] of Object.entries(definition.renderers??{}))if(typeof render==="function")rendererRegistry.set(language,{pluginId:manifest.id,render:render as any});window.dispatchEvent(new Event("pi-plugin-renderers"));return definition;}
export function dispatchPluginAction(pluginId:string,item:any,value?:string){const name=item.action??`${pluginId}:${item.id}`;for(const fn of actions.get(name)??[])fn(`${pluginId}:${item.id}`,value);window.dispatchEvent(new CustomEvent("pi-plugin-action",{detail:{pluginId,item,value}}));}

export function PluginRuntime({enabled,onError}:{enabled:boolean;onError(message:string):void}){
  const [items,setItems]=useState<any[]>([]),[grants,setGrants]=useState<any>({pending:[]}),[modal,setModal]=useState<any>();
  const itemsRef=useRef(items);itemsRef.current=items;
  const refresh=()=>controlApi.pluginGrants().then(setGrants).catch(error=>onError(String(error)));
  useEffect(()=>{
    if(!enabled)return;
    (window as any).__piWebUiHost={version:1,setView:(view:string)=>window.dispatchEvent(new CustomEvent("pi-plugin-view",{detail:view})),openModal:(id:string)=>{for(const plugin of itemsRef.current){const item=plugin.ui?.find((value:any)=>`${plugin.id}:${value.id}`===id);if(item&&!item.hidden){setModal({plugin,item});return true;}}return false;},closeModal:()=>{setModal(undefined);return true;},onUiAction:(action:string,handler:any)=>{let set=actions.get(action);if(!set)actions.set(action,set=new Set());set.add(handler);return ()=>set!.delete(handler);}};
    const load=()=>controlApi.plugins().then(async(value:any)=>{setItems(value);const active=new Set(value.filter((plugin:any)=>plugin.enabled!==false&&!plugin.domBlocked).map((plugin:any)=>plugin.id));for(const [language,renderer] of rendererRegistry)if(!active.has(renderer.pluginId))rendererRegistry.delete(language);for(const plugin of value)if(plugin.enabled!==false&&plugin.client&&(plugin.preload||plugin.renderers?.length||plugin.permissions.includes("ui"))&&!plugin.domBlocked)try{await pluginModule(plugin);}catch(error){onError(String(error));}window.dispatchEvent(new Event("pi-plugin-renderers"));}).catch(error=>onError(String(error)));
    const attach=()=>void controlApi.attachPlugins().catch(error=>onError(String(error)));
    void load();void refresh();attach();
    const event=(event:Event)=>{const packet=(event as CustomEvent).detail;if(packet?.type==="plugins")void load();void refresh();};
    window.addEventListener("pi-plugin-sdk",event);
    window.addEventListener("pi-plugin-reconnect",attach);
    const timer=setInterval(refresh,5000);
    return ()=>{clearInterval(timer);window.removeEventListener("pi-plugin-sdk",event);window.removeEventListener("pi-plugin-reconnect",attach);delete (window as any).__piWebUiHost;actions.clear();rendererRegistry.clear();};
  },[enabled]);
  if(!enabled)return null;
  return <>
    {grants.pending?.map((request:any)=><div className="plugin-consent" key={request.id}><b>Plugin {request.pluginId} prosi o uprawnienie</b><pre>{JSON.stringify(request.request,null,2)}</pre><button onClick={()=>controlApi.decidePluginGrant(request.id,false).then(refresh).catch(error=>onError(String(error)))}>Odrzuć</button>{request.kind!=="path"&&<button onClick={()=>controlApi.decidePluginGrant(request.id,true,false).then(refresh).catch(error=>onError(String(error)))}>Zezwól w tej sesji</button>}<button onClick={()=>controlApi.decidePluginGrant(request.id,true,true).then(refresh).catch(error=>onError(String(error)))}>Zezwól i zapamiętaj</button></div>)}
    {items.filter(plugin=>plugin.enabled!==false&&!plugin.domBlocked).flatMap(plugin=>(plugin.ui??[]).filter((item:any)=>!item.hidden&&item.slot!=="modal.dialog").sort((a:any,b:any)=>(a.order??0)-(b.order??0)).map((item:any)=><PluginSlot key={`${plugin.id}:${item.id}`} pluginId={plugin.id} item={item}/>))}
    {modal&&<div className="modal-backdrop"><section className="modal"><h2>{modal.item.labelEn??modal.item.label}</h2><PluginContribution pluginId={modal.plugin.id} item={modal.item}/><button onClick={()=>setModal(undefined)}>Zamknij</button></section></div>}
  </>;
}

function PluginSlot({pluginId,item}:{pluginId:string;item:any}){
  const targets:Record<string,string>={"topbar.primary":".app-header .status-row","topbar.overflow":".app-header .status-row","composer.leading":".composer","composer.actions":".composer-footer","leftpanel.sessions":".sessions-panel","rightpanel.tabs":".cockpit-tabs","chat.header":".chat-search","chat.empty":".conversation","file.preview.toolbar":".editor-head","terminal.toolbar":".terminal-dock header","scm.toolbar":".git-head","goalbar.actions":".goal-bar","notice.actions":".update-banner"};
  const selector=targets[item.slot];const target=selector?document.querySelector(selector):null;
  const node=<PluginContribution pluginId={pluginId} item={item}/>;
  return target?createPortal(node,target):node;
}

function PluginContribution({pluginId,item}:{pluginId:string;item:any}){
  const action=(value?:string)=>dispatchPluginAction(pluginId,item,value);
  const label=item.labelEn??item.label??item.id;
  if(item.kind==="divider")return <hr/>;
  if(item.kind==="badge")return <span className="plugin-contribution">{label} {item.badge}</span>;
  if(item.kind==="progress")return <label className="plugin-contribution">{label}<progress value={item.progress??0} max={100}/></label>;
  return <div className="plugin-contribution" data-slot={item.slot}>
    {item.kind==="select"?<label>{label}<select value={item.value??""} onChange={event=>action(event.target.value)}>{item.options?.map((option:any)=><option key={option.value} value={option.value}>{option.labelEn??option.label??option.value}</option>)}</select></label>
      :item.kind==="input"?<label>{label}<input defaultValue={item.value} onBlur={event=>action(event.target.value)}/></label>
      :item.kind==="toggle"?<label><input type="checkbox" checked={!!item.checked} onChange={event=>action(String(event.target.checked))}/>{label}</label>
      :<button title={item.hintEn??item.hint} onClick={()=>item.view?(window as any).__piWebUiHost.setView(item.view):action()}>{item.icon} {label}</button>}
    {item.children?.map((child:any)=><PluginContribution key={child.id} pluginId={pluginId} item={child}/>)}
  </div>;
}

export function PluginCode({language,code,fallback}:{language:string;code:string;fallback:any}){
  const host=useRef<HTMLDivElement>(null);const [,redraw]=useState(0);
  useEffect(()=>{const refresh=()=>redraw(value=>value+1);window.addEventListener("pi-plugin-renderers",refresh);return ()=>window.removeEventListener("pi-plugin-renderers",refresh);},[]);
  const renderer=rendererRegistry.get(language);
  useEffect(()=>{if(!renderer||!host.current)return;try{const element=renderer.render(code,pluginContext(renderer.pluginId));if(element)host.current.replaceChildren(element);}catch{host.current.textContent=code;}return ()=>host.current?.replaceChildren();},[renderer,language,code]);
  return renderer?<div className="plugin-code" ref={host}/>:fallback;
}
