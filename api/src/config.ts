import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://swiftpay:swiftpay@localhost:5432/swiftpay',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-insecure-change-me',
  encryptionKey: process.env.ENCRYPTION_KEY ?? 'dev-insecure-change-me-32bytes!!',
  dataDir: process.env.DATA_DIR ?? path.resolve(__dirname, '../../data'),
  appleMock: (process.env.APPLE_MOCK ?? 'true').toLowerCase() === 'true',
  payoutProvider: process.env.PAYOUT_PROVIDER ?? 'internal_stub',
  payoutWebhookSecret: process.env.PAYOUT_WEBHOOK_SECRET ?? 'dev-webhook-secret',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  payoutRetryMax: Number(process.env.PAYOUT_RETRY_MAX ?? 3),
  payoutRetryBaseMs: Number(process.env.PAYOUT_RETRY_BASE_MS ?? 250),
};
