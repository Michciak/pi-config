import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Role = "coding" | "research" | "reasoning" | "fast" | "general";

const UNSUPPORTED_FOR_CODEX_CHATGPT = new Set(["openai-codex/gpt-5.3-codex-spark"]);

const PROVIDER_PRIORITY: Record<Role, string[]> = {
  coding: ["cursor", "openai-codex", "opencode", "github-copilot", "openrouter"],
  research: ["openrouter", "openai-codex", "github-copilot", "opencode", "cursor"],
  reasoning: ["openai-codex", "cursor", "openrouter", "opencode", "github-copilot"],
  fast: ["openrouter", "opencode", "github-copilot", "cursor", "openai-codex"],
  general: ["openai-codex", "cursor", "openrouter", "opencode", "github-copilot"],
};

function classify(task: string): Role {
  const text = task.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
  if (/\b(szukaj|wyszukaj|porownaj|zrodla|search|research|sources?|web|compare|look up|investigate)\b/.test(text)) return "research";
  if (/\b(napraw|blad|bledy|zaimplementuj|refaktoryzuj|testy|debug|fix|implement|code|refactor|test|bug|typescript|javascript|python)\b/.test(text)) return "coding";
  if (/\b(zaplanuj|zaprojektuj|architektura|architekture|przeanalizuj|plan|architecture|design|trade-?off|reason|analy[sz]e|review)\b/.test(text)) return "reasoning";
  if (/\b(krotko|szybko|podsumuj|quick|brief|short|summarize|simple)\b/.test(text)) return "fast";
  return "general";
}

function ref(model: any): string { return `${model.provider}/${model.id}`; }

function eligible(model: any, ctx: any): boolean {
  const path = process.env.PI_ROUTER_CAPABILITIES || join(homedir(), "projects", "pi-config", "settings", "model-capabilities.json");
  if (!UNSUPPORTED_FOR_CODEX_CHATGPT.has(ref(model)) && ctx?.modelRegistry?.hasConfiguredAuth && !ctx.modelRegistry.hasConfiguredAuth(model)) return false;
  if (!existsSync(path)) return !UNSUPPORTED_FOR_CODEX_CHATGPT.has(ref(model));
  try {
    const entry = JSON.parse(readFileSync(path, "utf8")).models?.[ref(model)];
    return entry?.eligibleForAutomaticRouting !== false && !UNSUPPORTED_FOR_CODEX_CHATGPT.has(ref(model));
  } catch {
    return !UNSUPPORTED_FOR_CODEX_CHATGPT.has(ref(model));
  }
}

export default function modelRouter(pi: ExtensionAPI) {
  const route = async (args: string, ctx: any) => {
    const explainOnly = /^--explain-only(?:\s|$)/.test(args.trim());
    const explain = explainOnly || /^--explain(?:\s|$)/.test(args.trim());
    const task = args.trim().replace(/^--explain(?:-only)?(?:\s+|$)/, "");
    if (!task) {
      ctx.ui.notify("Usage: /route <task description>", "warning");
      return;
    }
    if (task.startsWith("--")) {
      ctx.ui.notify("Unknown router option. Use --explain or --explain-only.", "warning");
      return;
    }
    const role = classify(task);
    const candidates = [...ctx.scopedModels].map((entry: any) => entry.model);
    const ranked = candidates.sort((a: any, b: any) => {
      const pa = PROVIDER_PRIORITY[role].indexOf(a.provider);
      const pb = PROVIDER_PRIORITY[role].indexOf(b.provider);
      return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
    });
    const eligibleRanked = ranked.filter((model: any) => eligible(model, ctx));
    if (explain) {
      const preview = eligibleRanked.slice(0, 5).map(ref).join(", ") || "(none)";
      ctx.ui.notify(`Router ${role}: ${preview}`, "info");
      pi.appendEntry("router-decision", { role, candidates: eligibleRanked.slice(0, 10).map(ref), explained: true });
      if (explainOnly) return;
    }
    // Limit selection attempts; never replay a dispatched task on another model.
    const attempts: { model: string; outcome: string }[] = [];
    for (const model of eligibleRanked.slice(0, 3)) {
      let selected = false;
      try {
        selected = await pi.setModel(model);
        attempts.push({ model: ref(model), outcome: selected ? "selected" : "unavailable" });
      } catch {
        // Provider errors may contain sensitive data: record only a category.
        attempts.push({ model: ref(model), outcome: "selection-error" });
        continue;
      }
      if (selected) {
        ctx.ui.notify(`Router: ${role} → ${ref(model)}`, "info");
        pi.appendEntry("router-decision", { role, attempts, selected: ref(model), candidates: eligibleRanked.slice(0, 10).map(ref) });
        await pi.sendUserMessage(task);
        return;
      }
    }
    pi.appendEntry("router-decision", { role, attempts, selected: null, candidates: eligibleRanked.slice(0, 10).map(ref) });
    ctx.ui.notify(`Router could not select a model for ${role} within 3 attempts; task was not dispatched.`, "warning");
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
