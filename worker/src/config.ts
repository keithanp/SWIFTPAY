import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://swiftpay:swiftpay@localhost:5432/swiftpay',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  dataDir: process.env.DATA_DIR ?? path.resolve(__dirname, '../../data'),
  appleMock: (process.env.APPLE_MOCK ?? 'true').toLowerCase() === 'true',
};
