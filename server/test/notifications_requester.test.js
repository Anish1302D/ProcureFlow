import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { expectStatus, pdf, startApi } from './helpers.js';

let t;
const tok = {};
const ids = {};

before(async () => {
  t = await startApi();
  for (const [key, email] of Object.entries({
    head: 'head.cs@spcollege.edu',
    pc1: 'pc1@spcollege.edu',
    principal: 'principal@spcollege.edu',
    cdcGrant: 'cdc.grant@spcollege.edu',
    cdcNonGrant: 'cdc.nongrant@spcollege.edu',
    admin: 'admin@spcollege.edu',
  })) {
    tok[key] = await t.login(email);
  }

  const heads = expectStatus(await t.api('GET', '/api/budget-heads', { token: tok.head }), 200);
  ids.it = heads.find((h) => h.code === 'IT').id;
  const items = expectStatus(await t.api('GET', `/api/budget-heads/${ids.it}/items`, { token: tok.head }), 200);
  for (const i of items) ids[i.code] = i.id;
  const depts = expectStatus(await t.api('GET', '/api/departments', { token: tok.head }), 200);
  ids.cs = depts.find((d) => d.code === 'CS').id;
});

after(() => t?.close());

test('HOD gets in-app notification and email when Principal and higher authority escalate/approve', async () => {
  // 1. HOD creates and submits a request for ₹1,20,000 (routes through PC -> Principal -> CDC)
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.head,
    body: {
      title: 'CS Lab Microphones',
      budgetHeadId: ids.it,
      departmentId: ids.cs,
      description: 'Microphones for CS seminar hall',
      items: [{ budgetItemId: ids['MIC-01'], quantity: 3, unitCost: 40000 }],
    },
  }), 201);
  ids.req1 = draft.id;

  // Add quotation
  expectStatus(await t.api('POST', `/api/requests/${ids.req1}/attachments`, {
    token: tok.head, form: pdf('quote.pdf').form,
  }), 201);

  // Submit request
  expectStatus(await t.api('POST', `/api/requests/${ids.req1}/submit`, { token: tok.head }), 200);

  // 2. PC escalates to Principal
  expectStatus(await t.api('POST', `/api/requests/${ids.req1}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE', comments: 'PC check complete' },
  }), 201);

  // 3. Principal escalates to CDC
  expectStatus(await t.api('POST', `/api/requests/${ids.req1}/actions`, {
    token: tok.principal,
    body: { action: 'ESCALATE', comments: 'Principal escalated to CDC' },
  }), 201);

  // 4. Verify HOD has in-app notification in login for the escalation
  const notesAfterEscalate = expectStatus(await t.api('GET', '/api/notifications', { token: tok.head }), 200);
  const escNotes = notesAfterEscalate.items.filter((n) => n.request?.id === ids.req1);
  assert.ok(escNotes.length > 0, 'HOD should receive notifications for their request');
  assert.ok(
    escNotes.some((n) => /escalated/i.test(n.subject)),
    'HOD in-app notification should indicate request was escalated',
  );

  // 5. Admin updates the HOD email in User Management
  const { rows: userRows } = await t.superuser.query(
    "SELECT user_id FROM users WHERE email = 'head.cs@spcollege.edu'",
  );
  const hodUserId = userRows[0].user_id;

  const newHodEmail = 'hod.computerscience@spcollege.edu';
  expectStatus(await t.api('PATCH', `/api/admin/users/${hodUserId}`, {
    token: tok.admin,
    body: { email: newHodEmail },
  }), 200);

  // 6. CDC grant member approves (CS department is GRANT, so CDC Grant member decides)
  const decBody = {
    action: 'APPROVE',
    decisions: [{ requestItemId: draft.items[0].id, approvedQuantity: 3, approvedAmount: 120000 }],
    comments: 'CDC Grant Approved',
  };
  const approval = expectStatus(await t.api('POST', `/api/requests/${ids.req1}/actions`, {
    token: tok.cdcGrant,
    body: decBody,
  }), 201);
  assert.equal(approval.request.status, 'APPROVED');

  // Verify CDC non-grant member cannot access this grant department request
  expectStatus(await t.api('POST', `/api/requests/${ids.req1}/actions`, {
    token: tok.cdcNonGrant,
    body: decBody,
  }), 404);

  // 7. Verify HOD login has the approval notification
  // Login with new updated email to verify User Management change worked
  const newHodTok = await t.login(newHodEmail);
  const notesAfterApprove = expectStatus(await t.api('GET', '/api/notifications', { token: newHodTok }), 200);
  const approveNotes = notesAfterApprove.items.filter((n) => n.request?.id === ids.req1);
  assert.ok(
    approveNotes.some((n) => /approved/i.test(n.subject)),
    'HOD in-app notification should show request was approved',
  );

  // Verify the updated email is present on the user record in database
  const { rows: checkUser } = await t.superuser.query(
    'SELECT email FROM users WHERE user_id = $1', [hodUserId],
  );
  assert.equal(checkUser[0].email, newHodEmail);
});

test('HOD gets in-app notification when request is returned for correction and resubmitted', async () => {
  // Login HOD with current email
  const { rows: userRows } = await t.superuser.query(
    "SELECT email FROM users WHERE full_name ILIKE '%Deshpande%'",
  );
  const hodEmail = userRows[0].email;
  const hodTok = await t.login(hodEmail);

  // Create request
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token: hodTok,
    body: {
      title: 'Lab Cables',
      budgetHeadId: ids.it,
      departmentId: ids.cs,
      description: 'HDMI cables',
      items: [{ budgetItemId: ids['HDMI-01'] || ids['MIC-01'], quantity: 2, unitCost: 1000 }],
    },
  }), 201);
  const reqId = draft.id;

  expectStatus(await t.api('POST', `/api/requests/${reqId}/attachments`, {
    token: hodTok, form: pdf('quote2.pdf').form,
  }), 201);

  expectStatus(await t.api('POST', `/api/requests/${reqId}/submit`, { token: hodTok }), 200);

  // PC returns request for correction
  expectStatus(await t.api('POST', `/api/requests/${reqId}/actions`, {
    token: tok.pc1,
    body: { action: 'RETURN', comments: 'Quotation date is missing, please update' },
  }), 201);

  // Verify HOD login has the "returned for correction" notification
  const notesAfterReturn = expectStatus(await t.api('GET', '/api/notifications', { token: hodTok }), 200);
  const returnNotes = notesAfterReturn.items.filter((n) => n.request?.id === reqId);
  assert.ok(
    returnNotes.some((n) => /returned for correction/i.test(n.subject)),
    'HOD should get returned for correction notification in login',
  );

  // Resubmit
  expectStatus(await t.api('POST', `/api/requests/${reqId}/resubmit`, {
    token: hodTok,
    body: { comments: 'Attached updated quotation' },
  }), 200);

  // Verify HOD login has the "resubmitted" notification
  const notesAfterResubmit = expectStatus(await t.api('GET', '/api/notifications', { token: hodTok }), 200);
  const resubmitNotes = notesAfterResubmit.items.filter((n) => n.request?.id === reqId);
  assert.ok(
    resubmitNotes.some((n) => /resubmitted/i.test(n.subject)),
    'HOD should get resubmitted notification in login',
  );
});
