import { allocateSettlement } from '@swiftpay/policy';
import { pool } from './db.js';

export async function reconcileSettlementEventById(settlementEventId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ev = await client.query<{
      id: string;
      developer_id: string;
      advance_id: string;
      amount_cents: string;
      provider_event_id: string | null;
      reconciliation_state: string;
    }>(
      `select id, developer_id, advance_id, amount_cents, provider_event_id, reconciliation_state
       from settlement_events
       where id = $1
       for update`,
      [settlementEventId],
    );
    if (ev.rowCount !== 1) {
      await client.query('ROLLBACK');
      return;
    }
    const evt = ev.rows[0]!;
    if (evt.reconciliation_state === 'applied' || evt.reconciliation_state === 'ignored') {
      await client.query('COMMIT');
      return;
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
      [evt.advance_id, evt.developer_id],
    );
    if (adv.rowCount !== 1) {
      await client.query(
        `update settlement_events set reconciliation_state = 'failed', reconcile_error = 'advance_not_found' where id = $1`,
        [settlementEventId],
      );
      await client.query('COMMIT');
      return;
    }
    const a = adv.rows[0]!;
    if (a.status !== 'funded' && a.status !== 'repaid') {
      await client.query(
        `update settlement_events set reconciliation_state = 'ignored', reconcile_error = 'advance_not_funded' where id = $1`,
        [settlementEventId],
      );
      await client.query('COMMIT');
      return;
    }

    const principalRemainingCents = Math.max(0, Number(a.amount_cents) - Number(a.principal_repaid_cents));
    const feeRemainingCents = Math.max(0, Number(a.fee_cents) - Number(a.fee_repaid_cents));
    const allocation = allocateSettlement({
      amountCents: Number(evt.amount_cents),
      principalRemainingCents,
      feeRemainingCents,
    });

    await client.query(
      `update advances
       set principal_repaid_cents = principal_repaid_cents + $3,
           fee_repaid_cents = fee_repaid_cents + $4
       where id = $1 and developer_id = $2`,
      [evt.advance_id, evt.developer_id, allocation.principalAppliedCents, allocation.feeAppliedCents],
    );

    await client.query(
      `update settlement_events
       set principal_applied_cents = $2,
           fee_applied_cents = $3,
           reconciliation_state = 'applied',
           reconciled_at = now(),
           reconcile_error = null
       where id = $1`,
      [settlementEventId, allocation.principalAppliedCents, allocation.feeAppliedCents],
    );

    await client.query(
      `insert into advance_ledger_events (advance_id, event_type, metadata)
       values ($1,'advance_settlement_applied',$2::jsonb)`,
      [
        evt.advance_id,
        JSON.stringify({
          amountCents: Number(evt.amount_cents),
          principalAppliedCents: allocation.principalAppliedCents,
          feeAppliedCents: allocation.feeAppliedCents,
          providerEventId: evt.provider_event_id,
          unappliedCents: allocation.unappliedCents,
        }),
      ],
    );

    const fullyRepaid = await client.query<{ status: string }>(
      `select status from advances
       where id = $1 and developer_id = $2 and principal_repaid_cents >= amount_cents and fee_repaid_cents >= fee_cents`,
      [evt.advance_id, evt.developer_id],
    );
    if (fullyRepaid.rowCount === 1 && fullyRepaid.rows[0]!.status === 'funded') {
      await client.query(`update advances set status = 'repaid', repaid_at = now() where id = $1 and developer_id = $2`, [
        evt.advance_id,
        evt.developer_id,
      ]);
      await client.query(
        `insert into advance_ledger_events (advance_id, event_type, metadata)
         values ($1,'advance_repaid',$2::jsonb)`,
        [evt.advance_id, JSON.stringify({ via: 'worker_settlement_reconciliation' })],
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    await pool.query(
      `update settlement_events
       set reconciliation_state = 'failed',
           reconcile_error = $2
       where id = $1`,
      [settlementEventId, (e as Error).message ?? 'unknown_error'],
    );
    throw e;
  } finally {
    client.release();
  }
}
