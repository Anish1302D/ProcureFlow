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

// ---------------------------------------------------------------------------
// Invite-only: nobody can create their own account
// ---------------------------------------------------------------------------

test('there is no public sign-up', async () => {
  const before = (await t.superuser.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  const res = await t.api('POST', '/api/auth/register', {
    body: { email: 'walk.in@example.com', fullName: 'Walk In', password: 'violet-harbour-lantern-42' } });
  // Unknown routes meet the sign-in wall (401) rather than a 404: refused either way.
  assert.ok([401, 404].includes(res.status), `sign-up must be refused, got ${res.status}`);
  const status = await t.api('GET', '/api/auth/registration-status');
  assert.ok([401, 404].includes(status.status), `got ${status.status}`);
  const after = (await t.superuser.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
  assert.equal(after, before, 'no account was created');
});

// ---------------------------------------------------------------------------
// Invitations are emailed; the administrator never sees the link
// ---------------------------------------------------------------------------

const TOKEN_LIKE = /[0-9a-f]{64}/i;
const STRONG = 'quiet-meadow-compass-81';

async function roleId(code) {
  const roles = expectStatus(await t.api('GET', '/api/admin/roles', { token: tok.admin }), 200);
  return roles.find((r) => r.code === code).id;
}

async function invite(email, fullName, roleCode = 'CDC_GRANT_MEMBER') {
  return t.api('POST', '/api/admin/users', {
    token: tok.admin, body: { email, fullName, roleIds: [await roleId(roleCode)] } });
}

test('an invitation is emailed, and the response carries no link', async () => {
  const res = await invite('p.shinde@gmail.com', 'Prakash Shinde');
  const body = expectStatus(res, 201);
  assert.equal(body.invitation.delivery, 'SENT');
  assert.equal(body.invitation.sentTo, 'p.shinde@gmail.com');
  assert.equal(body.account.status, 'INVITED');
  assert.doesNotMatch(JSON.stringify(body), TOKEN_LIKE, 'no token anywhere in what the administrator receives');
  assert.equal(res.headers.get('cache-control'), 'no-store, no-cache, must-revalidate, private');

  const [mail] = await t.inbox('p.shinde@gmail.com');
  assert.match(mail.subject, /Invitation/);
  assert.match(mail.html, /CDC Grant Member/, 'the email names the role');
  assert.match(mail.html, /7 days/, 'and how long the link lasts');
  assert.match(mail.html, /https:\/\/approvals\.example\.test\/#\/accept-invite\//, 'the token sits after #, out of server logs');
  t.linkIn(mail, 'accept-invite');

  const { rows } = await t.superuser.query(
    `SELECT a.after_json::text AS j FROM audit_logs a JOIN users u ON a.entity_id = u.user_id::text
      WHERE u.email = 'p.shinde@gmail.com'`);
  assert.ok(rows.length > 0);
  for (const r of rows) assert.doesNotMatch(r.j ?? '', TOKEN_LIKE, 'the audit log never holds a token');
});

test('the invitee sees who they are and their role, then sets their own password', async () => {
  const token = t.linkIn((await t.inbox('p.shinde@gmail.com')).at(-1), 'accept-invite');

  const seen = expectStatus(await t.api('POST', '/api/auth/verify-setup-token', { body: { token } }), 200);
  assert.equal(seen.email, 'p.shinde@gmail.com');
  assert.deepEqual(seen.roles, ['CDC Grant Member']);
  assert.equal(seen.passwordRules.minLength, 12);

  // A weak password is refused and the invitation stays usable.
  const weak = await t.api('POST', '/api/auth/setup-account', { body: { token, password: 'shinde-2026-abc' } });
  assert.equal(weak.status, 422);
  assert.ok(weak.body.error.details.some((p) => /your (name|email)/.test(p)));

  const done = expectStatus(await t.api('POST', '/api/auth/setup-account', { body: { token, password: STRONG } }), 200);
  assert.equal(done.user.email, 'p.shinde@gmail.com');
  assert.ok(done.token, 'they are signed in straight away');
  assert.equal(await canSignIn('p.shinde@gmail.com', STRONG), true);

  const again = await t.api('POST', '/api/auth/setup-account', { body: { token, password: 'another-new-phrase-77' } });
  assert.equal(again.status, 410);
  assert.equal(again.body.error.code, 'LINK_USED');

  const users = expectStatus(await t.api('GET', '/api/admin/users', { token: tok.admin }), 200);
  assert.equal(users.find((u) => u.email === 'p.shinde@gmail.com').account.status, 'ACTIVE');
});

test('links are checked in the request body, never from a URL', async () => {
  const res = await t.api('GET', `/api/auth/verify-setup-token?token=${'a'.repeat(64)}`);
  assert.ok([401, 404].includes(res.status), `the old query-string form is gone, got ${res.status}`);
  const garbage = await t.api('POST', '/api/auth/verify-setup-token', { body: { token: 'not-a-token' } });
  assert.equal(garbage.status, 404);
  assert.equal(garbage.body.error.code, 'LINK_INVALID');
});

test('resending replaces the link; the old one stops working', async () => {
  const created = expectStatus(await invite('n.gokhale@outlook.com', 'Neha Gokhale', 'CDC_NON_GRANT_MEMBER'), 201);
  const first = t.linkIn((await t.inbox('n.gokhale@outlook.com')).at(-1), 'accept-invite');

  const resent = expectStatus(await t.api('POST', `/api/admin/users/${created.id}/invite`, { token: tok.admin }), 200);
  assert.equal(resent.invitation.delivery, 'SENT');
  assert.doesNotMatch(JSON.stringify(resent), TOKEN_LIKE);
  const second = t.linkIn((await t.inbox('n.gokhale@outlook.com')).at(-1), 'accept-invite');
  assert.notEqual(first, second);

  const old = await t.api('POST', '/api/auth/verify-setup-token', { body: { token: first } });
  assert.equal(old.status, 410);
  assert.equal(old.body.error.code, 'LINK_REVOKED');
  expectStatus(await t.api('POST', '/api/auth/verify-setup-token', { body: { token: second } }), 200);
});

test('a pending invitation can be cancelled, and an expired one says so', async () => {
  const users = expectStatus(await t.api('GET', '/api/admin/users', { token: tok.admin }), 200);
  const neha = users.find((u) => u.email === 'n.gokhale@outlook.com');
  const link = t.linkIn((await t.inbox('n.gokhale@outlook.com')).at(-1), 'accept-invite');

  const cancelled = expectStatus(await t.api('DELETE', `/api/admin/users/${neha.id}/invite`, { token: tok.admin }), 200);
  assert.equal(cancelled.account.status, 'INVITE_CANCELLED');
  assert.equal((await t.api('POST', '/api/auth/verify-setup-token', { body: { token: link } })).body.error.code, 'LINK_REVOKED');

  expectStatus(await t.api('POST', `/api/admin/users/${neha.id}/invite`, { token: tok.admin }), 200);
  await t.superuser.query(
    `UPDATE account_setup_tokens SET expires_at = NOW() - interval '1 minute'
      WHERE user_id = $1 AND purpose = 'INVITE' AND used_at IS NULL AND revoked_at IS NULL`, [neha.id]);
  const expired = t.linkIn((await t.inbox('n.gokhale@outlook.com')).at(-1), 'accept-invite');
  assert.equal((await t.api('POST', '/api/auth/verify-setup-token', { body: { token: expired } })).body.error.code, 'LINK_EXPIRED');
  const listed = expectStatus(await t.api('GET', '/api/admin/users', { token: tok.admin }), 200);
  assert.equal(listed.find((u) => u.id === neha.id).account.status, 'INVITE_EXPIRED');
});

test('someone who already set up their account is not re-invited', async () => {
  const res = await t.api('POST', `/api/admin/users/${id.head}/invite`, { token: tok.admin });
  assert.equal(res.status, 409);
  assert.match(res.body.error.message, /reset it from the sign-in page/);
});

test('an optional allow-list can restrict which email domains are invited', async () => {
  expectStatus(await t.api('PATCH', '/api/admin/config', {
    token: tok.admin, body: { settings: { 'auth.allowed_email_domains': ['spcollege.edu.in'] } } }), 200);
  const refused = await invite('someone@gmail.com', 'Some One');
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.code, 'EMAIL_DOMAIN_NOT_ALLOWED');
  expectStatus(await invite('staff@spcollege.edu.in', 'College Staff'), 201);

  expectStatus(await t.api('PATCH', '/api/admin/config', {
    token: tok.admin, body: { settings: { 'auth.allowed_email_domains': [] } } }), 200);
  expectStatus(await invite('someone@gmail.com', 'Some One'), 201);
});
