-- Stub payout destination + KYC checklist; advances with immutable ledger events

CREATE TABLE payout_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  bank_display_name TEXT NOT NULL DEFAULT 'Stub Bank (link not live)',
  account_last4 TEXT,
  routing_last4 TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  verification_state TEXT NOT NULL DEFAULT 'incomplete' CHECK (
    verification_state IN ('incomplete', 'pending_review', 'verified', 'rejected')
  ),
  kyc_checklist JSONB NOT NULL DEFAULT '{
    "govId": false,
    "proofOfAddress": false,
    "beneficialOwners": false,
    "bankLinkAuthorized": false
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (developer_id)
);

CREATE TABLE advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'funded', 'repaid', 'cancelled')),
  limit_decision_id UUID REFERENCES limit_decisions (id) ON DELETE SET NULL,
  ingestion_run_id UUID REFERENCES ingestion_runs (id) ON DELETE SET NULL,
  fee_rate_bps INT NOT NULL DEFAULT 300,
  implied_hold_days INT NOT NULL DEFAULT 35,
  effective_apr_proxy_bps INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  funded_at TIMESTAMPTZ,
  repaid_at TIMESTAMPTZ
);

CREATE INDEX idx_advances_developer_created ON advances (developer_id, created_at DESC);

CREATE TABLE advance_ledger_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id UUID NOT NULL REFERENCES advances (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('advance_requested', 'advance_funded', 'advance_repaid', 'note')
  ),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_advance_ledger_advance ON advance_ledger_events (advance_id, created_at);
