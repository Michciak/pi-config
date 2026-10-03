#!/usr/bin/env node
/**
 * cost-report.mjs — agregacja telemetry kosztów (#10).
 *
 * Źródła (wszystkie lokalne, zero sekretów w outputcie):
 *   1. Sesje Pi (~/.pi/agent/sessions/**) — usage+cost per assistant message
 *      (koszt FAKTYCZNY z providera, nie estymata).
 *   2. ~/.local/state/pi-config/router-decisions.jsonl — decyzje routera.
 *   3. scripts/quota-check.mjs — live quota per provider.
 *   4. settings/model-capabilities.json — avgCostPerM (estymata gdy brak
 *      danych sesyjnych, np. modele jeszcze nieużywane).
 *
 * Użycie: node scripts/cost-report.mjs [--save]
 *   --save  zapisuje JSON do ~/.local/state/pi-config/cost-report.json
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = process.env.HOME;
const SESSIONS_ROOT = `${HOME}/.pi/agent/sessions`;
const ROUTER_LOG = `${HOME}/.local/state/pi-config/router-decisions.jsonl`;
const REPORT_PATH = `${HOME}/.local/state/pi-config/cost-report.json`;
const CAPS_PATH = new URL("../settings/model-capabilities.json", import.meta.url);

const save = process.argv.includes("--save");
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function walkSessions(root, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) walkSessions(p, out);
    else if (e.name.endsWith(".jsonl") && !e.name.includes("loadout")) out.push(p);
  }
  return out;
}

function main() {
  const caps = readJson(CAPS_PATH);
  const byModel = {}; // fullId -> {requests, inTok, outTok, reasonTok, costUsd}
  const bump = (id) => (byModel[id] ??= { requests: 0, inTok: 0, outTok: 0, reasonTok: 0, costUsd: 0 });

  let files = 0, messages = 0;
  for (const file of walkSessions(SESSIONS_ROOT)) {
    files++;
    let content;
    try { content = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.type !== "message" || e.message?.role !== "assistant" || !e.message.usage) continue;
      messages++;
      const u = e.message.usage;
      const id = `${e.message.provider ?? "?"}/${e.message.model ?? "?"}`;
      const r = bump(id);
      r.requests++;
      r.inTok += u.input || 0;
      r.outTok += u.output || 0;
      r.reasonTok += u.reasoning || 0;
      r.costUsd += u.cost?.total || 0;
    }
  }

  // Decyzje routera
  const routing = {};
  try {
    for (const line of fs.readFileSync(ROUTER_LOG, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const d = JSON.parse(line);
        routing[d.selected] = (routing[d.selected] ?? 0) + 1;
      } catch { /* skip */ }
    }
  } catch { /* brak logu */ }

  // Agregacja per provider
  const byProvider = {};
  for (const [id, r] of Object.entries(byModel)) {
    const prov = id.split("/")[0];
    const p = (byProvider[prov] ??= { requests: 0, inTok: 0, outTok: 0, costUsd: 0, models: 0 });
    p.requests += r.requests; p.inTok += r.inTok; p.outTok += r.outTok; p.costUsd += r.costUsd; p.models++;
  }

  const totalCost = Object.values(byProvider).reduce((a, p) => a + p.costUsd, 0);
  const totalReq = Object.values(byProvider).reduce((a, p) => a + p.requests, 0);

  const fmtUsd = (v) => `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`;
  const lines = [];
  lines.push(`# Cost report (${new Date().toISOString().slice(0, 10)})`);
  lines.push(`Sesje: ${files} plików, ${messages} odpowiedzi asystenta, ${totalReq} requestów, koszt FAKTYCZNY ${fmtUsd(totalCost)}`);
  lines.push("");
  lines.push("## Per provider (usage z sesji)");
  for (const [prov, p] of Object.entries(byProvider).sort((a, b) => b[1].costUsd - a[1].costUsd)) {
    const avg = caps[`${prov}/`] ?? null;
    lines.push(`- ${prov}: ${p.requests} req, ${(p.inTok / 1e6).toFixed(2)}M in / ${(p.outTok / 1e6).toFixed(2)}M out, ${fmtUsd(p.costUsd)} (${p.models} modeli)`);
  }
  if (!Object.keys(byProvider).length) lines.push("(brak danych usage w sesjach)");
  lines.push("");
  lines.push("## Top modele (koszt faktyczny)");
  for (const [id, r] of Object.entries(byModel).sort((a, b) => b[1].costUsd - a[1].costUsd).slice(0, 10)) {
    lines.push(`- ${id}: ${r.requests} req, ${fmtUsd(r.costUsd)}`);
  }
  lines.push("");
  lines.push("## Decyzje routera (telemetry)");
  const routedTotal = Object.values(routing).reduce((a, b) => a + b, 0);
  for (const [id, n] of Object.entries(routing).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    lines.push(`- ${id}: ${n}x (${routedTotal ? Math.round((n / routedTotal) * 100) : 0}%)`);
  }
  if (!routedTotal) lines.push("(brak decyzji w logu)");
  lines.push("");
  lines.push("## Quota live (bramki, nie koszt)");
  try {
    const quotas = JSON.parse(execFileSync("node", [new URL("./quota-check.mjs", import.meta.url).pathname], { encoding: "utf8" }));
    for (const [k, q] of Object.entries(quotas)) {
      const state = q.quotaKnown ? `znane, remaining=${q.remaining}${q.unit === "percent" ? "%" : ""}` : `nieznane (${q.reason ?? "?"})`;
      lines.push(`- ${k}: ${state}`);
    }
  } catch { lines.push("(quota-check niedostępny)"); }

  const report = lines.join("\n");
  console.log(report);
  if (save) {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), byModel, byProvider, routing, totalCostUsd: totalCost }, null, 2) + "\n");
    console.log(`\nzapisano ${REPORT_PATH}`);
  }
}

main();
