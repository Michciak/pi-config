export type UsageSeverity = "normal" | "warning" | "critical";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function usageSeverity(percent: number | undefined): UsageSeverity {
  return percent != null && percent >= 95 ? "critical" : percent != null && percent >= 80 ? "warning" : "normal";
}
export function usageHint(percent: number | undefined): string {
  if (percent == null) return "";
  const severity = usageSeverity(percent);
  return `${Math.round(percent)}% limitu${severity === "critical" ? " · limit prawie wyczerpany" : severity === "warning" ? " · zbliżasz się do limitu" : ""}`;
}
export function contextUsagePercent(context?: {percent?: number; tokens?: number | null; contextWindow?: number} | null, fallbackWindow?: number): number | undefined {
  if (finite(context?.percent) && context.percent >= 0) return context.percent;
  const limit = context?.contextWindow ?? fallbackWindow;
  return finite(context?.tokens) && context.tokens >= 0 && finite(limit) && limit > 0 ? context.tokens / limit * 100 : undefined;
}
type Quota = {state?: string; buckets?: Record<string, {percent?: number} | undefined>; limit?: number; remaining?: number; used?: number; rate?: {remainingRequests?: number; limitRequests?: number; remainingTokens?: number; limitTokens?: number}};
/** Only known limits yield warnings; an auth/subscription fallback is not zero usage. */
export function quotaUsagePercent(quota?: Quota | null): number | undefined {
  const values: number[] = [];
  const remaining = (left: unknown, limit: unknown) => {
    if (finite(left) && finite(limit) && limit > 0) values.push(Math.max(0, (1 - left / limit) * 100));
  };
  if (quota?.state === "available") {
    for (const bucket of Object.values(quota.buckets ?? {})) if (finite(bucket?.percent) && bucket.percent >= 0) values.push(bucket.percent);
    remaining(quota.remaining, quota.limit);
    if (!finite(quota.remaining) && finite(quota.used) && quota.used >= 0 && finite(quota.limit) && quota.limit > 0) values.push(quota.used / quota.limit * 100);
  }
  remaining(quota?.rate?.remainingRequests, quota?.rate?.limitRequests);
  remaining(quota?.rate?.remainingTokens, quota?.rate?.limitTokens);
  return values.length ? Math.max(...values) : undefined;
}
