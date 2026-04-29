import { describe, expect, it } from 'vitest';
import { computePolicy, hashPolicyInputs, POLICY_VERSION } from './policy.js';

const fixedNow = new Date('2025-04-15T12:00:00.000Z');

function days(n: number, start: string, centsPerDay: number) {
  const out: { date: string; netUsdCents: number }[] = [];
  const d = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < n; i++) {
    out.push({
      date: d.toISOString().slice(0, 10),
      netUsdCents: centsPerDay + i * 100, // slight drift
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe('computePolicy', () => {
  it('returns zeros and reason when no data', () => {
    const r = computePolicy([], { now: fixedNow, latestLedgerDate: null });
    expect(r.max_advance_cents).toBe(0);
    expect(r.reason_codes).toContain('NO_LEDGER_DATA');
    expect(r.confidence).toBe(0);
    expect(r.policy_version).toBe(POLICY_VERSION);
  });

  it('computes advances for stable 90d series', () => {
    const daily = days(90, '2025-01-16', 50_000_00);
    const latest = daily[daily.length - 1]!.date;
    const r = computePolicy(daily, { now: fixedNow, latestLedgerDate: latest });
    expect(r.trailing_28d_net_usd_cents).toBeGreaterThan(0);
    expect(r.trailing_90d_net_usd_cents).toBeGreaterThan(r.trailing_28d_net_usd_cents);
    expect(r.max_advance_cents).toBeGreaterThan(0);
    expect(r.recommended_advance_cents).toBe(Math.floor(r.max_advance_cents * 0.6));
    expect(r.inputs_snapshot_hash).toHaveLength(64);
  });

  it('downgrades for high volatility', () => {
    const base = days(90, '2025-01-16', 10_000_00);
    // spike every 7 days
    for (let i = 0; i < base.length; i += 7) {
      base[i] = { ...base[i]!, netUsdCents: 200_000_00 };
    }
    const latest = base[base.length - 1]!.date;
    const stable = computePolicy(days(90, '2025-01-16', 10_000_00), {
      now: fixedNow,
      latestLedgerDate: latest,
    });
    const volatile = computePolicy(base, { now: fixedNow, latestLedgerDate: latest });
    expect(volatile.coefficient_of_variation).toBeGreaterThan(stable.coefficient_of_variation);
    expect(volatile.reason_codes).toContain('HIGH_VOLATILITY');
    const uncapped = Math.min(
      Math.floor(volatile.trailing_28d_net_usd_cents * 0.65),
      Math.floor(volatile.trailing_90d_net_usd_cents * 0.45),
      250_000_00,
    );
    expect(volatile.max_advance_cents).toBeLessThanOrEqual(uncapped);
    expect(volatile.max_advance_cents).toBeLessThanOrEqual(Math.floor(uncapped * 0.85) + 1); // volatility haircut
  });
});

describe('hashPolicyInputs', () => {
  it('is deterministic', () => {
    expect(hashPolicyInputs({ a: 1 })).toBe(hashPolicyInputs({ a: 1 }));
    expect(hashPolicyInputs({ a: 1 })).not.toBe(hashPolicyInputs({ a: 2 }));
  });
});
