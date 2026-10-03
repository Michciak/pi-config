#!/usr/bin/env node
/**
 * sync-models.mjs — okresowa aktualizacja model-capabilities.json.
 *
 * Źródła (wszystkie zweryfikowane 2026-10-03):
 *   1. Dostępność .... pi --list-models (katalog licencjonowanych providerów)
 *   2. Koszt .......... ~/.pi/agent/models-store.json, $/M tokenów, ta sama
 *                       jednostka u wszystkich providerów. Cursor nie ma cen
 *                       (subskrypcja) -> costClass "subscription", neutralny scoring.
 *   3. Benchmarki ..... data.benchlm.ai (overall/coding/agentic/knowledge),
 *                       dopasowanie po nazwie bazowej modelu.
 *
 * Zasady (uzgodnione, bez tierów i kar):
 *   - Jeden uśredniony koszt: avgCostPerM = (input*3 + output) / 4  [$/M].
 *   - Subskrypcje używają kosztu KATALOGOWEGO jako sygnału preferencji
 *     (flagship $60/M przegrywa z haiku $6/M przy prostych zadaniach
 *     bez dodatkowej maszynerii). Bramki binarne (auth/health/quota)
 *     decydują o dopuszczeniu — patrz router.mjs.
 *   - costScore = max(0, 100 - avgCostPerM * 5); brak danych -> 50 (neutralny).
 *   - priority = clamp(round(70 + (bench*0.7 + cost*0.3) * 0.3), 1, 100).
 *   - Modele lokalne: pomijane (priorytet kuratorowany ręcznie).
 *   - Scope (enabledModels) NIE jest rozszerzany automatycznie:
 *     --save odświeża dane modeli w scope + usuwa wpisy zgniłe
 *     (niekatalogowane); kandydaci z katalogu są tylko RAPORTOWANI.
 *
 * Użycie:
 *   node scripts/sync-models.mjs --dry-run   # tylko raport
 *   node scripts/sync-models.mjs --save       # zapis + backup settings
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const HOME = process.env.HOME;
const SETTINGS_PATH = `${HOME}/.pi/agent/settings.json`;
const CAPS_PATH = new URL("../settings/model-capabilities.json", import.meta.url);
const MODELS_STORE_PATH = `${HOME}/.pi/agent/models-store.json`;
const BENCHLM_API = "https://data.benchlm.ai/v1/rankings/current";
const BENCHLM_TOKEN = "bld_free_socrTqI6S_KYvjfqqpAmByE0mdP-ANUp3_iu95HVItE";
const BENCHLM_SURFACES = ["overall", "coding", "agentic", "knowledge"];
const BENCHLM_WEIGHTS = { overall: 1.0, coding: 1.5, agentic: 1.5, knowledge: 1.0 };

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || !args.includes("--save");
const save = args.includes("--save");

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, d) => fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");
const log = (m, ...r) => console.log(`[${new Date().toISOString().slice(0, 16)}] ${m}`, ...r);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// 1. Katalog z pi --list-models (pomija nagłówek; openrouter/auto bez duplikacji)
function discoverModels() {
  const output = execFileSync("pi", ["--list-models"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  const models = {};
  for (const line of output.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6) continue;
    const [provider, modelId, ctx, maxOut, thinking, images] = f;
    if (!provider || !modelId || provider === "provider") continue; // nagłówek
    // modelId może już zawierać provider (openrouter/auto) — nie duplikować
    const fullId = modelId.includes("/") ? modelId : `${provider}/${modelId}`;
    const ctxNum = (s) => {
      const m = s.match(/^([\d.]+)([MK])$/);
      return m ? Math.round(parseFloat(m[1]) * (m[2] === "M" ? 1000000 : 1000)) : 200000;
    };
    models[fullId] = { provider, model: modelId, contextWindow: ctxNum(ctx), maxTokens: ctxNum(maxOut), hasThinking: thinking === "yes", hasVision: images === "yes" };
  }
  log(`discover: ${Object.keys(models).length} modeli w katalogu`);
  return models;
}

// 2. Koszty z models-store.json ($/M, ta sama jednostka wszędzie)
function loadCostData() {
  const store = readJson(MODELS_STORE_PATH);
  const costs = {};
  for (const [provider, data] of Object.entries(store)) {
    for (const model of data.models ?? []) {
      if (!model.cost) continue;
      const c = model.cost;
      const fullId = `${provider}/${model.id}`;
      costs[fullId] = {
        avgCostPerM: ((c.input || 0) * 3 + (c.output || 0)) / 4,
        reasoning: model.reasoning,
        hasVision: Array.isArray(model.input) && model.input.includes("image"),
      };
    }
  }
  log(`costs: ${Object.keys(costs).length} modeli z ceną`);
  return costs;
}

// 3. Benchmarki benchlm.ai
async function loadBenchmarks() {
  const scores = {};
  for (const surface of BENCHLM_SURFACES) {
    try {
      const resp = await fetch(`${BENCHLM_API}?surface=${surface}&limit=100`, {
        headers: { Authorization: `Bearer ${BENCHLM_TOKEN}` }, signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) { log(`${surface}: HTTP ${resp.status}`); continue; }
      for (const item of (await resp.json()).items ?? []) {
        scores[item.modelKey] = scores[item.modelKey] || {};
        scores[item.modelKey][surface] = { score: item.score, rank: item.rank };
      }
    } catch (e) { log(`${surface}: ${e.message}`); }
  }
  for (const [k, s] of Object.entries(scores)) {
    let ws = 0, wt = 0;
    for (const [surface, d] of Object.entries(s)) { ws += d.score * (BENCHLM_WEIGHTS[surface] || 1); wt += 1; }
    s.weighted = wt > 0 ? ws / wt : null;
  }
  log(`benchlm: ${Object.keys(scores).length} modeli`);
  return scores;
}

// Znane rozjazdy nazw katalogowych vs benchlm (weryfikowane ręcznie).
const BENCH_ALIASES = { "kimi-k3": "kimi-3" };
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function benchFor(modelPart, scores) {
  const candidates = [modelPart.toLowerCase()];
  const alias = BENCH_ALIASES[modelPart.toLowerCase()];
  if (alias) candidates.push(alias);
  let sum = 0, n = 0;
  for (const [key, d] of Object.entries(scores)) {
    if (!candidates.some((c) => { const a = norm(c), b = norm(key); return a === b || a.includes(b) || b.includes(a); })) continue;
    if (d.weighted !== null) { sum += d.weighted; n++; }
    for (const s of BENCHLM_SURFACES) if (d[s]) { sum += d[s].score; n++; }
  }
  return n > 0 ? sum / n : 0;
}

async function main() {
  log("=== sync-models ===");
  const caps = readJson(CAPS_PATH);
  const settings = readJson(SETTINGS_PATH);
  const enabled = settings.enabledModels ?? [];

  const catalog = discoverModels();
  const costs = loadCostData();
  const bench = await loadBenchmarks();

  const updated = [], stale = [], candidates = [];
  for (const [fullId, cap] of Object.entries(caps)) {
    if (cap.local) continue; // lokalne: ręczna kuracja
    if (!catalog[fullId]) { stale.push(fullId); continue; }
    const cat = catalog[fullId];
    const cost = costs[fullId];
    const benchScore = benchFor(fullId.split("/")[1], bench);
    const hasCost = cost && Number.isFinite(cost.avgCostPerM);
    const avgCostPerM = hasCost ? cost.avgCostPerM : null;
    // costClass: subscription przy braku danych (Cursor), inaczej z cennika
    let costClass = "subscription";
    if (hasCost) costClass = avgCostPerM > 10 ? "premium" : avgCostPerM > 1 ? "standard" : avgCostPerM > 0.1 ? "mid" : "cheap";
    const costScore = hasCost ? Math.max(0, 100 - avgCostPerM * 5) : 50;
    const combined = benchScore * 0.7 + costScore * 0.3;
    const priority = clamp(Math.round(70 + combined * 0.3), 1, 100);
    const next = {
      ...cap,
      vision: cat.hasVision || cost?.hasVision || false,
      reasoning: cost?.reasoning ?? cap.reasoning,
      contextWindow: cat.contextWindow || cap.contextWindow,
      costClass, avgCostPerM, benchScore: Math.round(benchScore * 10) / 10, priority,
    };
    if (JSON.stringify(next) !== JSON.stringify(cap)) { caps[fullId] = next; updated.push(`${fullId} p${cap.priority}->p${priority} $` + (avgCostPerM ?? "?") + "/M b" + next.benchScore); }
  }

  // Kandydaci: katalogowane w licencjonowanych providerach, spoza scope
  const licensed = new Set(["github-copilot", "openai-codex", "cursor", "opencode-go"]);
  for (const fullId of Object.keys(catalog)) {
    const prov = fullId.split("/")[0];
    if (licensed.has(prov) && !enabled.includes(fullId) && !caps[fullId]) candidates.push(fullId);
  }

  log(`updated: ${updated.length}`); for (const u of updated.slice(0, 15)) log("  ~ " + u);
  if (updated.length > 15) log(`  ... +${updated.length - 15}`);
  log(`stale (w caps, brak w katalogu): ${stale.length}`); for (const s of stale) log("  ! " + s);
  log(`kandydaci (katalog, spoza scope): ${candidates.length}`); for (const c of candidates.slice(0, 10)) log("  + " + c);
  if (candidates.length > 10) log(`  ... +${candidates.length - 10}`);

  // Top scope wg nowego scoringu
  log("top scope:");
  for (const [id, c] of Object.entries(caps).filter(([id]) => enabled.includes(id)).sort((a, b) => b[1].priority - a[1].priority).slice(0, 12))
    log(`  p${c.priority} b${c.benchScore ?? "-"} $${c.avgCostPerM ?? "?"} ${id}`);

  if (save && !dryRun) {
    writeJson(CAPS_PATH, caps);
    log(`saved ${Object.keys(caps).length} capabilities`);
  } else log("DRY RUN — bez zapisu (użyj --save)");
}

main().catch((e) => { console.error("sync failed:", e); process.exitCode = 1; });
