import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { expectStatus, startApi, pdf } from './helpers.js';

let t;
const tok = {};

before(async () => {
  t = await startApi();
  tok.admin = await t.login('admin@spcollege.edu');
  tok.headCs = await t.login('head.cs@spcollege.edu');
  tok.pc1 = await t.login('pc1@spcollege.edu');
  tok.pc2 = await t.login('pc2@spcollege.edu');
  tok.principal = await t.login('principal@spcollege.edu');
  tok.cdcTeach1 = await t.login('cdc.grant@spcollege.edu');
  tok.cdcTeach2 = await t.login('cdc.teach2@spcollege.edu');
  tok.cdcTeach3 = await t.login('cdc.teach3@spcollege.edu');
  tok.cdcNonGrant = await t.login('cdc.nongrant@spcollege.edu');
});

after(() => t?.close());

test('1. Multiple members per role and committee staffing', async () => {
  // 3 Teaching CDC members + 1 Non-Teaching CDC member all authenticated successfully
  assert.ok(tok.cdcTeach1);
  assert.ok(tok.cdcTeach2);
  assert.ok(tok.cdcTeach3);
  assert.ok(tok.cdcNonGrant);

  // Multiple Purchase Committee members both authenticated
  assert.ok(tok.pc1);
  assert.ok(tok.pc2);

  // Verify stage_approvers seating for CDC
  const { rows: cdcApprovers } = await t.superuser.query(
    `SELECT u.email, sa.member_classification, r.code AS role_code
       FROM stage_approvers sa
       JOIN users u ON u.user_id = sa.user_id
       JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
       JOIN roles r ON r.role_id = sa.role_id
      WHERE ws.code = 'CDC'
      ORDER BY u.email`,
  );

  assert.equal(cdcApprovers.length, 4, 'CDC stage must seat exactly 4 members in seed');
  const teachingMembers = cdcApprovers.filter((m) => m.member_classification === 'TEACHING');
  const nonTeachingMembers = cdcApprovers.filter((m) => m.member_classification === 'NON_TEACHING');
  assert.equal(teachingMembers.length, 3, 'Must have exactly 3 teaching CDC members');
  assert.equal(nonTeachingMembers.length, 1, 'Must have exactly 1 non-teaching CDC member');

  // Admin attempts to appoint a 4th active teaching CDC member -> rejected with 422
  const { rows: newTeacher } = await t.superuser.query(
    `INSERT INTO users (email, full_name, password_hash, is_active, employee_id)
     VALUES ('fourth.teach@spcollege.edu', 'Prof. Extra Teacher', 'hash', TRUE, 'EMP-CDC-099')
     RETURNING user_id`,
  );
  const cdcRoleRes = await t.superuser.query("SELECT role_id FROM roles WHERE code = 'CDC_MEMBER'");
  const cdcRoleId = cdcRoleRes.rows[0].role_id;

  const limitExceededRes = await t.api('POST', '/api/admin/appointments', {
    token: tok.admin,
    body: {
      userId: newTeacher[0].user_id,
      roleId: cdcRoleId,
      memberClassification: 'TEACHING',
      isActive: true,
    },
  });
  assert.equal(limitExceededRes.status, 422);
  assert.match(limitExceededRes.body.error?.message || limitExceededRes.body.message, /statutory limit/i);
});

test('2. Role tenure history: Principal, Chairman, Vice Chairman history preserved', async () => {
  // Verify historical principals A, B, C exist with persistent identities
  const { rows: principals } = await t.superuser.query(
    `SELECT u.email, u.full_name, u.employee_id, ra.start_date, ra.end_date, ra.is_active, ra.remarks
       FROM role_appointments ra
       JOIN users u ON u.user_id = ra.user_id
       JOIN roles r ON r.role_id = ra.role_id
      WHERE r.code = 'PRINCIPAL'
      ORDER BY ra.start_date`,
  );

  assert.ok(principals.length >= 3, 'Must have at least 3 historical principal tenures');
  const [prinA, prinB, prinC] = principals;

  assert.equal(prinA.email, 'principal.a@spcollege.edu');
  assert.equal(prinA.employee_id, 'EMP-PRIN-001');
  assert.equal(prinA.is_active, false);

  assert.equal(prinB.email, 'principal.b@spcollege.edu');
  assert.equal(prinB.employee_id, 'EMP-PRIN-002');
  assert.equal(prinB.is_active, false);

  assert.equal(prinC.email, 'principal@spcollege.edu');
  assert.equal(prinC.employee_id, 'EMP-PRIN-003');
  assert.equal(prinC.is_active, true);

  // Verify Chairman history
  const { rows: chairmen } = await t.superuser.query(
    `SELECT u.email, ra.is_active
       FROM role_appointments ra
       JOIN users u ON u.user_id = ra.user_id
       JOIN roles r ON r.role_id = ra.role_id
      WHERE r.code = 'CHAIRMAN'
      ORDER BY ra.start_date`,
  );
  assert.ok(chairmen.length >= 2, 'Must have at least 2 chairman appointments (Former & Current)');
  assert.equal(chairmen.some((c) => c.email === 'chairman.former@spcollege.edu' && !c.is_active), true);
  assert.equal(chairmen.some((c) => c.email === 'chairman@spcollege.edu' && c.is_active), true);

  // Verify Vice Chairman history
  const { rows: vps } = await t.superuser.query(
    `SELECT u.email, ra.is_active
       FROM role_appointments ra
       JOIN users u ON u.user_id = ra.user_id
       JOIN roles r ON r.role_id = ra.role_id
      WHERE r.code = 'VICE_PRESIDENT'
      ORDER BY ra.start_date`,
  );
  assert.ok(vps.length >= 2, 'Must have at least 2 vice chairman appointments (Former & Current)');
  assert.equal(vps.some((v) => v.email === 'vp.former@spcollege.edu' && !v.is_active), true);
  assert.equal(vps.some((v) => v.email === 'vp@spcollege.edu' && v.is_active), true);

});

test('3. Historical approval integrity: past decisions preserve actual actor and role', async () => {
  // Create and submit a request by Head CS
  const fyRes = await t.superuser.query('SELECT financial_year_id FROM financial_years WHERE is_active LIMIT 1');
  const fyId = fyRes.rows[0].financial_year_id;
  const deptRes = await t.superuser.query("SELECT department_id FROM departments WHERE code = 'CS'");
  const deptId = deptRes.rows[0].department_id;
  const headRes = await t.superuser.query("SELECT budget_head_id FROM budget_heads WHERE code = 'IT'");
  const headId = headRes.rows[0].budget_head_id;
  const itemRes = await t.superuser.query("SELECT budget_item_id FROM budget_items WHERE code = 'MIC-01'");
  const itemId = itemRes.rows[0].budget_item_id;

  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.headCs,
    body: {
      financialYearId: fyId,
      departmentId: deptId,
      budgetHeadId: headId,
      title: 'Projector & Microphone Procurement',
      items: [{
        budgetItemId: itemId,
        itemType: 'CAPITAL',
        unitCost: 5000,
        quantity: 6, // 30,000 -> Principal final authority
      }],
    },
  }), 201);

  // Upload attachment and submit
  await t.api('POST', `/api/requests/${draft.id}/attachments`, {
    token: tok.headCs,
    form: pdf('spec.pdf').form,
  });
  expectStatus(await t.api('POST', `/api/requests/${draft.id}/submit`, { token: tok.headCs }), 200);

  // Step 1: Purchase Committee validity review by pc1
  expectStatus(await t.api('POST', `/api/requests/${draft.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE', comments: 'PC1 verified specifications' },
  }), 201);

  // Step 2: Principal approval by Dr. V. Rane (principal@spcollege.edu) while active incumbent
  expectStatus(await t.api('POST', `/api/requests/${draft.id}/actions`, {
    token: tok.principal,
    body: {
      action: 'APPROVE',
      comments: 'Sanctioned by Principal Rane',
    },
  }), 201);

  // Step 3: Now change/transition the Principal to another person (Dr. D. Successor)
  const { rows: prinDUser } = await t.superuser.query(
    `INSERT INTO users (email, full_name, password_hash, is_active, employee_id)
     VALUES ('principal.d@spcollege.edu', 'Dr. D. Successor (Principal D)', 'hash', TRUE, 'EMP-PRIN-004')
     RETURNING user_id`,
  );
  const prinRoleId = (await t.superuser.query("SELECT role_id FROM roles WHERE code = 'PRINCIPAL'")).rows[0].role_id;

  const transitionRes = expectStatus(await t.api('POST', '/api/admin/appointments', {
    token: tok.admin,
    body: {
      userId: prinDUser[0].user_id,
      roleId: prinRoleId,
      startDate: '2026-11-01',
      autoTransitionPrevious: true,
      appointmentOrderNo: 'SP/PRIN/2026/01',
      remarks: 'New Principal assumption of charge',
    },
  }), 201);

  assert.equal(transitionRes.user.email, 'principal.d@spcollege.edu');
  assert.equal(transitionRes.isActive, true);

  // Verify previous principal appointment (Dr. V. Rane) was marked inactive with an end date
  const { rows: raneAppt } = await t.superuser.query(
    `SELECT ra.is_active, ra.end_date
       FROM role_appointments ra
       JOIN users u ON u.user_id = ra.user_id
      WHERE u.email = 'principal@spcollege.edu' AND ra.role_id = $1`,
    [prinRoleId],
  );
  assert.equal(raneAppt[0].is_active, false, 'Previous Principal appointment should be marked inactive');
  assert.ok(raneAppt[0].end_date, 'Previous Principal should have an end_date populated');

  // And verify Dr. V. Rane's user account itself was NOT overwritten or deleted
  const { rows: raneUser } = await t.superuser.query(
    "SELECT user_id, email, full_name FROM users WHERE email = 'principal@spcollege.edu'",
  );
  assert.equal(raneUser.length, 1);
  assert.equal(raneUser[0].full_name, 'Dr. V. Rane (Principal)');

  // Step 4: Fetch request timeline and verify historical approval integrity
  const timeline = expectStatus(await t.api('GET', `/api/requests/${draft.id}/timeline`, {
    token: tok.headCs,
  }), 200);

  // Check submission entry
  const submitStep = timeline.find((item) => item.action === 'SUBMIT');
  assert.ok(submitStep);
  assert.equal(submitStep.by.name, 'Dr. A. Deshpande (Head, CS)');
  assert.equal(submitStep.by.email, 'head.cs@spcollege.edu');
  assert.equal(submitStep.by.employeeId, 'EMP-CS-001');

  // Check PC1 escalate entry
  const pcStep = timeline.find((item) => item.action === 'ESCALATE');
  assert.ok(pcStep);
  assert.equal(pcStep.by.name, 'R. Joshi (Purchase Committee)');
  assert.equal(pcStep.by.email, 'pc1@spcollege.edu');
  assert.equal(pcStep.by.employeeId, 'EMP-PC-001');
  assert.equal(pcStep.role.code, 'PURCHASE_COMMITTEE');

  // Check Principal approval entry
  const prinStep = timeline.find((item) => item.action === 'APPROVE');
  assert.ok(prinStep);
  // Crucial: Must show Dr. V. Rane (Principal), NOT Dr. E. Successor!
  assert.equal(prinStep.by.name, 'Dr. V. Rane (Principal)', 'Historical approver name must not be replaced');
  assert.equal(prinStep.by.email, 'principal@spcollege.edu');
  assert.equal(prinStep.by.employeeId, 'EMP-PRIN-003');
  assert.equal(prinStep.role.code, 'PRINCIPAL');
  assert.notEqual(prinStep.by.name, 'Dr. D. Successor (Principal D)');
});

test('4. Security & member directory authorization', async () => {
  // Non-admin user cannot appoint roles or transition members
  const unauthAppoint = await t.api('POST', '/api/admin/appointments', {
    token: tok.headCs,
    body: {
      userId: '00000000-0000-0000-0000-000000000001',
      roleId: 1,
    },
  });
  assert.equal(unauthAppoint.status, 403, 'Non-admin must be denied appointment authority');

  // Non-admin user cannot edit appointments
  const unauthPatch = await t.api('PATCH', '/api/admin/appointments/00000000-0000-0000-0000-000000000001', {
    token: tok.headCs,
    body: { isActive: false },
  });
  assert.equal(unauthPatch.status, 403, 'Non-admin must be denied tenure editing');

  // GET /api/members by authorized institutional staff
  const members = expectStatus(await t.api('GET', '/api/members', { token: tok.principal }), 200);
  assert.ok(Array.isArray(members));
  assert.ok(members.length >= 10);

  // Verify sensitive security fields are NEVER exposed
  for (const m of members) {
    assert.equal(m.password_hash, undefined, 'password_hash must never be exposed');
    assert.equal(m.token_version, undefined, 'token_version must never be exposed');
    assert.equal(m.setup_token, undefined, 'setup tokens must never be exposed');
    assert.ok(m.id);
    assert.ok(m.name);
    assert.ok(m.email);
  }

  // GET /api/members/tenure-history returns appointment records
  const tenureHistory = expectStatus(await t.api('GET', '/api/members/tenure-history', { token: tok.principal }), 200);
  assert.ok(Array.isArray(tenureHistory));
  assert.ok(tenureHistory.length >= 5);
  assert.ok(tenureHistory.some((th) => th.role.code === 'PRINCIPAL'));
});
