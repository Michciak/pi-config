import {readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";

export function patchAcpRemote(source) {
  const marker = '/*pi-remote-acp-v2*/';
  if (source.includes(marker)) return patchAcpLifecycle(source);
  const anchor = "delegateStatusWidget.setContext(ctx,runningRunsSnapshot";
  const delivery = 'const send=pi2.sendUserMessage';
  const model = 'const callModel=normalizeModelRef(args.model);';
  if (!source.includes("function fleetRunsSnapshot()") || !source.includes(anchor) || source.split(delivery).length!==3 || source.split(model).length!==2) throw new Error("Unsupported ACP build: remote adapter not installed");
  if (!source.includes('Symbol.for("pi-remote.acp-fleet")')) source=source.replaceAll(anchor, 'if(process.env.PI_WEB_SESSION_ID)globalThis[Symbol.for("pi-remote.acp-fleet")]=()=>fleetRunsSnapshot();' + anchor);
  // Retain the native batching, injected flags and error handling. Only the
  // delivery envelope changes: delegate output is system data, not user text.
  source=source.replaceAll(delivery,'const send=process.env.PI_WEB_SESSION_ID?function(text){return pi2.sendMessage({customType:"subagent_result",content:text,display:true,details:{transport:"acp"}},{triggerTurn:true,deliverAs:"steer"})}:pi2.sendUserMessage');
  source=source.replace(model,'const remoteRoute=process.env.PI_WEB_SESSION_ID?globalThis[Symbol.for("pi-remote.delegate-model")]:undefined;const callModel=normalizeModelRef(args.model??(!roleCfg?.model&&typeof remoteRoute==="function"?remoteRoute(args,ctx):undefined));');
  return patchAcpLifecycle(marker+source);
}

export function patchAcpLifecycle(source) {
  const marker='/*pi-remote-acp-startup-awaited*/';
  if(source.includes(marker))return source;
  const start='pi2.on("session_start",(_event,ctx)=>{if(!agentProvidersDone)';
  const task='void registerTools(pi2,ctx,state2,agent,false).catch';
  // A small routing-only fixture (or a bundle without this lifecycle hook) has
  // nothing to patch. Partial matches are rejected rather than guessed.
  if(!source.includes(start)&&!source.includes(task))return source;
  if(source.split(start).length!==2||source.split(task).length!==2)throw new Error("Unsupported ACP startup lifecycle");
  source=source.replace(start,'pi2.on("session_start",async(_event,ctx)=>{if(!agentProvidersDone)');
  const begin=source.indexOf(task),end=source.indexOf(';if(typeof pi2.getSessionName',begin);
  if(end<begin)throw new Error("Unsupported ACP registration completion");
  const registration=source.slice(begin,end).replace('void registerTools','const remoteRegistration=registerTools');
  source=source.slice(0,begin)+registration+';if(process.env.PI_WEB_SESSION_ID)await remoteRegistration'+source.slice(end);
  return marker+source;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  writeFileSync(path, patchAcpRemote(readFileSync(path, "utf8")));
}
