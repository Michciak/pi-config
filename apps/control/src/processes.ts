import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec=promisify(execFile);
export async function ownedProcesses(roots: number[]) {
  const {stdout}=await exec("/bin/ps",["-axo","pid=,ppid=,comm="],{timeout:5000,maxBuffer:2*1024*1024});
  const all=stdout.trim().split("\n").flatMap(line=>{const match=/^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);return match?[{pid:Number(match[1]),parent:Number(match[2]),command:match[3]!}]:[];});
  const owned=new Set(roots);
  for(let i=0;i<64;i++){const before=owned.size;for(const item of all)if(owned.has(item.parent))owned.add(item.pid);if(before===owned.size)break;}
  const items=all.filter(item=>owned.has(item.pid));
  let ports:string="";
  try { ports=(await exec("/usr/sbin/lsof",["-nP","-iTCP","-sTCP:LISTEN","-Fpn"],{timeout:5000,maxBuffer:2*1024*1024})).stdout; } catch {}
  const portMap=new Map<number,string[]>();let pid=0;
  for(const line of ports.split("\n")){if(line.startsWith("p"))pid=Number(line.slice(1));if(line.startsWith("n")&&owned.has(pid))portMap.set(pid,[...(portMap.get(pid)??[]),line.slice(1)]);}
  return items.map(item=>({...item,ports:portMap.get(item.pid)??[]}));
}
