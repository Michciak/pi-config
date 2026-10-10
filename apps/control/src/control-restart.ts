import {readFileSync,writeFileSync,renameSync,unlinkSync,existsSync} from "node:fs";
import {join} from "node:path";

/** One-shot intent: ordinary service boots never start the engine unexpectedly. */
export function prepareControlRestart(runtimeDir:string,sessionIds:string[]) {
  const path=join(runtimeDir,"control-restart.json");
  writeFileSync(path+".next",JSON.stringify({version:1,startEngine:true,sessionIds:[...new Set(sessionIds)]}),{mode:0o600});
  renameSync(path+".next",path);
}
export function consumeControlRestart(runtimeDir:string):string[]|undefined {
  const path=join(runtimeDir,"control-restart.json");
  if(!existsSync(path))return;
  const text=readFileSync(path,"utf8");unlinkSync(path);
  const state=JSON.parse(text);
  if(state.version!==1||state.startEngine!==true||!Array.isArray(state.sessionIds)||state.sessionIds.some((id:unknown)=>typeof id!=="string"))throw new Error("Invalid Control restart intent");
  return state.sessionIds;
}
