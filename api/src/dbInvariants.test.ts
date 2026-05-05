import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('db invariants', () => {
  it('keeps advance ledger immutable via triggers', async () => {
    const sql = await fs.readFile(path.resolve(process.cwd(), '../db/migrations/003_advance_ops_hardening.sql'), 'utf8');
    expect(sql).toMatch(/prevent_advance_ledger_mutation/);
    expect(sql).toMatch(/BEFORE UPDATE ON advance_ledger_events/);
    expect(sql).toMatch(/BEFORE DELETE ON advance_ledger_events/);
  });
});
