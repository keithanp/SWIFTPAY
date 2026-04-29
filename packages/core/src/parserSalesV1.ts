import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

export const PARSER_SALES_V1 = 'sales-tsv-v1';

export type ParsedRevenueRow = {
  app_sku: string;
  revenue_date: string;
  currency: string;
  net_proceeds_cents: number;
  row_fingerprint: string;
};

function fingerprint(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * v1 canonical internal format (UTF-8 TSV), optionally gzip-compressed on disk.
 * Header row must be: APP_SKU\tDATE\tCURRENCY\tNET_USD_CENTS
 */
export function parseSalesTsvV1(buffer: Buffer): ParsedRevenueRow[] {
  const text = maybeGunzip(buffer).toString('utf8').trim();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0]!.split('\t');
  if (
    header.length !== 4 ||
    header[0] !== 'APP_SKU' ||
    header[1] !== 'DATE' ||
    header[2] !== 'CURRENCY' ||
    header[3] !== 'NET_USD_CENTS'
  ) {
    throw new Error('INVALID_SALES_TSV_HEADER');
  }
  const rows: ParsedRevenueRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split('\t');
    if (cols.length !== 4) throw new Error(`INVALID_SALES_TSV_ROW:${i + 1}`);
    const [app_sku, revenue_date, currency, centsStr] = cols as [string, string, string, string];
    const net_proceeds_cents = Number(centsStr);
    if (!Number.isFinite(net_proceeds_cents)) throw new Error(`INVALID_CENTS_ROW:${i + 1}`);
    const row_fingerprint = fingerprint([app_sku, revenue_date, currency, centsStr]);
    rows.push({ app_sku, revenue_date, currency, net_proceeds_cents, row_fingerprint });
  }
  return rows;
}

export function maybeGunzip(buf: Buffer): Buffer {
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    return gunzipSync(buf);
  }
  return buf;
}

export function gzipBuffer(buf: Buffer): Buffer {
  return gzipSync(buf);
}
