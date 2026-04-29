import { describe, expect, it } from 'vitest';
import { generateMockReports } from './mockApple.js';
import { gzipBuffer, parseSalesTsvV1 } from './parserSalesV1.js';

describe('parseSalesTsvV1', () => {
  it('parses plain and gzipped TSV', () => {
    const tsv = 'APP_SKU\tDATE\tCURRENCY\tNET_USD_CENTS\ncom.app\t2025-03-01\tUSD\t12345\n';
    const plain = parseSalesTsvV1(Buffer.from(tsv, 'utf8'));
    expect(plain).toHaveLength(1);
    expect(plain[0]!.net_proceeds_cents).toBe(12345);
    const gz = gzipBuffer(Buffer.from(tsv, 'utf8'));
    const parsed = parseSalesTsvV1(gz);
    expect(parsed).toEqual(plain);
  });

  it('parses mock apple gzip fixtures', () => {
    const [first] = generateMockReports({ developerSeed: 'abc', days: 3 });
    const rows = parseSalesTsvV1(first.gzip);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.currency).toBe('USD');
  });
});
