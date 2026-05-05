-- Provider account consistency and lookup performance

CREATE UNIQUE INDEX IF NOT EXISTS uq_payout_accounts_provider_account
ON payout_accounts (provider, provider_account_id)
WHERE provider_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payout_accounts_provider_state
ON payout_accounts (provider, verification_state, updated_at DESC);
