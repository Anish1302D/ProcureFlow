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

test('a Head of Department cannot be left without a department', async () => {
  const headRole = await roleId('HEAD');
  const refused = await invite('no.dept.head@gmail.com', 'No Department Head', 'HEAD');
  assert.equal(refused.status, 422);
  assert.equal(refused.body.error.code, 'HEAD_NEEDS_DEPARTMENT');
  const { rowCount } = await t.superuser.query("SELECT 1 FROM users WHERE email = 'no.dept.head@gmail.com'");
  assert.equal(rowCount, 0, 'no account was created');

  // Nor can an existing head lose theirs, or someone without one become a head.
  const cleared = await t.api('PATCH', `/api/admin/users/${id.head}`, { token: tok.admin, body: { departmentId: null } });
  assert.equal(cleared.body.error.code, 'HEAD_NEEDS_DEPARTMENT');
  const promoted = await t.api('PATCH', `/api/admin/users/${id.admin}`, {
    token: tok.admin, body: { roleIds: [headRole, await roleId('ADMIN')], departmentId: null } });
  assert.equal(promoted.body.error.code, 'HEAD_NEEDS_DEPARTMENT');
  const { rows } = await t.superuser.query('SELECT department_id FROM users WHERE user_id = $1', [id.head]);
  assert.notEqual(rows[0].department_id, null, 'the head keeps their department');
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

// ---------------------------------------------------------------------------
// Forgotten passwords are reset by email, with no administrator involved
// ---------------------------------------------------------------------------

async function forgot(email) {
  return t.api('POST', '/api/auth/forgot-password', { body: { email } });
}

test('asking for a reset reveals nothing about which addresses have accounts', async () => {
  const known = await forgot('pc1@spcollege.edu');
  const unknown = await forgot('nobody.here@example.com');
  const notYetAccepted = await forgot('someone@gmail.com'); // invited above, never accepted
  for (const res of [known, unknown, notYetAccepted]) {
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, known.body, 'the same words for every address');
  }
  assert.equal((await t.waitForMail('pc1@spcollege.edu', /Reset/)).length, 1, 'the real, active account gets a link');
  assert.equal((await t.inbox('nobody.here@example.com')).length, 0);
  assert.equal((await t.inbox('someone@gmail.com')).filter((m) => /Reset/.test(m.subject)).length, 0,
    'an invitee who never accepted gets no reset link (their invitation is the way in)');
});

test('the reset link sets a new password, signs out every device and tells the owner', async () => {
  const before = await t.login('pc1@spcollege.edu');
  const mail = (await t.waitForMail('pc1@spcollege.edu', /Reset your password/)).at(-1);
  assert.match(mail.html, /60 minutes/);
  const token = t.linkIn(mail, 'reset-password');

  const seen = expectStatus(await t.api('POST', '/api/auth/reset-password/verify', { body: { token } }), 200);
  assert.equal(seen.email, 'pc1@spcollege.edu');

  const weak = await t.api('POST', '/api/auth/reset-password', { body: { token, password: 'short' } });
  assert.equal(weak.status, 422, 'a weak password is refused and the link stays usable');

  const fresh = 'amber-lighthouse-orchard-19';
  const done = expectStatus(await t.api('POST', '/api/auth/reset-password', { body: { token, password: fresh } }), 200);
  assert.equal(done.token, undefined, 'no automatic sign-in: the new password must be used to sign in');

  expectStatus(await t.api('GET', '/api/auth/me', { token: before }), 401);
  assert.equal(await canSignIn('pc1@spcollege.edu', PASSWORD), false);
  assert.equal(await canSignIn('pc1@spcollege.edu', fresh), true);
  assert.equal((await t.waitForMail('pc1@spcollege.edu', /password was changed/)).length, 1);

  const again = await t.api('POST', '/api/auth/reset-password', { body: { token, password: 'second-try-phrase-55' } });
  assert.equal(again.status, 410);
  assert.equal(again.body.error.code, 'LINK_USED');
});

test('a newer reset link replaces the older one, and links expire', async () => {
  await forgot('principal@spcollege.edu');
  const first = t.linkIn((await t.waitForMail('principal@spcollege.edu', /Reset/, 1)).at(-1), 'reset-password');
  await forgot('principal@spcollege.edu');
  const second = t.linkIn((await t.waitForMail('principal@spcollege.edu', /Reset/, 2)).at(-1), 'reset-password');

  const old = await t.api('POST', '/api/auth/reset-password/verify', { body: { token: first } });
  assert.equal(old.body.error.code, 'LINK_REVOKED');

  await t.superuser.query(
    `UPDATE account_setup_tokens SET expires_at = NOW() - interval '1 minute'
      WHERE purpose = 'PASSWORD_RESET' AND used_at IS NULL AND revoked_at IS NULL
        AND user_id = (SELECT user_id FROM users WHERE email = 'principal@spcollege.edu')`);
  const expired = await t.api('POST', '/api/auth/reset-password/verify', { body: { token: second } });
  assert.equal(expired.body.error.code, 'LINK_EXPIRED');
});

test('repeated requests cannot flood someone\'s inbox', async () => {
  for (let i = 0; i < 6; i += 1) expectStatus(await forgot('pc2@spcollege.edu'), 202);
  await t.waitForMail('pc2@spcollege.edu', /Reset/, 3);
  await new Promise((resolve) => { setTimeout(resolve, 300); }); // give any extra (wrong) email time to appear
  const resets = (await t.inbox('pc2@spcollege.edu')).filter((m) => /Reset/.test(m.subject));
  assert.equal(resets.length, 3, 'capped at the configured three an hour, while every reply looks the same');
});

// ---------------------------------------------------------------------------
// Repeated wrong passwords pause the account, without revealing anything
// ---------------------------------------------------------------------------

test('five wrong passwords pause sign-in, the owner is told, and a reset clears it', async () => {
  const who = 'clerk@spcollege.edu';
  let refusal;
  for (let i = 0; i < 5; i += 1) {
    refusal = await t.api('POST', '/api/auth/login', { body: { email: who, password: `wrong-guess-${i}` } });
    assert.equal(refusal.status, 401);
  }
  const { rows } = await t.superuser.query('SELECT locked_until > NOW() AS locked FROM users WHERE email = $1', [who]);
  assert.equal(rows[0].locked, true, 'the pause is kept in the database, so a restart does not lift it');
  assert.equal((await t.waitForMail(who, /Sign-in paused/)).length, 1);

  // Even the right password is refused while paused — with the same words as
  // a wrong one, and the same as for an address with no account at all.
  const paused = await t.api('POST', '/api/auth/login', { body: { email: who, password: PASSWORD } });
  const unknown = await t.api('POST', '/api/auth/login', { body: { email: 'ghost@example.com', password: PASSWORD } });
  assert.equal(paused.status, 401);
  assert.equal(paused.body.error.message, refusal.body.error.message);
  assert.equal(unknown.body.error.message, refusal.body.error.message);
  assert.equal(paused.body.error.code, 'SIGN_IN_REFUSED');

  await forgot(who);
  const token = t.linkIn((await t.waitForMail(who, /Reset/)).at(-1), 'reset-password');
  expectStatus(await t.api('POST', '/api/auth/reset-password', { body: { token, password: 'copper-valley-thistle-64' } }), 200);
  assert.equal(await canSignIn(who, 'copper-valley-thistle-64'), true, 'the reset lifted the pause');
});

// ---------------------------------------------------------------------------
// An account's email changes only when the new address confirms
// ---------------------------------------------------------------------------

test('an administrator\'s email change waits for the new address to confirm', async () => {
  const principalId = (await t.superuser.query("SELECT user_id FROM users WHERE email = 'principal@spcollege.edu'")).rows[0].user_id;
  const res = await t.api('PATCH', `/api/admin/users/${principalId}`, {
    token: tok.admin, body: { email: 'v.rane.principal@outlook.com' } });
  const body = expectStatus(res, 200);
  assert.equal(body.emailChange.status, 'PENDING_CONFIRMATION');
  assert.equal(body.email, 'principal@spcollege.edu', 'nothing changes yet');
  assert.doesNotMatch(JSON.stringify(body), TOKEN_LIKE);

  assert.equal((await t.inbox('v.rane.principal@outlook.com')).filter((m) => /Confirm your new email/.test(m.subject)).length, 1);
  assert.equal((await t.inbox('principal@spcollege.edu')).filter((m) => /change to your account email/.test(m.subject)).length, 1,
    'the current address hears about it');

  // Until confirmed, password resets still go to the current address.
  expectStatus(await t.api('POST', '/api/auth/forgot-password', { body: { email: 'v.rane.principal@outlook.com' } }), 202);
  expectStatus(await t.api('POST', '/api/auth/forgot-password', { body: { email: 'principal@spcollege.edu' } }), 202);
  await t.waitForMail('principal@spcollege.edu', /Reset/, 3);
  assert.equal((await t.inbox('v.rane.principal@outlook.com')).filter((m) => /Reset/.test(m.subject)).length, 0);
});

test('confirming moves the account, signs out every device and cancels links sent to the old address', async () => {
  const session = await t.login('principal@spcollege.edu').catch(() => null);
  const oldReset = t.linkIn((await t.inbox('principal@spcollege.edu')).filter((m) => /Reset/.test(m.subject)).at(-1), 'reset-password');
  const token = t.linkIn((await t.inbox('v.rane.principal@outlook.com')).at(-1), 'confirm-email');

  const seen = expectStatus(await t.api('POST', '/api/auth/confirm-email/verify', { body: { token } }), 200);
  assert.equal(seen.newEmail, 'v.rane.principal@outlook.com');
  const done = expectStatus(await t.api('POST', '/api/auth/confirm-email', { body: { token } }), 200);
  assert.equal(done.email, 'v.rane.principal@outlook.com');

  if (session) expectStatus(await t.api('GET', '/api/auth/me', { token: session }), 401);
  assert.equal((await t.waitForMail('principal@spcollege.edu', /account email was changed/)).length, 1);
  const stale = await t.api('POST', '/api/auth/reset-password/verify', { body: { token: oldReset } });
  assert.ok([404, 410].includes(stale.status), 'a reset link sent to the old address no longer works');

  const again = await t.api('POST', '/api/auth/confirm-email', { body: { token } });
  assert.equal(again.body.error.code, 'LINK_USED');
});

test('re-addressing an invitation nobody accepted cancels the old link', async () => {
  const users = expectStatus(await t.api('GET', '/api/admin/users', { token: tok.admin }), 200);
  const pending = users.find((u) => u.email === 'someone@gmail.com');
  const oldLink = t.linkIn((await t.inbox('someone@gmail.com')).filter((m) => /Invitation/.test(m.subject)).at(-1), 'accept-invite');

  const body = expectStatus(await t.api('PATCH', `/api/admin/users/${pending.id}`, {
    token: tok.admin, body: { email: 'someone.else@gmail.com' } }), 200);
  assert.equal(body.email, 'someone.else@gmail.com');
  assert.equal(body.emailChange.status, 'CHANGED_INVITATION_CANCELLED');
  assert.equal(body.account.status, 'INVITE_CANCELLED');
  const old = await t.api('POST', '/api/auth/verify-setup-token', { body: { token: oldLink } });
  assert.ok([404, 410].includes(old.status));
});

// ---------------------------------------------------------------------------
// Break-glass recovery, run on the server by its operator
// ---------------------------------------------------------------------------

async function recoveryScript(...cliArgs) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/admin-recovery.js', ...cliArgs], { env: process.env });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('the recovery script refuses anyone but the administrator', async () => {
  const res = await recoveryScript('--email', 'head.cs@spcollege.edu');
  assert.equal(res.code, 1);
  assert.match(res.out, /not an administrator/);
});

test('the recovery script emails the administrator a reset link and lifts a pause', async () => {
  await t.superuser.query(
    `UPDATE users SET locked_until = NOW() + interval '1 hour' WHERE email = 'admin@spcollege.edu'`);
  const res = await recoveryScript('--email', 'admin@spcollege.edu');
  assert.equal(res.code, 0, res.out);
  assert.doesNotMatch(res.out, TOKEN_LIKE, 'without --print-link the link is never printed');

  const token = t.linkIn((await t.waitForMail('admin@spcollege.edu', /Reset/)).at(-1), 'reset-password');
  expectStatus(await t.api('POST', '/api/auth/reset-password', { body: { token, password: 'granite-harbor-willow-37' } }), 200);
  assert.equal(await canSignIn('admin@spcollege.edu', 'granite-harbor-willow-37'), true);
  const { rows } = await t.superuser.query(
    `SELECT after_json->>'operator' AS operator FROM audit_logs WHERE action = 'BREAK_GLASS_RECOVERY'`);
  assert.equal(rows.length, 1, 'every use is recorded');
  assert.ok(rows[0].operator);
  // Recovery also cleared 2-step verification: the next sign-in enrols again.
  const signIn = await t.api('POST', '/api/auth/login', { body: { email: 'admin@spcollege.edu', password: 'granite-harbor-willow-37' } });
  assert.equal(signIn.body.mfa?.step, 'enrol');
  tok.admin = await t.login('admin@spcollege.edu', 'granite-harbor-willow-37');
});

test('bootstrap only creates the first administrator', async () => {
  const res = await recoveryScript('--bootstrap', '--email', 'second.admin@example.com', '--name', 'Second Admin');
  assert.equal(res.code, 1);
  assert.match(res.out, /already exists/);
  const { rowCount } = await t.superuser.query("SELECT 1 FROM users WHERE email = 'second.admin@example.com'");
  assert.equal(rowCount, 0);
});

// ---------------------------------------------------------------------------
// 2-step verification for the administrator (and any role configured)
// ---------------------------------------------------------------------------

test('the administrator cannot sign in with a password alone', async () => {
  const res = await t.api('POST', '/api/auth/login', { body: { email: 'admin@spcollege.edu', password: 'granite-harbor-willow-37' } });
  assert.equal(res.status, 200);
  assert.equal(res.body.token, undefined, 'no session from the password step');
  assert.equal(res.body.mfa.step, 'verify');
  // The challenge is not a session: it opens nothing.
  expectStatus(await t.api('GET', '/api/auth/me', { token: res.body.mfa.challenge }), 401);
  expectStatus(await t.api('GET', '/api/admin/users', { token: res.body.mfa.challenge }), 401);
});

test('a code works once; a replayed code is refused', async () => {
  const first = await t.api('POST', '/api/auth/login', { body: { email: 'admin@spcollege.edu', password: 'granite-harbor-willow-37' } });
  await t.superuser.query("UPDATE users SET mfa_last_step = NULL WHERE email = 'admin@spcollege.edu'");
  const code = t.totpFor('admin@spcollege.edu');
  expectStatus(await t.api('POST', '/api/auth/mfa/verify', { body: { challenge: first.body.mfa.challenge, code } }), 200);

  const second = await t.api('POST', '/api/auth/login', { body: { email: 'admin@spcollege.edu', password: 'granite-harbor-willow-37' } });
  const replay = await t.api('POST', '/api/auth/mfa/verify', { body: { challenge: second.body.mfa.challenge, code } });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, 'MFA_CODE_INVALID');
  const wrong = await t.api('POST', '/api/auth/mfa/verify', { body: { challenge: second.body.mfa.challenge, code: '000000' === code ? '111111' : '000000' } });
  assert.equal(wrong.status, 401);
});

test('a role added to the policy must enrol at its next sign-in, and secrets are stored encrypted', async () => {
  expectStatus(await t.api('PATCH', '/api/admin/config', {
    token: tok.admin, body: { settings: { 'auth.mfa_required_roles': ['ADMIN', 'HEAD'] } } }), 200);
  const refused = await t.api('PATCH', '/api/admin/config', {
    token: tok.admin, body: { settings: { 'auth.mfa_required_roles': ['HEAD'] } } });
  assert.equal(refused.status, 422, 'the administrator can never be exempted');

  const res = await t.api('POST', '/api/auth/login', { body: { email: 'head.cs@spcollege.edu', password: PASSWORD } });
  assert.equal(res.body.mfa.step, 'enrol');
  const { challenge } = res.body.mfa;
  const setup = expectStatus(await t.api('POST', '/api/auth/mfa/setup/start', { body: { challenge } }), 200);
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.otpauthUri, /^otpauth:\/\/totp\//);

  const bad = await t.api('POST', '/api/auth/mfa/setup/confirm', { body: { challenge, code: '000000' } });
  assert.equal(bad.status, 401, 'setup completes only with a working code');

  const { codeAt, stepAt } = await import('../src/totp.js');
  const done = expectStatus(await t.api('POST', '/api/auth/mfa/setup/confirm', {
    body: { challenge, code: codeAt(setup.secret, stepAt()) } }), 200);
  assert.equal(done.recoveryCodes.length, 10);
  assert.ok(done.token);
  assert.equal((await t.waitForMail('head.cs@spcollege.edu', /2-step verification is on/)).length, 1);

  const { rows: [u] } = await t.superuser.query(
    "SELECT mfa_secret_enc, mfa_enabled_at FROM users WHERE email = 'head.cs@spcollege.edu'");
  assert.ok(u.mfa_enabled_at);
  assert.match(u.mfa_secret_enc, /^v1:/);
  assert.equal(u.mfa_secret_enc.includes(setup.secret), false, 'the secret is never stored readable');
  const { rows: codes } = await t.superuser.query(
    `SELECT code_hash FROM mfa_recovery_codes WHERE user_id = (SELECT user_id FROM users WHERE email = 'head.cs@spcollege.edu')`);
  assert.equal(codes.length, 10);
  for (const c of codes) for (const plain of done.recoveryCodes) assert.equal(c.code_hash.includes(plain.replace('-', '')), false);

  // A recovery code signs in once, and the owner is told how many are left.
  const login1 = await t.api('POST', '/api/auth/login', { body: { email: 'head.cs@spcollege.edu', password: PASSWORD } });
  const used = expectStatus(await t.api('POST', '/api/auth/mfa/verify', {
    body: { challenge: login1.body.mfa.challenge, recoveryCode: done.recoveryCodes[0].toLowerCase() } }), 200);
  assert.equal(used.recoveryCodesLeft, 9);
  assert.equal((await t.waitForMail('head.cs@spcollege.edu', /recovery code was used/)).length, 1);
  const login2 = await t.api('POST', '/api/auth/login', { body: { email: 'head.cs@spcollege.edu', password: PASSWORD } });
  const reused = await t.api('POST', '/api/auth/mfa/verify', {
    body: { challenge: login2.body.mfa.challenge, recoveryCode: done.recoveryCodes[0] } });
  assert.equal(reused.status, 401);

  expectStatus(await t.api('PATCH', '/api/admin/config', {
    token: tok.admin, body: { settings: { 'auth.mfa_required_roles': ['ADMIN'] } } }), 200);
});

test('people in roles that do not require it sign in with their password', async () => {
  const res = await t.api('POST', '/api/auth/login', { body: { email: 'incharge@spcollege.edu', password: 'violet-harbour-lantern-42' } });
  assert.ok(res.body.token);
  assert.equal(res.body.mfa, undefined);
});

test('a challenge stops working once the account is signed out everywhere', async () => {
  const res = await t.api('POST', '/api/auth/login', { body: { email: 'admin@spcollege.edu', password: 'granite-harbor-willow-37' } });
  await t.superuser.query(
    "UPDATE users SET token_version = token_version + 1, mfa_last_step = NULL WHERE email = 'admin@spcollege.edu'");
  const late = await t.api('POST', '/api/auth/mfa/verify', {
    body: { challenge: res.body.mfa.challenge, code: t.totpFor('admin@spcollege.edu') } });
  assert.equal(late.status, 401);
  assert.equal(late.body.error.code, 'CHALLENGE_EXPIRED');
  const forged = await t.api('POST', '/api/auth/mfa/verify', { body: { challenge: 'not-a-challenge', code: '123456' } });
  assert.equal(forged.body.error.code, 'CHALLENGE_EXPIRED');
  tok.admin = await t.login('admin@spcollege.edu', 'granite-harbor-willow-37');
});

test('new recovery codes need a current authenticator code', async () => {
  const without = await t.api('POST', '/api/auth/mfa/recovery-codes', { token: tok.admin, body: { code: '000000' } });
  assert.equal(without.status, 401);
  await t.superuser.query("UPDATE users SET mfa_last_step = NULL WHERE email = 'admin@spcollege.edu'");
  const fresh = expectStatus(await t.api('POST', '/api/auth/mfa/recovery-codes', {
    token: tok.admin, body: { code: t.totpFor('admin@spcollege.edu') } }), 200);
  assert.equal(fresh.recoveryCodes.length, 10);
});

test('the signed-in profile says whether 2-step verification is on, never the secret', async () => {
  const admin = expectStatus(await t.api('GET', '/api/auth/me', { token: tok.admin }), 200);
  assert.equal(admin.mfa.enabled, true);
  assert.ok(admin.mfa.enabledAt);
  assert.doesNotMatch(JSON.stringify(admin), /mfa_secret|v1:/);
  const requester = await t.login('incharge@spcollege.edu', 'violet-harbour-lantern-42');
  const plain = expectStatus(await t.api('GET', '/api/auth/me', { token: requester }), 200);
  assert.equal(plain.mfa.enabled, false);
});
