import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Role = "coding" | "research" | "reasoning" | "fast" | "general";

const PROVIDER_PRIORITY: Record<Role, string[]> = {
  coding: ["cursor", "openai-codex", "opencode", "github-copilot", "openrouter"],
  research: ["openrouter", "openai-codex", "github-copilot", "opencode", "cursor"],
  reasoning: ["openai-codex", "cursor", "openrouter", "opencode", "github-copilot"],
  fast: ["openrouter", "opencode", "github-copilot", "cursor", "openai-codex"],
  general: ["openai-codex", "cursor", "openrouter", "opencode", "github-copilot"],
};

function classify(task: string): Role {
  const text = task.toLowerCase();
  if (/\b(search|research|sources?|web|compare|look up|investigate)\b/.test(text)) return "research";
  if (/\b(debug|fix|implement|code|refactor|test|bug|typescript|javascript|python)\b/.test(text)) return "coding";
  if (/\b(plan|architecture|design|trade-?off|reason|analy[sz]e|review)\b/.test(text)) return "reasoning";
  if (/\b(quick|brief|short|summarize|simple)\b/.test(text)) return "fast";
  return "general";
}

function ref(model: any): string { return `${model.provider}/${model.id}`; }

export default function modelRouter(pi: ExtensionAPI) {
  const route = async (args: string, ctx: any) => {
    const task = args.trim();
    if (!task) {
      ctx.ui.notify("Usage: /route <task description>", "warning");
      return;
    }
    const role = classify(task);
    const candidates = [...ctx.scopedModels].map((entry: any) => entry.model);
    const ranked = candidates.sort((a: any, b: any) => {
      const pa = PROVIDER_PRIORITY[role].indexOf(a.provider);
      const pb = PROVIDER_PRIORITY[role].indexOf(b.provider);
      return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
    });
    for (const model of ranked) {
      const selected = await pi.setModel(model);
      if (selected) {
        ctx.ui.notify(`Router: ${role} → ${ref(model)}`, "info");
        await pi.sendUserMessage(task);
        return;
      }
    }
    ctx.ui.notify(`Router found no authenticated model for role ${role}; current model kept.`, "warning");
  };

  pi.registerCommand("route", {
    description: "Choose a model for a task from the active Pi scope",
    handler: route,
  });
  pi.registerCommand("router", {
    description: "Alias for /route",
    handler: route,
  });
}
