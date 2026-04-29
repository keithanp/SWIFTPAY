-- Swiftpay pipeline core schema (Postgres)

CREATE TABLE developers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  api_secret_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE apple_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  issuer_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  private_key_encrypted BYTEA NOT NULL,
  private_key_iv BYTEA NOT NULL,
  private_key_auth_tag BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ,
  UNIQUE (developer_id)
);

CREATE TABLE ingestion_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT,
  reports_attempted INT NOT NULL DEFAULT 0,
  reports_stored INT NOT NULL DEFAULT 0,
  rows_parsed INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_runs_developer_created ON ingestion_runs (developer_id, created_at DESC);

CREATE TABLE raw_report_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  ingestion_run_id UUID REFERENCES ingestion_runs (id) ON DELETE SET NULL,
  report_identifier TEXT NOT NULL,
  report_type TEXT NOT NULL,
  report_date DATE NOT NULL,
  storage_path TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  byte_size BIGINT NOT NULL,
  parser_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (developer_id, report_identifier)
);

CREATE INDEX idx_raw_reports_developer_date ON raw_report_objects (developer_id, report_date DESC);

CREATE TABLE revenue_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  app_sku TEXT NOT NULL DEFAULT '',
  revenue_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  net_proceeds_cents BIGINT NOT NULL,
  source_raw_report_id UUID NOT NULL REFERENCES raw_report_objects (id) ON DELETE CASCADE,
  row_fingerprint TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (developer_id, source_raw_report_id, row_fingerprint)
);

CREATE INDEX idx_revenue_daily_developer_date ON revenue_daily (developer_id, revenue_date DESC);

CREATE TABLE feature_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  policy_version TEXT NOT NULL,
  features JSONB NOT NULL,
  ingestion_run_id UUID REFERENCES ingestion_runs (id) ON DELETE SET NULL
);

CREATE INDEX idx_feature_snapshots_developer ON feature_snapshots (developer_id, computed_at DESC);

CREATE TABLE limit_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  policy_version TEXT NOT NULL,
  max_advance_cents BIGINT NOT NULL,
  recommended_advance_cents BIGINT NOT NULL,
  confidence NUMERIC NOT NULL,
  staleness_hours NUMERIC NOT NULL,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  expires_at TIMESTAMPTZ NOT NULL,
  inputs_snapshot_hash TEXT NOT NULL,
  explainability JSONB NOT NULL,
  ingestion_run_id UUID REFERENCES ingestion_runs (id) ON DELETE SET NULL
);

CREATE INDEX idx_limit_decisions_developer ON limit_decisions (developer_id, computed_at DESC);
