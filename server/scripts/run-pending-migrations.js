import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '..', '..');

// Load environment variables from .env.local in root or server/.env
dotenv.config({ path: path.join(root, '.env.local') });
dotenv.config({ path: path.join(root, 'server', '.env') });

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.DATABASE_URL ||
  'postgresql://postgres:devpass@localhost:5433/spc_approval';

async function main() {
  const isNeon = connectionString.includes('neon.tech');
  const client = new pg.Client({
    connectionString,
    ssl: isNeon ? { rejectUnauthorized: false } : undefined,
  });

  console.log(`Connecting to database (${isNeon ? 'Neon Cloud' : 'Local'})...`);
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const { rows: appliedRows } = await client.query('SELECT filename FROM schema_migrations;');
  const appliedSet = new Set(appliedRows.map((r) => r.filename));

  const migDir = path.join(root, 'db', 'migrations');
  const allFiles = await fs.readdir(migDir);
  const sqlFiles = allFiles.filter((f) => f.endsWith('.sql')).sort();

  const pendingFiles = sqlFiles.filter((f) => !appliedSet.has(f));

  if (pendingFiles.length === 0) {
    console.log('No pending migrations! Database schema is up to date.');
    await client.end();
    return;
  }

  console.log(`Found ${pendingFiles.length} pending migration(s):`);
  for (const f of pendingFiles) {
    console.log(`  - ${f}`);
  }

  for (const filename of pendingFiles) {
    console.log(`\nApplying: ${filename}...`);
    const migPath = path.join(migDir, filename);
    const sql = await fs.readFile(migPath, 'utf8');

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO UPDATE SET applied_at = NOW();',
        [filename]
      );
      await client.query('COMMIT');
      console.log(`Successfully applied: ${filename}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`ERROR applying migration ${filename}:`, err);
      throw err;
    }
  }

  console.log('\nAll pending migrations executed successfully!');
  await client.end();
}

main().catch((err) => {
  console.error('\nMigration runner failed:', err);
  process.exit(1);
});
