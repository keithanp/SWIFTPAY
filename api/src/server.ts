import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config.js';
import { pool } from './db.js';
import { registerRoutes } from './routes.js';
import { closeQueue } from './queue.js';
import { runMigrations } from './migrate-runner.js';

const app = Fastify({
  logger: {
    transport:
      (process.env.NODE_ENV ?? 'development') === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { translateTime: 'SYS:standard', colorize: true } },
  },
});

await app.register(cors, { origin: true });
await registerRoutes(app);

await mkdir(path.join(config.dataDir, 'raw'), { recursive: true });

await runMigrations();

app.get('/health', async () => ({ ok: true }));

const shutdown = async () => {
  await app.close();
  await pool.end();
  await closeQueue();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
