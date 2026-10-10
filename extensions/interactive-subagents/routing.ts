import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

type Role = "coding" | "research" | "reasoning" | "fast" | "general";
const roleNames:Record<string,Role>={coder:"coding",worker:"coding",fixer:"coding",detective:"coding",researcher:"research",explorer:"research",planner:"reasoning",reviewer:"reasoning",oracle:"reasoning",inventor:"reasoning",scout:"fast"};

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
  // Concrete work takes precedence over generic phrasing such as "investigate".
  if (/\b(napraw|blad|bledy|zaimplementuj|refaktoryzuj|testy|debug|fix|implement|code|refactor|test|bug|typescript|javascript|python)\b/.test(text)) return "coding";
  if (/\b(zaplanuj|zaprojektuj|architektura|architekture|przeanalizuj|plan|architecture|design|trade-?off|reason|analy[sz]e|review)\b/.test(text)) return "reasoning";
  if (/\b(szukaj|wyszukaj|porownaj|zrodla|search|research|sources?|web|compare|look up|investigate)\b/.test(text)) return "research";
  if (/\b(krotko|szybko|podsumuj|quick|brief|short|summarize|simple)\b/.test(text)) return "fast";
  return "general";
}

export function ref(model: any): string { return `${model.provider}/${model.id}`; }

function capabilities():Record<string,any> {
  const path = process.env.PI_ROUTER_CAPABILITIES || join(homedir(), "projects", "pi-config", "settings", "model-capabilities.json");
  try { return JSON.parse(readFileSync(path,"utf8")).models??{}; } catch { return {}; }
}

function eligible(model: any, ctx: any, entries:Record<string,any>): boolean {
  if (!UNSUPPORTED_FOR_CODEX_CHATGPT.has(ref(model)) && ctx?.modelRegistry?.hasConfiguredAuth && !ctx.modelRegistry.hasConfiguredAuth(model)) return false;
  const entry=entries[ref(model)];
  return entry?.enabled!==false && entry?.eligibleForAutomaticRouting!==false && !(entry?.verified&&entry.toolCalling===false) && !UNSUPPORTED_FOR_CODEX_CHATGPT.has(ref(model));
}

export function taskProfile(task:string,agent?:string) {
  const text=task.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/ł/g,"l");
  const classified=classify(task),role=classified==="general"?(roleNames[agent??""]??classified):classified;
  const complex=/\b(architecture|architektur\w*|security|bezpieczen\w*|concurrency|race condition|wspolbiezn\w*|distributed|production|refactor|refaktoryz\w*)\b/.test(text);
  const economical=!complex && (role==="fast" || /\b(krotko|szybko|quick|brief|simple|prosty|prosta|prostego|small|drobny)\b/.test(text));
  const vision=/\b(analy[sz]e|inspect|read|przeanalizuj|odczytaj)\b.{0,35}\b(screenshot|image|photo|diagram|zrzut|obraz|zdjecie)\b/.test(text);
  const context=text.match(/\b(\d+(?:\.\d+)?)\s*(k|m)?\s*(?:tokens|tokenow|tokenow kontekstu)\b/);
  const minimumContext=context?Number(context[1])*(context[2]==="m"?1e6:context[2]==="k"?1e3:1):0;
  return {role,economical,vision,minimumContext,reasoning:complex||role==="reasoning"};
}

function price(model:any):number {
  // Zero subscription prices are unknown here, not evidence of free/fast use.
  return Number.isFinite(model.cost?.input)&&Number.isFinite(model.cost?.output)&&model.cost.input+model.cost.output>0?model.cost.input+model.cost.output:Infinity;
}

function remoteRank(task:string,ctx:any,agent:string|undefined,entries:Record<string,any>):any[] {
  const profile=taskProfile(task,agent);
  const models=[...(ctx.scopedModels??[])].map((entry:any)=>entry.model).filter((model:any)=>{
    const cap=entries[ref(model)];
    const vision=cap?.verified&&typeof cap.vision==="boolean"?cap.vision:model.input?.includes("image");
    return eligible(model,ctx,entries)&&(!profile.vision||vision===true)&&(!profile.minimumContext||model.contextWindow>=profile.minimumContext);
  });
  const fit=(model:any)=>{
    const cap=entries[ref(model)],verified=cap?.verified===true;
    const reasoning=verified&&typeof cap.reasoning==="boolean"?cap.reasoning:model.reasoning;
    return [verified&&cap.roles?.includes(profile.role)?1:0,profile.reasoning&&reasoning===true?1:0,profile.economical&&verified?(cap.latencyClass==="fast"?2:cap.latencyClass==="balanced"?1:0):0];
  };
  return models.sort((a:any,b:any)=>{
    const left=fit(a),right=fit(b);
    for(let index=0;index<left.length;index++)if(left[index]!==right[index])return right[index]-left[index];
    if(profile.economical&&price(a)!==price(b))return price(a)<price(b)?-1:1;
    // Equivalent evidence: do not switch merely for variety or provider brand.
    const parent=ctx.model?ref(ctx.model):undefined;
    return Number(ref(b)===parent)-Number(ref(a)===parent);
  });
}

export function rankedModels(task: string, ctx: any, agent?: string): any[] {
  const entries=capabilities();
  if(process.env.PI_WEB_SESSION_ID||ctx.remoteDelegation)return remoteRank(task,ctx,agent,entries);
  const role = roleNames[agent ?? ""] ?? classify(task);
  return [...(ctx.scopedModels ?? [])].map((entry: any) => entry.model)
    .filter((model: any) => eligible(model, ctx,entries))
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
