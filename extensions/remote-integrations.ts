/** Publishes existing extension state to Pi Remote; never adds model turns. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {restoreAcpRuns} from "./shared/acp-runs.ts";
import {currentWorkState,workBoundaryPrompt} from "./shared/work-state.ts";
import {selectSubagentModel} from "./interactive-subagents/routing.ts";

export default function remoteIntegrations(pi: ExtensionAPI) {
  if(process.env.PI_WEB_SESSION_ID) {
    (globalThis as any)[Symbol.for("pi-remote.delegate-model")]=(args:any,context:any)=>selectSubagentModel(args.task??"",context,args.agent,args.model);
    pi.on("before_agent_start",(event,context)=>({systemPrompt:event.systemPrompt+"\n\n"+workBoundaryPrompt(context.sessionManager.getBranch())}));
  }
  const guards=async(phase:string,packet:unknown)=>{
    const response=await fetch(`http://127.0.0.1:${process.env.PI_WEB_CONTROL_PORT??3784}/api/v1/plugins/guards/${phase}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(packet),signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error("Plugin guard unavailable");return response.json();
  };
  if(process.env.PI_WEB_SESSION_ID){
    pi.on("tool_call",async(event)=>{if(!["read","bash"].includes(event.toolName))return;try{const verdict=await guards("pre",{toolName:event.toolName,params:event.input,conversationId:process.env.PI_WEB_SESSION_ID});if(verdict?.decision&&verdict.decision!=="allow")return {block:true,reason:verdict.reason??"Plugin denied this tool"};}catch{return {block:true,reason:"Plugin guard unavailable; request denied safely"};}});
    pi.on("tool_result",async(event)=>{if(!["read","bash"].includes(event.toolName))return;try{const edit=await guards("post",{toolName:event.toolName,params:event.input,result:{content:event.content,details:event.details,isError:event.isError},conversationId:process.env.PI_WEB_SESSION_ID});if(edit?.content)return {content:edit.content,details:event.details,isError:event.isError};}catch{}});
  }
  if (process.env.PI_WEB_SESSION_ID && process.env.PI_WEB_RUNTIME_DIR) {
    try {
      const bridge = JSON.parse(readFileSync(join(process.env.PI_WEB_RUNTIME_DIR,"plugin-bridge.json"),"utf8"));
      const invoke = async (pluginId: string, kind: string, payload: unknown, signal?: AbortSignal) => {
        const response = await fetch(`http://127.0.0.1:${process.env.PI_WEB_CONTROL_PORT ?? 3784}/api/v1/plugins/${encodeURIComponent(pluginId)}/${kind}`, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),signal});
        const value = await response.json();
        if (!response.ok) throw new Error(value.error ?? "Plugin request failed");
        return value;
      };
      for (const tool of bridge.tools ?? []) pi.registerTool({
        name:tool.name,label:tool.label??tool.name,description:tool.description,parameters:tool.parameters??{type:"object",properties:{}},
        execute: async (callId: string, params: unknown, signal?: AbortSignal) => invoke(tool.pluginId,"tool",{name:tool.name,callId,params},signal),
      });
      for (const command of bridge.commands ?? []) pi.registerCommand(command.name,{
        description:command.description??"Plugin command",
        handler:async(args,context)=>{try { await invoke(command.pluginId,"command",{name:command.name,args}); } catch(error) { context.ui.notify(String(error),"error"); }},
      });
    } catch { /* Empty plugin inventory is normal on first install. */ }
  }
  let ctx: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let previous = "";
  const workflows = new Map<string, any>();
  const fleetPrevious = new Map<string, string>();
  const publish = () => {
    if (!ctx || !process.env.PI_WEB_SESSION_ID) return;
    const fleet = (globalThis as any)[Symbol.for("pi-remote.acp-fleet")];
    if (typeof fleet === "function") for (const run of fleet()) {
      const packet = JSON.stringify({id:`acp:${run.runId}`,parentId:process.env.PI_SUBAGENT_RUN_ID??null,name:`ACP · ${run.agent} · ${run.runId.slice(-4)}`,agent:run.agent,transport:"acp",status:run.status==="failed"?"error":run.status==="cancelled"?"interrupted":run.status==="queued"?"starting":run.status,task:run.task,sessionFile:run.sessionFile});
      if (fleetPrevious.get(run.runId) !== packet) {fleetPrevious.set(run.runId,packet);ctx.ui.setWidget(`remote-subagent:acp:${run.runId}`,[packet]);}
    }
    const branch = ctx.sessionManager.getBranch();
    const {goal,tasks}=currentWorkState(branch);
    // Read only the extension's small run heads, never materialize child transcripts.
    const slug = ctx.cwd.split("/").at(-1)!.toLowerCase().replace(/[^a-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,48) || "project";
    const key = slug + "-" + createHash("sha256").update(ctx.cwd).digest("hex").slice(0,12);
    const runsDir=join(homedir(),".pi/workflows/projects",key,"runs");
    try {
      for (const name of readdirSync(runsDir).filter(name=>name.endsWith(".json")).slice(-100)) {
        try {
          const record=JSON.parse(readFileSync(join(runsDir,name),"utf8"));
          const run=record.format==="pi-workflow-run-v2"?record.index:record;
          if (run.sessionId && run.sessionId!==ctx.sessionManager.getSessionId()) continue;
          const summary=record.summary;
          workflows.set(run.runId,{
            runId:run.runId,workflowName:run.workflowName,status:run.status,phase:run.currentPhase,
            agents:summary?.total??run.agents?.length??0,
            activeAgents:summary?.activeLabels??[],
            tokens:run.tokenUsage?.total??summary?.usage?.totalTokens,
            cost:run.tokenUsage?.cost??summary?.usage?.cost,
          });
        } catch {}
      }
    } catch {}
    const packet = JSON.stringify({ goal, tasks, workflows: [...workflows.values()] });
    if (packet === previous) return;
    previous = packet;
    ctx.ui.setWidget("remote-integrations", [packet]);
  };
  pi.events.on("pi-dynamic-workflows:lifecycle", (data: any) => {
    if (!data?.runId) return;
    workflows.set(data.runId, { ...workflows.get(data.runId), ...data });
    publish();
  });
  pi.on("session_start", async (_event, context) => {
    if (timer) clearInterval(timer);
    ctx = context; previous = ""; workflows.clear(); fleetPrevious.clear();
    if(process.env.PI_WEB_SESSION_ID)for(const run of restoreAcpRuns(ctx.sessionManager.getBranch()))ctx.ui.setWidget(`remote-subagent:acp:${run.runId}`,[JSON.stringify({id:`acp:${run.runId}`,name:`ACP · ${run.agent} · ${run.runId.slice(-4)}`,agent:run.agent,transport:"acp",restored:true,status:run.status,task:run.task,sessionFile:join(tmpdir(),"acp-delegate",`${run.runId}.session.jsonl`)})]);
    publish();
    if (process.env.PI_WEB_SESSION_ID) { timer = setInterval(publish, 1000); timer.unref(); }
  });
  pi.on("tool_result", async () => { queueMicrotask(publish); });
  pi.on("session_shutdown", async () => { if (timer) clearInterval(timer); timer = undefined; ctx = undefined; });
}
