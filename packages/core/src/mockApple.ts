import { gzipBuffer } from './parserSalesV1.js';

export type MockReportDescriptor = {
  report_identifier: string;
  report_type: 'SALES_SUMMARY';
  report_date: string;
  gzip: Buffer;
};

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Generates deterministic mock Apple-like gzipped TSV payloads for local / test ingestion.
 */
export function generateMockReports(params: {
  developerSeed: string;
  days?: number;
  anchorDate?: Date;
}): MockReportDescriptor[] {
  const days = params.days ?? 120;
  const anchor = params.anchorDate ?? new Date();
  const out: MockReportDescriptor[] = [];
  let hash = 0;
  for (let i = 0; i < params.developerSeed.length; i++) hash += params.developerSeed.charCodeAt(i);
  for (let i = 0; i < days; i++) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() - i);
    const date = iso(d);
    const base = 12_000_00 + (hash % 5) * 100_00 + (i % 7) * 50_00;
    const tsv = [
      'APP_SKU\tDATE\tCURRENCY\tNET_USD_CENTS',
      `com.swiftpay.demo\t${date}\tUSD\t${base}`,
    ].join('\n');
    const gzip = gzipBuffer(Buffer.from(tsv, 'utf8'));
    out.push({
      report_identifier: `mock_sales_${date}`,
      report_type: 'SALES_SUMMARY',
      report_date: date,
      gzip,
    });
  }
  return out;
}
