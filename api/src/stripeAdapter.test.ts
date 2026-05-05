import { describe, expect, it, vi } from 'vitest';
import { dispatchStripeTransfer } from './stripeAdapter.js';

describe('dispatchStripeTransfer', () => {
  it('returns transfer id on success', async () => {
    const stripe = {
      transfers: {
        create: vi.fn().mockResolvedValue({ id: 'tr_123' }),
      },
    } as any;
    const r = await dispatchStripeTransfer({
      stripe,
      connectedAccountId: 'acct_123',
      amountCents: 5000,
      idempotencyKey: 'idem',
      maxRetries: 2,
      baseBackoffMs: 1,
    });
    expect(r).toEqual({ ok: true, externalTransferId: 'tr_123' });
  });

  it('retries transient errors and eventually fails', async () => {
    const stripe = {
      transfers: {
        create: vi.fn().mockRejectedValue({ type: 'StripeConnectionError', message: 'network' }),
      },
    } as any;
    const r = await dispatchStripeTransfer({
      stripe,
      connectedAccountId: 'acct_123',
      amountCents: 5000,
      idempotencyKey: 'idem',
      maxRetries: 1,
      baseBackoffMs: 1,
    });
    expect(r.ok).toBe(false);
    expect(stripe.transfers.create).toHaveBeenCalledTimes(2);
  });
});
