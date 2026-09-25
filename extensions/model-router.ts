import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classify, rankedModels, ref } from "./interactive-subagents/routing.ts";

export default function modelRouter(pi: ExtensionAPI) {
  const route = async (args: string, ctx: any) => {
    const input = args.trim();
    const explainOnly = /^--explain-only(?:\s|$)/.test(input);
    const explain = explainOnly || /^--explain(?:\s|$)/.test(input);
    const task = input.replace(/^--explain(?:-only)?(?:\s+|$)/, "");
    if (!task || task.startsWith("--")) {
      ctx.ui.notify("Usage: /route [--explain|--explain-only] <task>", "warning"); return;
    }
    const role = classify(task);
    const candidates = rankedModels(task, ctx);
    if (!candidates.length) { ctx.ui.notify("No eligible models in the active scope; task was not dispatched.", "warning"); return; }
    if (explain) ctx.ui.notify(`Router ${role}: ${candidates.slice(0,5).map(ref).join(", ")}`, "info");
    pi.appendEntry("router-decision", {role, candidates:candidates.slice(0,10).map(ref), explained:explain, coordinator:ctx.model ? ref(ctx.model) : null});
    if (explainOnly) return;
    if (!pi.getActiveTools().includes("subagent")) {
      ctx.ui.notify("The subagent tool is not active. Enable interactive-subagents before using /route.", "warning"); return;
    }
    if (!process.env.TMUX) {
      ctx.ui.notify("Start Pi inside tmux before using /route to create subagent panes.", "warning"); return;
    }
    // Keep the user's selected model as coordinator. The subagent tool validates
    // and selects executor models at spawn time; this command never calls setModel.
    pi.sendUserMessage(`Coordinate this task using the available subagent tool. Choose a suitable existing agent profile, delegate a concrete task, and use the returned result to answer the user. Omit model to use automatic role-based selection from the active scope, or specify an exact eligible provider/model. Do not stop at listing candidate models. Subagent results arrive automatically; never invent them or poll.\n\nTask:\n${task}`);
  };
  pi.registerCommand("route", {description:"Delegate through subagents while retaining the current coordinator model",handler:route});
  pi.registerCommand("router", {description:"Alias for /route",handler:route});
}
