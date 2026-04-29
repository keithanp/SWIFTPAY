import { createHash } from 'node:crypto';

export const POLICY_VERSION = 'v1.0.0';

export type DailyUsdPoint = { date: string; netUsdCents: number };

export type PolicyResult = {
  policy_version: string;
  trailing_28d_net_usd_cents: number;
  trailing_90d_net_usd_cents: number;
  coefficient_of_variation: number;
  refund_pressure_proxy: number;
  max_advance_cents: number;
  recommended_advance_cents: number;
  confidence: number;
  staleness_hours: number;
  reason_codes: string[];
  expires_at: string;
  inputs_snapshot_hash: string;
};

function sumCents(points: DailyUsdPoint[]): number {
  return points.reduce((a, p) => a + p.netUsdCents, 0);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v = mean(values.map((x) => (x - m) ** 2));
  return Math.sqrt(v);
}

export function hashPolicyInputs(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export type PolicyContext = {
  now: Date;
  /** Latest day present in ledger (ISO date), if any */
  latestLedgerDate: string | null;
  /** v1: optional scalar 0..1 if refunds inferred externally */
  refund_pressure_proxy?: number;
};

/**
 * v1 policy: USD-normalized daily net series only.
 * - max_advance = min(0.65 * trailing_28d, 0.45 * trailing_90d, hard_cap)
 * - recommended = 0.6 * max_advance
 * - confidence downgraded for sparse data, high CV, staleness
 */
export function computePolicy(
  dailyUsd: DailyUsdPoint[],
  ctx: PolicyContext,
): PolicyResult {
  const sorted = [...dailyUsd].sort((a, b) => a.date.localeCompare(b.date));
  const refund_pressure_proxy = ctx.refund_pressure_proxy ?? 0;

  const lastDate = sorted.length ? sorted[sorted.length - 1]!.date : null;
  let staleness_hours = 0;
  if (lastDate) {
    const last = new Date(`${lastDate}T23:59:59.000Z`).getTime();
    staleness_hours = Math.max(0, (ctx.now.getTime() - last) / 3600_000);
  } else {
    staleness_hours = 24 * 365;
  }

  const last28 = sorted.filter((p) => {
    if (!ctx.latestLedgerDate) return false;
    const cutoff = new Date(`${ctx.latestLedgerDate}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 27);
    return new Date(`${p.date}T00:00:00.000Z`) >= cutoff;
  });

  const last90 = sorted.filter((p) => {
    if (!ctx.latestLedgerDate) return false;
    const cutoff = new Date(`${ctx.latestLedgerDate}T00:00:00.000Z`);
    cutoff.setUTCDate(cutoff.getUTCDate() - 89);
    return new Date(`${p.date}T00:00:00.000Z`) >= cutoff;
  });

  const trailing_28d_net_usd_cents = sumCents(last28);
  const trailing_90d_net_usd_cents = sumCents(last90);

  const dailyAmounts = last28.map((p) => p.netUsdCents / 100);
  const cv =
    mean(dailyAmounts) > 0 ? stddev(dailyAmounts) / mean(dailyAmounts) : dailyAmounts.length ? 1 : 0;

  const hard_cap_cents = 250_000_00; // $250k prototype cap
  const cap28 = Math.floor(trailing_28d_net_usd_cents * 0.65);
  const cap90 = Math.floor(trailing_90d_net_usd_cents * 0.45);
  let max_advance_cents = Math.min(cap28, cap90, hard_cap_cents);
  max_advance_cents = Math.max(0, max_advance_cents);

  let recommended_advance_cents = Math.floor(max_advance_cents * 0.6);

  const reason_codes: string[] = [];
  let confidence = 1;

  if (sorted.length === 0) {
    reason_codes.push('NO_LEDGER_DATA');
    confidence = 0;
    max_advance_cents = 0;
    recommended_advance_cents = 0;
  }

  if (last28.length < 20) {
    reason_codes.push('SPARSE_28D_WINDOW');
    confidence *= 0.85;
  }

  if (cv > 0.45) {
    reason_codes.push('HIGH_VOLATILITY');
    confidence *= 0.8;
    max_advance_cents = Math.floor(max_advance_cents * 0.85);
    recommended_advance_cents = Math.floor(max_advance_cents * 0.6);
  }

  if (staleness_hours > 24 * 3) {
    reason_codes.push('STALE_LEDGER');
    confidence *= 0.75;
  }

  if (refund_pressure_proxy > 0.15) {
    reason_codes.push('ELEVATED_REFUND_PROXY');
    confidence *= 0.85;
    max_advance_cents = Math.floor(max_advance_cents * 0.9);
    recommended_advance_cents = Math.floor(max_advance_cents * 0.6);
  }

  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(4))));

  const expires = new Date(ctx.now.getTime() + 24 * 3600_000);

  const inputs_snapshot_hash = hashPolicyInputs({
    sorted: sorted.slice(-120),
    ctx: {
      latestLedgerDate: ctx.latestLedgerDate,
      refund_pressure_proxy,
      now: ctx.now.toISOString(),
    },
  });

  return {
    policy_version: POLICY_VERSION,
    trailing_28d_net_usd_cents,
    trailing_90d_net_usd_cents,
    coefficient_of_variation: Number(cv.toFixed(4)),
    refund_pressure_proxy,
    max_advance_cents,
    recommended_advance_cents,
    confidence,
    staleness_hours: Number(staleness_hours.toFixed(2)),
    reason_codes,
    expires_at: expires.toISOString(),
    inputs_snapshot_hash,
  };
}
