-- Operational advance lifecycle hardening:
-- disbursements, settlement reconciliation, idempotency keys, immutable ledger invariants.

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_code INT,
  response_body JSONB,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (developer_id, endpoint, idempotency_key)
);

CREATE TABLE payout_disbursements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  advance_id UUID NOT NULL REFERENCES advances (id) ON DELETE CASCADE,
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'internal_stub',
  status TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'failed')),
  amount_cents BIGINT NOT NULL,
  external_transfer_id TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_at TIMESTAMPTZ,
  UNIQUE (advance_id)
);

CREATE INDEX idx_payout_disbursements_developer_created ON payout_disbursements (developer_id, created_at DESC);

CREATE TABLE settlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  developer_id UUID NOT NULL REFERENCES developers (id) ON DELETE CASCADE,
  advance_id UUID NOT NULL REFERENCES advances (id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'apple_settlement',
  provider_event_id TEXT,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  principal_applied_cents BIGINT NOT NULL CHECK (principal_applied_cents >= 0),
  fee_applied_cents BIGINT NOT NULL CHECK (fee_applied_cents >= 0),
  event_occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX idx_settlement_events_advance_time ON settlement_events (advance_id, event_occurred_at);
CREATE INDEX idx_settlement_events_developer_time ON settlement_events (developer_id, event_occurred_at DESC);

ALTER TABLE advances
  ADD COLUMN principal_repaid_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN fee_repaid_cents BIGINT NOT NULL DEFAULT 0;

ALTER TABLE advance_ledger_events DROP CONSTRAINT IF EXISTS advance_ledger_events_event_type_check;
ALTER TABLE advance_ledger_events
  ADD CONSTRAINT advance_ledger_events_event_type_check
  CHECK (
    event_type IN (
      'advance_requested',
      'advance_funded',
      'advance_repaid',
      'advance_settlement_applied',
      'advance_disbursement_posted',
      'advance_disbursement_failed',
      'note'
    )
  );

CREATE OR REPLACE FUNCTION prevent_advance_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'advance_ledger_events are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_advance_ledger_no_update ON advance_ledger_events;
CREATE TRIGGER trg_advance_ledger_no_update
BEFORE UPDATE ON advance_ledger_events
FOR EACH ROW EXECUTE FUNCTION prevent_advance_ledger_mutation();

DROP TRIGGER IF EXISTS trg_advance_ledger_no_delete ON advance_ledger_events;
CREATE TRIGGER trg_advance_ledger_no_delete
BEFORE DELETE ON advance_ledger_events
FOR EACH ROW EXECUTE FUNCTION prevent_advance_ledger_mutation();
