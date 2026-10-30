import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import jwt from 'jsonwebtoken';
import { expectStatus, startApi } from './helpers.js';

let t;
before(async () => { t = await startApi(); });
after(() => t?.close());

test('signs in with a seeded account and describes the user', async () => {
  const token = await t.login('principal@spcollege.edu');
  const me = expectStatus(await t.api('GET', '/api/auth/me', { token }), 200);
  assert.equal(me.email, 'principal@spcollege.edu');
  assert.deepEqual(me.roles, ['PRINCIPAL']);
  assert.deepEqual(me.stages.map((s) => s.code), ['PRINCIPAL']);
  assert.equal(me.can.approve, true);
  assert.equal(me.can.raiseRequests, false);
});

test('the same message for a wrong password and an unknown address', async () => {
  const wrong = await t.api('POST', '/api/auth/login',
    { body: { email: 'principal@spcollege.edu', password: 'nope' } });
  const unknown = await t.api('POST', '/api/auth/login',
    { body: { email: 'nobody@spcollege.edu', password: 'nope' } });
  expectStatus(wrong, 401);
  expectStatus(unknown, 401);
  assert.equal(wrong.body.error.message, unknown.body.error.message);
});

test('email is case-insensitive at sign-in', async () => {
  const res = await t.api('POST', '/api/auth/login',
    { body: { email: '  Head.CS@SPCollege.edu ', password: 'ChangeMe#2026' } });
  expectStatus(res, 200);
});

test('failed and successful sign-ins are audited', async () => {
  const { rows } = await t.superuser.query(
    `SELECT action FROM audit_logs WHERE entity_type = 'user' AND action LIKE 'LOGIN%'`);
  const actions = rows.map((r) => r.action);
  assert.ok(actions.includes('LOGIN'));
  assert.ok(actions.includes('LOGIN_FAILED'));
});

test('rejects missing, malformed, forged and unsigned tokens', async () => {
  expectStatus(await t.api('GET', '/api/auth/me'), 401);
  expectStatus(await t.api('GET', '/api/auth/me', { token: 'not-a-token' }), 401);

  const { rows } = await t.superuser.query(
    "SELECT user_id FROM users WHERE email = 'admin@spcollege.edu'");
  const forged = jwt.sign({}, 'x'.repeat(64), { subject: rows[0].user_id });
  expectStatus(await t.api('GET', '/api/auth/me', { token: forged }), 401);

  // alg "none": a token with no signature at all, claiming to be the admin.
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    sub: rows[0].user_id, exp: Math.floor(Date.now() / 1000) + 3600 })}.`;
  expectStatus(await t.api('GET', '/api/auth/me', { token: unsigned }), 401);
});

test('a disabled account is locked out immediately, token or not', async () => {
  const token = await t.login('vp@spcollege.edu');
  await t.superuser.query("UPDATE users SET is_active = false WHERE email = 'vp@spcollege.edu'");
  try {
    expectStatus(await t.api('GET', '/api/auth/me', { token }), 401);
  } finally {
    await t.superuser.query("UPDATE users SET is_active = true WHERE email = 'vp@spcollege.edu'");
  }
});

test('throttles repeated sign-in attempts for one address', async () => {
  const attempt = () => t.api('POST', '/api/auth/login',
    { body: { email: 'throttle@spcollege.edu', password: 'guess' } });
  for (let i = 0; i < 10; i += 1) expectStatus(await attempt(), 401);
  expectStatus(await attempt(), 429);
  // A different address from the same client is unaffected.
  expectStatus(await t.api('POST', '/api/auth/login',
    { body: { email: 'other@spcollege.edu', password: 'guess' } }), 401);
});

test('every /api route requires a signed-in user', async () => {
  for (const url of ['/api/requests', '/api/issues', '/api/budget-heads', '/api/dashboard', '/api/notifications']) {
    expectStatus(await t.api('GET', url), 401);
  }
  expectStatus(await t.api('GET', '/health'), 200);
});

test('validation errors name the offending field', async () => {
  const res = await t.api('POST', '/api/auth/login', { body: { email: 'not-an-email', password: 'x' } });
  expectStatus(res, 422);
  assert.equal(res.body.error.code, 'VALIDATION');
  assert.equal(res.body.error.details[0].path, 'email');
});
