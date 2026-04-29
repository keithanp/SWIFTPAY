import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generateMockReports, parseSalesTsvV1, PARSER_SALES_V1 } from '@swiftpay/core';
import { computePolicy } from '@swiftpay/policy';
import { config } from './config.js';
import { pool } from './db.js';

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export async function runIngestion(developerId: string, ingestionRunId: string): Promise<void> {
  await pool.query(
    `update ingestion_runs set status = 'running', started_at = now() where id = $1 and developer_id = $2`,
    [ingestionRunId, developerId],
  );

  let reportsAttempted = 0;
  let reportsStored = 0;
  let rowsParsed = 0;

  try {
    const reports = config.appleMock
      ? generateMockReports({ developerSeed: developerId, days: 90 })
      : [];

    if (!config.appleMock) {
      throw new Error('APPLE_MOCK=false requires ASC client (TODO: implement real downloader).');
    }

    const baseDir = path.join(config.dataDir, 'raw', developerId, ingestionRunId);
    await fs.mkdir(baseDir, { recursive: true });

    for (const rep of reports) {
      reportsAttempted += 1;
      const storageRel = path.join('raw', developerId, ingestionRunId, `${rep.report_identifier}.gz`);
      const absPath = path.join(config.dataDir, storageRel);
      await fs.writeFile(absPath, rep.gzip);
      const content_sha256 = sha256(rep.gzip);

      const ins = await pool.query<{ id: string }>(
        `insert into raw_report_objects (developer_id, ingestion_run_id, report_identifier, report_type, report_date, storage_path, content_sha256, byte_size, parser_version)
         values ($1,$2,$3,$4,$5::date,$6,$7,$8,$9)
         on conflict (developer_id, report_identifier) do nothing
         returning id`,
        [
          developerId,
          ingestionRunId,
          rep.report_identifier,
          rep.report_type,
          rep.report_date,
          storageRel,
          content_sha256,
          rep.gzip.length,
          PARSER_SALES_V1,
        ],
      );

      if (ins.rowCount !== 1) {
        // Already ingested idempotently — skip parsing duplicate raw
        continue;
      }
      reportsStored += 1;
      const rawId = ins.rows[0]!.id;

      let parsedRows;
      try {
        parsedRows = parseSalesTsvV1(rep.gzip);
      } catch (e) {
        throw new Error(`PARSE_FAILED:${rep.report_identifier}:${(e as Error).message}`);
      }

      for (const row of parsedRows) {
        const insRow = await pool.query(
          `insert into revenue_daily (developer_id, app_sku, revenue_date, currency, net_proceeds_cents, source_raw_report_id, row_fingerprint, parser_version)
           values ($1,$2,$3::date,$4,$5,$6,$7,$8)
           on conflict (developer_id, source_raw_report_id, row_fingerprint) do nothing`,
          [
            developerId,
            row.app_sku,
            row.revenue_date,
            row.currency,
            row.net_proceeds_cents,
            rawId,
            row.row_fingerprint,
            PARSER_SALES_V1,
          ],
        );
        if (insRow.rowCount === 1) rowsParsed += 1;
      }
    }

    const series = await pool.query<{ d: string; cents: string }>(
      `select revenue_date::text as d, sum(net_proceeds_cents)::text as cents
       from revenue_daily
       where developer_id = $1 and currency = 'USD'
       group by revenue_date
       order by revenue_date asc`,
      [developerId],
    );

    const dailyUsd = series.rows.map((r) => ({ date: r.d, netUsdCents: Number(r.cents) }));
    const latestLedgerDate = dailyUsd.length ? dailyUsd[dailyUsd.length - 1]!.date : null;
    const policy = computePolicy(dailyUsd, { now: new Date(), latestLedgerDate });

    await pool.query(
      `insert into feature_snapshots (developer_id, policy_version, features, ingestion_run_id)
       values ($1,$2,$3::jsonb,$4)`,
      [
        developerId,
        policy.policy_version,
        JSON.stringify({
          trailing_28d_net_usd_cents: policy.trailing_28d_net_usd_cents,
          trailing_90d_net_usd_cents: policy.trailing_90d_net_usd_cents,
          coefficient_of_variation: policy.coefficient_of_variation,
          refund_pressure_proxy: policy.refund_pressure_proxy,
        }),
        ingestionRunId,
      ],
    );

    const explainability = {
      report_types: ['SALES_SUMMARY'],
      parser_version: PARSER_SALES_V1,
      window: {
        earliest_day: dailyUsd[0]?.date ?? null,
        latest_day: latestLedgerDate,
        points: dailyUsd.length,
      },
      ingestion_run_id: ingestionRunId,
      apple_mode: config.appleMock ? 'mock' : 'asc_api',
      // TODO(counsel): map reason_codes to user-facing disclosures.
    };

    await pool.query(
      `insert into limit_decisions (
         developer_id, policy_version, max_advance_cents, recommended_advance_cents,
         confidence, staleness_hours, reason_codes, expires_at, inputs_snapshot_hash, explainability, ingestion_run_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9,$10::jsonb,$11)`,
      [
        developerId,
        policy.policy_version,
        policy.max_advance_cents,
        policy.recommended_advance_cents,
        policy.confidence,
        policy.staleness_hours,
        policy.reason_codes,
        policy.expires_at,
        policy.inputs_snapshot_hash,
        JSON.stringify(explainability),
        ingestionRunId,
      ],
    );

    await pool.query(
      `update ingestion_runs set status = 'succeeded', finished_at = now(), reports_attempted = $2, reports_stored = $3, rows_parsed = $4 where id = $1`,
      [ingestionRunId, reportsAttempted, reportsStored, rowsParsed],
    );
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    await pool.query(
      `update ingestion_runs set status = 'failed', finished_at = now(), error_message = $2, reports_attempted = $3, reports_stored = $4, rows_parsed = $5 where id = $1`,
      [ingestionRunId, msg, reportsAttempted, reportsStored, rowsParsed],
    );
    throw e;
  }
}
