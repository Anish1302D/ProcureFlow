import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';
import { TEST_DB, adminUrl, resetTestDatabase } from '../scripts/reset-test-db.js';

dotenv.config({ path: [path.resolve(process.cwd(), '.env'), path.resolve(import.meta.dirname, '../.env')], quiet: true });
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

export const PASSWORD = 'ChangeMe#2026';

function withDatabase(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Turns a connection refusal into an error that says what to start. */
function explainStartupFailure(cause) {
  const refused = cause?.code === 'ECONNREFUSED' || /ECONNREFUSED/.test(cause?.message ?? '');
  if (!refused) return cause;
  const target = new URL(adminUrl('postgres'));
  return new Error(
    `cannot reach PostgreSQL at ${target.host} — the tests build a throwaway database `
    + 'and cannot run without it. Start it with:\n'
    + '  docker compose -f db/docker-compose.yml up -d\n'
    + 'and check TEST_ADMIN_URL in server/.env. This is an environment failure, '
    + 'not a test result: nothing about the API has been verified.',
    { cause },
  );
}

/**
 * Starts the real API against a freshly built test database, as app_user —
 * the same role and the same Row-Level Security it runs under in production.
 * Each test file gets its own rebuild, so no file's data can change another's
 * results.
 *
 * If any step fails, everything already allocated is released before the error
 * is rethrown: a half-started API would otherwise leave an open pool holding
 * the test run open, and the real failure would be buried under the teardown's
 * own errors.
 */
export async function startApi() {
  const cleanups = [];
  let unwound = false;
  async function unwind() {
    if (unwound) return;
    unwound = true;
    // Reverse order, on a copy: each step runs even if an earlier one throws,
    // because the failure that brought us here matters more than this cleanup.
    for (const release of [...cleanups].reverse()) {
      try { await release(); } catch { /* see above */ }
    }
  }

  try {
    await resetTestDatabase();
  } catch (cause) {
    throw explainStartupFailure(cause);
  }

  try {
    process.env.DATABASE_URL = withDatabase(process.env.DATABASE_URL, TEST_DB);
    const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spc-uploads-'));
    process.env.UPLOAD_DIR = uploadDir;
    process.env.MAX_UPLOAD_MB = '1';
    cleanups.push(() => fs.rm(uploadDir, { recursive: true, force: true }));

    // Imported only after the environment is set: config is read at import time.
    const { createApp } = await import('../src/app.js');
    const { pool, assertRlsEnforced } = await import('../src/db.js');
    cleanups.push(() => pool.end());
    assert.equal(await assertRlsEnforced(), 'app_user', 'tests must run as app_user');

    const server = createApp().listen(0, '127.0.0.1');
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;

    async function api(method, url, { token, body, form } = {}) {
      const headers = {};
      if (token) headers.authorization = `Bearer ${token}`;
      if (body !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method,
        headers,
        body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
      });
      const buffer = Buffer.from(await res.arrayBuffer());
      let json;
      try { json = JSON.parse(buffer.toString('utf8')); } catch { /* not JSON */ }
      return { status: res.status, body: json, buffer, headers: res.headers };
    }

    async function login(email) {
      const res = await api('POST', '/api/auth/login', { body: { email, password: PASSWORD } });
      assert.equal(res.status, 200, `login ${email}: ${JSON.stringify(res.body)}`);
      return res.body.token;
    }

    // A superuser connection for the few tests that must reach behind the API —
    // simulating someone editing the database directly.
    const superuser = new pg.Client({ connectionString: adminUrl(TEST_DB) });
    await superuser.connect();
    cleanups.push(() => superuser.end());

    return { api, login, superuser, close: unwind };
  } catch (err) {
    await unwind();
    throw err;
  }
}

/** Asserts a status, showing the response body when it is wrong. */
export function expectStatus(res, status) {
  assert.equal(res.status, status, `expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

export function pdf(name = 'quote.pdf', size = 64) {
  const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(size, 0x20)]);
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
  return { form, bytes };
}
