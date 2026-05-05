export const ADVANCE_FEE_RATE_BPS = 300;
export const IMPLIED_HOLD_DAYS_DEFAULT = 35;
export const IMPLIED_HOLD_DAYS_MAX = 65;

export const REASON_CODE_DISCLOSURES: Record<string, string> = {
  NO_LEDGER_DATA: 'No verified Apple ledger yet — advances are unavailable until ingestion succeeds.',
  SPARSE_28D_WINDOW: 'Fewer than 20 days of recent revenue — limit confidence is reduced.',
  HIGH_VOLATILITY: 'Revenue swings increased risk — max advance is haircut until stability improves.',
  STALE_LEDGER: 'Ledger is older than expected — limits may understate true risk until refreshed.',
  ELEVATED_REFUND_PROXY: 'Refund pressure signal reduced the advance cap.',
};

export function aprProxyBps(feeCents: number, principalCents: number, holdDays: number): number {
  if (principalCents <= 0 || holdDays <= 0) return 0;
  const feeRatio = feeCents / principalCents;
  return Math.round(feeRatio * (365 / holdDays) * 10_000);
}

export function computeAdvanceQuote(amountCents: number): {
  feeCents: number;
  netCents: number;
  effectiveAprProxyBps: number;
} {
  const feeCents = Math.round((amountCents * ADVANCE_FEE_RATE_BPS) / 10_000);
  const netCents = amountCents - feeCents;
  return {
    feeCents,
    netCents,
    effectiveAprProxyBps: aprProxyBps(feeCents, amountCents, IMPLIED_HOLD_DAYS_DEFAULT),
  };
}

export function allocateSettlement(params: {
  amountCents: number;
  principalRemainingCents: number;
  feeRemainingCents: number;
}): { principalAppliedCents: number; feeAppliedCents: number; unappliedCents: number } {
  const amountCents = Math.max(0, params.amountCents);
  const principalRemainingCents = Math.max(0, params.principalRemainingCents);
  const feeRemainingCents = Math.max(0, params.feeRemainingCents);
  const principalAppliedCents = Math.min(amountCents, principalRemainingCents);
  const feeAppliedCents = Math.min(amountCents - principalAppliedCents, feeRemainingCents);
  const unappliedCents = Math.max(0, amountCents - principalAppliedCents - feeAppliedCents);
  return { principalAppliedCents, feeAppliedCents, unappliedCents };
}
