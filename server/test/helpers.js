import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

    // Emails go to a throwaway outbox the tests can read, never to anyone.
    const outboxDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spc-outbox-'));
    process.env.MAIL_TRANSPORT = 'outbox';
    process.env.MAIL_OUTBOX_DIR = outboxDir;
    process.env.APP_URL = 'https://approvals.example.test';
    // A fresh 2-step encryption key per test file: never a fixed value.
    process.env.MFA_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    cleanups.push(() => fs.rm(outboxDir, { recursive: true, force: true }));

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

    // Authenticator secrets of accounts that enrolled in 2-step verification
    // during this test file, so later sign-ins can type a real code.
    const mfaSecrets = new Map();
    const { codeAt, stepAt } = await import('../src/totp.js');

    /**
     * Signs in like a person, including the second step for accounts that
     * need one: enrolling on first sign-in, then typing the current code.
     */
    async function login(email, password = PASSWORD) {
      const res = await api('POST', '/api/auth/login', { body: { email, password } });
      assert.equal(res.status, 200, `login ${email}: ${JSON.stringify(res.body)}`);
      if (!res.body.mfa) return res.body.token;

      const { step, challenge } = res.body.mfa;
      if (step === 'enrol') {
        const setup = await api('POST', '/api/auth/mfa/setup/start', { body: { challenge } });
        assert.equal(setup.status, 200, `2-step setup ${email}: ${JSON.stringify(setup.body)}`);
        mfaSecrets.set(email.toLowerCase(), setup.body.secret);
        const done = await api('POST', '/api/auth/mfa/setup/confirm', {
          body: { challenge, code: codeAt(setup.body.secret, stepAt()) } });
        assert.equal(done.status, 200, `2-step enrol ${email}: ${JSON.stringify(done.body)}`);
        return done.body.token;
      }
      const secret = mfaSecrets.get(email.toLowerCase());
      assert.ok(secret, `no authenticator secret recorded for ${email}`);
      // Tests sign in faster than once per 30-second code. A person cannot,
      // so only here is the replay guard reset between sign-ins.
      await superuser.query('UPDATE users SET mfa_last_step = NULL WHERE email = $1', [email]);
      const ok = await api('POST', '/api/auth/mfa/verify', { body: { challenge, code: codeAt(secret, stepAt()) } });
      assert.equal(ok.status, 200, `2-step verify ${email}: ${JSON.stringify(ok.body)}`);
      return ok.body.token;
    }

    /** The current authenticator code for an enrolled account. */
    function totpFor(email, offsetSteps = 0) {
      const secret = mfaSecrets.get(email.toLowerCase());
      assert.ok(secret, `no authenticator secret recorded for ${email}`);
      return codeAt(secret, stepAt() + offsetSteps);
    }

    // A superuser connection for the few tests that must reach behind the API —
    // simulating someone editing the database directly.
    const superuser = new pg.Client({ connectionString: adminUrl(TEST_DB) });
    await superuser.connect();
    cleanups.push(() => superuser.end());

    /** Every email sent to an address, oldest first. */
    async function inbox(address) {
      const files = (await fs.readdir(outboxDir)).filter((f) => f.endsWith('.json')).sort();
      const mails = await Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(outboxDir, f), 'utf8'))));
      return mails.filter((m) => String(m.to).toLowerCase() === address.toLowerCase());
    }

    /** The token from a link like https://…/#/accept-invite/<token> in an email. */
    function linkIn(mail, linkPath) {
      const match = mail?.html?.match(new RegExp(`#/${linkPath}/([0-9a-f]{64})`));
      assert.ok(match, `no #/${linkPath}/ link in email "${mail?.subject}"`);
      return match[1];
    }

    /**
     * Emails to an address whose subject matches, waiting briefly for them:
     * some are sent just after the reply, on purpose, so timing reveals nothing.
     */
    async function waitForMail(address, subject, minCount = 1, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = (await inbox(address)).filter((m) => subject.test(m.subject));
        if (found.length >= minCount || Date.now() > deadline) return found;
        await new Promise((resolve) => { setTimeout(resolve, 50); });
      }
    }

    return { api, login, totpFor, superuser, inbox, waitForMail, linkIn, close: unwind };
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
