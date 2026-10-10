import type {ExtensionAPI, ExtensionContext} from '@earendil-works/pi-coding-agent';

/**
 * Zużycie i quota providerów (widget `remote-metrics`).
 *
 * Publikuje { context, quota } jako JSON. Quota jest znormalizowane i nigdy
 * nie zawiera sekretów (kluczy, tokenów, e-maili) — tylko liczby i etykiety.
 *
 * Strategie per provider (best-effort, z łagodną degradacją):
 * - openrouter:    GET /api/v1/key -> limit_remaining/limit/usage (kwoty $)
 * - opencode-go:    GET <zen>/usage -> limity rolling/weekly/monthly (%, nieudokumentowane,
 *                  całkowite); same zera przy realnym użyciu traktowane jako brak sygnału
 *                  -> status klucza + odesłanie do konsoli (etykieta Go, nie Zen)
 *                  fallback: GET <zen>/models -> tylko status klucza
 * - opencode:      brak udokumentowanego endpointu quota (/zen/v1/usage zwraca 404)
 *                  -> status klucza przez GET <zen>/models
 * - openai:        GET /v1/models -> status klucza (PAYG, brak endpointu quota)
 * - openai-codex:  plan (Plus/Pro/...) dekodowany lokalnie z JWT dostępowego;
 *                  limity ilościowe istnieją tylko w nagłówkach odpowiedzi API
 * - github-copilot:GET /models -> status autoryzacji + tier z pola sku tokenu;
 *                  odpytanie quota w nagłówkach czatu kosztowałoby requesty
 * - cursor:        brak publicznego API quota dla klucza API (dashboard www)
 * - inne:          unavailable (lub no-auth gdy brak skonfigurowanej autoryzacji)
 */

type QuotaState = 'available' | 'subscription' | 'key-ok' | 'unavailable' | 'no-auth' | 'error';

interface ZenBucket { status: string; percent: number | null; resetsAt?: string }
interface ZenBuckets { rolling?: ZenBucket; weekly?: ZenBucket; monthly?: ZenBucket }

interface RateInfo {
  remainingRequests?: number;
  limitRequests?: number;
  resetRequests?: string;
  remainingTokens?: number;
  limitTokens?: number;
  resetTokens?: string;
  /** Przefitrowane surowe nagłówki (max 15, tylko liczby/daty) do podglądu. */
  raw?: Record<string,string>;
  checkedAt?: string;
}

interface Quota {
  state: QuotaState;
  provider?: string;
  /** openrouter: pozostałe środki ($). null = brak limitu / nieznane. */
  remaining?: number | null;
  limit?: number | null;
  used?: number | null;
  reset?: unknown;
  /** zen: limity procentowe z czasami resetu. */
  buckets?: ZenBuckets;
  /** subscription/key-ok: czytelna etykieta, np. "ChatGPT Plus", "Copilot Pro". */
  plan?: string;
  detail?: string;
  checkedAt?: string;
  /** Limity z nagłówków ostatniej odpowiedzi API (zero dodatkowych requestów). */
  rate?: RateInfo;
}

const TTL_MS = 60000;
const FETCH_TIMEOUT_MS = 8000;
const MIN_PUBLISH_MS = 5000;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export default function(pi:ExtensionAPI) {
  let lastFetch = 0;
  let lastPublish = 0;
  let quota: Quota = {state:'unavailable'};
  let provider = '';
  let activeContext:ExtensionContext|undefined;
  let refreshTimer:ReturnType<typeof setInterval>|undefined;
  /** Ostatnie nagłówki rate-limit per provider (z after_provider_response). */
  let rateByProvider: Record<string, {at: number; parsed: RateInfo}> = {};

  async function getJson(url: string, headers: Record<string,string>, timeoutMs = FETCH_TIMEOUT_MS): Promise<any> {
    const response = await fetch(url, {headers, signal: AbortSignal.timeout(timeoutMs)});
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  }

  /** Świeży token/klucz providera (OAuth odświeżany pod spodem). Nigdy nie trafia do widgetu. */
  async function providerToken(ctx: ExtensionContext, name: string): Promise<string | undefined> {
    try {
      const resolved = await ctx.modelRegistry.getProviderAuth?.(name) as {auth?: {apiKey?: string}} | undefined;
      const key = resolved?.auth?.apiKey;
      if (typeof key === 'string' && key) return key;
    } catch { /* ignore, próbuj niżej */ }
    try {
      const key = await ctx.modelRegistry.getApiKeyForProvider(name);
      if (typeof key === 'string' && key) return key;
    } catch { /* ignore */ }
    return undefined;
  }

  /** Czy provider ma skonfigurowaną autoryzację. undefined = rejestr nie umie powiedzieć. */
  function authConfigured(ctx: ExtensionContext, name: string): boolean | undefined {
    try { return ctx.modelRegistry.getProviderAuthStatus?.(name)?.configured; }
    catch { return undefined; }
  }

  function planFromCodexJwt(token: string): string | undefined {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
      const raw = payload?.['https://api.openai.com/auth']?.chatgpt_plan_type;
      if (typeof raw !== 'string' || !raw) return undefined;
      const known: Record<string,string> = {
        plus: 'ChatGPT Plus', pro: 'ChatGPT Pro', team: 'ChatGPT Team',
        free: 'ChatGPT Free', enterprise: 'ChatGPT Enterprise',
        business: 'ChatGPT Business', edu: 'ChatGPT Edu',
      };
      return known[raw.toLowerCase()] ?? `ChatGPT ${raw}`;
    } catch { return undefined; }
  }

  function planFromCopilotToken(token: string): string | undefined {
    try {
      const match = /(?:^|;)sku=([^;]+)/.exec(token);
      const raw = match?.[1]?.trim();
      if (!raw) return undefined;
      const known: Record<string,string> = {
        free_limited_copilot: 'Copilot Free', copilot_free: 'Copilot Free',
        copilot_pro: 'Copilot Pro', copilot_pro_plus: 'Copilot Pro+',
        copilot_business: 'Copilot Business', copilot_enterprise: 'Copilot Enterprise',
      };
      return known[raw.toLowerCase()] ?? raw;
    } catch { return undefined; }
  }

  function zenBucket(value: unknown): ZenBucket | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const raw = value as Record<string, unknown>;
    return {
      status: typeof raw.status === 'string' ? raw.status : 'unknown',
      percent: typeof raw.percent === 'number' ? raw.percent : null,
      ...(typeof raw.resetsAt === 'string' ? {resetsAt: raw.resetsAt} : {}),
    };
  }

  async function fetchQuota(name: string, ctx: ExtensionContext): Promise<Quota> {
    const checkedAt = new Date().toISOString();
    switch (name) {
      case 'openrouter': {
        const key = await providerToken(ctx, name);
        if (!key) return {state:'no-auth', provider:name, checkedAt};
        try {
          const {data} = await getJson('https://openrouter.ai/api/v1/key', {Authorization:`Bearer ${key}`});
          return {state:'available', provider:name, remaining:data.limit_remaining ?? null, limit:data.limit ?? null, used:data.usage ?? null, reset:data.limit_reset ?? null, checkedAt};
        } catch { return {state:'error', provider:name, checkedAt}; }
      }
      case 'opencode-go':
      case 'opencode': {
        const key = await providerToken(ctx, name);
        if (!key) return {state:'no-auth', provider:name, checkedAt};
        const usageName = name === 'opencode-go' ? 'Go' : 'Zen';
        const base = name === 'opencode-go' ? 'https://opencode.ai/zen/go/v1' : 'https://opencode.ai/zen/v1';
        const headers = {Authorization:`Bearer ${key}`, Accept:'application/json', 'User-Agent':BROWSER_UA};
        try {
          const body = await getJson(`${base}/usage`, headers);
          const usage = body?.usage;
          const buckets: ZenBuckets = {
            rolling: zenBucket(usage?.rolling),
            weekly: zenBucket(usage?.weekly),
            monthly: zenBucket(usage?.monthly),
          };
          const signals = [buckets.rolling, buckets.weekly, buckets.monthly].filter(Boolean) as ZenBucket[];
          if (!signals.length) throw new Error('no buckets');
          // Endpoint zwraca całkowite procenty i bywa niezgodny z konsolą:
          // same zera przy realnym użyciu to brak sygnału, nie potwierdzenie 0%.
          const hasSignal = signals.some(b => (b.percent ?? 0) > 0 || (b.status !== 'ok' && b.status !== 'unknown'));
          if (!hasSignal) return {state:'key-ok', provider:name, detail:`${usageName.toLowerCase()} · użycie w konsoli opencode.ai`, checkedAt};
          return {state:'available', provider:name, buckets, checkedAt};
        } catch { /* fallback: sam status klucza */ }
        try {
          await getJson(`${base}/models`, headers);
          return {state:'key-ok', provider:name, detail:`${usageName.toLowerCase()} · brak odczytu limitów`, checkedAt};
        } catch { return {state:'error', provider:name, checkedAt}; }
      }
      case 'openai': {
        const key = await providerToken(ctx, name);
        if (!key) return {state:'no-auth', provider:name, checkedAt};
        try {
          await getJson('https://api.openai.com/v1/models', {Authorization:`Bearer ${key}`});
          return {state:'key-ok', provider:name, detail:'pay-as-you-go · brak endpointu quota', checkedAt};
        } catch (error) {
          const invalid = /HTTP 401/.test(String(error));
          return {state:'error', provider:name, detail: invalid ? 'nieprawidłowy klucz' : undefined, checkedAt};
        }
      }
      case 'openai-codex': {
        const token = await providerToken(ctx, name);
        if (!token) return {state:'no-auth', provider:name, checkedAt};
        return {state:'subscription', provider:name, plan:planFromCodexJwt(token), detail:'limity ilościowe w nagłówkach odpowiedzi API', checkedAt};
      }
      case 'github-copilot': {
        const token = await providerToken(ctx, name);
        if (!token) return {state:'no-auth', provider:name, checkedAt};
        const plan = planFromCopilotToken(token);
        try {
          await getJson('https://api.githubcopilot.com/models', {
            Authorization:`Bearer ${token}`, Accept:'application/json',
            'Editor-Version':'vscode/1.90.0', 'Copilot-Integration-Id':'vscode-chat', 'User-Agent':'GithubCopilot/1.0',
          });
          return {state:'subscription', provider:name, plan, detail:'quota w jednostkach premium', checkedAt};
        } catch { return {state:'error', provider:name, plan, detail:'nie udało się zweryfikować tokenu', checkedAt}; }
      }
      case 'cursor': {
        if (authConfigured(ctx, name) === false) return {state:'no-auth', provider:name, checkedAt};
        return {state:'subscription', provider:name, detail:'quota na dashboardzie cursor.com', checkedAt};
      }
      default: {
        if (authConfigured(ctx, name) === false) return {state:'no-auth', provider:name, checkedAt};
        return {state:'unavailable', provider:name, detail:'brak endpointu quota', checkedAt};
      }
    }
  }

  /** Wyciąga nagłówki limitów z odpowiedzi API (tylko liczby/daty, max 15). */
  function pickRateHeaders(headers: unknown): Record<string,string> {
    const out: Record<string,string> = {};
    if (!headers || typeof headers !== 'object') return out;
    for (const [rawKey, rawValue] of Object.entries(headers as Record<string, unknown>)) {
      const key = rawKey.toLowerCase();
      if (!/(ratelimit|rate.limit|quota|remaining|reset|^x-.*limit|limit-remaining)/.test(key)) continue;
      if (Object.keys(out).length >= 15) break;
      out[key] = String(rawValue).slice(0, 64);
    }
    return out;
  }

  function parseRate(raw: Record<string,string>): RateInfo {
    const num = (key: string): number | undefined => {
      const value = raw[key];
      return value != null && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : undefined;
    };
    const str = (key: string): string | undefined =>
      typeof raw[key] === 'string' && raw[key].length ? raw[key] : undefined;
    return {
      remainingRequests: num('x-ratelimit-remaining-requests'),
      limitRequests: num('x-ratelimit-limit-requests'),
      resetRequests: str('x-ratelimit-reset-requests'),
      remainingTokens: num('x-ratelimit-remaining-tokens'),
      limitTokens: num('x-ratelimit-limit-tokens'),
      resetTokens: str('x-ratelimit-reset-tokens'),
      ...(Object.keys(raw).length ? {raw} : {}),
    };
  }

  function rateSummary(rate?: RateInfo): string | null {
    if (!rate) return null;
    const parts: string[] = [];
    if (rate.remainingRequests != null)
      parts.push(`${rate.remainingRequests} zapytań${rate.limitRequests != null ? ` z ${rate.limitRequests}` : ''}${rate.resetRequests ? ` (reset ${rate.resetRequests})` : ''}`);
    else if (rate.remainingTokens != null)
      parts.push(`${rate.remainingTokens} tokenów${rate.resetTokens ? ` (reset ${rate.resetTokens})` : ''}`);
    else if (rate.raw && Object.keys(rate.raw).length)
      parts.push(Object.entries(rate.raw).slice(0, 3).map(([k, v]) => `${k}=${v}`).join(', '));
    return parts.length ? parts.join(' · ') : null;
  }

  function summarize(q: Quota): string {
    const who = q.provider || 'provider';
    const rate = rateSummary(q.rate);
    switch (q.state) {
      case 'available': {
        if (q.buckets) {
          const usageName = q.provider === 'opencode-go' ? 'Go' : 'Zen';
          const fmt = (label: string, b?: ZenBucket) =>
            b?.percent != null ? `${label} ${b.percent}%${b.resetsAt ? ` (reset ${b.resetsAt.slice(0,10)})` : ''}` : null;
          const parts = [fmt('rolling', q.buckets.rolling), fmt('weekly', q.buckets.weekly), fmt('monthly', q.buckets.monthly)].filter(Boolean);
          return parts.length ? `${usageName} (${who}): zużycie ${parts.join(' · ')}` : `${usageName} (${who}): limity aktywne`;
        }
        if (q.remaining == null && q.limit == null) {
          if (q.used != null) return `${who}: użyto $${Number(q.used).toFixed(2)} (klucz bez limitu)${rate ? ` · API: ${rate}` : ''}`;
          return `${who}: klucz bez limitu${rate ? ` · API: ${rate}` : ''}`;
        }
        return `${who}: pozostało $${Number(q.remaining ?? 0).toFixed(2)} z $${Number(q.limit ?? 0).toFixed(2)} (użyto $${Number(q.used ?? 0).toFixed(2)})${rate ? ` · API: ${rate}` : ''}`;
      }
      case 'subscription': return `${who}: ${q.plan ?? 'subskrypcja'}${q.detail ? ` · ${q.detail}` : ''}${rate ? ` · API: ${rate}` : ''}`;
      case 'key-ok': return `${who}: klucz działa${q.detail ? ` · ${q.detail}` : ''}${rate ? ` · API: ${rate}` : ''}`;
      case 'no-auth': return `${who}: brak logowania`;
      default: return `${who}: brak danych quota${q.detail ? ` · ${q.detail}` : ''}`;
    }
  }

  async function currentQuota(ctx: ExtensionContext, force = false): Promise<Quota> {
    const current = ctx.model?.provider ?? '';
    if (current !== provider) { provider = current; lastFetch = 0; lastPublish = 0; quota = {state:'unavailable', provider}; }
    if (force || Date.now() - lastFetch > TTL_MS) {
      lastFetch = Date.now();
      try {
        const next = await fetchQuota(current, ctx);
        if (provider !== current) return quota;
        quota = next;
      } catch {
        if (provider !== current) return quota;
        quota = {state:'error', provider:current};
      }
    }
    const rate = rateByProvider[current];
    if (rate) quota = {...quota, rate:{...rate.parsed, checkedAt:new Date(rate.at).toISOString()}};
    else if (quota.rate) {
      const {rate: _dropped, ...rest} = quota;
      quota = rest;
    }
    return quota;
  }

  async function publish(ctx: ExtensionContext, force = false): Promise<Quota> {
    const current = await currentQuota(ctx, force);
    if (!process.env.PI_WEB_SESSION_ID) return current;
    // Widget zapisujemy rzadziej niż pobieramy (after_provider_response bywa co kilka sekund).
    if (force || current.provider !== provider || Date.now() - lastPublish > MIN_PUBLISH_MS) {
      lastPublish = Date.now();
      ctx.ui.setWidget('remote-metrics', [JSON.stringify({context:ctx.getContextUsage(), quota:current})]);
    }
    return current;
  }

  // Zdarzenia pasywne odświeżają widget tylko w sesjach webowych (bez ruchu w CLI).
  // Komenda /quota zawsze pobiera na świeżo i powiadamia — działa i w CLI, i w remote.
  const webOnly = (handler: (event: any, ctx: ExtensionContext) => Promise<void>) => async (event: any, ctx: ExtensionContext) => {
    if (process.env.PI_WEB_SESSION_ID) await handler(event, ctx);
  };
  pi.on('session_start', webOnly(async (_event, ctx) => {
    activeContext=ctx;
    if(refreshTimer)clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>{if(activeContext)void publish(activeContext).catch(()=>{});},TTL_MS);
    refreshTimer.unref();
    await publish(ctx);
  }));
  pi.on('session_shutdown',async()=>{if(refreshTimer)clearInterval(refreshTimer);refreshTimer=undefined;activeContext=undefined;});
  pi.on('agent_end', webOnly(async (_event, ctx) => { await publish(ctx); }));
  pi.on('turn_end', webOnly(async (_event, ctx) => { await publish(ctx); }));
  pi.on('model_select', webOnly(async (_event, ctx) => { activeContext=ctx;await publish(ctx); }));
  pi.on('after_provider_response', webOnly(async (event, ctx) => {
    const current = ctx.model?.provider ?? '';
    const raw = pickRateHeaders((event as {headers?: unknown}).headers);
    if (current && Object.keys(raw).length) rateByProvider[current] = {at: Date.now(), parsed: parseRate(raw)};
    await publish(ctx);
  }));
  pi.registerCommand('quota', {
    description: 'Pokaż zużycie i quota aktywnego providera',
    handler: async (_args, ctx) => {
      const current = await publish(ctx, true);
      ctx.ui.notify(summarize(current), 'info');
    },
  });
}
