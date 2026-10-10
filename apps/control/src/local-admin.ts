import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { extensionInventory } from "./extensions.js";

const exec=promisify(execFile);
const agent=join(homedir(),".pi/agent");
const models=join(agent,"models.json");
function readModels() { return existsSync(models)?JSON.parse(readFileSync(models,"utf8")):{providers:{}}; }
function redact(value: any): any {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value!=="object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!/apiKey|headers|secret|password|token/i.test(key)).map(([key,item])=>[key,redact(item)]));
}
export function providerSettings() { return redact(readModels()); }
export function saveProviderSettings(patch: any) {
  if (!patch?.providers || typeof patch.providers!=="object" || Array.isArray(patch.providers)) throw Object.assign(new Error("Invalid providers document"),{statusCode:400});
  const current=readModels();
  for(const [id,provider] of Object.entries(patch.providers)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)||!provider||typeof provider!=="object") throw Object.assign(new Error("Invalid provider"),{statusCode:400});
    current.providers??={};
    current.providers[id]={...current.providers[id],...redact(provider)};
  }
  mkdirSync(dirname(models),{recursive:true});
  const temp=models+"."+randomUUID()+".tmp";
  writeFileSync(temp,JSON.stringify(current,null,2)+"\n",{mode:0o600,flag:"wx"});renameSync(temp,models);
  return providerSettings();
}
export function saveProviderKey(id: string, key: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)||!key.trim()||key.length>10000) throw Object.assign(new Error("Invalid provider key"),{statusCode:400});
  const path=join(agent,"auth.json");
  const current=existsSync(path)?JSON.parse(readFileSync(path,"utf8")):{};
  current[id]={type:"api_key",key:key.trim()};
  const temp=path+"."+randomUUID()+".tmp";
  writeFileSync(temp,JSON.stringify(current,null,2)+"\n",{mode:0o600,flag:"wx"});renameSync(temp,path);
  return {saved:true};
}
export async function extensionVersions() {
  const items=extensionInventory();
  return Promise.all(items.map(async item=>{
    if (!item.source.startsWith("npm:")) return {...item,latest:null};
    try { const {stdout}=await exec("npm",["view",item.name,"version","--json"],{timeout:15000,maxBuffer:10000});return {...item,latest:JSON.parse(stdout)}; }
    catch {return {...item,latest:null};}
  }));
}
let updateInProgress=false;
export async function updateExtension(source: string, runtimeDir: string) {
  if(updateInProgress)throw Object.assign(new Error("Extension update already in progress"),{statusCode:409});
  updateInProgress=true;
  try { return await performUpdate(source,runtimeDir); } finally { updateInProgress=false; }
}
async function performUpdate(source: string, runtimeDir: string) {
  const item=extensionInventory().find(item=>item.source===source && item.source.startsWith("npm:"));
  if(!item) throw Object.assign(new Error("Only installed npm extensions can be updated"),{statusCode:400});
  const backup=join(runtimeDir,"extension-backups",Date.now()+"-"+randomUUID());
  mkdirSync(backup,{recursive:true,mode:0o700});
  cpSync(join(agent,"npm"),join(backup,"npm"),{recursive:true,dereference:false});
  cpSync(join(agent,"settings.json"),join(backup,"settings.json"));
  const entry=fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
  const cli=join(dirname(entry),"cli.js");
  try { await exec(process.execPath,[cli,"update",source,"--approve"],{timeout:120000,maxBuffer:1024*1024}); }
  catch(error){
    // Restore a clean directory, not an overlay containing partially installed modules.
    const failed=join(backup,"failed-npm");
    renameSync(join(agent,"npm"),failed);
    cpSync(join(backup,"npm"),join(agent,"npm"),{recursive:true,dereference:false});
    const restored=join(agent,"settings.json."+randomUUID()+".tmp");
    cpSync(join(backup,"settings.json"),restored);renameSync(restored,join(agent,"settings.json"));
    throw Object.assign(new Error("Update failed; previous installation restored. Failed files retained at "+failed),{statusCode:400});
  }
  return {updated:true,backup,appliesTo:"new-or-resumed-sessions"};
}
