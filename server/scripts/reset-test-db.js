// Rebuilds the spc_api_test database from db/schema and db/seed, so a test
// starts from the same known state and never touches development data.
//
// Needs TEST_ADMIN_URL: a superuser connection (creating a database and the
// pgcrypto extension both require one). The API under test still connects as
// app_user — only this setup step runs as the superuser.
//
// Imported by the test helpers, which rebuild before each test file so no
// file's data can change another's results. Also runnable directly:
//   node scripts/reset-test-db.js

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ quiet: true });

export const TEST_DB = 'spc_api_test';
const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '..', '..', 'db');

export function adminUrl(database) {
  const url = new URL(process.env.TEST_ADMIN_URL ?? 'postgresql://postgres:devpass@localhost:5433/postgres');
  url.pathname = `/${database}`;
  return url.toString();
}

async function sqlFiles(dir) {
  const names = (await fs.readdir(path.join(root, dir))).filter((n) => n.endsWith('.sql')).sort();
  return names.map((n) => path.join(root, dir, n));
}

function getAppUserCredentials() {
  const urlStr = process.env.DATABASE_URL ?? 'postgresql://app_user:CHANGE_ME@localhost:5433/spc_approval';
  try {
    const url = new URL(urlStr);
    return {
      user: url.username || 'app_user',
      password: url.password || '',
    };
  } catch {
    return { user: 'app_user', password: '' };
  }
}

async function canUserAuthenticate(database, user, password) {
  if (!password) return false;
  const url = new URL(adminUrl(database));
  url.username = user;
  url.password = password;
  const client = new pg.Client({ connectionString: url.toString() });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

export async function resetTestDatabase() {
  const admin = new pg.Client({ connectionString: adminUrl('postgres') });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const db = new pg.Client({ connectionString: adminUrl(TEST_DB) });
  await db.connect();
  try {
    await db.query('SET client_min_messages = warning');
    const files = [...await sqlFiles('schema'), ...await sqlFiles('seed')];
    for (const file of files) {
      try {
        await db.query(await fs.readFile(file, 'utf8'));
      } catch (err) {
        throw new Error(`failed loading ${path.relative(root, file)}: ${err.message}`);
      }
    }
    const creds = getAppUserCredentials();
    const canConnect = await canUserAuthenticate(TEST_DB, creds.user, creds.password);
    if (!canConnect && creds.password) {
      await db.query(`ALTER ROLE ${db.escapeIdentifier(creds.user)} WITH LOGIN PASSWORD ${db.escapeLiteral(creds.password)}`);
    }
    return files.length;
  } finally {
    await db.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === here) {
  const count = await resetTestDatabase();
  console.log(`${TEST_DB}: rebuilt from ${count} files`);
}
