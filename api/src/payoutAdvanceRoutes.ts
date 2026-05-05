import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ADVANCE_FEE_RATE_BPS,
  IMPLIED_HOLD_DAYS_DEFAULT,
  IMPLIED_HOLD_DAYS_MAX,
  REASON_CODE_DISCLOSURES,
  allocateSettlement,
  aprProxyBps,
  computeAdvanceQuote,
} from '@swiftpay/policy';
import type { PoolClient } from 'pg';
import { pool } from './db.js';
import { authMiddleware } from './auth.js';
import { config } from './config.js';
import { settlementQueue } from './queue.js';
import {
  constructStripeEvent,
  createStripeClient,
  createStripeOnboardingLink,
  dispatchStripeTransfer,
  ensureStripeConnectedAccount,
} from './stripeAdapter.js';

type AuthedRequest = FastifyRequest & { auth: { developerId: string } };

async function ensurePayoutRow(developerId: string) {
  const r = await pool.query(`select * from payout_accounts where developer_id = $1`, [developerId]);
  if (r.rowCount === 0) {
    await pool.query(
      `insert into payout_accounts (developer_id) values ($1)
       on conflict (developer_id) do nothing`,
      [developerId],
    );
    return (
      await pool.query(`select * from payout_accounts where developer_id = $1`, [developerId])
    ).rows[0]!;
  }
  return r.rows[0]!;
}

function requestHash(body: unknown, extra: unknown): string {
  return createHash('sha256').update(JSON.stringify({ body, extra })).digest('hex');
}

async function beginIdempotent(
  developerId: string,
  endpoint: string,
  idempotencyKey: string,
  reqHash: string,
): Promise<{ replay: boolean; code?: number; body?: unknown }> {
  const ins = await pool.query(
    `insert into idempotency_keys (developer_id, endpoint, idempotency_key, request_hash)
     values ($1,$2,$3,$4)
     on conflict (developer_id, endpoint, idempotency_key) do nothing`,
    [developerId, endpoint, idempotencyKey, reqHash],
  );
  if (ins.rowCount === 1) return { replay: false };

  const existing = await pool.query<{
    request_hash: string;
    status: string;
    response_code: number | null;
    response_body: unknown;
  }>(
    `select request_hash, status, response_code, response_body
     from idempotency_keys
     where developer_id = $1 and endpoint = $2 and idempotency_key = $3`,
    [developerId, endpoint, idempotencyKey],
  );
  if (existing.rowCount !== 1) return { replay: false };
  const row = existing.rows[0]!;
  if (row.request_hash !== reqHash) {
    return {
      replay: true,
      code: 409,
      body: { error: 'idempotency_key_reused_with_different_payload' },
    };
  }
  if (row.status === 'completed' && row.response_code != null) {
    return { replay: true, code: row.response_code, body: row.response_body };
  }
  return { replay: true, code: 409, body: { error: 'idempotent_request_in_progress' } };
}

async function finishIdempotent(
  developerId: string,
  endpoint: string,
  idempotencyKey: string,
  responseCode: number,
  body: unknown,
): Promise<void> {
  await pool.query(
    `update idempotency_keys
     set status = 'completed', response_code = $4, response_body = $5::jsonb, updated_at = now()
     where developer_id = $1 and endpoint = $2 and idempotency_key = $3`,
    [developerId, endpoint, idempotencyKey, responseCode, JSON.stringify(body)],
  );
}

async function failIdempotent(
  developerId: string,
  endpoint: string,
  idempotencyKey: string,
  err: unknown,
): Promise<void> {
  await pool.query(
    `update idempotency_keys
     set status = 'failed', response_code = 500,
         response_body = $4::jsonb, updated_at = now()
     where developer_id = $1 and endpoint = $2 and idempotency_key = $3`,
    [developerId, endpoint, idempotencyKey, JSON.stringify({ error: (err as Error).message ?? 'internal_error' })],
  );
}

function getIdempotencyKey(req: FastifyRequest): string | null {
  const header = req.headers['idempotency-key'];
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function dayIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const stripeClient = config.stripeSecretKey ? createStripeClient({
  secretKey: config.stripeSecretKey,
  webhookSecret: config.stripeWebhookSecret,
  maxRetries: config.payoutRetryMax,
  baseBackoffMs: config.payoutRetryBaseMs,
}) : null;

async function dispatchDisbursement(
  client: PoolClient,
  advanceId: string,
  developerId: string,
  amountCents: number,
  provider: string,
  providerAccountId: string | null,
  idempotencyKey: string,
): Promise<{ ok: true; externalTransferId: string } | { ok: false; failureCode: string; failureMessage: string }> {
  if (provider === 'stripe') {
    if (!stripeClient) {
      return { ok: false, failureCode: 'stripe_not_configured', failureMessage: 'Missing STRIPE_SECRET_KEY' };
    }
    if (!providerAccountId) {
      return { ok: false, failureCode: 'missing_provider_account_id', failureMessage: 'Missing Stripe connected account id' };
    }
    return dispatchStripeTransfer({
      stripe: stripeClient,
      connectedAccountId: providerAccountId,
      amountCents,
      idempotencyKey,
      maxRetries: config.payoutRetryMax,
      baseBackoffMs: config.payoutRetryBaseMs,
    });
  }

  if (provider !== 'internal_stub') {
    return {
      ok: false,
      failureCode: 'provider_not_supported',
      failureMessage: `Provider ${provider} is not supported.`,
    };
  }
  const transferId = `stub_tr_${randomUUID()}`;
  await client.query(
    `insert into payout_disbursements (advance_id, developer_id, provider, status, amount_cents, external_transfer_id, posted_at)
     values ($1,$2,$5,'posted',$3,$4,now())
     on conflict (advance_id) do update set
       status = excluded.status,
       provider = excluded.provider,
       amount_cents = excluded.amount_cents,
       external_transfer_id = excluded.external_transfer_id,
       posted_at = excluded.posted_at`,
    [advanceId, developerId, amountCents, transferId, provider],
  );
  return { ok: true, externalTransferId: transferId };
}

export async function registerPayoutAdvancePricingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/payout-profile', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const row = await ensurePayoutRow(developerId);
    return {
      bankDisplayName: row.bank_display_name,
      accountLast4: row.account_last4,
      routingLast4: row.routing_last4,
      currency: row.currency,
      verificationState: row.verification_state,
      provider: row.provider,
      providerAccountId: row.provider_account_id,
      providerVerificationStatus: row.provider_verification_status,
      providerFailureCode: row.provider_failure_code,
      providerFailureMessage: row.provider_failure_message,
      kycChecklist: row.kyc_checklist,
      updatedAt: row.updated_at,
    };
  });

  app.put('/v1/payout-profile', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    await ensurePayoutRow(developerId);
    const body = (req.body ?? {}) as {
      bankDisplayName?: string;
      accountLast4?: string;
      routingLast4?: string;
      currency?: string;
      verificationState?: string;
      provider?: string;
      providerAccountId?: string;
      providerBankAccountId?: string;
      providerCustomerId?: string;
    };
    const allowed = new Set(['incomplete', 'pending_review', 'verified', 'rejected']);
    if (body.verificationState && !allowed.has(body.verificationState)) {
      return reply.code(400).send({ error: 'invalid_verification_state' });
    }
    await pool.query(
      `update payout_accounts set
         bank_display_name = coalesce($2, bank_display_name),
         account_last4 = coalesce($3, account_last4),
         routing_last4 = coalesce($4, routing_last4),
         currency = coalesce($5, currency),
         verification_state = coalesce($6, verification_state),
         provider = coalesce($7, provider),
         provider_account_id = coalesce($8, provider_account_id),
         provider_bank_account_id = coalesce($9, provider_bank_account_id),
         provider_customer_id = coalesce($10, provider_customer_id),
         updated_at = now()
       where developer_id = $1`,
      [
        developerId,
        body.bankDisplayName ?? null,
        body.accountLast4 ?? null,
        body.routingLast4 ?? null,
        body.currency ?? null,
        body.verificationState ?? null,
        body.provider ?? null,
        body.providerAccountId ?? null,
        body.providerBankAccountId ?? null,
        body.providerCustomerId ?? null,
      ],
    );
    const row = (await pool.query(`select * from payout_accounts where developer_id = $1`, [developerId])).rows[0]!;
    return {
      bankDisplayName: row.bank_display_name,
      accountLast4: row.account_last4,
      routingLast4: row.routing_last4,
      currency: row.currency,
      verificationState: row.verification_state,
      provider: row.provider,
      providerAccountId: row.provider_account_id,
      providerVerificationStatus: row.provider_verification_status,
      providerFailureCode: row.provider_failure_code,
      providerFailureMessage: row.provider_failure_message,
      kycChecklist: row.kyc_checklist,
    };
  });

  app.put('/v1/kyc-checklist', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const row0 = await ensurePayoutRow(developerId);
    const body = (req.body ?? {}) as Partial<{
      govId: boolean;
      proofOfAddress: boolean;
      beneficialOwners: boolean;
      bankLinkAuthorized: boolean;
    }>;
    const cur = (row0.kyc_checklist as Record<string, boolean>) ?? {};
    const next = {
      govId: typeof body.govId === 'boolean' ? body.govId : Boolean(cur.govId),
      proofOfAddress: typeof body.proofOfAddress === 'boolean' ? body.proofOfAddress : Boolean(cur.proofOfAddress),
      beneficialOwners:
        typeof body.beneficialOwners === 'boolean' ? body.beneficialOwners : Boolean(cur.beneficialOwners),
      bankLinkAuthorized:
        typeof body.bankLinkAuthorized === 'boolean' ? body.bankLinkAuthorized : Boolean(cur.bankLinkAuthorized),
    };
    await pool.query(
      `update payout_accounts set kyc_checklist = $2::jsonb, updated_at = now() where developer_id = $1`,
      [developerId, JSON.stringify(next)],
    );
    const row = (await pool.query(`select * from payout_accounts where developer_id = $1`, [developerId])).rows[0]!;
    const allDone = next.govId && next.proofOfAddress && next.beneficialOwners && next.bankLinkAuthorized;
    if (allDone && row.verification_state === 'incomplete') {
      await pool.query(
        `update payout_accounts set verification_state = 'pending_review', updated_at = now() where developer_id = $1`,
        [developerId],
      );
    }
    const r2 = (await pool.query(`select * from payout_accounts where developer_id = $1`, [developerId])).rows[0]!;
    return { kycChecklist: r2.kyc_checklist, verificationState: r2.verification_state };
  });

  /** Demo: mark payout profile verified without external KYC vendor */
  app.post('/v1/payout-profile/verify-stub', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    await ensurePayoutRow(developerId);
    await pool.query(
      `update payout_accounts
       set verification_state = 'verified',
           provider_verification_status = 'verified',
           verified_at = now(),
           updated_at = now()
       where developer_id = $1`,
      [developerId],
    );
    return { ok: true, verificationState: 'verified' };
  });

  app.post('/v1/payout-profile/stripe/onboarding-link', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    if (config.payoutProvider !== 'stripe') return reply.code(400).send({ error: 'stripe_not_enabled' });
    if (!stripeClient) return reply.code(500).send({ error: 'stripe_not_configured' });

    const row = await ensurePayoutRow(developerId);
    const accountId = await ensureStripeConnectedAccount({
      stripe: stripeClient,
      existingAccountId: (row.provider_account_id as string | null) ?? null,
      developerId,
    });
    await pool.query(
      `update payout_accounts
       set provider = 'stripe',
           provider_account_id = $2,
           provider_verification_status = coalesce(provider_verification_status, 'onboarding_started'),
           verification_state = case when verification_state = 'verified' then verification_state else 'pending_review' end,
           updated_at = now()
       where developer_id = $1`,
      [developerId, accountId],
    );
    const onboardingUrl = await createStripeOnboardingLink({
      stripe: stripeClient,
      accountId,
      refreshUrl: `${config.appBaseUrl}/dashboard?stripeRefresh=1`,
      returnUrl: `${config.appBaseUrl}/dashboard?stripeReturn=1`,
    });
    return { ok: true, accountId, onboardingUrl };
  });

  app.post('/v1/webhooks/payout-provider', { config: { rawBody: true, rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    if (config.payoutProvider !== 'stripe') return reply.code(400).send({ error: 'stripe_not_enabled' });
    if (!stripeClient || !config.stripeWebhookSecret) return reply.code(500).send({ error: 'stripe_not_configured' });
    const sig = typeof req.headers['stripe-signature'] === 'string' ? req.headers['stripe-signature'] : null;
    if (!sig) return reply.code(401).send({ error: 'missing_stripe_signature' });
    const rawBody = String((req as FastifyRequest & { rawBody?: string }).rawBody ?? '');
    if (!rawBody) return reply.code(400).send({ error: 'missing_raw_body' });

    let event;
    try {
      event = constructStripeEvent({
        stripe: stripeClient,
        rawBody,
        signature: sig,
        webhookSecret: config.stripeWebhookSecret,
      });
    } catch {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    const payload = event.data.object as unknown as Record<string, unknown>;
    const metadata = (payload.metadata ?? {}) as Record<string, string>;
    const developerId = metadata.developerId ?? null;
    const advanceId = metadata.advanceId ?? null;
    const provider = 'stripe';
    req.log.info({ requestId: req.id, providerEventId: event.id, providerEventType: event.type }, 'stripe webhook received');

    const insWebhook = await pool.query(
      `insert into webhook_events (provider, event_id, event_type, developer_id, signature_valid, payload)
       values ($1,$2,$3,$4,true,$5::jsonb)
       on conflict (provider, event_id) do nothing`,
      [provider, event.id, event.type, developerId, rawBody],
    );
    if (insWebhook.rowCount === 0) return { ok: true, duplicate: true };

    try {
      if (event.type === 'charge.succeeded' && developerId && advanceId) {
        const amountCents = Number(payload.amount ?? 0);
        if (amountCents > 0) {
          const se = await pool.query<{ id: string }>(
            `insert into settlement_events (
               developer_id, advance_id, provider, provider_event_id, amount_cents,
               principal_applied_cents, fee_applied_cents, event_occurred_at, raw_payload
             ) values ($1,$2,$3,$4,$5,0,0,to_timestamp($6),$7::jsonb)
             on conflict (provider, provider_event_id) do update set raw_payload = excluded.raw_payload
             returning id`,
            [developerId, advanceId, provider, event.id, amountCents, event.created, rawBody],
          );
          if (se.rowCount === 1) {
            await settlementQueue.add('settlement-reconcile', { settlementEventId: se.rows[0]!.id }, { removeOnComplete: 1000, removeOnFail: 5000 });
          }
        }
      } else if ((event.type === 'payout.failed' || event.type === 'payout.canceled') && advanceId) {
        await pool.query(
          `update payout_disbursements
           set status = 'failed',
               failure_code = $2,
               failure_message = $3
           where advance_id = $1`,
          [advanceId, String(payload.failure_code ?? 'payout_failed'), String(payload.failure_message ?? event.type)],
        );
        await pool.query(
          `insert into advance_ledger_events (advance_id, event_type, metadata)
           values ($1,'advance_disbursement_failed',$2::jsonb)`,
          [advanceId, JSON.stringify({ providerEventType: event.type, providerEventId: event.id })],
        );
      } else if (event.type === 'payout.paid' && advanceId) {
        await pool.query(
          `update payout_disbursements
           set status = 'posted', posted_at = now(), external_transfer_id = coalesce(external_transfer_id, $2)
           where advance_id = $1`,
          [advanceId, String(payload.id ?? event.id)],
        );
      } else if (event.type === 'transfer.reversed' && developerId && advanceId) {
        const amountCents = Number(payload.amount_reversed ?? payload.amount ?? 0);
        if (amountCents > 0) {
          const se = await pool.query<{ id: string }>(
            `insert into settlement_events (
               developer_id, advance_id, provider, provider_event_id, amount_cents,
               principal_applied_cents, fee_applied_cents, event_occurred_at, raw_payload
             ) values ($1,$2,$3,$4,$5,0,0,to_timestamp($6),$7::jsonb)
             on conflict (provider, provider_event_id) do update set raw_payload = excluded.raw_payload
             returning id`,
            [developerId, advanceId, provider, event.id, amountCents, event.created, rawBody],
          );
          if (se.rowCount === 1) {
            await settlementQueue.add('settlement-reconcile', { settlementEventId: se.rows[0]!.id }, { removeOnComplete: 1000, removeOnFail: 5000 });
          }
        }
      } else if (event.type === 'account.updated') {
        const accountId = String(payload.id ?? '');
        const chargesEnabled = Boolean(payload.charges_enabled);
        const payoutsEnabled = Boolean(payload.payouts_enabled);
        const verificationState = payoutsEnabled ? 'verified' : chargesEnabled ? 'pending_review' : 'incomplete';
        await pool.query(
          `update payout_accounts
           set provider_verification_status = $2,
               verification_state = $3,
               provider_last_webhook_at = now(),
               verified_at = case when $3 = 'verified' then coalesce(verified_at, now()) else verified_at end,
               updated_at = now()
           where provider = 'stripe' and provider_account_id = $1`,
          [accountId, payoutsEnabled ? 'verified' : chargesEnabled ? 'under_review' : 'incomplete', verificationState],
        );
      }
      await pool.query(
        `update webhook_events set processed_at = now(), processing_status = 'processed'
         where provider = $1 and event_id = $2`,
        [provider, event.id],
      );
      return { ok: true };
    } catch (e) {
      await pool.query(
        `update webhook_events
         set processed_at = now(), processing_status = 'failed', processing_error = $3
         where provider = $1 and event_id = $2`,
        [provider, event.id, (e as Error).message ?? 'processing_error'],
      );
      throw e;
    }
  });

  app.get('/v1/pricing-transparency', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const lim = await pool.query<{ reason_codes: string[] }>(
      `select reason_codes from limit_decisions where developer_id = $1 order by computed_at desc limit 1`,
      [developerId],
    );
    const activeReasons = lim.rows[0]?.reason_codes ?? [];

    const feeOn100Usd = Math.round(100_00 * (ADVANCE_FEE_RATE_BPS / 10_000));
    const aprAt35 = aprProxyBps(feeOn100Usd, 100_00, IMPLIED_HOLD_DAYS_DEFAULT);
    const aprAt65 = aprProxyBps(feeOn100Usd, 100_00, IMPLIED_HOLD_DAYS_MAX);

    return {
      feeSchedule: {
        advanceFeeRatePercent: ADVANCE_FEE_RATE_BPS / 100,
        feeRateBps: ADVANCE_FEE_RATE_BPS,
        notes: [
          'Fee is assessed on gross advance amount at funding.',
          'Net proceeds are deposited after the fee is withheld.',
        ],
      },
      appleDelayAssumptions: {
        impliedHoldDaysMin: IMPLIED_HOLD_DAYS_DEFAULT,
        impliedHoldDaysMax: IMPLIED_HOLD_DAYS_MAX,
        copy: 'Apple typically settles proceeds on a multi-week cadence. Annualized cost estimates below assume the fixed fee applies over that estimated hold window until batch repayment.',
      },
      illustrativeApr: {
        basisPointsAt35DayHold: aprAt35,
        basisPointsAt65DayHold: aprAt65,
        aprPercentAt35DayHold: (aprAt35 / 100).toFixed(1),
        aprPercentAt65DayHold: (aprAt65 / 100).toFixed(1),
        formula:
          'Estimated annualized cost (bps) = (fixed fee / advance principal) × (365 / estimated hold days) × 10,000. This estimate is for transparency only and does not change the fixed fee you pay.',
      },
      chargebacksAndDelays: {
        title: 'If Apple delays or claws back revenue',
        bullets: [
          'Outstanding advances remain obligations secured against verified receivables.',
          'Severe refund spikes can trigger limit haircuts (see active reason codes).',
          'Stale ingestion reduces confidence until you run a fresh verification refresh.',
        ],
      },
      activeReasonCodes: activeReasons,
      reasonCodeDisclosures: Object.fromEntries(
        activeReasons.map((c) => [c, REASON_CODE_DISCLOSURES[c] ?? 'Policy signal active.']),
      ),
    };
  });

  app.get('/v1/advances', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const r = await pool.query(
      `select id, amount_cents, fee_cents, net_cents, status, limit_decision_id, ingestion_run_id,
              fee_rate_bps, implied_hold_days, effective_apr_proxy_bps, principal_repaid_cents, fee_repaid_cents,
              created_at, funded_at, repaid_at
       from advances where developer_id = $1 order by created_at desc limit 50`,
      [developerId],
    );
    return {
      advances: r.rows.map((row) => ({
        id: row.id,
        amountCents: Number(row.amount_cents),
        feeCents: Number(row.fee_cents),
        netCents: Number(row.net_cents),
        status: row.status,
        limitDecisionId: row.limit_decision_id,
        ingestionRunId: row.ingestion_run_id,
        feeRateBps: row.fee_rate_bps,
        impliedHoldDays: row.implied_hold_days,
        effectiveAprProxyBps: row.effective_apr_proxy_bps != null ? Number(row.effective_apr_proxy_bps) : null,
        principalRepaidCents: Number(row.principal_repaid_cents ?? 0),
        feeRepaidCents: Number(row.fee_repaid_cents ?? 0),
        createdAt: row.created_at,
        fundedAt: row.funded_at,
        repaidAt: row.repaid_at,
      })),
    };
  });

  app.get('/v1/advances/:id/ledger', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const { id } = req.params as { id: string };
    const own = await pool.query(`select 1 from advances where id = $1 and developer_id = $2`, [id, developerId]);
    if (own.rowCount !== 1) return reply.code(404).send({ error: 'not_found' });
    const ev = await pool.query(
      `select id, event_type, metadata, created_at from advance_ledger_events where advance_id = $1 order by created_at asc`,
      [id],
    );
    return { events: ev.rows };
  });

  app.post(
    '/v1/advances',
    {
      preHandler: authMiddleware,
      schema: {
        body: {
          type: 'object',
          required: ['amountCents'],
          additionalProperties: false,
          properties: {
            amountCents: { type: 'number', minimum: 1 },
            limitDecisionId: { type: 'string' },
          },
        },
      },
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const body = (req.body ?? {}) as { amountCents?: number; limitDecisionId?: string };
    const idempotencyKey = getIdempotencyKey(req);
    if (!idempotencyKey) return reply.code(400).send({ error: 'idempotency_key_required' });
    req.log.info({ requestId: req.id, idempotencyKey, endpoint: '/v1/advances' }, 'advance create requested');
    const reqHash = requestHash(body, { endpoint: '/v1/advances' });
    const idem = await beginIdempotent(developerId, '/v1/advances', idempotencyKey, reqHash);
    if (idem.replay) return reply.code(idem.code ?? 200).send(idem.body);

    const amountCents = Number(body.amountCents);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      await finishIdempotent(developerId, '/v1/advances', idempotencyKey, 400, { error: 'amountCents_required' });
      return reply.code(400).send({ error: 'amountCents_required' });
    }

    const lim = body.limitDecisionId
      ? await pool.query(
          `select id, max_advance_cents, ingestion_run_id from limit_decisions
           where developer_id = $1 and id = $2`,
          [developerId, body.limitDecisionId],
        )
      : await pool.query(
          `select id, max_advance_cents, ingestion_run_id from limit_decisions
           where developer_id = $1 order by computed_at desc limit 1`,
          [developerId],
        );
    if (lim.rowCount !== 1) {
      const outBody = { error: 'no_limit_decision' };
      await finishIdempotent(developerId, '/v1/advances', idempotencyKey, 400, outBody);
      return reply.code(400).send(outBody);
    }
    const maxCents = Number(lim.rows[0]!.max_advance_cents);

    const out = await pool.query<{ s: string }>(
      `select coalesce(sum(amount_cents),0)::text as s from advances
       where developer_id = $1 and status in ('requested','funded')`,
      [developerId],
    );
    const outstanding = Number(out.rows[0]!.s);
    if (amountCents + outstanding > maxCents) {
      const outBody = { error: 'exceeds_available', maxAdvanceCents: maxCents, outstandingCents: outstanding };
      await finishIdempotent(developerId, '/v1/advances', idempotencyKey, 400, outBody);
      return reply.code(400).send(outBody);
    }

    const quote = computeAdvanceQuote(amountCents);
    const limitId = lim.rows[0]!.id as string;
    const ingestionRunId = lim.rows[0]!.ingestion_run_id as string | null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ins = await client.query<{ id: string }>(
        `insert into advances (
           developer_id, amount_cents, fee_cents, net_cents, status,
           limit_decision_id, ingestion_run_id, fee_rate_bps, implied_hold_days, effective_apr_proxy_bps
         ) values ($1,$2,$3,$4,'requested',$5,$6,$7,$8,$9)
         returning id`,
        [
          developerId,
          amountCents,
          quote.feeCents,
          quote.netCents,
          limitId,
          ingestionRunId,
          ADVANCE_FEE_RATE_BPS,
          IMPLIED_HOLD_DAYS_DEFAULT,
          quote.effectiveAprProxyBps,
        ],
      );
      const advanceId = ins.rows[0]!.id;
      await client.query(
        `insert into advance_ledger_events (advance_id, event_type, metadata)
         values ($1,'advance_requested', $2::jsonb)`,
        [
          advanceId,
          JSON.stringify({
            amountCents,
            feeCents: quote.feeCents,
            netCents: quote.netCents,
            limitDecisionId: limitId,
            ingestionRunId,
            effectiveAprProxyBps: quote.effectiveAprProxyBps,
          }),
        ],
      );
      await client.query('COMMIT');
      const outBody = {
        id: advanceId,
        status: 'requested',
        amountCents,
        feeCents: quote.feeCents,
        netCents: quote.netCents,
        effectiveAprProxyBps: quote.effectiveAprProxyBps,
      };
      await finishIdempotent(developerId, '/v1/advances', idempotencyKey, 201, outBody);
      return reply.code(201).send(outBody);
    } catch (e) {
      await client.query('ROLLBACK');
      await failIdempotent(developerId, '/v1/advances', idempotencyKey, e);
      throw e;
    } finally {
      client.release();
    }
    },
  );

  app.post(
    '/v1/advances/:id/transition',
    {
      preHandler: authMiddleware,
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        },
        body: {
          type: 'object',
          required: ['to'],
          additionalProperties: false,
          properties: { to: { type: 'string', enum: ['funded', 'repaid', 'cancelled'] } },
        },
      },
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { to?: string };
    const idempotencyKey = getIdempotencyKey(req);
    if (!idempotencyKey) return reply.code(400).send({ error: 'idempotency_key_required' });
    req.log.info({ requestId: req.id, idempotencyKey, advanceId: id, endpoint: '/v1/advances/:id/transition' }, 'advance transition requested');
    const reqHash = requestHash(body, { endpoint: '/v1/advances/:id/transition', id });
    const idem = await beginIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, reqHash);
    if (idem.replay) return reply.code(idem.code ?? 200).send(idem.body);

    if (body.to !== 'funded' && body.to !== 'repaid' && body.to !== 'cancelled') {
      const outBody = { error: 'to_must_be_funded_repaid_or_cancelled' };
      await finishIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, 400, outBody);
      return reply.code(400).send(outBody);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const adv = await client.query<{
        status: string;
        amount_cents: string;
        fee_cents: string;
        principal_repaid_cents: string;
        fee_repaid_cents: string;
        verification_state: string | null;
        provider: string | null;
        provider_account_id: string | null;
      }>(
        `select a.status, a.amount_cents, a.fee_cents, a.principal_repaid_cents, a.fee_repaid_cents, p.verification_state, p.provider, p.provider_account_id
         from advances a
         left join payout_accounts p on p.developer_id = a.developer_id
         where a.id = $1 and a.developer_id = $2
         for update`,
        [id, developerId],
      );
      if (adv.rowCount !== 1) {
        await client.query('ROLLBACK');
        const outBody = { error: 'not_found' };
        await finishIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, 404, outBody);
        return reply.code(404).send(outBody);
      }
      const row = adv.rows[0]!;
      const st = row.status;
      const amountCents = Number(row.amount_cents);
      const feeCents = Number(row.fee_cents);
      const principalRepaidCents = Number(row.principal_repaid_cents);
      const feeRepaidCents = Number(row.fee_repaid_cents);

      if (body.to === 'funded') {
        if (st !== 'requested') {
          await client.query('ROLLBACK');
          const outBody = { error: 'invalid_transition', from: st, to: 'funded' };
          await finishIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, 409, outBody);
          return reply.code(409).send(outBody);
        }
        if (row.verification_state !== 'verified') {
          await client.query('ROLLBACK');
          const outBody = { error: 'payout_not_verified', verificationState: row.verification_state ?? 'incomplete' };
          await finishIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, 409, outBody);
          return reply.code(409).send(outBody);
        }
        const disb = await dispatchDisbursement(
          client,
          id,
          developerId,
          amountCents - feeCents,
          row.provider ?? config.payoutProvider,
          row.provider_account_id ?? null,
          idempotencyKey,
        );
        if (!disb.ok) {
          await client.query(
            `insert into payout_disbursements
              (advance_id, developer_id, provider, status, amount_cents, failure_code, failure_message)
             values ($1,$2,$6,'failed',$3,$4,$5)
             on conflict (advance_id) do update set
               status = excluded.status,
               provider = excluded.provider,
               failure_code = excluded.failure_code,
               failure_message = excluded.failure_message`,
            [id, developerId, amountCents - feeCents, disb.failureCode, disb.failureMessage, row.provider ?? config.payoutProvider],
          );
          await client.query(
            `insert into advance_ledger_events (advance_id, event_type, metadata)
             values ($1,'advance_disbursement_failed',$2::jsonb)`,
            [id, JSON.stringify({ failureCode: disb.failureCode, failureMessage: disb.failureMessage })],
          );
          await client.query('ROLLBACK');
          const outBody = { error: 'disbursement_failed', reason: disb.failureCode };
          await finishIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, 502, outBody);
          return reply.code(502).send(outBody);
        }
        await client.query(`update advances set status = 'funded', funded_at = now() where id = $1 and developer_id = $2`, [
          id,
          developerId,
        ]);
        await client.query(
          `insert into advance_ledger_events (advance_id, event_type, metadata)
           values ($1,'advance_disbursement_posted',$2::jsonb)`,
          [id, JSON.stringify({ externalTransferId: disb.externalTransferId, netCents: amountCents - feeCents })],
        );
        await client.query(
          `insert into advance_ledger_events (advance_id, event_type, metadata)
           values ($1,'advance_funded',$2::jsonb)`,
          [id, JSON.stringify({ amountCents, feeCents, netCents: amountCents - feeCents })],
        );
      } else if (body.to === 'repaid') {
        if (st !== 'funded') {
          await client.query('ROLLBACK');
          const outBody = { error: 'invalid_transition', from: st, to: 'repaid' };
          await finishIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, 409, outBody);
          return reply.code(409).send(outBody);
        }
        if (principalRepaidCents < amountCents || feeRepaidCents < feeCents) {
          await client.query('ROLLBACK');
          const outBody = {
            error: 'cannot_mark_repaid_before_settlement',
            principalRemainingCents: Math.max(0, amountCents - principalRepaidCents),
            feeRemainingCents: Math.max(0, feeCents - feeRepaidCents),
          };
          await finishIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, 409, outBody);
          return reply.code(409).send(outBody);
        }
        await client.query(
          `update advances set status = 'repaid', repaid_at = now() where id = $1 and developer_id = $2`,
          [id, developerId],
        );
        await client.query(
          `insert into advance_ledger_events (advance_id, event_type, metadata) values ($1,'advance_repaid', '{}'::jsonb)`,
          [id],
        );
      } else if (body.to === 'cancelled') {
        if (st !== 'requested') {
          await client.query('ROLLBACK');
          const outBody = { error: 'invalid_transition', from: st, to: 'cancelled' };
          await finishIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, 409, outBody);
          return reply.code(409).send(outBody);
        }
        await client.query(
          `update advances set status = 'cancelled' where id = $1 and developer_id = $2`,
          [id, developerId],
        );
        await client.query(
          `insert into advance_ledger_events (advance_id, event_type, metadata) values ($1,'note', $2::jsonb)`,
          [id, JSON.stringify({ note: 'cancelled' })],
        );
      }
      await client.query('COMMIT');
      const outBody = {
        ok: true,
        id,
        status: body.to === 'funded' ? 'funded' : body.to === 'repaid' ? 'repaid' : 'cancelled',
      };
      await finishIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, 200, outBody);
      return outBody;
    } catch (e) {
      await client.query('ROLLBACK');
      await failIdempotent(developerId, '/v1/advances/:id/transition', idempotencyKey, e);
      throw e;
    } finally {
      client.release();
    }
    },
  );

  app.post(
    '/v1/settlements/reconcile',
    {
      preHandler: authMiddleware,
      schema: {
        body: {
          type: 'object',
          required: ['events'],
          additionalProperties: false,
          properties: {
            events: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['advanceId', 'amountCents'],
                properties: {
                  advanceId: { type: 'string' },
                  amountCents: { type: 'number', minimum: 1 },
                  providerEventId: { type: 'string' },
                  occurredAt: { type: 'string' },
                  rawPayload: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const body = (req.body ?? {}) as {
      events?: Array<{
        advanceId?: string;
        amountCents?: number;
        providerEventId?: string;
        occurredAt?: string;
        rawPayload?: Record<string, unknown>;
      }>;
    };
    const idempotencyKey = getIdempotencyKey(req);
    if (!idempotencyKey) return reply.code(400).send({ error: 'idempotency_key_required' });
    req.log.info({ requestId: req.id, idempotencyKey, endpoint: '/v1/settlements/reconcile' }, 'settlement reconcile requested');
    const reqHash = requestHash(body, { endpoint: '/v1/settlements/reconcile' });
    const idem = await beginIdempotent(developerId, '/v1/settlements/reconcile', idempotencyKey, reqHash);
    if (idem.replay) return reply.code(idem.code ?? 200).send(idem.body);

    if (!Array.isArray(body.events) || body.events.length === 0) {
      const outBody = { error: 'events_required' };
      await finishIdempotent(developerId, '/v1/settlements/reconcile', idempotencyKey, 400, outBody);
      return reply.code(400).send(outBody);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const results: Array<Record<string, unknown>> = [];
      for (const ev of body.events) {
        const advanceId = ev.advanceId ?? '';
        const amountCents = Number(ev.amountCents);
        if (!advanceId || !Number.isFinite(amountCents) || amountCents <= 0) {
          results.push({ advanceId, status: 'invalid_event' });
          continue;
        }
        const adv = await client.query<{
          status: string;
          amount_cents: string;
          fee_cents: string;
          principal_repaid_cents: string;
          fee_repaid_cents: string;
        }>(
          `select status, amount_cents, fee_cents, principal_repaid_cents, fee_repaid_cents
           from advances
           where id = $1 and developer_id = $2
           for update`,
          [advanceId, developerId],
        );
        if (adv.rowCount !== 1) {
          results.push({ advanceId, status: 'not_found' });
          continue;
        }
        const row = adv.rows[0]!;
        if (row.status !== 'funded' && row.status !== 'repaid') {
          results.push({ advanceId, status: 'not_fundable_state', currentStatus: row.status });
          continue;
        }
        const principalRemaining = Math.max(0, Number(row.amount_cents) - Number(row.principal_repaid_cents));
        const feeRemaining = Math.max(0, Number(row.fee_cents) - Number(row.fee_repaid_cents));
        const allocation = allocateSettlement({
          amountCents,
          principalRemainingCents: principalRemaining,
          feeRemainingCents: feeRemaining,
        });
        const principalAppliedCents = allocation.principalAppliedCents;
        const feeAppliedCents = allocation.feeAppliedCents;
        const applied = principalAppliedCents + feeAppliedCents;

        let duplicate = false;
        if (ev.providerEventId) {
          const settled = await client.query(
            `insert into settlement_events (
               developer_id, advance_id, provider, provider_event_id, amount_cents,
               principal_applied_cents, fee_applied_cents, event_occurred_at, raw_payload, reconciliation_state
             )
             values ($1,$2,'apple_settlement',$3,$4,$5,$6,$7,$8::jsonb,'pending')
             on conflict (provider, provider_event_id) do nothing`,
            [
              developerId,
              advanceId,
              ev.providerEventId,
              amountCents,
              principalAppliedCents,
              feeAppliedCents,
              ev.occurredAt ?? new Date().toISOString(),
              JSON.stringify(ev.rawPayload ?? {}),
            ],
          );
          duplicate = settled.rowCount === 0;
        } else {
          await client.query(
            `insert into settlement_events (
               developer_id, advance_id, provider, amount_cents, principal_applied_cents, fee_applied_cents, event_occurred_at, raw_payload, reconciliation_state
             )
             values ($1,$2,'apple_settlement',$3,$4,$5,$6,$7::jsonb,'pending')`,
            [
              developerId,
              advanceId,
              amountCents,
              principalAppliedCents,
              feeAppliedCents,
              ev.occurredAt ?? new Date().toISOString(),
              JSON.stringify(ev.rawPayload ?? {}),
            ],
          );
        }
        if (duplicate) {
          results.push({ advanceId, status: 'duplicate_provider_event' });
          continue;
        }
        await client.query(
          `update settlement_events
           set reconciliation_state = 'applied', reconciled_at = now(), reconcile_error = null
           where developer_id = $1 and advance_id = $2 and provider = 'apple_settlement' and provider_event_id is not distinct from $3`,
          [developerId, advanceId, ev.providerEventId ?? null],
        );
        if (applied > 0) {
          await client.query(
            `update advances
             set principal_repaid_cents = principal_repaid_cents + $3,
                 fee_repaid_cents = fee_repaid_cents + $4
             where id = $1 and developer_id = $2`,
            [advanceId, developerId, principalAppliedCents, feeAppliedCents],
          );
          await client.query(
            `insert into advance_ledger_events (advance_id, event_type, metadata)
             values ($1,'advance_settlement_applied',$2::jsonb)`,
            [
              advanceId,
              JSON.stringify({
                amountCents,
                principalAppliedCents,
                feeAppliedCents,
                providerEventId: ev.providerEventId ?? null,
              }),
            ],
          );
        }

        const latest = await client.query<{ status: string }>(
          `select status from advances
           where id = $1 and developer_id = $2 and principal_repaid_cents >= amount_cents and fee_repaid_cents >= fee_cents`,
          [advanceId, developerId],
        );
        if (latest.rowCount === 1 && latest.rows[0]!.status === 'funded') {
          await client.query(`update advances set status = 'repaid', repaid_at = now() where id = $1 and developer_id = $2`, [
            advanceId,
            developerId,
          ]);
          await client.query(
            `insert into advance_ledger_events (advance_id, event_type, metadata)
             values ($1,'advance_repaid', $2::jsonb)`,
            [advanceId, JSON.stringify({ via: 'settlement_reconciliation' })],
          );
          results.push({ advanceId, status: 'applied_and_closed', principalAppliedCents, feeAppliedCents });
        } else {
          results.push({ advanceId, status: 'applied', principalAppliedCents, feeAppliedCents });
        }
      }
      await client.query('COMMIT');
      const outBody = { ok: true, results };
      await finishIdempotent(developerId, '/v1/settlements/reconcile', idempotencyKey, 200, outBody);
      return outBody;
    } catch (e) {
      await client.query('ROLLBACK');
      await failIdempotent(developerId, '/v1/settlements/reconcile', idempotencyKey, e);
      throw e;
    } finally {
      client.release();
    }
    },
  );

  app.post(
    '/v1/settlements/ingest',
    {
      preHandler: authMiddleware,
      schema: {
        body: {
          type: 'object',
          required: ['events'],
          additionalProperties: false,
          properties: {
            events: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                required: ['advanceId', 'amountCents'],
                properties: {
                  advanceId: { type: 'string' },
                  amountCents: { type: 'number', minimum: 1 },
                  providerEventId: { type: 'string' },
                  occurredAt: { type: 'string' },
                  rawPayload: { type: 'object' },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const body = (req.body ?? {}) as {
      events?: Array<{ advanceId?: string; amountCents?: number; providerEventId?: string; occurredAt?: string; rawPayload?: Record<string, unknown> }>;
    };
    if (!Array.isArray(body.events) || body.events.length === 0) {
      return reply.code(400).send({ error: 'events_required' });
    }
    const out: Array<Record<string, unknown>> = [];
    for (const ev of body.events) {
      const advanceId = ev.advanceId ?? '';
      const amountCents = Number(ev.amountCents);
      if (!advanceId || !Number.isFinite(amountCents) || amountCents <= 0) {
        out.push({ advanceId, status: 'invalid_event' });
        continue;
      }
      const ins = await pool.query<{ id: string }>(
        `insert into settlement_events (
           developer_id, advance_id, provider, provider_event_id, amount_cents, principal_applied_cents, fee_applied_cents, event_occurred_at, raw_payload, reconciliation_state
         ) values ($1,$2,'apple_settlement',$3,$4,0,0,$5,$6::jsonb,'pending')
         on conflict (provider, provider_event_id) do nothing
         returning id`,
        [developerId, advanceId, ev.providerEventId ?? null, amountCents, ev.occurredAt ?? new Date().toISOString(), JSON.stringify(ev.rawPayload ?? {})],
      );
      if (ins.rowCount !== 1) {
        out.push({ advanceId, status: 'duplicate_provider_event' });
        continue;
      }
      await settlementQueue.add('settlement-reconcile', { settlementEventId: ins.rows[0]!.id }, { removeOnComplete: 1000, removeOnFail: 5000 });
      out.push({ advanceId, status: 'queued', settlementEventId: ins.rows[0]!.id });
    }
    return { ok: true, results: out };
    },
  );

  app.get('/v1/advances/reporting/outstanding', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const q = req.query as { days?: string };
    const days = Math.max(1, Math.min(365, Number(q.days ?? 90)));
    const now = new Date();
    const start = new Date(now);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    const startIso = dayIso(start);
    const baselineEvents = await pool.query<{ event_type: string; metadata: Record<string, unknown> }>(
      `select ale.event_type, ale.metadata
       from advance_ledger_events ale
       join advances a on a.id = ale.advance_id
       where a.developer_id = $1
         and ale.created_at < $2::timestamptz
         and ale.event_type in ('advance_funded', 'advance_settlement_applied')
       order by ale.created_at asc`,
      [developerId, `${startIso}T00:00:00.000Z`],
    );
    const events = await pool.query<{ created_at: string; event_type: string; metadata: Record<string, unknown> }>(
      `select ale.created_at::text, ale.event_type, ale.metadata
       from advance_ledger_events ale
       join advances a on a.id = ale.advance_id
       where a.developer_id = $1
         and ale.created_at >= $2::timestamptz
       order by ale.created_at asc`,
      [developerId, `${startIso}T00:00:00.000Z`],
    );
    const buckets = new Map<string, { principalDelta: number; feeDelta: number }>();
    let principal = 0;
    let fee = 0;
    for (const e of baselineEvents.rows) {
      if (e.event_type === 'advance_funded') {
        principal += Number(e.metadata?.amountCents ?? 0);
        fee += Number(e.metadata?.feeCents ?? 0);
      } else if (e.event_type === 'advance_settlement_applied') {
        principal = Math.max(0, principal - Number(e.metadata?.principalAppliedCents ?? 0));
        fee = Math.max(0, fee - Number(e.metadata?.feeAppliedCents ?? 0));
      }
    }
    for (const e of events.rows) {
      const key = dayIso(new Date(e.created_at));
      const cur = buckets.get(key) ?? { principalDelta: 0, feeDelta: 0 };
      if (e.event_type === 'advance_funded') {
        cur.principalDelta += Number(e.metadata?.amountCents ?? 0);
        cur.feeDelta += Number(e.metadata?.feeCents ?? 0);
      } else if (e.event_type === 'advance_settlement_applied') {
        cur.principalDelta -= Number(e.metadata?.principalAppliedCents ?? 0);
        cur.feeDelta -= Number(e.metadata?.feeAppliedCents ?? 0);
      } else if (e.event_type === 'advance_repaid') {
        // no-op: repayment deltas are already represented by settlement-applied events
      }
      buckets.set(key, cur);
    }
    const series: Array<{ date: string; principalOutstandingCents: number; feeOutstandingCents: number; totalOutstandingCents: number }> = [];
    for (let i = 0; i < days; i += 1) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = dayIso(d);
      const delta = buckets.get(key);
      if (delta) {
        principal = Math.max(0, principal + delta.principalDelta);
        fee = Math.max(0, fee + delta.feeDelta);
      }
      series.push({
        date: key,
        principalOutstandingCents: principal,
        feeOutstandingCents: fee,
        totalOutstandingCents: principal + fee,
      });
    }
    return { days, series };
  });

  app.get('/v1/advances/reporting/summary', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const r = await pool.query<{
      principal_outstanding_cents: string;
      fee_outstanding_cents: string;
      fee_realized_cents: string;
      principal_repaid_cents: string;
      funded_count: string;
      repaid_count: string;
    }>(
      `select
         coalesce(sum(greatest(a.amount_cents - a.principal_repaid_cents, 0)),0)::text as principal_outstanding_cents,
         coalesce(sum(greatest(a.fee_cents - a.fee_repaid_cents, 0)),0)::text as fee_outstanding_cents,
         coalesce(sum(a.fee_repaid_cents),0)::text as fee_realized_cents,
         coalesce(sum(a.principal_repaid_cents),0)::text as principal_repaid_cents,
         coalesce(sum(case when a.status = 'funded' then 1 else 0 end),0)::text as funded_count,
         coalesce(sum(case when a.status = 'repaid' then 1 else 0 end),0)::text as repaid_count
       from advances a
       where a.developer_id = $1`,
      [developerId],
    );
    const x = r.rows[0]!;
    return {
      principalOutstandingCents: Number(x.principal_outstanding_cents),
      feeOutstandingCents: Number(x.fee_outstanding_cents),
      totalOutstandingCents: Number(x.principal_outstanding_cents) + Number(x.fee_outstanding_cents),
      feeRealizedCents: Number(x.fee_realized_cents),
      principalRepaidCents: Number(x.principal_repaid_cents),
      fundedCount: Number(x.funded_count),
      repaidCount: Number(x.repaid_count),
    };
  });
}
