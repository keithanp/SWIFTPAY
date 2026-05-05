# Advance Operations Runbook

## Failed disbursement

1. Check `GET /v1/ops/metrics` for `failedDisbursements`.
2. Inspect `payout_disbursements.failure_code` and `failure_message`.
3. Validate payout profile (`/v1/payout-profile`) has:
   - `verificationState=verified`
   - `provider=stripe`
   - `providerAccountId` set to a valid connected account (`acct_...`).
4. Confirm Stripe platform balance and API key scope.
5. Retry by re-requesting transition `requested -> funded` with a new idempotency key.

## Stuck pending settlement

1. Check `GET /v1/ops/metrics` for `pendingSettlements`.
2. Validate worker is running (`swiftpay-settlement` queue).
3. Requeue via `POST /v1/settlements/ingest` or wait for sweep (`SETTLEMENT_SWEEP_MS`).
4. If an event is poisoned, inspect `settlement_events.reconcile_error` and patch payload mapping.

## Webhook replay / duplicate events

1. Check `webhook_events` for repeated `provider,event_id`.
2. Duplicates are expected from Stripe retries; route is idempotent.
3. Never delete webhook history rows; treat as audit log.
4. If signature failures spike, rotate `STRIPE_WEBHOOK_SECRET` and verify endpoint config in Stripe Dashboard.
