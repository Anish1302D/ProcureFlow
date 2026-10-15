import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '..', '..');

async function main() {
  const client = new pg.Client({ connectionString: 'postgresql://postgres:devpass@localhost:5433/spc_approval' });
  await client.connect();

  await client.query("INSERT INTO schema_migrations (filename) VALUES ('20261004T170000_cdc_funding_separation.sql') ON CONFLICT DO NOTHING;");

  console.log('Reading migration file...');
  const migPath = path.join(root, 'db', 'migrations', '20261014T100000_historical_user_member_architecture.sql');
  const sql = await fs.readFile(migPath, 'utf8');

  console.log('Executing migration 20261014T100000_historical_user_member_architecture.sql...');
  await client.query(sql);

  console.log('Migration finished successfully!');
  await client.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
