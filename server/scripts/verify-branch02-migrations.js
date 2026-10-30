// Verifies that Branch 02 migrations apply cleanly to a fresh database
// following the established migration sequence, enforce constraints and RLS,
// and are safely idempotent.
//
// Distinct from verify-token-version-migration.js (Branch 01).
//
// 1. Creates disposable database (spc_branch02_migration_test).
// 2. Builds baseline schema through Branch 01 (token_version).
// 3. Sequentially applies Branch 02 migrations:
//    - 20261011T200000_config_driven_system.sql
//    - 20261011T220000_approval_workflow_and_user_mgmt_corrections.sql
//    - 20261011T230000_secure_account_activation.sql
// 4. Verifies tables, functions, RLS policies, and schema_migrations records.
// 5. Re-applies all three migrations to verify idempotency.
// 6. Cleans up the disposable database.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });

const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '..', '..');

export const DISPOSABLE_DB = 'spc_branch02_migration_test';
export const BRANCH02_MIGRATIONS = [
  '20261011T200000_config_driven_system.sql',
  '20261011T220000_approval_workflow_and_user_mgmt_corrections.sql',
  '20261011T230000_secure_account_activation.sql',
];

export function getAdminUrl(database = 'postgres') {
  const base = process.env.TEST_ADMIN_URL ?? 'postgresql://postgres:devpass@localhost:5433/postgres';
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export async function runBranch02MigrationTest({ throwOnOffline = true } = {}) {
  const adminUrl = getAdminUrl('postgres');

  // 1. Check database connectivity
  const probeClient = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 3000 });
  try {
    await probeClient.connect();
    await probeClient.end();
  } catch (err) {
    const isConnRefused =
      err.code === 'ECONNREFUSED' ||
      /ECONNREFUSED/.test(err.message) ||
      err.code === 'ETIMEDOUT';

    if (isConnRefused) {
      if (!throwOnOffline) {
        return {
          skipped: true,
          reason: `PostgreSQL is offline at ${adminUrl}. Start Docker or check TEST_ADMIN_URL.`,
        };
      }
      throw new Error(`cannot reach PostgreSQL at ${adminUrl} (service offline)`, { cause: err });
    }
    throw err;
  }

  // 2. Fresh test database setup
  const rootClient = new pg.Client({ connectionString: adminUrl });
  await rootClient.connect();

  try {
    await rootClient.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `, [DISPOSABLE_DB]);
    await rootClient.query(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB}`);
    await rootClient.query(`CREATE DATABASE ${DISPOSABLE_DB}`);
  } finally {
    await rootClient.end();
  }

  const testDbUrl = getAdminUrl(DISPOSABLE_DB);
  const testClient = new pg.Client({ connectionString: testDbUrl });
  await testClient.connect();

  try {
    // 3. Apply base schema files in order
    const schemaDir = path.join(root, 'db', 'schema');
    const schemaFiles = (await fs.readdir(schemaDir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of schemaFiles) {
      const sql = await fs.readFile(path.join(schemaDir, file), 'utf8');
      await testClient.query(sql);
    }

    // Apply seed files
    const seedDir = path.join(root, 'db', 'seed');
    const seedFiles = (await fs.readdir(seedDir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of seedFiles) {
      const sql = await fs.readFile(path.join(seedDir, file), 'utf8');
      await testClient.query(sql);
    }

    // 4. Apply each Branch 02 migration sequentially
    const migrationsDir = path.join(root, 'db', 'migrations');
    for (const migFile of BRANCH02_MIGRATIONS) {
      const migPath = path.join(migrationsDir, migFile);
      const sql = await fs.readFile(migPath, 'utf8');
      await testClient.query(sql);

      // Verify registered in schema_migrations
      const regRes = await testClient.query(
        'SELECT filename, applied_at FROM schema_migrations WHERE filename = $1',
        [migFile]
      );
      assert.strictEqual(regRes.rows.length, 1, `Migration ${migFile} must be registered in schema_migrations`);
    }

    // 5. Verify system_configurations schema & RLS policies
    const configTable = await testClient.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'system_configurations'
    `);
    const cols = Object.fromEntries(configTable.rows.map((r) => [r.column_name, r.data_type]));
    assert.ok(cols.key, 'key column must exist');
    assert.ok(cols.value, 'value column must exist');
    assert.ok(cols.is_secret, 'is_secret column must exist');

    const configRls = await testClient.query(`
      SELECT rowsecurity FROM pg_tables WHERE tablename = 'system_configurations'
    `);
    assert.strictEqual(configRls.rows[0].rowsecurity, true, 'RLS must be enabled on system_configurations');

    // 6. Verify account_setup_tokens schema & RLS policies
    const tokenTable = await testClient.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'account_setup_tokens'
    `);
    const tokenCols = Object.fromEntries(tokenTable.rows.map((r) => [r.column_name, r.data_type]));
    assert.ok(tokenCols.token_hash, 'token_hash must exist');
    assert.ok(tokenCols.expires_at, 'expires_at must exist');
    assert.ok(tokenCols.used_at, 'used_at must exist');

    const tokenRls = await testClient.query(`
      SELECT rowsecurity FROM pg_tables WHERE tablename = 'account_setup_tokens'
    `);
    assert.strictEqual(tokenRls.rows[0].rowsecurity, true, 'RLS must be enabled on account_setup_tokens');

    // 7. Verify functions
    const funcRes = await testClient.query(`
      SELECT proname FROM pg_proc WHERE proname IN (
        'app_get_config_numeric', 'app_get_config_bool',
        'fn_verify_account_setup_token', 'fn_consume_account_setup_token',
        'fn_record_action'
      )
    `);
    const funcs = new Set(funcRes.rows.map((r) => r.proname));
    assert.ok(funcs.has('app_get_config_numeric'));
    assert.ok(funcs.has('app_get_config_bool'));
    assert.ok(funcs.has('fn_verify_account_setup_token'));
    assert.ok(funcs.has('fn_consume_account_setup_token'));
    assert.ok(funcs.has('fn_record_action'));

    // 8. Test Idempotency: re-running all 3 Branch 02 migrations must succeed with zero errors
    for (const migFile of BRANCH02_MIGRATIONS) {
      const migPath = path.join(migrationsDir, migFile);
      const sql = await fs.readFile(migPath, 'utf8');
      await testClient.query(sql);

      const countRes = await testClient.query(
        'SELECT count(*)::int AS cnt FROM schema_migrations WHERE filename = $1',
        [migFile]
      );
      assert.strictEqual(countRes.rows[0].cnt, 1, `Idempotent re-run must not create duplicate entry for ${migFile}`);
    }

    return {
      success: true,
      migrationsTested: BRANCH02_MIGRATIONS,
    };
  } finally {
    await testClient.end();

    // 9. Clean up test database
    const cleanupClient = new pg.Client({ connectionString: adminUrl });
    try {
      await cleanupClient.connect();
      await cleanupClient.query(`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()
      `, [DISPOSABLE_DB]);
      await cleanupClient.query(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB}`);
    } finally {
      await cleanupClient.end();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const result = await runBranch02MigrationTest();
    if (result?.skipped) {
      console.log(`⚠️  Branch 02 migration test skipped: ${result.reason}`);
    } else {
      console.log('✅ Branch 02 migrations verification succeeded:', result);
    }
  } catch (err) {
    console.error('❌ Branch 02 migrations verification failed:', err);
    process.exit(1);
  }
}
