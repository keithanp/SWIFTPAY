import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { encryptString } from '@swiftpay/core';
import { pool } from './db.js';
import { assertDeveloperExists, authMiddleware, hashApiSecret, signToken, verifyApiSecret } from './auth.js';
import { ingestQueue } from './queue.js';
import { config } from './config.js';

type AuthedRequest = FastifyRequest & { auth: { developerId: string } };

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post('/v1/developers', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string };
    if (!body.name) return reply.code(400).send({ error: 'name_required' });
    const apiSecret = `sp_live_${randomBytes(24).toString('base64url')}`;
    const hash = await hashApiSecret(apiSecret);
    const r = await pool.query<{ id: string }>(
      `insert into developers (name, api_secret_hash) values ($1, $2) returning id`,
      [body.name, hash],
    );
    const id = r.rows[0]!.id;
    return reply.code(201).send({
      developerId: id,
      apiSecret,
      message: 'Store apiSecret securely; it cannot be retrieved again.',
    });
  });

  app.post('/v1/auth/token', async (req, reply) => {
    const body = (req.body ?? {}) as { developerId?: string; apiSecret?: string };
    if (!body.developerId || !body.apiSecret) return reply.code(400).send({ error: 'invalid_body' });
    const r = await pool.query<{ id: string; api_secret_hash: string }>(
      'select id, api_secret_hash from developers where id = $1',
      [body.developerId],
    );
    if (r.rowCount !== 1) return reply.code(401).send({ error: 'invalid_credentials' });
    const row = r.rows[0]!;
    const ok = await verifyApiSecret(body.apiSecret, row.api_secret_hash);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });
    const token = signToken(row.id);
    return { accessToken: token, tokenType: 'Bearer', expiresInSeconds: 7 * 24 * 3600 };
  });

  app.post('/v1/apple-credentials', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const body = (req.body ?? {}) as { issuerId?: string; keyId?: string; privateKey?: string };
    if (!body.issuerId || !body.keyId || !body.privateKey) {
      return reply.code(400).send({ error: 'issuerId_keyId_privateKey_required' });
    }
    const enc = encryptString(body.privateKey, config.encryptionKey);
    await pool.query(
      `insert into apple_credentials (developer_id, issuer_id, key_id, private_key_encrypted, private_key_iv, private_key_auth_tag)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (developer_id) do update set
         issuer_id = excluded.issuer_id,
         key_id = excluded.key_id,
         private_key_encrypted = excluded.private_key_encrypted,
         private_key_iv = excluded.private_key_iv,
         private_key_auth_tag = excluded.private_key_auth_tag,
         rotated_at = now()`,
      [developerId, body.issuerId, body.keyId, enc.ciphertext, enc.iv, enc.authTag],
    );
    return { ok: true };
  });

  app.post('/v1/verification/refresh', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const exists = await assertDeveloperExists(developerId);
    if (!exists) return reply.code(404).send({ error: 'not_found' });
    const r = await pool.query<{ id: string }>(
      `insert into ingestion_runs (developer_id, status) values ($1, 'queued') returning id`,
      [developerId],
    );
    const ingestionRunId = r.rows[0]!.id;
    await ingestQueue.add(
      'ingest',
      { developerId, ingestionRunId },
      { jobId: ingestionRunId, removeOnComplete: 1000, removeOnFail: 5000 },
    );
    return reply.code(202).send({ ingestionRunId, status: 'queued' });
  });

  app.get('/v1/verification/status', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const r = await pool.query(
      `select id, status, started_at, finished_at, error_message, reports_attempted, reports_stored, rows_parsed, created_at
       from ingestion_runs where developer_id = $1 order by created_at desc limit 10`,
      [developerId],
    );
    return { runs: r.rows };
  });

  app.get('/v1/dashboard/summary', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;

    const lim = await pool.query(
      `select id, computed_at, policy_version, max_advance_cents, recommended_advance_cents, confidence, staleness_hours, reason_codes, expires_at, inputs_snapshot_hash, explainability, ingestion_run_id
       from limit_decisions where developer_id = $1 order by computed_at desc limit 1`,
      [developerId],
    );
    if (lim.rowCount === 0) {
      return reply.code(404).send({
        error: 'no_limit_yet',
        message: 'Run POST /v1/verification/refresh after ingestion completes.',
      });
    }

    const feat = await pool.query<{ features: unknown }>(
      `select features from feature_snapshots where developer_id = $1 order by computed_at desc limit 1`,
      [developerId],
    );

    const ledger = await pool.query<{ date: string; netUsdCents: string }>(
      `select revenue_date::text as date, sum(net_proceeds_cents)::text as "netUsdCents"
       from revenue_daily
       where developer_id = $1 and currency = 'USD'
       group by revenue_date
       order by revenue_date asc`,
      [developerId],
    );

    const run = await pool.query(
      `select id, status, finished_at, reports_stored, rows_parsed, error_message
       from ingestion_runs where developer_id = $1 order by created_at desc limit 1`,
      [developerId],
    );

    const d = lim.rows[0] as Record<string, unknown>;
    const decision = {
      ...d,
      max_advance_cents: Number(d.max_advance_cents),
      recommended_advance_cents: Number(d.recommended_advance_cents),
      confidence: Number(d.confidence),
      staleness_hours: Number(d.staleness_hours),
    };

    return {
      decision,
      features: feat.rows[0]?.features ?? null,
      ledgerDaily: ledger.rows.map((r) => ({ date: r.date, netUsdCents: Number(r.netUsdCents) })),
      latestRun: run.rows[0] ?? null,
    };
  });

  app.get('/v1/limits', { preHandler: authMiddleware }, async (req, reply) => {
    const { developerId } = (req as AuthedRequest).auth;
    const lim = await pool.query(
      `select id, computed_at, policy_version, max_advance_cents, recommended_advance_cents, confidence, staleness_hours, reason_codes, expires_at, inputs_snapshot_hash, explainability, ingestion_run_id
       from limit_decisions where developer_id = $1 order by computed_at desc limit 1`,
      [developerId],
    );
    if (lim.rowCount === 0) {
      return reply.code(404).send({ error: 'no_limit_yet', message: 'Run POST /v1/verification/refresh first.' });
    }
    return { decision: lim.rows[0] };
  });

  /** Dev-only: list raw files on disk for audit demos */
  app.get('/v1/debug/raw-tree', { preHandler: authMiddleware }, async (req, reply) => {
    if ((process.env.NODE_ENV ?? 'development') === 'production') {
      return reply.code(404).send();
    }
    const { developerId } = (req as AuthedRequest).auth;
    const base = path.join(config.dataDir, 'raw', developerId);
    try {
      const entries = await fs.readdir(base, { withFileTypes: true });
      return { base, entries: entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() })) };
    } catch {
      return { base, entries: [] };
    }
  });
}
