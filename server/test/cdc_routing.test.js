import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { expectStatus, startApi } from './helpers.js';

// CDC is two routes: a Grant request goes to the Grant (teaching) side, a
// Non-Grant request to the Non-Grant (non-teaching) side. Whoever is told a
// request awaits them must be able to open it, and nobody off the route may be
// told — the demo failure was CDC members notified of requests they could not see.

let t;
const tok = {};
const ids = {};

const CDC_USERS = [
  'cdc.grant@spcollege.edu', 'cdc.teach2@spcollege.edu',
  'cdc.teach3@spcollege.edu', 'cdc.nongrant@spcollege.edu',
];

before(async () => {
  t = await startApi();
  await t.superuser.query("UPDATE departments SET funding_type = 'NON_GRANT' WHERE code = 'CHEM'");

  for (const [key, email] of Object.entries({
    admin: 'admin@spcollege.edu',
    headCs: 'head.cs@spcollege.edu',
    headChem: 'head.chem@spcollege.edu',
    pc1: 'pc1@spcollege.edu',
    principal: 'principal@spcollege.edu',
    'cdc.grant@spcollege.edu': 'cdc.grant@spcollege.edu',
    'cdc.teach2@spcollege.edu': 'cdc.teach2@spcollege.edu',
    'cdc.teach3@spcollege.edu': 'cdc.teach3@spcollege.edu',
    'cdc.nongrant@spcollege.edu': 'cdc.nongrant@spcollege.edu',
  })) {
    tok[key] = await t.login(email);
  }

  const one = async (sql) => (await t.superuser.query(sql)).rows[0];
  ids.it = (await one("SELECT budget_head_id AS id FROM budget_heads WHERE code = 'IT'")).id;
  ids.mic = (await one("SELECT budget_item_id AS id FROM budget_items WHERE code = 'MIC-01'")).id;
  ids.cs = (await one("SELECT department_id AS id FROM departments WHERE code = 'CS'")).id;
  ids.chem = (await one("SELECT department_id AS id FROM departments WHERE code = 'CHEM'")).id;
});

after(() => t?.close());

async function userId(email) {
  return (await t.superuser.query('SELECT user_id FROM users WHERE email = $1', [email])).rows[0].user_id;
}

/** A ₹1,00,000 request taken to CDC; CS is a Grant department, CHEM Non-Grant. */
async function requestAtCdc(title, { nonGrant }) {
  const token = nonGrant ? tok.headChem : tok.headCs;
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token,
    body: { title, budgetHeadId: ids.it, departmentId: nonGrant ? ids.chem : ids.cs,
            items: [{ budgetItemId: ids.mic, quantity: 1, unitCost: 100000 }] },
  }), 201);
  expectStatus(await t.api('POST', `/api/requests/${draft.id}/submit`, { token }), 200);
  expectStatus(await t.api('POST', `/api/requests/${draft.id}/actions`, { token: tok.pc1, body: { action: 'FORWARD' } }), 201);
  const res = expectStatus(await t.api('POST', `/api/requests/${draft.id}/actions`, {
    token: tok.principal, body: { action: 'FORWARD' } }), 201);
  assert.equal(res.request.status, 'UNDER_CDC_REVIEW');
  return draft.id;
}

/** The CDC members told that this request awaits their review. */
async function cdcNotified(requestId, extra = []) {
  const { rows } = await t.superuser.query(
    `SELECT DISTINCT u.email FROM notifications n JOIN users u ON u.user_id = n.user_id
      WHERE n.request_id = $1 AND n.subject LIKE '%awaits your review' AND u.email = ANY($2)
      ORDER BY u.email`,
    [requestId, [...CDC_USERS, ...extra]],
  );
  return rows.map((r) => r.email);
}

/** Each notified member can open the request, sees it in their queue, and may act. */
async function assertNotifiedCanAct(requestId, emails) {
  for (const email of emails) {
    const detail = expectStatus(await t.api('GET', `/api/requests/${requestId}`, { token: tok[email] }), 200);
    assert.equal(detail.permissions.canAct, true, `${email} was notified, so must be able to act`);
    const queue = expectStatus(await t.api('GET', '/api/requests?awaitingMe=true', { token: tok[email] }), 200);
    assert.ok(queue.items.some((r) => r.id === requestId), `${email} was notified, so it is in their queue`);
  }
}

test('a Non-Grant request notifies only the Non-Grant side, and they can open it', async () => {
  const id = await requestAtCdc('CDC routing - Non-Grant', { nonGrant: true });

  const told = await cdcNotified(id);
  assert.deepEqual(told, ['cdc.nongrant@spcollege.edu'],
    'teaching CDC members must not be told about a Non-Grant request they cannot see');
  await assertNotifiedCanAct(id, told);

  for (const email of ['cdc.grant@spcollege.edu', 'cdc.teach2@spcollege.edu', 'cdc.teach3@spcollege.edu']) {
    expectStatus(await t.api('GET', `/api/requests/${id}`, { token: tok[email] }), 404);
  }
});

test('a Grant request notifies the whole teaching side, and each can open it', async () => {
  const id = await requestAtCdc('CDC routing - Grant', { nonGrant: false });

  const told = await cdcNotified(id);
  assert.deepEqual(told, ['cdc.grant@spcollege.edu', 'cdc.teach2@spcollege.edu', 'cdc.teach3@spcollege.edu']);
  await assertNotifiedCanAct(id, told);
  expectStatus(await t.api('GET', `/api/requests/${id}`, { token: tok['cdc.nongrant@spcollege.edu'] }), 404);
});

test('changing a CDC appointment\'s classification moves the member to the other route', async () => {
  const teach3 = 'cdc.teach3@spcollege.edu';
  const { appointment_id: appointmentId } = (await t.superuser.query(
    `SELECT ra.appointment_id FROM role_appointments ra JOIN users u ON u.user_id = ra.user_id
      WHERE u.email = $1 AND ra.is_active`, [teach3])).rows[0];

  // The single non-teaching seat is taken, so the move is refused, not slipped past the limit.
  const refused = await t.api('PATCH', `/api/admin/appointments/${appointmentId}`, {
    token: tok.admin, body: { memberClassification: 'NON_TEACHING' } });
  assert.equal(refused.status, 422, JSON.stringify(refused.body));

  expectStatus(await t.api('DELETE', `/api/admin/stages/CDC/approvers/${await userId('cdc.nongrant@spcollege.edu')}`,
    { token: tok.admin }), 204);
  expectStatus(await t.api('PATCH', `/api/admin/appointments/${appointmentId}`, {
    token: tok.admin, body: { memberClassification: 'NON_TEACHING' } }), 200);

  const staffed = (await t.superuser.query(
    `SELECT sa.member_classification FROM stage_approvers sa JOIN workflow_stages ws USING (stage_id)
      WHERE ws.code = 'CDC' AND sa.user_id = $1`, [await userId(teach3)])).rows[0];
  assert.equal(staffed.member_classification, 'NON_TEACHING', 'routing reads stage_approvers; it must follow the edit');

  const id = await requestAtCdc('CDC routing - reclassified member', { nonGrant: true });
  assert.deepEqual(await cdcNotified(id), [teach3]);
  await assertNotifiedCanAct(id, [teach3]);
  const done = expectStatus(await t.api('POST', `/api/requests/${id}/actions`, { token: tok[teach3], body: { action: 'APPROVE' } }), 201);
  assert.equal(done.request.status, 'APPROVED');
});

test('a non-teaching member staffed from the approval route decides Non-Grant requests', async () => {
  // Free the non-teaching seat, then staff a new person by classification alone,
  // the way the Approval route settings page does.
  expectStatus(await t.api('DELETE', `/api/admin/stages/CDC/approvers/${await userId('cdc.teach3@spcollege.edu')}`,
    { token: tok.admin }), 204);

  await t.superuser.query(
    `INSERT INTO users (email, full_name, password_hash, employee_id, is_active)
     VALUES ('cdc.staff@spcollege.edu', 'CDC Non-Teaching Staff', crypt('ChangeMe#2026', gen_salt('bf', 12)), 'EMP-CDC-099', TRUE)`);
  const staffId = await userId('cdc.staff@spcollege.edu');
  const res = await t.api('POST', '/api/admin/stages/CDC/approvers', {
    token: tok.admin, body: { userId: staffId, memberClassification: 'NON_TEACHING' } });
  assert.ok(res.status < 300, JSON.stringify(res.body));

  const role = (await t.superuser.query(
    `SELECT r.code FROM stage_approvers sa JOIN roles r ON r.role_id = sa.role_id
      JOIN workflow_stages ws ON ws.stage_id = sa.stage_id WHERE ws.code = 'CDC' AND sa.user_id = $1`,
    [staffId])).rows[0].code;
  assert.equal(role, 'CDC_NON_GRANT_MEMBER', 'a non-teaching member sits on the Non-Grant route');

  tok['cdc.staff@spcollege.edu'] = await t.login('cdc.staff@spcollege.edu');

  const nonGrant = await requestAtCdc('CDC routing - new non-teaching member', { nonGrant: true });
  assert.deepEqual(await cdcNotified(nonGrant, ['cdc.staff@spcollege.edu']), ['cdc.staff@spcollege.edu']);
  await assertNotifiedCanAct(nonGrant, ['cdc.staff@spcollege.edu']);
  const done = expectStatus(await t.api('POST', `/api/requests/${nonGrant}/actions`, {
    token: tok['cdc.staff@spcollege.edu'], body: { action: 'APPROVE' } }), 201);
  assert.equal(done.request.status, 'APPROVED');

  const grant = await requestAtCdc('CDC routing - Grant, not theirs', { nonGrant: false });
  expectStatus(await t.api('GET', `/api/requests/${grant}`, { token: tok['cdc.staff@spcollege.edu'] }), 404);
});
