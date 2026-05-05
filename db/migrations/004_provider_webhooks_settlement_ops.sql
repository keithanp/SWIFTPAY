-- Provider integration scaffolding + asynchronous settlement reconciliation primitives.

ALTER TABLE payout_accounts
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'internal_stub',
  ADD COLUMN provider_account_id TEXT,
  ADD COLUMN provider_bank_account_id TEXT,
  ADD COLUMN provider_customer_id TEXT,
  ADD COLUMN provider_verification_status TEXT,
  ADD COLUMN provider_failure_code TEXT,
  ADD COLUMN provider_failure_message TEXT,
  ADD COLUMN provider_last_webhook_at TIMESTAMPTZ,
  ADD COLUMN verified_at TIMESTAMPTZ;

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  developer_id UUID REFERENCES developers (id) ON DELETE SET NULL,
  signature_valid BOOLEAN NOT NULL DEFAULT false,
  payload JSONB NOT NULL DEFAULT '{}',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received', 'processed', 'failed')),
  processing_error TEXT,
  UNIQUE (provider, event_id)
);

ALTER TABLE settlement_events
  ADD COLUMN reconciliation_state TEXT NOT NULL DEFAULT 'pending' CHECK (reconciliation_state IN ('pending', 'applied', 'ignored', 'failed')),
  ADD COLUMN reconciled_at TIMESTAMPTZ,
  ADD COLUMN reconcile_error TEXT;

CREATE INDEX idx_webhook_events_provider_received ON webhook_events (provider, received_at DESC);
CREATE INDEX idx_settlement_events_reconciliation_state ON settlement_events (reconciliation_state, created_at);
