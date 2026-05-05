export type DashboardSummary = {
  decision: {
    id: string;
    computed_at: string;
    policy_version: string;
    max_advance_cents: number;
    recommended_advance_cents: number;
    confidence: number;
    staleness_hours: number;
    reason_codes: string[];
    expires_at: string;
    inputs_snapshot_hash: string;
    explainability: Record<string, unknown>;
    ingestion_run_id: string;
  };
  features: {
    trailing_28d_net_usd_cents: number;
    trailing_90d_net_usd_cents: number;
    coefficient_of_variation: number;
    refund_pressure_proxy: number;
  } | null;
  ledgerDaily: { date: string; netUsdCents: number }[];
  latestRun: {
    id: string;
    status: string;
    finished_at: string | null;
    reports_stored: number;
    rows_parsed: number;
    error_message: string | null;
  } | null;
  outstandingAdvanceCents: number;
  availableAfterAdvancesCents: number;
};

export type PayoutProfile = {
  bankDisplayName: string;
  accountLast4: string | null;
  routingLast4: string | null;
  currency: string;
  verificationState: string;
  provider?: string;
  providerAccountId?: string | null;
  providerVerificationStatus?: string | null;
  providerFailureCode?: string | null;
  providerFailureMessage?: string | null;
  kycChecklist: {
    govId: boolean;
    proofOfAddress: boolean;
    beneficialOwners: boolean;
    bankLinkAuthorized: boolean;
  };
  updatedAt?: string;
};

export type PricingTransparency = {
  feeSchedule: {
    advanceFeeRatePercent: number;
    feeRateBps: number;
    notes: string[];
  };
  appleDelayAssumptions: { impliedHoldDaysMin: number; impliedHoldDaysMax: number; copy: string };
  illustrativeApr: {
    basisPointsAt35DayHold: number;
    basisPointsAt65DayHold: number;
    aprPercentAt35DayHold: string;
    aprPercentAt65DayHold: string;
    formula: string;
  };
  chargebacksAndDelays: { title: string; bullets: string[] };
  activeReasonCodes: string[];
  reasonCodeDisclosures: Record<string, string>;
};

export type AdvanceRow = {
  id: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
  status: string;
  limitDecisionId: string | null;
  ingestionRunId: string | null;
  feeRateBps: number;
  impliedHoldDays: number;
  effectiveAprProxyBps: number | null;
  principalRepaidCents?: number;
  feeRepaidCents?: number;
  createdAt: string;
  fundedAt: string | null;
  repaidAt: string | null;
};

export type SettlementReconcileResult = {
  advanceId: string;
  status: string;
  principalAppliedCents?: number;
  feeAppliedCents?: number;
};

export type OutstandingSeriesPoint = {
  date: string;
  principalOutstandingCents: number;
  feeOutstandingCents: number;
  totalOutstandingCents: number;
};

export type OutstandingSummary = {
  principalOutstandingCents: number;
  feeOutstandingCents: number;
  totalOutstandingCents: number;
  feeRealizedCents: number;
  principalRepaidCents: number;
  fundedCount: number;
  repaidCount: number;
};

export type OpsMetrics = {
  pendingSettlements: number;
  failedSettlements: number;
  failedDisbursements: number;
  staleIngestions72h: number;
  idempotencyCompletions24h: number;
};
