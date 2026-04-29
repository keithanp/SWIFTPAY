import { pool } from './db.js';
import { runMigrations } from './migrate-runner.js';

async function main() {
  await runMigrations();
  await pool.end();
  console.log('Migrations complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
