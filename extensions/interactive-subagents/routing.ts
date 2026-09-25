import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type Role = "coding" | "research" | "reasoning" | "fast" | "general";

const UNSUPPORTED_FOR_CODEX_CHATGPT = new Set(["openai-codex/gpt-5.3-codex-spark"]);

const PROVIDER_PRIORITY: Record<Role, string[]> = {
  coding: ["cursor", "openai-codex", "opencode", "github-copilot", "openrouter"],
  research: ["openrouter", "openai-codex", "github-copilot", "opencode", "cursor"],
  reasoning: ["openai-codex", "cursor", "openrouter", "opencode", "github-copilot"],
  fast: ["openrouter", "opencode", "github-copilot", "cursor", "openai-codex"],
  general: ["openai-codex", "cursor", "openrouter", "opencode", "github-copilot"],
};

export function classify(task: string): Role {
  const text = task.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
  if (/\b(szukaj|wyszukaj|porownaj|zrodla|search|research|sources?|web|compare|look up|investigate)\b/.test(text)) return "research";
  if (/\b(napraw|blad|bledy|zaimplementuj|refaktoryzuj|testy|debug|fix|implement|code|refactor|test|bug|typescript|javascript|python)\b/.test(text)) return "coding";
  if (/\b(zaplanuj|zaprojektuj|architektura|architekture|przeanalizuj|plan|architecture|design|trade-?off|reason|analy[sz]e|review)\b/.test(text)) return "reasoning";
  if (/\b(krotko|szybko|podsumuj|quick|brief|short|summarize|simple)\b/.test(text)) return "fast";
  return "general";
}

export function ref(model: any): string { return `${model.provider}/${model.id}`; }

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


export function rankedModels(task: string, ctx: any, agent?: string): any[] {
  const roles: Record<string, Role> = {coder:"coding", fixer:"coding", detective:"coding", researcher:"research", planner:"reasoning", reviewer:"reasoning", inventor:"reasoning", scout:"fast"};
  const role = roles[agent ?? ""] ?? classify(task);
  return [...(ctx.scopedModels ?? [])].map((entry: any) => entry.model)
    .filter((model: any) => eligible(model, ctx))
    .sort((a: any, b: any) => {
      // Prices are catalog estimates, not subscription quota or entitlement.
      if (role === "fast") {
        const price = (m: any) => Number.isFinite(m.cost?.input) && Number.isFinite(m.cost?.output) && m.cost.input + m.cost.output > 0 ? m.cost.input + m.cost.output : Infinity;
        if (price(a) !== price(b)) return price(a) < price(b) ? -1 : 1;
      }
      if (role === "reasoning" && !!a.reasoning !== !!b.reasoning) return a.reasoning ? -1 : 1;
      const priority = (m: any) => { const i = PROVIDER_PRIORITY[role].indexOf(m.provider); return i < 0 ? 999 : i; };
      return priority(a) - priority(b);
    });
}

export function selectSubagentModel(task: string, ctx: any, agent?: string, requested?: string): string {
  const candidates = rankedModels(task, ctx, agent);
  if (requested) {
    if (!candidates.some(model => ref(model) === requested)) throw new Error("Requested subagent model is outside the active scope or is unavailable by routing policy.");
    return requested;
  }
  if (!candidates.length) throw new Error("No eligible authenticated subagent model in the active Pi scope.");
  return ref(candidates[0]);
}
