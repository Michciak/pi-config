/** Recover only delegate references belonging to this session's branch. */
export function restoreAcpRuns(branch: any[]): any[] {
  const calls=new Map<string,any>(),runs=new Map<string,any>();
  for(const entry of branch){
    const message=entry.message;
    if(!message)continue;
    for(const part of Array.isArray(message.content)?message.content:[])if(part.type==="toolCall"&&part.name==="acp_delegate")calls.set(part.id,part.arguments);
    const text=typeof message.content==="string"?message.content:(Array.isArray(message.content)?message.content:[]).filter((part:any)=>part.type==="text").map((part:any)=>part.text).join("\n");
    if(!["acp_delegate","acp_delegate_wait","acp_delegate_cancel"].includes(message.toolName) && !/^\[acp_delegate (completed|failed|cancelled)\]/.test(text))continue;
    const id=text.match(/\brunId[\s`"'():]*(del_[a-z0-9_]+)/i)?.[1];
    if(!id)continue;
    const call=calls.get(message.toolCallId),previous=runs.get(id);
    const agent=call?.agent??previous?.agent??text.match(/^\[acp_delegate \w+\]\s+(\S+)/)?.[1]??"delegate";
    const status=/^\[acp_delegate failed\]|\bFAILED\b/.test(text)?"error":/^\[acp_delegate cancelled\]|\bcancelled\b/i.test(text)?"interrupted":/^\[acp_delegate completed\]|\*\*[^*]+\*\*[^\n]*\bcompleted\b/i.test(text)?"completed":previous?.status??"interrupted";
    runs.set(id,{runId:id,agent,task:call?.task??previous?.task,status});
  }
  return [...runs.values()].slice(-100);
}
