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
};
