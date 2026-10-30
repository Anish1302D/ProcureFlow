import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { expectStatus, startApi } from './helpers.js';

let t;
const tok = {};
const ids = {};

before(async () => {
  t = await startApi();
  for (const [key, email] of Object.entries({
    head: 'head.cs@spcollege.edu',
    headChem: 'head.chem@spcollege.edu',
    clerkCs: 'clerk@spcollege.edu',
    pc1: 'pc1@spcollege.edu',
    principal: 'principal@spcollege.edu',
    cdcGrant: 'cdc.grant@spcollege.edu',
    cdcNonGrant: 'cdc.nongrant@spcollege.edu',
    chairman: 'chairman@spcollege.edu',
    vp: 'vp@spcollege.edu',
    admin: 'admin@spcollege.edu',
  })) {
    tok[key] = await t.login(email);
  }

  const heads = expectStatus(await t.api('GET', '/api/budget-heads', { token: tok.head }), 200);
  ids.it = heads.find((h) => h.code === 'IT').id;
  const itItems = expectStatus(await t.api('GET', `/api/budget-heads/${ids.it}/items`, { token: tok.head }), 200);
  for (const i of itItems) ids[i.code] = i.id;

  const depts = expectStatus(await t.api('GET', '/api/departments', { token: tok.head }), 200);
  ids.csDept = depts.find((d) => d.code === 'CS').id;
  ids.chemDept = depts.find((d) => d.code === 'CHEM').id;

  const fys = expectStatus(await t.api('GET', '/api/financial-years', { token: tok.head }), 200);
  ids.fy = fys[0].id;
});

after(() => t?.close());

async function createSubmittedRequest(token, title, amount) {
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token,
    body: {
      title,
      budgetHeadId: ids.it,
      departmentId: ids.csDept,
      items: [{ budgetItemId: ids['MIC-01'], quantity: 1, unitCost: amount }],
    },
  }), 201);

  expectStatus(await t.api('POST', `/api/requests/${draft.id}/submit`, { token }), 200);
  return draft;
}

test('1. PC APPROVE is rejected', async () => {
  const req = await createSubmittedRequest(tok.head, 'Authz test - PC approve', 30000);

  const res = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'APPROVE' },
  });
  assert.equal(res.status, 422, `expected a refusal, got ${res.status}`);
  assert.match(res.body.error.message, /validity review only/);
});

test('2. Principal APPROVE above 50,000 is rejected', async () => {
  const req = await createSubmittedRequest(tok.head, 'Authz test - Principal >50k approve', 100000);

  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'FORWARD' },
  }), 201);

  const res = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'APPROVE' },
  });
  assert.equal(res.status, 422, `expected a refusal, got ${res.status}`);
  assert.match(res.body.error.message, /above ₹50,000/);
});

test('3. Single CDC Grant member approving closes Grant request as APPROVED', async () => {
  const req = await createSubmittedRequest(tok.head, 'Authz test - Single CDC approve', 100000);

  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, { token: tok.pc1, body: { action: 'FORWARD' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, { token: tok.principal, body: { action: 'FORWARD' } }), 201);

  const res = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.cdcGrant,
    body: { action: 'APPROVE' },
  }), 201);

  assert.equal(res.request.status, 'APPROVED');
});

test('4. CDC Non-Grant member cannot see or approve a Grant department request', async () => {
  const req = await createSubmittedRequest(tok.head, 'Authz test - CDC non-grant blocked', 100000);

  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, { token: tok.pc1, body: { action: 'FORWARD' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, { token: tok.principal, body: { action: 'FORWARD' } }), 201);

  // CDC Non-Grant member attempting to act on Grant department request is refused with 404 (not found / not permitted via RLS)
  const nonGrantRes = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.cdcNonGrant,
    body: { action: 'APPROVE' },
  });
  assert.equal(nonGrantRes.status, 404);
});

test('5. Non-Grant request is approved solely by CDC Non-Grant member', async () => {
  // Set CHEM department to NON_GRANT
  await t.superuser.query("UPDATE departments SET funding_type = 'NON_GRANT' WHERE department_id = $1", [ids.chemDept]);

  // Create request for CHEM department (Non-Grant)
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.headChem,
    body: {
      title: 'Authz test - Non-Grant department',
      departmentId: ids.chemDept,
      budgetHeadId: ids.it,
      items: [{ budgetItemId: ids['MIC-01'], quantity: 1, unitCost: 100000 }],
    },
  }), 201);

  expectStatus(await t.api('POST', `/api/requests/${draft.id}/submit`, { token: tok.headChem }), 200);
  expectStatus(await t.api('POST', `/api/requests/${draft.id}/actions`, { token: tok.pc1, body: { action: 'FORWARD' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${draft.id}/actions`, { token: tok.principal, body: { action: 'FORWARD' } }), 201);

  // CDC Grant member cannot see or approve Non-Grant request
  const grantRes = await t.api('POST', `/api/requests/${draft.id}/actions`, {
    token: tok.cdcGrant,
    body: { action: 'APPROVE' },
  });
  assert.equal(grantRes.status, 404);

  // CDC Non-Grant member CAN approve and finalize the decision
  const nonGrantApproval = expectStatus(await t.api('POST', `/api/requests/${draft.id}/actions`, {
    token: tok.cdcNonGrant,
    body: { action: 'APPROVE' },
  }), 201);
  assert.equal(nonGrantApproval.request.status, 'APPROVED');
});

test('6. Single Chairman approval finalizes final stage', async () => {
  const req = await createSubmittedRequest(tok.head, 'Authz test - Final authority single approve', 600000);

  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, { token: tok.pc1, body: { action: 'FORWARD' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, { token: tok.principal, body: { action: 'FORWARD' } }), 201);

  const res = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, { token: tok.chairman, body: { action: 'APPROVE' } }), 201);
  assert.equal(res.request.status, 'APPROVED');
});

test('7. Resubmit by non-raiser is rejected', async () => {
  const req = await createSubmittedRequest(tok.head, 'Authz test - Resubmit by non-raiser', 20000);

  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, { token: tok.pc1, body: { action: 'RETURN', comments: 'Fix details' } }), 201);

  const res = await t.api('POST', `/api/requests/${req.id}/resubmit`, {
    token: tok.headChem,
    body: { comments: 'Wrong user resubmit' },
  });
  assert.notEqual(res.status, 200);
});

test('8. Principal RETURN on 30k & 75k and PC RETURN resubmission routing', async () => {
  // (a) Principal RETURN on 30k
  const req30 = await createSubmittedRequest(tok.head, 'Authz test - Principal RETURN 30k', 30000);
  expectStatus(await t.api('POST', `/api/requests/${req30.id}/actions`, { token: tok.pc1, body: { action: 'FORWARD' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${req30.id}/actions`, { token: tok.principal, body: { action: 'RETURN', comments: 'Fix budget' } }), 201);

  const resub30 = expectStatus(await t.api('POST', `/api/requests/${req30.id}/resubmit`, { token: tok.head, body: { comments: 'Resubmitted' } }), 200);
  console.log('[Test 8a] 30k Principal RETURN -> Resubmit landed stage:', resub30.stage.code, 'status:', resub30.status);
  assert.equal(resub30.stage.code, 'PRINCIPAL', 'Resubmission lands directly back at PRINCIPAL stage, skipping PC');

  // (b) Principal RETURN on 75k
  const req75 = await createSubmittedRequest(tok.head, 'Authz test - Principal RETURN 75k', 75000);
  expectStatus(await t.api('POST', `/api/requests/${req75.id}/actions`, { token: tok.pc1, body: { action: 'FORWARD' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${req75.id}/actions`, { token: tok.principal, body: { action: 'RETURN', comments: 'Fix items' } }), 201);

  const resub75 = expectStatus(await t.api('POST', `/api/requests/${req75.id}/resubmit`, { token: tok.head, body: { comments: 'Resubmitted' } }), 200);
  console.log('[Test 8b] 75k Principal RETURN -> Resubmit landed stage:', resub75.stage.code, 'status:', resub75.status);
  assert.equal(resub75.stage.code, 'PRINCIPAL', 'Resubmission lands directly back at PRINCIPAL stage, skipping PC');

  // (c) PC RETURN
  const reqPc = await createSubmittedRequest(tok.head, 'Authz test - PC RETURN', 20000);
  expectStatus(await t.api('POST', `/api/requests/${reqPc.id}/actions`, { token: tok.pc1, body: { action: 'RETURN', comments: 'Fix vendor' } }), 201);

  const resubPc = expectStatus(await t.api('POST', `/api/requests/${reqPc.id}/resubmit`, { token: tok.head, body: { comments: 'Resubmitted' } }), 200);
  console.log('[Test 8c] PC RETURN -> Resubmit landed stage:', resubPc.stage.code, 'status:', resubPc.status);
  assert.equal(resubPc.stage.code, 'PURCHASE_COMMITTEE');
});

test('9. Dual-staffed CDC member cannot be inserted twice due to stage_approvers_pkey constraint', async () => {
  const grantRoleId = (await t.superuser.query("SELECT role_id FROM roles WHERE code = 'CDC_GRANT_MEMBER'")).rows[0].role_id;
  const nonGrantRoleId = (await t.superuser.query("SELECT role_id FROM roles WHERE code = 'CDC_NON_GRANT_MEMBER'")).rows[0].role_id;
  const cdcStageId = (await t.superuser.query("SELECT stage_id FROM workflow_stages WHERE code = 'CDC'")).rows[0].stage_id;

  const dualUserRes = await t.superuser.query(`
    INSERT INTO users (email, full_name, password_hash)
    VALUES ('cdc.dual2@spcollege.edu', 'Dual Staffed CDC Member', crypt('ChangeMe#2026', gen_salt('bf', 12)))
    RETURNING user_id;
  `);
  const dualUserId = dualUserRes.rows[0].user_id;

  await t.superuser.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($1, $3)', [dualUserId, grantRoleId, nonGrantRoleId]);
  
  // First role insertion in stage_approvers succeeds
  await t.superuser.query('INSERT INTO stage_approvers (stage_id, user_id, role_id) VALUES ($1, $2, $3)', [cdcStageId, dualUserId, grantRoleId]);

  // Second role insertion for same user at same stage fails due to PK (stage_id, user_id)
  let pkeyFailed = false;
  try {
    await t.superuser.query('INSERT INTO stage_approvers (stage_id, user_id, role_id) VALUES ($1, $2, $3)', [cdcStageId, dualUserId, nonGrantRoleId]);
  } catch (err) {
    pkeyFailed = (err.code === '23505');
  }
  assert.equal(pkeyFailed, true, 'stage_approvers_pkey prevents assigning multiple role_ids to the same user at the same stage');
});

test('10. Budget context follows request visibility, and only a head declares a provision', async () => {
  const req = await createSubmittedRequest(tok.head, 'Authz test - Endpoint checks', 20000);

  // The budget picture is part of the request, so it is visible to exactly
  // those who may see the request — and to nobody else.
  const own = await t.api('GET', `/api/requests/${req.id}/budget-context`, { token: tok.clerkCs });
  assert.equal(own.status, 404, 'a clerk who cannot see the request cannot read its budget either');
  const principal = await t.api('GET', `/api/requests/${req.id}/budget-context`, { token: tok.principal });
  assert.equal(principal.status, 200, 'the Principal sees every request, so also its budget');
  const crossDept = await t.api('GET', `/api/requests/${req.id}/budget-context`, { token: tok.headChem });
  assert.equal(crossDept.status, 404, 'another department\'s head cannot read it');

  // A head declares their own department's provision.
  const prov = expectStatus(await t.api('POST', '/api/budget-provisions', {
    token: tok.head,
    body: { departmentId: ids.csDept, financialYearId: ids.fy, allocatedAmount: 50000000 },
  }), 201);

  // A head cannot declare one for another department...
  const foreign = await t.api('POST', '/api/budget-provisions', {
    token: tok.head,
    body: { departmentId: ids.chemDept, financialYearId: ids.fy, allocatedAmount: 900000 },
  });
  assert.equal(foreign.status, 403, `expected a refusal, got ${foreign.status}`);

  // ...and someone with no head role cannot declare one at all.
  const clerk = await t.api('POST', '/api/budget-provisions', {
    token: tok.clerkCs,
    body: { departmentId: ids.csDept, financialYearId: ids.fy, allocatedAmount: 100 },
  });
  assert.equal(clerk.status, 403, `expected a refusal, got ${clerk.status}`);

  // Clean up provision so subsequent authorization test cases remain cleanly isolated
  await t.superuser.query('DELETE FROM budget_provisions WHERE budget_provision_id = $1', [prov.id]);
});

test('11. A head cannot read another department\'s request', async () => {
  const req = await createSubmittedRequest(tok.head, 'Authz test - Cross department read', 20000);

  const detail = await t.api('GET', `/api/requests/${req.id}`, { token: tok.headChem });
  assert.equal(detail.status, 404, 'not 403, which would confirm it exists');

  const list = expectStatus(await t.api('GET', '/api/requests', { token: tok.headChem }), 200);
  assert.equal(list.items.some((r) => r.id === req.id), false, 'nor does it appear in their list');
});

test('12. An administrator is not an approver', async () => {
  const req = await createSubmittedRequest(tok.head, 'Authz test - Admin action', 20000);

  // Admin sees everything, but approval authority comes from stage staffing,
  // never from a role (server/src/roles.js).
  const res = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.admin,
    body: { action: 'FORWARD' },
  });
  assert.equal(res.status, 403, `expected a refusal, got ${res.status}`);
  assert.equal(res.body.error.code, 'SP004');
});

test('13. Returning for correction belongs to the committee and the Principal alone', async () => {
  const reqCdc = await createSubmittedRequest(tok.head, 'Authz test - CDC Return attempt', 100000);
  expectStatus(await t.api('POST', `/api/requests/${reqCdc.id}/actions`, { token: tok.pc1, body: { action: 'FORWARD' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${reqCdc.id}/actions`, { token: tok.principal, body: { action: 'FORWARD' } }), 201);

  const res = await t.api('POST', `/api/requests/${reqCdc.id}/actions`, {
    token: tok.cdcGrant,
    body: { action: 'RETURN', comments: 'Needs budget fix' },
  });
  assert.equal(res.status, 422, `expected a refusal, got ${res.status}`);

  const detail = expectStatus(await t.api('GET', `/api/requests/${reqCdc.id}`, { token: tok.cdcGrant }), 200);
  assert.equal(detail.status, 'UNDER_CDC_REVIEW', 'the request did not move');
  assert.equal(detail.permissions.actions.includes('RETURN'), false, 'nor is it offered to them');
});

test('14. A head raises requests only for their own department', async () => {
  // Another department is refused; leaving it blank pins the head's own.
  const other = await t.api('POST', '/api/requests', {
    token: tok.head,
    body: { title: 'Authz test - other department', budgetHeadId: ids.it, departmentId: ids.chemDept },
  });
  assert.equal(other.status, 403);
  assert.match(other.body.error.message, /own department/);

  const blank = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.head,
    body: { title: 'Authz test - no department sent', budgetHeadId: ids.it, departmentId: null },
  }), 201);
  assert.equal(blank.department.id, ids.csDept);

  // Nor can a course from another department be slipped in on edit.
  const chemCourses = expectStatus(await t.api('GET', `/api/courses?departmentId=${ids.chemDept}`, { token: tok.head }), 200);
  const res = await t.api('PATCH', `/api/requests/${blank.id}`, {
    token: tok.head,
    body: { courseId: chemCourses[0].id },
  });
  assert.equal(res.status, 422);
  assert.match(res.body.error.message, /different department/);
});
