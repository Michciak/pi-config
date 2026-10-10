// Display-only projection. Never changes persisted history or model context.
export function remoteHistoryPage(messages, before, limit) {
  const end=Number.isSafeInteger(before)?Math.max(0,Math.min(before,messages.length)):messages.length;
  const count=Number.isSafeInteger(limit)?Math.max(1,Math.min(limit,400)):160;
  const start=Math.max(0,end-count);
  const clip=value=>typeof value==="string"&&value.length>24000?value.slice(0,24000)+"\n[… skrócono podgląd; pełny zapis pozostaje w historii sesji]":value;
  const projected=messages.slice(start,end).map(message=>{
    const result={};
    for(const key of ["role","timestamp","toolCallId","toolName","isError","customType","display","provider","model","api","stopReason","errorMessage","usage"])
      if(message[key]!==undefined)result[key]=message[key];
    if(message.details) {
      result.details={};
      for(const key of ["diff","path","filePath","snapshotId","classification"])
        if(typeof message.details[key]==="string")result.details[key]=clip(message.details[key]);
    }
    result.content=typeof message.content==="string"?clip(message.content):(message.content??[]).map(block=>{
      if(block.type==="text")return {type:"text",text:clip(block.text)};
      if(block.type==="thinking")return {type:"thinking",thinking:clip(block.thinking)};
      if(block.type==="image")return block.data?.length>256000?{type:"text",text:"[Obraz pominięty w podglądzie historii; oryginał pozostaje zapisany]"}:block;
      if(block.type==="toolCall") {
        const encoded=JSON.stringify(block.arguments??{});
        return {type:"toolCall",id:block.id,name:block.name,arguments:encoded.length>24000?{preview:clip(encoded)}:JSON.parse(encoded)};
      }
      return {type:"text",text:`[${block.type??"załącznik"}]`};
    });
    return result;
  });
  return {messages:projected,total:messages.length,start,end};
}

export function patchRpcHistory(source,version) {
  if(version!=="1.0.3")throw new Error("RPC history patch requires Pi 1.0.3");
  const anchor='            case "get_messages": {';
  if(source.includes('case "get_messages_page":')||source.split(anchor).length!==2)throw new Error("RPC history anchor changed or already patched");
  return 'import {remoteHistoryPage} from "./remote-history.js";\n'+source.replace(anchor,'            case "get_messages_page": {\n                return success(id, command.type, remoteHistoryPage(session.messages, command.before, command.limit));\n            }\n'+anchor);
}
