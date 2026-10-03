#!/usr/bin/env node
/**
 * sync-models.mjs — Aktualizuje model-capabilities.json i enabledModels
 * bazując na:
 *   1. Dostępności z `pi --list-models`
 *   2. Kosztach z `~/.pi/agent/models-store.json`
 *   3. Benchmarkach z `data.benchlm.ai` (overall, coding, agentic, knowledge)
 *
 * Użycie:
 *   node scripts/sync-models.mjs [--dry-run] [--save] [--update-capabilities]
 *
 * --dry-run        tylko drukuje co by zmieniono
 * --save           zapisuje zmiany
 * --update-capabilities aktualizuje też model-capabilities.json (domyślnie)
 *
 * Zachowuje istniejące ręczne ustawienia (roles, priority override, verified).
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
const dryRun = args.includes("--dry-run");
const save = args.includes("--save");
const updateCaps = !args.includes("--no-update-capabilities");

function readJson(path) { return JSON.parse(fs.readFileSync(path, "utf8")); }
function writeJson(path, data) { fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n"); }
function log(msg, ...rest) { console.log(`[${new Date().toISOString().slice(0, 16)}] ${msg}`, ...rest); }

// ═══════════════════════════════════════════════════
// 1. Discovery: available models from pi --list-models
// ═══════════════════════════════════════════════════
function discoverModels() {
  log("Discovering models via `pi --list-models`...");
  const output = execFileSync("pi", ["--list-models"], { encoding: "utf8", maxBuffer: 10*1024*1024 });
  const models = {};
  for (const line of output.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6) continue;
    const [provider, modelId, ctx, maxOut, thinking, images] = f;
    if (!provider || !modelId) continue;
    const fullId = `${provider}/${modelId}`;
    const ctxNum = (s) => {
      const m = s.match(/^([\d.]+)([MK])$/);
      return m ? Math.round(parseFloat(m[1]) * (m[2] === "M" ? 1000000 : 1000)) : 200000;
    };
    models[fullId] = { provider, model: modelId, contextWindow: ctxNum(ctx), maxTokens: ctxNum(maxOut), hasThinking: thinking === "yes", hasVision: images === "yes" };
  }
  const providers = [...new Set(Object.values(models).map(m => m.provider))];
  log(`Discovered ${Object.keys(models).length} models from providers: ${providers.join(", ")}`);
  return models;
}

// ═══════════════════════════════════════════════════
// 2. Cost data from models-store.json
// ═══════════════════════════════════════════════════
function loadCostData() {
  log("Loading cost data from models-store.json...");
  const store = readJson(MODELS_STORE_PATH);
  const costs = {};
  for (const [provider, data] of Object.entries(store)) {
    for (const model of data.models) {
      const fullId = `${provider}/${model.id}`;
      if (model.cost) {
        const c = model.cost;
        costs[fullId] = { totalPerToken: (c.input||0)+(c.output||0), reasoning: model.reasoning, inputTypes: model.input||["text"], hasVision: Array.isArray(model.input)&&model.input.includes("image") };
      }
    }
  }
  log(`Loaded cost data for ${Object.keys(costs).length} models`);
  return costs;
}

// ═══════════════════════════════════════════════════
// 3. Benchmark data from benchlm.ai
// ═══════════════════════════════════════════════════
async function loadBenchmarks() {
  log("Loading benchmarks from benchlm.ai...");
  const benchmarks = { scores: {}, surfaces: {} };
  for (const surface of BENCHLM_SURFACES) {
    try {
      const resp = await fetch(`${BENCHLM_API}?surface=${surface}&limit=100`, { headers: { Authorization: `Bearer ${BENCHLM_TOKEN}` }, signal: AbortSignal.timeout(15000) });
      if (!resp.ok) { log(`  ${surface}: HTTP ${resp.status}`); continue; }
      const data = await resp.json();
      benchmarks.surfaces[surface] = data;
      if (data.items) {
        for (const item of data.items) {
          benchmarks.scores[item.modelKey] = benchmarks.scores[item.modelKey] || {};
          benchmarks.scores[item.modelKey][surface] = { score: item.score, rank: item.rank, interval: [item.scoreInterval90Lower, item.scoreInterval90Upper] };
        }
      }
    } catch (e) { log(`  ${surface}: error — ${e.message}`); }
  }
  for (const [modelKey, scores] of Object.entries(benchmarks.scores)) {
    let ws = 0, wt = 0;
    for (const [surface, data] of Object.entries(scores)) { ws += data.score * (BENCHLM_WEIGHTS[surface]||1); wt += 1; }
    benchmarks.scores[modelKey].weightedScore = wt > 0 ? ws/wt : null;
  }
  const withScores = Object.keys(benchmarks.scores).filter(k => benchmarks.scores[k].weightedScore !== null).length;
  log(`Loaded benchmarks for ${withScores} models (surfaces: ${BENCHLM_SURFACES.join(", ")})`);
  return benchmarks;
}

// ═══════════════════════════════════════════════════
// 4. Match benchlm modelKey to our fullId
// ═══════════════════════════════════════════════════
function matchBenchKey(benchKey, availableModels) {
  const benchLower = benchKey.toLowerCase();
  for (const fullId of Object.keys(availableModels)) {
    const modelPart = fullId.split("/")[1]?.toLowerCase();
    if (modelPart === benchLower) return fullId;
  }
  for (const fullId of Object.keys(availableModels)) {
    const modelPart = fullId.split("/")[1]?.toLowerCase();
    if (modelPart && benchLower.startsWith(modelPart)) return fullId;
  }
  return null;
}

// ═══════════════════════════════════════════════════
// 5. Build/merge capabilities
// ═══════════════════════════════════════════════════
function buildCapabilities(availableModels, costs, benchmarks, oldCaps) {
  log("Building capabilities...");
  const caps = {};

  // Preserve local models from old caps
  for (const [fullId, cap] of Object.entries(oldCaps)) {
    if (cap.local) {
      caps[fullId] = { ...cap, benchScore: null, costPerToken: cap.costPerToken || 0 };
    }
  }

  // Build remote model capabilities
  for (const [fullId, model] of Object.entries(availableModels)) {
    const cost = costs[fullId] || {};
    const reasoning = cost.reasoning || false;
    const vision = model.hasVision || cost.hasVision || false;
    const contextWindow = model.contextWindow || 200000;
    const totalCost = cost.totalPerToken || 0.01;
    let costClass = "cheap";
    if (totalCost > 10) costClass = "premium";
    else if (totalCost > 1) costClass = "standard";
    else if (totalCost > 0.1) costClass = "mid";
    const isFlash = model.model.toLowerCase().includes("flash") || model.model.toLowerCase().includes("fast");
    let latencyClass = "medium-remote";
    if (isFlash) latencyClass = "fast-remote";
    const roles = ["general"];
    if (reasoning) roles.push("reasoning");
    if (vision) roles.push("vision");

    caps[fullId] = { enabled: true, verified: true, local: false, roles, reasoning, toolCalling: true, vision, contextWindow, latencyClass, costClass, priority: 80, benchScore: null, costPerToken: totalCost };
  }

  // Merge: preserve existing settings for known models
  for (const [fullId, cap] of Object.entries(oldCaps)) {
    if (caps[fullId] && !caps[fullId].local) {
      // Preserve manual overrides
      if (cap.priority !== undefined && cap.priority !== 80) caps[fullId].priority = cap.priority;
      if (cap.verified !== undefined) caps[fullId].verified = cap.verified;
      if (cap.enabled !== undefined) caps[fullId].enabled = cap.enabled;
      if (cap.roles && cap.roles.length > 0) caps[fullId].roles = cap.roles;
    }
  }

  // Score models
  for (const [fullId, cap] of Object.entries(caps)) {
    if (cap.local) continue;
    const modelPart = fullId.split("/")[1]?.toLowerCase();
    let benchSum = 0, benchCnt = 0;
    for (const [benchKey, data] of Object.entries(benchmarks.scores || {})) {
      if (modelPart === benchKey.toLowerCase() || modelPart?.includes(benchKey.toLowerCase())) {
        if (data.weightedScore !== null) { benchSum += data.weightedScore; benchCnt++; }
        for (const surface of BENCHLM_SURFACES) { if (data[surface]) { benchSum += data[surface].score; benchCnt++; } }
      }
    }
    cap.benchScore = benchCnt > 0 ? benchSum / benchCnt : 0;
    cap.costScore = Math.max(0, 100 - (cap.costPerToken || 0) * 1000);
    cap.combinedScore = cap.benchScore * 0.7 + cap.costScore * 0.3;
    cap.priority = Math.round(70 + cap.combinedScore * 0.3);
  }

  log(`Capabilities for ${Object.keys(caps).length} models built and scored`);
  return caps;
}

// ═══════════════════════════════════════════════════
// 6. Generate diff
// ═══════════════════════════════════════════════════
function generateDiff(oldCaps, newCaps, oldEnabled, newEnabled) {
  const added = newEnabled.filter(id => !oldEnabled.includes(id));
  const removed = oldEnabled.filter(id => !newEnabled.includes(id));
  const updated = [];
  for (const id of newEnabled) {
    if (oldCaps[id] && oldCaps[id].priority !== newCaps[id]?.priority) updated.push(`${id} (priority: ${oldCaps[id].priority} → ${newCaps[id]?.priority})`);
  }
  return { added, removed, updated };
}

// ═══════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════
async function main() {
  log("=== Model Sync ===");

  const oldCaps = readJson(CAPS_PATH);
  const oldSettings = readJson(SETTINGS_PATH);
  const oldEnabled = oldSettings.enabledModels || [];

  const availableModels = discoverModels();
  const costs = loadCostData();
  const benchmarks = await loadBenchmarks();

  const newCaps = buildCapabilities(availableModels, costs, benchmarks, oldCaps);
  const newEnabled = Object.keys(newCaps);
  const diff = generateDiff(oldCaps, newCaps, oldEnabled, newEnabled);

  log("=== Diff ===");
  log(`Added: ${diff.added.length} models`);
  for (const id of diff.added.slice(0, 10)) log(`  + ${id}`);
  if (diff.added.length > 10) log(`  ... and ${diff.added.length - 10} more`);

  log(`Removed: ${diff.removed.length} models`);
  for (const id of diff.removed.slice(0, 10)) log(`  - ${id}`);

  log(`Updated: ${diff.updated.length} entries`);
  for (const id of diff.updated.slice(0, 5)) log(`  ~ ${id}`);

  log("\n=== Top Models by Combined Score ===");
  const sorted = Object.entries(newCaps).sort((a, b) => b[1].combinedScore - a[1].combinedScore).slice(0, 20);
  for (const [id, cap] of sorted) log(`  ${cap.priority} ${cap.combinedScore.toFixed(1)} ${cap.benchScore.toFixed(1)} ${id}`);

  if (save && !dryRun) {
    if (updateCaps) { writeJson(CAPS_PATH, newCaps); log(`Saved ${Object.keys(newCaps).length} capabilities to ${CAPS_PATH}`); }
    writeJson(SETTINGS_PATH, { ...oldSettings, enabledModels: [...newEnabled] });
    log(`Saved ${newEnabled.length} enabled models to ${SETTINGS_PATH}`);
  } else { log(dryRun ? "DRY RUN: no changes saved" : "No --save flag: no changes saved"); }

  log("\n=== Sync Complete ===");
}

main().catch(e => { console.error("Sync failed:", e); process.exitCode = 1; });
