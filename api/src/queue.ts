import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { config } from './config.js';

const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });

export const ingestQueue = new Queue<{ developerId: string; ingestionRunId: string }>('swiftpay-ingest', {
  connection,
});

export const settlementQueue = new Queue<{ settlementEventId: string }>('swiftpay-settlement', {
  connection,
});

export async function closeQueue(): Promise<void> {
  await ingestQueue.close();
  await settlementQueue.close();
  await connection.quit();
}
