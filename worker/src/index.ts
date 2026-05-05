import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';
import { pool } from './db.js';
import { runIngestion } from './ingestion.js';
import { reconcileSettlementEventById } from './settlement.js';

await mkdir(path.join(config.dataDir, 'raw'), { recursive: true });

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker<{ developerId: string; ingestionRunId: string }>(
  'swiftpay-ingest',
  async (job) => {
    const { developerId, ingestionRunId } = job.data;
    await runIngestion(developerId, ingestionRunId);
  },
  { connection, concurrency: 2 },
);

const settlementWorker = new Worker<{ settlementEventId: string }>(
  'swiftpay-settlement',
  async (job) => {
    await reconcileSettlementEventById(job.data.settlementEventId);
  },
  { connection, concurrency: 4 },
);

worker.on('failed', (job, err) => {
  console.error('job failed', job?.id, err);
});

worker.on('completed', (job) => {
  console.log('job completed', job.id);
});
settlementWorker.on('failed', (job, err) => {
  console.error('settlement job failed', job?.id, err);
});
settlementWorker.on('completed', (job) => {
  console.log('settlement job completed', job.id);
});

const backfillTimer = setInterval(async () => {
  const pending = await pool.query<{ id: string }>(
    `select id from settlement_events where reconciliation_state = 'pending' order by created_at asc limit 200`,
  );
  for (const row of pending.rows) {
    await reconcileSettlementEventById(row.id);
  }
}, config.settlementSweepMs);

const shutdown = async () => {
  clearInterval(backfillTimer);
  await settlementWorker.close();
  await worker.close();
  await connection.quit();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('swiftpay ingest worker started');
