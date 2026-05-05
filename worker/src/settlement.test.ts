import { describe, expect, it } from 'vitest';
import { allocateSettlement } from '@swiftpay/policy';

describe('settlement allocation scenarios', () => {
  it('applies principal then fee', () => {
    const r = allocateSettlement({
      amountCents: 1200,
      principalRemainingCents: 1000,
      feeRemainingCents: 500,
    });
    expect(r.principalAppliedCents).toBe(1000);
    expect(r.feeAppliedCents).toBe(200);
    expect(r.unappliedCents).toBe(0);
  });

  it('caps overpayment as unapplied', () => {
    const r = allocateSettlement({
      amountCents: 2000,
      principalRemainingCents: 1000,
      feeRemainingCents: 300,
    });
    expect(r.principalAppliedCents).toBe(1000);
    expect(r.feeAppliedCents).toBe(300);
    expect(r.unappliedCents).toBe(700);
  });
});
