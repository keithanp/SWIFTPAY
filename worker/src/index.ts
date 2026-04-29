import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';
import { pool } from './db.js';
import { runIngestion } from './ingestion.js';

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

worker.on('failed', (job, err) => {
  console.error('job failed', job?.id, err);
});

worker.on('completed', (job) => {
  console.log('job completed', job.id);
});

const shutdown = async () => {
  await worker.close();
  await connection.quit();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('swiftpay ingest worker started');
