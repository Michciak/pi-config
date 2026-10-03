#!/usr/bin/env node
import fs from "node:fs/promises";

const authPath = `${process.env.HOME}/.pi/agent/auth.json`;
const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses";
const OPENCODE_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

async function auth(provider) {
  try {
    const data = JSON.parse(await fs.readFile(authPath, "utf8"));
    return data[provider] ?? null;
  } catch { return null; }
}

function configured(record) {
  return Boolean(record && (record.key || record.access || record.refresh));
}

async function openrouterQuota(record) {
  if (!record?.key) return { provider: "openrouter", license: "api-key", configured: false, quotaKnown: false, remaining: null, reason: "missing auth" };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${record.key}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { provider: "openrouter", license: "api-key", configured: true, quotaKnown: false, remaining: null, httpStatus: response.status };
    const body = await response.json();
    const total = Number(body.data?.total_credits);
    const usage = Number(body.data?.total_usage);
    const known = Number.isFinite(total) && Number.isFinite(usage);
    return {
      provider: "openrouter", license: "api-key", configured: true, quotaKnown: known,
      totalCredits: known ? total : null, totalUsage: known ? usage : null,
      remaining: known ? Math.max(0, total - usage) : null,
    };
  } catch (error) {
    return { provider: "openrouter", license: "api-key", configured: true, quotaKnown: false, remaining: null, reason: error instanceof Error ? error.message : "request failed" };
  }
}

// Codex returns quota in x-codex-* response headers (verified 2026-10-03,
// headers present even on 4xx). Minimal valid probe: stream + store:false +
// max_output_tokens>=16; the stream is aborted after headers arrive.
async function codexQuota(record) {
  const base = { provider: "openai-codex", license: "ChatGPT/Codex OAuth", configured: configured(record) };
  if (!record?.access) return { ...base, quotaKnown: false, remaining: null, reason: "missing auth" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const response = await fetch(CODEX_URL, {
      method: "POST", signal: ctl.signal,
      headers: { Authorization: `Bearer ${record.access}`, "ChatGPT-Account-Id": record.accountId ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-5.5", input: [{ role: "user", content: "Reply with: ok" }], max_output_tokens: 16, store: false, stream: true }),
    });
    const h = (name) => response.headers.get(name);
    const primaryUsed = Number(h("x-codex-primary-used-percent"));
    const secondaryUsed = Number(h("x-codex-secondary-used-percent"));
    clearTimeout(timer);
    ctl.abort();
    try { await response.text(); } catch { /* stream aborted by design */ }
    if (!Number.isFinite(primaryUsed)) {
      return { ...base, quotaKnown: false, remaining: null, httpStatus: response.status, reason: "x-codex headers absent" };
    }
    return {
      ...base, quotaKnown: true,
      planType: h("x-codex-plan-type"),
      primaryUsedPercent: primaryUsed,
      secondaryUsedPercent: Number.isFinite(secondaryUsed) ? secondaryUsed : null,
      primaryResetsAt: h("x-codex-primary-reset-at"),
      remaining: Math.max(0, 100 - primaryUsed), // percent of primary window left
      unit: "percent",
    };
  } catch (error) {
    clearTimeout(timer);
    return { ...base, quotaKnown: false, remaining: null, reason: error instanceof Error ? error.message : "request failed" };
  }
}

// opencode zen API (verified 2026-10-03): GET /zen/go/v1/usage returns
// rolling/weekly/monthly percent + status + resetsAt.
async function opencodeQuota(record) {
  const base = { provider: "opencode-go", license: "opencode-go API key", configured: configured(record) };
  if (!record?.key) return { ...base, quotaKnown: false, remaining: null, reason: "missing auth" };
  try {
    const response = await fetch(OPENCODE_USAGE_URL, {
      headers: { Authorization: `Bearer ${record.key}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { ...base, quotaKnown: false, remaining: null, httpStatus: response.status };
    const body = await response.json();
    const u = body.usage ?? {};
    const pct = (w) => Number(u[w]?.percent);
    if (![pct("rolling"), pct("weekly"), pct("monthly")].every(Number.isFinite)) {
      return { ...base, quotaKnown: false, remaining: null, reason: "unexpected usage payload" };
    }
    return {
      ...base, quotaKnown: true,
      rollingUsedPercent: pct("rolling"), weeklyUsedPercent: pct("weekly"), monthlyUsedPercent: pct("monthly"),
      status: { rolling: u.rolling?.status, weekly: u.weekly?.status, monthly: u.monthly?.status },
      resetsAt: { rolling: u.rolling?.resetsAt, weekly: u.weekly?.resetsAt, monthly: u.monthly?.resetsAt },
      remaining: Math.max(0, 100 - Math.max(pct("rolling"), pct("weekly"), pct("monthly"))),
      unit: "percent",
    };
  } catch (error) {
    return { ...base, quotaKnown: false, remaining: null, reason: error instanceof Error ? error.message : "request failed" };
  }
}

// GitHub Copilot: license reported expired; verified 2026-10-03 via
// api.github.com/user -> 401 with the stored access token.
async function copilotQuota(record) {
  const base = { provider: "github-copilot", license: "GitHub Copilot OAuth", configured: configured(record) };
  if (!configured(record)) return { ...base, quotaKnown: false, remaining: null, reason: "missing auth" };
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${record.access}`, Accept: "application/vnd.github+json", "User-Agent": "pi-config" },
      signal: AbortSignal.timeout(8000),
    });
    if (response.status === 401) {
      return { ...base, authValid: false, quotaKnown: false, remaining: null, reason: "license expired (GitHub auth 401)" };
    }
    return { ...base, authValid: response.ok, quotaKnown: false, remaining: null, httpStatus: response.status, reason: "no supported public quota endpoint" };
  } catch (error) {
    return { ...base, quotaKnown: false, remaining: null, reason: error instanceof Error ? error.message : "request failed" };
  }
}

// Cursor: no public quota endpoint found (SDK exposes no quota surface;
// only api.cursor.com base). Manual verification only — never invent a value.
function cursorQuota(record) {
  return {
    provider: "cursor", license: "Cursor API key", configured: configured(record),
    quotaKnown: false, remaining: null,
    reason: configured(record) ? "no public quota endpoint — manual verification only" : "missing auth",
  };
}

export async function checkQuotas() {
  const [openrouter, codex, copilot, cursor, opencode] = await Promise.all([
    auth("openrouter"), auth("openai-codex"), auth("github-copilot"), auth("cursor"), auth("opencode-go"),
  ]);
  const [orq, cxq, cpq, ocq] = await Promise.all([
    openrouterQuota(openrouter), codexQuota(codex), copilotQuota(copilot), opencodeQuota(opencode),
  ]);
  return {
    openrouter: orq, "openai-codex": cxq, "github-copilot": cpq,
    cursor: cursorQuota(cursor), "opencode-go": ocq,
    local: { provider: "local", license: "self-hosted", configured: true, quotaKnown: false, remaining: null, reason: "hardware-bound" },
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await checkQuotas(), null, 2));
}
