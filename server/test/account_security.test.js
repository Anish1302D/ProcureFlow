import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { PASSWORD, expectStatus, startApi } from './helpers.js';

// Accounts belong to real people who set their own passwords. Nobody else —
// administrators included — may set, see or take over someone's credentials.

let t;
const tok = {};
const id = {};

before(async () => {
  t = await startApi();
  for (const [key, email] of Object.entries({
    admin: 'admin@spcollege.edu',
    head: 'head.cs@spcollege.edu',
    incharge: 'incharge@spcollege.edu',
  })) {
    tok[key] = await t.login(email);
    id[key] = (await t.superuser.query('SELECT user_id FROM users WHERE email = $1', [email])).rows[0].user_id;
  }
});

after(() => t?.close());

async function canSignIn(email, password) {
  const res = await t.api('POST', '/api/auth/login', { body: { email, password } });
  return res.status === 200;
}

// ---------------------------------------------------------------------------
// Password policy
// ---------------------------------------------------------------------------

test('the password rules are published, so pages show the real policy', async () => {
  const rules = expectStatus(await t.api('GET', '/api/auth/password-policy'), 200);
  assert.equal(rules.minLength, 12);
  assert.equal(rules.maxBytes, 72);
});

test('a weak new password is refused with every reason listed', async () => {
  const short = await t.api('POST', '/api/auth/change-password', {
    token: tok.incharge, body: { currentPassword: PASSWORD, newPassword: 'Short#1' } });
  assert.equal(short.status, 422);
  assert.equal(short.body.error.code, 'WEAK_PASSWORD');
  assert.ok(short.body.error.details.some((p) => /at least 12/.test(p)));

  // Built from the person's own name: refused even though it is long.
  const named = await t.api('POST', '/api/auth/change-password', {
    token: tok.incharge, body: { currentPassword: PASSWORD, newPassword: 'Kulkarni-2026-Strong' } });
  assert.equal(named.status, 422);
  assert.ok(named.body.error.details.some((p) => /your name/.test(p)));

  const common = await t.api('POST', '/api/auth/change-password', {
    token: tok.incharge, body: { currentPassword: PASSWORD, newPassword: 'Password123!' } });
  assert.equal(common.status, 422);

  assert.equal(await canSignIn('incharge@spcollege.edu', PASSWORD), true, 'a refused change leaves the old password working');
});

test('a strong new password is accepted and signs out every other session', async () => {
  const strong = 'violet-harbour-lantern-42';
  expectStatus(await t.api('POST', '/api/auth/change-password', {
    token: tok.incharge, body: { currentPassword: PASSWORD, newPassword: strong } }), 204);

  expectStatus(await t.api('GET', '/api/auth/me', { token: tok.incharge }), 401);
  assert.equal(await canSignIn('incharge@spcollege.edu', PASSWORD), false);
  assert.equal(await canSignIn('incharge@spcollege.edu', strong), true);
});

// ---------------------------------------------------------------------------
// Administrators cannot take over accounts
// ---------------------------------------------------------------------------

test('an administrator cannot set anyone\'s password', async () => {
  const res = await t.api('PATCH', `/api/admin/users/${id.head}`, {
    token: tok.admin, body: { password: 'admin-chose-this-1234', fullName: 'Dr. A. Deshpande (Head, CS)' } });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'ADMIN_PASSWORD_FORBIDDEN');

  assert.equal(await canSignIn('head.cs@spcollege.edu', 'admin-chose-this-1234'), false);
  assert.equal(await canSignIn('head.cs@spcollege.edu', PASSWORD), true, 'the person\'s own password is untouched');
  const { rows } = await t.superuser.query('SELECT full_name FROM users WHERE user_id = $1', [id.head]);
  assert.equal(rows[0].full_name, 'Dr. A. Deshpande (Head, CS)', 'nothing in the refused request was applied');
});

test('an administrator can still edit the other details of an account', async () => {
  expectStatus(await t.api('PATCH', `/api/admin/users/${id.head}`, {
    token: tok.admin, body: { employeeId: 'EMP-CS-001A' } }), 200);
  const { rows } = await t.superuser.query('SELECT employee_id FROM users WHERE user_id = $1', [id.head]);
  assert.equal(rows[0].employee_id, 'EMP-CS-001A');
});
