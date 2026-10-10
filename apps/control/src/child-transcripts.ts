import {readFile, realpath, stat} from "node:fs/promises";
import {isAbsolute, relative} from "node:path";
import {setImmediate} from "node:timers/promises";

type Transcript = {messages:any[];model?:string};
const cache=new Map<string,{signature:string;bytes:number;value:Promise<Transcript>}>();
// Preserve the existing 32 MB security bound, but never synchronously scan all
// child transcripts on every poll. Yield during first-time parsing as well.
export async function childTranscript(rootPath:string,filePath:string):Promise<Transcript> {
  try {
    const [root,file]=await Promise.all([realpath(rootPath),realpath(filePath)]);
    const rel=relative(root,file);
    if(rel===".."||rel.startsWith("../")||isAbsolute(rel)) return {messages:[]};
    const info=await stat(file);
    if(!info.isFile()||info.size>32*1024*1024) return {messages:[]};
    const signature=`${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
    if(cache.get(file)?.signature===signature) return await cache.get(file)!.value;
    const value=(async()=>{
      const lines=(await readFile(file,"utf8")).split("\n");
      const messages:any[]=[];let model:string|undefined;
      for(let i=0;i<lines.length;i++) {
        if(i%250===0) await setImmediate();
        try {
          const entry=JSON.parse(lines[i]!);
          if(entry.type==="message") {messages.push(entry.message);if(messages.length>200)messages.shift();}
          if(entry.type==="model_change")model=`${entry.provider}/${entry.modelId}`;
        } catch {}
      }
      return {messages,model};
    })();
    cache.set(file,{signature,bytes:info.size,value});
    while(cache.size>128 || [...cache.values()].reduce((total,item)=>total+item.bytes,0)>64*1024*1024)
      cache.delete(cache.keys().next().value!);
    return await value;
  } catch {return {messages:[]};}
}
