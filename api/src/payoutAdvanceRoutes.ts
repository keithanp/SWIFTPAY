import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pool } from './db.js';
import { authMiddleware } from './auth.js';

type AuthedRequest = FastifyRequest & { auth: { developerId: string } };

const FEE_RATE_BPS = 300;
const IMPLIED_HOLD_DAYS_DEFAULT = 35;
const IMPLIED_HOLD_DAYS_MAX = 65;

function aprProxyBps(feeCents: number, principalCents: number, holdDays: number): number {
  if (principalCents <= 0 || holdDays <= 0) return 0;
  const feeRatio = feeCents / principalCents;
  return Math.round(feeRatio * (365 / holdDays) * 10_000);
}

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
         updated_at = now()
       where developer_id = $1`,
      [
        developerId,
        body.bankDisplayName ?? null,
        body.accountLast4 ?? null,
        body.routingLast4 ?? null,
        body.currency ?? null,
        body.verificationState ?? null,
      ],
    );
    const row = (await pool.query(`select * from payout_accounts where developer_id = $1`, [developerId])).rows[0]!;
    return {
      bankDisplayName: row.bank_display_name,
      accountLast4: row.account_last4,
      routingLast4: row.routing_last4,
      currency: row.currency,
      verificationState: row.verification_state,
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
      `update payout_accounts set verification_state = 'verified', updated_at = now() where developer_id = $1`,
      [developerId],
    );
    return { ok: true, verificationState: 'verified' };
  });

  app.get('/v1/pricing-transparency', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const lim = await pool.query<{ reason_codes: string[] }>(
      `select reason_codes from limit_decisions where developer_id = $1 order by computed_at desc limit 1`,
      [developerId],
    );
    const activeReasons = lim.rows[0]?.reason_codes ?? [];

    const disclosures: Record<string, string> = {
      NO_LEDGER_DATA: 'No verified Apple ledger yet — advances are unavailable until ingestion succeeds.',
      SPARSE_28D_WINDOW: 'Fewer than 20 days of recent revenue — limit confidence is reduced.',
      HIGH_VOLATILITY: 'Revenue swings increased risk — max advance is haircut until stability improves.',
      STALE_LEDGER: 'Ledger is older than expected — limits may understate true risk until refreshed.',
      ELEVATED_REFUND_PROXY: 'Refund pressure signal reduced the advance cap.',
    };

    const feeOn100Usd = Math.round(100_00 * (FEE_RATE_BPS / 10_000));
    const aprAt35 = aprProxyBps(feeOn100Usd, 100_00, IMPLIED_HOLD_DAYS_DEFAULT);
    const aprAt65 = aprProxyBps(feeOn100Usd, 100_00, IMPLIED_HOLD_DAYS_MAX);

    return {
      feeSchedule: {
        advanceFeeRatePercent: FEE_RATE_BPS / 100,
        feeRateBps: FEE_RATE_BPS,
        notes: [
          'Fee is assessed on gross advance amount at funding.',
          'Net proceeds are deposited after the fee is withheld.',
        ],
      },
      appleDelayAssumptions: {
        impliedHoldDaysMin: IMPLIED_HOLD_DAYS_DEFAULT,
        impliedHoldDaysMax: IMPLIED_HOLD_DAYS_MAX,
        copy: 'Apple typically settles proceeds on a multi-week cadence. APR-style figures below assume the fee applies over that window until batch repayment — illustrative only.',
      },
      illustrativeApr: {
        basisPointsAt35DayHold: aprAt35,
        basisPointsAt65DayHold: aprAt65,
        aprPercentAt35DayHold: (aprAt35 / 100).toFixed(1),
        aprPercentAt65DayHold: (aprAt65 / 100).toFixed(1),
        formula:
          'APR proxy (bps) ≈ (fee / principal) × (365 / hold_days) × 10,000 — not a legal APR disclosure; TODO(counsel).',
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
      reasonCodeDisclosures: Object.fromEntries(activeReasons.map((c) => [c, disclosures[c] ?? 'Policy signal active.'])),
    };
  });

  app.get('/v1/advances', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const r = await pool.query(
      `select id, amount_cents, fee_cents, net_cents, status, limit_decision_id, ingestion_run_id,
              fee_rate_bps, implied_hold_days, effective_apr_proxy_bps, created_at, funded_at, repaid_at
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

  app.post('/v1/advances', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const body = (req.body ?? {}) as { amountCents?: number; limitDecisionId?: string };
    const amountCents = Number(body.amountCents);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
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
    if (lim.rowCount !== 1) return reply.code(400).send({ error: 'no_limit_decision' });
    const maxCents = Number(lim.rows[0]!.max_advance_cents);

    const out = await pool.query<{ s: string }>(
      `select coalesce(sum(amount_cents),0)::text as s from advances
       where developer_id = $1 and status in ('requested','funded')`,
      [developerId],
    );
    const outstanding = Number(out.rows[0]!.s);
    if (amountCents + outstanding > maxCents) {
      return reply.code(400).send({ error: 'exceeds_available', maxAdvanceCents: maxCents, outstandingCents: outstanding });
    }

    const feeCents = Math.round((amountCents * FEE_RATE_BPS) / 10_000);
    const netCents = amountCents - feeCents;
    const aprBps = aprProxyBps(feeCents, amountCents, IMPLIED_HOLD_DAYS_DEFAULT);
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
          feeCents,
          netCents,
          limitId,
          ingestionRunId,
          FEE_RATE_BPS,
          IMPLIED_HOLD_DAYS_DEFAULT,
          aprBps,
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
            feeCents,
            netCents,
            limitDecisionId: limitId,
            ingestionRunId,
            effectiveAprProxyBps: aprBps,
          }),
        ],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ id: advanceId, status: 'requested', amountCents, feeCents, netCents, effectiveAprProxyBps: aprBps });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.post('/v1/advances/:id/transition', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { to?: string };
    if (body.to !== 'funded' && body.to !== 'repaid' && body.to !== 'cancelled') {
      return reply.code(400).send({ error: 'to_must_be_funded_repaid_or_cancelled' });
    }

    const adv = await pool.query<{ status: string }>(
      `select status from advances where id = $1 and developer_id = $2`,
      [id, developerId],
    );
    if (adv.rowCount !== 1) return reply.code(404).send({ error: 'not_found' });
    const st = adv.rows[0]!.status;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (body.to === 'funded') {
        if (st !== 'requested') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'invalid_transition', from: st, to: 'funded' });
        }
        await client.query(
          `update advances set status = 'funded', funded_at = now() where id = $1 and developer_id = $2`,
          [id, developerId],
        );
        await client.query(
          `insert into advance_ledger_events (advance_id, event_type, metadata) values ($1,'advance_funded', '{}'::jsonb)`,
          [id],
        );
      } else if (body.to === 'repaid') {
        if (st !== 'funded') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'invalid_transition', from: st, to: 'repaid' });
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
          return reply.code(409).send({ error: 'invalid_transition', from: st, to: 'cancelled' });
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
      return { ok: true, id, status: body.to === 'funded' ? 'funded' : body.to === 'repaid' ? 'repaid' : 'cancelled' };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
}
