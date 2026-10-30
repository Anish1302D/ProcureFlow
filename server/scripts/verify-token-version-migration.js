// Verifies that db/migrations/20261011T120000_add_user_token_version.sql
// can upgrade a pre-existing database with real data and is safely idempotent.
//
// 1. Creates a disposable database (spc_migration_test).
// 2. Builds pre-migration schema where users table lacks token_version.
// 3. Inserts representative existing users.
// 4. Applies the actual migration SQL file.
// 5. Verifies existing rows get token_version = 1, NOT NULL, default 1,
//    and registration in schema_migrations.
// 6. Applies the migration a second time to verify idempotency.
// 7. Cleans up the disposable database.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });

const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '..', '..');

export const DISPOSABLE_DB = 'spc_migration_test';
export const MIGRATION_FILENAME = '20261011T120000_add_user_token_version.sql';

export function getAdminUrl(database = 'postgres') {
  const base = process.env.TEST_ADMIN_URL ?? 'postgresql://postgres:devpass@localhost:5433/postgres';
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

export async function runTokenVersionMigrationTest({ throwOnOffline = true } = {}) {
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

  // 2. Setup disposable database
  const adminClient = new pg.Client({ connectionString: adminUrl });
  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB} WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE ${DISPOSABLE_DB}`);
  } finally {
    await adminClient.end();
  }

  const dbClient = new pg.Client({ connectionString: getAdminUrl(DISPOSABLE_DB) });
  await dbClient.connect();

  try {
    await dbClient.query('SET client_min_messages = warning');

    // 3. Create pre-migration extensions and tables
    await dbClient.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE EXTENSION IF NOT EXISTS citext;

      CREATE TABLE departments (
          department_id SERIAL PRIMARY KEY,
          code          TEXT UNIQUE NOT NULL,
          name          TEXT NOT NULL
      );
      INSERT INTO departments (code, name) VALUES ('CS', 'Computer Science'), ('CHEM', 'Chemistry');

      -- Pre-migration users table: explicitly does NOT have token_version
      CREATE TABLE users (
          user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email          citext UNIQUE NOT NULL,
          full_name      TEXT NOT NULL,
          password_hash  TEXT NOT NULL,
          department_id  INTEGER REFERENCES departments(department_id) ON DELETE SET NULL,
          is_active      BOOLEAN NOT NULL DEFAULT TRUE,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
          filename   TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      INSERT INTO schema_migrations (filename) VALUES ('20260902T180000_baseline.sql');
    `);

    // Verify token_version column does NOT exist yet
    const { rows: preCols } = await dbClient.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'token_version'
    `);
    assert.equal(preCols.length, 0, 'token_version column must not exist prior to migration');

    // 4. Insert representative existing users
    await dbClient.query(`
      INSERT INTO users (email, full_name, password_hash, department_id, is_active) VALUES
        ('active.user@spcollege.edu', 'Prof. Active', '$2a$12$DummyHashActiveUser000000000000000000000000000000000000', 1, true),
        ('inactive.user@spcollege.edu', 'Former Staff', '$2a$12$DummyHashInactiveUser0000000000000000000000000000000000', 2, false),
        ('unassigned.user@spcollege.edu', 'Unassigned User', '$2a$12$DummyHashUnassigned0000000000000000000000000000000000', NULL, true);
    `);

    const { rows: preUsers } = await dbClient.query('SELECT count(*)::int AS count FROM users');
    assert.equal(preUsers[0].count, 3, 'Must have 3 pre-migration users inserted');

    // 5. Read and execute the actual migration SQL file
    const migrationFilePath = path.join(root, 'db', 'migrations', MIGRATION_FILENAME);
    const migrationSql = await fs.readFile(migrationFilePath, 'utf8');
    await dbClient.query(migrationSql);

    // 6. Verify post-migration state
    // 6a. Existing rows must all receive token_version = 1
    const { rows: migratedUsers } = await dbClient.query(`
      SELECT email, token_version FROM users ORDER BY email
    `);
    assert.equal(migratedUsers.length, 3);
    for (const u of migratedUsers) {
      assert.equal(u.token_version, 1, `User ${u.email} must have token_version = 1`);
    }

    // 6b. Verify column constraints in information_schema.columns
    const { rows: postCols } = await dbClient.query(`
      SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'token_version'
    `);
    assert.equal(postCols.length, 1, 'token_version column must exist after migration');
    assert.equal(postCols[0].data_type, 'integer', 'token_version must be integer');
    assert.equal(postCols[0].is_nullable, 'NO', 'token_version must be NOT NULL');
    assert.ok(
      postCols[0].column_default && postCols[0].column_default.includes('1'),
      `token_version default must be 1, got ${postCols[0].column_default}`,
    );

    // 6c. Verify new insert without specifying token_version uses default 1
    await dbClient.query(`
      INSERT INTO users (email, full_name, password_hash)
      VALUES ('new.default@spcollege.edu', 'New Default User', '$2a$12$DummyHashNewUser00000000000000000000000000000000000000')
    `);
    const { rows: newUserRow } = await dbClient.query(`
      SELECT token_version FROM users WHERE email = 'new.default@spcollege.edu'
    `);
    assert.equal(newUserRow[0].token_version, 1, 'Newly inserted row must default token_version to 1');

    // 6d. Verify inserting NULL into token_version is rejected by NOT NULL constraint
    await assert.rejects(
      async () => {
        await dbClient.query(`
          INSERT INTO users (email, full_name, password_hash, token_version)
          VALUES ('null.ver@spcollege.edu', 'Null Version User', '$2a$12$DummyHash000000000000000000000000000000000000000000', NULL)
        `);
      },
      (err) => err.code === '23502', // not_null_violation
      'Inserting NULL into token_version must trigger not_null_violation (23502)',
    );

    // 6e. Verify schema_migrations registration
    const { rows: migrationRecord } = await dbClient.query(`
      SELECT filename, applied_at FROM schema_migrations WHERE filename = $1
    `, [MIGRATION_FILENAME]);
    assert.equal(migrationRecord.length, 1, 'Migration must be recorded in schema_migrations');
    assert.ok(migrationRecord[0].applied_at, 'applied_at must be populated');

    // 7. Execute the migration a second time to verify idempotency
    await dbClient.query(migrationSql);

    const { rows: idempotentUsers } = await dbClient.query(`
      SELECT count(*)::int AS count FROM users WHERE token_version = 1
    `);
    assert.equal(idempotentUsers[0].count, 4, 'Existing user token_version values must remain 1 after rerun');

    const { rows: idempotentRecords } = await dbClient.query(`
      SELECT count(*)::int AS count FROM schema_migrations WHERE filename = $1
    `, [MIGRATION_FILENAME]);
    assert.equal(idempotentRecords[0].count, 1, 'schema_migrations must still contain exactly 1 entry');

    return { success: true };
  } finally {
    await dbClient.end();

    // 8. Cleanup disposable database
    const cleanupAdmin = new pg.Client({ connectionString: adminUrl });
    await cleanupAdmin.connect();
    try {
      await cleanupAdmin.query(`DROP DATABASE IF EXISTS ${DISPOSABLE_DB} WITH (FORCE)`);
    } finally {
      await cleanupAdmin.end();
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  try {
    const res = await runTokenVersionMigrationTest({ throwOnOffline: true });
    console.log('✅ token_version migration verification succeeded:', res);
    process.exit(0);
  } catch (err) {
    console.error('❌ token_version migration verification failed:', err);
    process.exit(1);
  }
}
