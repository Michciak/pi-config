#!/usr/bin/env node
import fs from "node:fs/promises";

const authPath = `${process.env.HOME}/.pi/agent/auth.json`;

async function auth(provider) {
  try {
    const data = JSON.parse(await fs.readFile(authPath, "utf8"));
    return data[provider] ?? null;
  } catch { return null; }
}

async function openrouterQuota() {
  const record = await auth("openrouter");
  if (!record?.key) return { provider: "openrouter", license: "api-key", configured: false, quotaKnown: false, reason: "missing auth" };
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${record.key}` }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { provider: "openrouter", license: "api-key", configured: true, quotaKnown: false, httpStatus: response.status };
    const body = await response.json();
    const total = Number(body.data?.total_credits);
    const usage = Number(body.data?.total_usage);
    return {
      provider: "openrouter", license: "api-key", configured: true, quotaKnown: Number.isFinite(total) && Number.isFinite(usage),
      totalCredits: Number.isFinite(total) ? total : null,
      totalUsage: Number.isFinite(usage) ? usage : null,
      remaining: Number.isFinite(total) && Number.isFinite(usage) ? Math.max(0, total - usage) : null,
    };
  } catch (error) { return { provider: "openrouter", license: "api-key", configured: true, quotaKnown: false, reason: error instanceof Error ? error.message : "request failed" }; }
}

export async function checkQuotas() {
  const codex = await auth("openai-codex");
  return {
    openrouter: await openrouterQuota(),
    "openai-codex": {
      provider: "openai-codex", license: "ChatGPT/Codex OAuth", configured: !!codex,
      quotaKnown: false, remaining: null,
      reason: "Pi login confirms OAuth; no supported public quota endpoint is configured",
    },
    local: {
      provider: "local", license: "self-hosted", configured: true,
      quotaKnown: false, remaining: null, reason: "capacity is governed by local hardware, not provider quota",
    },
  };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await checkQuotas(), null, 2));
}
