import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { expectStatus, pdf, startApi } from './helpers.js';

let t;
const tok = {};
const ids = {};

before(async () => {
  t = await startApi();

  // Create Commerce department with NON_GRANT funding_type and a head user
  const commDept = await t.superuser.query(
    `INSERT INTO departments (code, name, funding_type)
     VALUES ('COMMERCE', 'Commerce Department', 'NON_GRANT')
     ON CONFLICT (code) DO UPDATE SET funding_type = 'NON_GRANT'
     RETURNING department_id`,
  );
  ids.deptCommerce = commDept.rows[0].department_id;

  await t.superuser.query(
    `INSERT INTO users (email, full_name, password_hash, department_id, employee_id, is_active)
     VALUES ('head.comm@spcollege.edu', 'Prof. Commerce Head', crypt('ChangeMe#2026', gen_salt('bf', 12)), $1, 'EMP-COMM-001', TRUE)
     ON CONFLICT (email) DO NOTHING`,
    [ids.deptCommerce],
  );

  await t.superuser.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT u.user_id, r.role_id
     FROM users u, roles r
     WHERE u.email = 'head.comm@spcollege.edu' AND r.code = 'HEAD'
     ON CONFLICT DO NOTHING`,
  );

  for (const [key, email] of Object.entries({
    admin: 'admin@spcollege.edu',
    headCs: 'head.cs@spcollege.edu',
    headCommerce: 'head.comm@spcollege.edu', // Non-grant department
    incharge: 'incharge@spcollege.edu',
    pc1: 'pc1@spcollege.edu',
    pc2: 'pc2@spcollege.edu',
    principal: 'principal@spcollege.edu',
    cdcGrant: 'cdc.grant@spcollege.edu',
    cdcTeach2: 'cdc.teach2@spcollege.edu',
    cdcTeach3: 'cdc.teach3@spcollege.edu',
    cdcNonGrant: 'cdc.nongrant@spcollege.edu',
    chairman: 'chairman@spcollege.edu',
    vp: 'vp@spcollege.edu',
    clerk: 'clerk@spcollege.edu',
  })) {
    tok[key] = await t.login(email);
  }

  // Resolve Master Data IDs
  const fyRes = await t.superuser.query("SELECT financial_year_id FROM financial_years WHERE label = '2026-27'");
  ids.fyId = fyRes.rows[0].financial_year_id;

  const csDept = await t.superuser.query("SELECT department_id FROM departments WHERE code = 'CS'");
  ids.deptCs = csDept.rows[0].department_id; // GRANT

  const itHead = await t.superuser.query("SELECT budget_head_id FROM budget_heads WHERE code = 'IT'");
  ids.headIt = itHead.rows[0].budget_head_id;

  const officeHead = await t.superuser.query("SELECT budget_head_id FROM budget_heads WHERE code = 'OFFICE'");
  ids.headOffice = officeHead.rows[0].budget_head_id;

  const micItem = await t.superuser.query("SELECT budget_item_id FROM budget_items WHERE code = 'MIC-01'");
  ids.itemMic = micItem.rows[0].budget_item_id;

  const spkItem = await t.superuser.query("SELECT budget_item_id FROM budget_items WHERE code = 'SPK-01'");
  ids.itemSpk = spkItem.rows[0].budget_item_id;

  const paperItem = await t.superuser.query("SELECT budget_item_id FROM budget_items WHERE code = 'PAPER-01'");
  ids.itemPaper = paperItem.rows[0].budget_item_id;
});

after(() => t?.close());

/**
 * Helper: creates and submits a request, returning its detail.
 */
async function createAndSubmitRequest({ token, deptId, headId, itemId, unitCost, quantity, title }) {
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token,
    body: {
      financialYearId: ids.fyId,
      departmentId: deptId,
      budgetHeadId: headId,
      title: title || 'Workflow Engine Test Request',
      items: [{
        budgetItemId: itemId,
        itemType: 'CAPITAL',
        unitCost,
        quantity,
      }],
    },
  }), 201);

  await t.api('POST', `/api/requests/${draft.id}/attachments`, {
    token,
    form: pdf('quote.pdf').form,
  });

  const submitted = expectStatus(await t.api('POST', `/api/requests/${draft.id}/submit`, { token }), 200);
  return submitted;
}

// ---------------------------------------------------------------------------
// 1. ROUTING THRESHOLDS REGRESSION TESTS
// ---------------------------------------------------------------------------

test('1. Routing thresholds: <= 50,000 decided by Principal, cannot escalate', async () => {
  // Amount = 30,000
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 5000,
    quantity: 6,
    title: 'Small lab mics 30k',
  });

  assert.equal(req.stage.code, 'PURCHASE_COMMITTEE');
  assert.equal(req.status, 'UNDER_PURCHASE_COMMITTEE_REVIEW');

  // PC reviews and escalates to Principal
  const pcAction = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE', comments: 'PC verified specifications' },
  }), 201);

  assert.equal(pcAction.request.stage.code, 'PRINCIPAL');
  assert.equal(pcAction.request.status, 'UNDER_PRINCIPAL_REVIEW');

  // Principal attempts ESCALATE on <= 50k -> must be rejected
  const escRes = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'ESCALATE', comments: 'Trying to escalate small request' },
  });
  assert.equal(escRes.status, 422);
  assert.match(escRes.body.error?.message || escRes.body.message, /must be decided by the Principal and cannot be escalated/i);

  // Principal can approve
  const appRes = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'APPROVE', comments: 'Approved by Principal' },
  }), 201);
  assert.equal(appRes.request.status, 'APPROVED');
});

test('2. Routing thresholds: > 50,000 to <= 5,00,000 routes from Principal to CDC', async () => {
  // Amount = 1,50,000
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 15000,
    quantity: 10,
    title: 'Medium lab mics 150k',
  });

  // PC reviews and escalates
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE', comments: 'PC verified' },
  }), 201);

  // Principal attempts to final-approve > 50k -> must be rejected
  const appRes = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'APPROVE', comments: 'Principal attempting unauthorized approval' },
  });
  assert.equal(appRes.status, 422);
  assert.match(appRes.body.error?.message || appRes.body.message, /decided by CDC/i);

  // Principal forwards/escalates to CDC
  const prinAction = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'ESCALATE', comments: 'Forwarding to CDC for review' },
  }), 201);
  assert.equal(prinAction.request.stage.code, 'CDC');
  assert.equal(prinAction.request.status, 'UNDER_CDC_REVIEW');

  // CDC cannot escalate at this amount (CDC holds final decision)
  const cdcEsc = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.cdcGrant,
    body: { action: 'ESCALATE', comments: 'CDC attempting unauthorized escalation' },
  });
  assert.equal(cdcEsc.status, 422);
  assert.match(cdcEsc.body.error?.message || cdcEsc.body.message, /CDC holds the decision/i);

  // CDC can approve
  const cdcApp = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.cdcGrant,
    body: { action: 'APPROVE', comments: 'Sanctioned by CDC' },
  }), 201);
  assert.equal(cdcApp.request.status, 'APPROVED');
});

test('3. Routing thresholds: > 5,00,000 routes from Principal to Final Authority (skips CDC)', async () => {
  // Amount = 6,00,000
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 150000,
    quantity: 4,
    title: 'Major auditorium overhaul 600k',
  });

  // PC escalates to Principal
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE', comments: 'PC verified' },
  }), 201);

  // Principal escalates > 5L -> routes directly to FINAL_AUTHORITY
  const prinAction = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'ESCALATE', comments: 'Forwarding above 5L to Chairman/VP' },
  }), 201);

  assert.equal(prinAction.request.stage.code, 'FINAL_AUTHORITY');
  assert.equal(prinAction.request.status, 'UNDER_FINAL_AUTHORITY_REVIEW');

  // CDC member cannot decide this request (not staffed at FINAL_AUTHORITY)
  const cdcAction = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.cdcGrant,
    body: { action: 'APPROVE', comments: 'CDC trying to approve FA request' },
  });
  assert.ok([403, 404].includes(cdcAction.status));

  // Final authority (Chairman) approves
  const faApp = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.chairman,
    body: { action: 'APPROVE', comments: 'Sanctioned by Chairman' },
  }), 201);
  assert.equal(faApp.request.status, 'APPROVED');
});

test('4. Dynamic threshold configuration shift', async () => {
  // Change threshold: Increase Principal max from 50,000 to 80,000 via admin config API
  expectStatus(await t.api('PATCH', '/api/admin/config', {
    token: tok.admin,
    body: {
      'workflow.threshold.principal_max': 80000,
    },
  }), 200);

  try {
    // Create a 70,000 request
    const req = await createAndSubmitRequest({
      token: tok.headCs,
      deptId: ids.deptCs,
      headId: ids.headIt,
      itemId: ids.itemMic,
      unitCost: 70000,
      quantity: 1,
      title: 'Dynamic threshold test 70k',
    });

    // PC escalates to Principal
    expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
      token: tok.pc1,
      body: { action: 'ESCALATE', comments: 'PC verified' },
    }), 201);

    // Because Principal limit is now 80,000, Principal CAN approve 70,000!
    const prinApp = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
      token: tok.principal,
      body: { action: 'APPROVE', comments: 'Principal approving 70k under increased limit' },
    }), 201);
    assert.equal(prinApp.request.status, 'APPROVED');
  } finally {
    // Restore threshold back to 50,000
    await t.api('PATCH', '/api/admin/config', {
      token: tok.admin,
      body: {
        'workflow.threshold.principal_max': 50000,
      },
    });
  }
});

// ---------------------------------------------------------------------------
// 2. UNAUTHORIZED ACTIONS REGRESSION TESTS
// ---------------------------------------------------------------------------

test('5. Unauthorized actions: Purchase Committee cannot approve or partially approve', async () => {
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 20000,
    quantity: 1,
    title: 'PC approve test',
  });

  // Attempt APPROVE
  const appRes = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'APPROVE', comments: 'PC attempting approval' },
  });
  assert.equal(appRes.status, 422);
  assert.match(appRes.body.error?.message || appRes.body.message, /validity review only/i);

  // Attempt PARTIAL_APPROVE
  const partRes = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: {
      action: 'PARTIAL_APPROVE',
      itemDecisions: [{
        requestItemId: req.items[0].id,
        approvedQuantity: 1,
        approvedAmount: 20000,
      }],
      comments: 'PC attempting partial approval',
    },
  });
  assert.equal(partRes.status, 422);
  assert.match(partRes.body.error?.message || partRes.body.message, /validity review only/i);
});

test('6. Unauthorized actions: Requester cannot approve their own request', async () => {
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 10000,
    quantity: 1,
    title: 'Self-approval test',
  });

  const selfApp = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.headCs,
    body: { action: 'APPROVE', comments: 'Requester approving self' },
  });
  assert.equal(selfApp.status, 403);
  assert.equal(selfApp.body.error?.code, 'SP004');
});

test('7. Unauthorized actions: Final Authority cannot escalate', async () => {
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 600000,
    quantity: 1,
    title: 'Final authority escalate test',
  });

  // PC -> Principal -> Final Authority
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE' },
  }), 201);
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'ESCALATE' },
  }), 201);

  // Chairman attempts ESCALATE
  const escRes = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.chairman,
    body: { action: 'ESCALATE', comments: 'Trying to escalate from top' },
  });
  assert.equal(escRes.status, 422);
  assert.match(escRes.body.error?.message || escRes.body.message, /final authority and cannot escalate|final stage; it cannot be escalated/i);
});

test('8. Unauthorized actions: CDC and Final Authority cannot return for correction', async () => {
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 100000,
    quantity: 1,
    title: 'CDC return test',
  });

  // PC -> Principal -> CDC
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE' },
  }), 201);
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'ESCALATE' },
  }), 201);

  // CDC attempts RETURN
  const retRes = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.cdcGrant,
    body: { action: 'RETURN', comments: 'CDC trying to return for correction' },
  });
  assert.equal(retRes.status, 422);
  assert.match(retRes.body.error?.message || retRes.body.message, /Only the Purchase Committee and the Principal can return/i);
});

test('9. Unauthorized actions: Return and Rejection require reasons', async () => {
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 10000,
    quantity: 1,
    title: 'Reason validation test',
  });

  // PC attempts RETURN without comments or reason
  const emptyRet = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'RETURN' },
  });
  assert.equal(emptyRet.status, 422);

  // PC attempts REJECT without reason
  const emptyRej = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'REJECT' },
  });
  assert.equal(emptyRej.status, 422);
  assert.ok(emptyRej.body.error);
});

// ---------------------------------------------------------------------------
// 3. MULTI-MEMBER CDC INDEPENDENT DECISION ATTRIBUTION & CROSS-FUNDING POLICY
// ---------------------------------------------------------------------------

test('10. Multi-member CDC: Independent decisions attributed to individual actor and historical role', async () => {
  // Create a 1,20,000 Grant request
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 120000,
    quantity: 1,
    title: 'Multi-member CDC grant attribution test',
  });

  // PC -> Principal -> CDC
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE' },
  }), 201);
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'ESCALATE' },
  }), 201);

  // CDC Member 2 (Prof. CDC Teach 2, CDC_MEMBER role) decides
  const cdc2Action = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.cdcTeach2,
    body: { action: 'APPROVE', comments: 'Approved independently by CDC Member Teach 2' },
  }), 201);

  assert.equal(cdc2Action.request.status, 'APPROVED');

  // Verify historical attribution in approval_actions
  const { rows: actionRows } = await t.superuser.query(
    `SELECT aa.action, aa.action_id, u.email AS actor_email, r.code AS role_code
       FROM approval_actions aa
       JOIN users u ON u.user_id = aa.performed_by
       JOIN roles r ON r.role_id = aa.role_id
      WHERE aa.action_id = $1`,
    [cdc2Action.actionId],
  );

  assert.equal(actionRows.length, 1);
  assert.equal(actionRows[0].actor_email, 'cdc.teach2@spcollege.edu');
  assert.equal(actionRows[0].role_code, 'CDC_MEMBER');
  assert.equal(actionRows[0].action, 'APPROVE');
});

test('11. CDC Funding-type Policy: Non-Grant member cannot decide Grant request & vice-versa', async () => {
  // A. Grant Request (CS Department)
  const grantReq = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 100000,
    quantity: 1,
    title: 'Grant funding check',
  });

  expectStatus(await t.api('POST', `/api/requests/${grantReq.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE' },
  }), 201);
  expectStatus(await t.api('POST', `/api/requests/${grantReq.id}/actions`, {
    token: tok.principal,
    body: { action: 'ESCALATE' },
  }), 201);

  // Non-Grant CDC member tries to act on Grant request -> Forbidden or Not Found (RLS)
  const nonGrantOnGrant = await t.api('POST', `/api/requests/${grantReq.id}/actions`, {
    token: tok.cdcNonGrant,
    body: { action: 'APPROVE', comments: 'Unauthorized cross-funding action' },
  });
  assert.ok([403, 404].includes(nonGrantOnGrant.status));

  // Direct SQL assertion: fn_record_action strictly refuses Non-Grant CDC member on Grant request (SP004)
  const cdcNonGrantUserId = (await t.superuser.query("SELECT user_id FROM users WHERE email = 'cdc.nongrant@spcollege.edu'")).rows[0].user_id;
  await assert.rejects(
    t.superuser.query(
      'SELECT fn_record_action($1, $2, $3, NULL, $4, NULL, NULL)',
      [grantReq.id, cdcNonGrantUserId, 'APPROVE', 'Direct SQL test'],
    ),
    (err) => {
      assert.equal(err.code, 'SP004');
      assert.match(err.message, /Only CDC Grant Member can decide requests for Grant departments/i);
      return true;
    },
  );

  // B. Non-Grant Request (Commerce Department)
  const nonGrantReq = await createAndSubmitRequest({
    token: tok.headCommerce,
    deptId: ids.deptCommerce,
    headId: ids.headOffice,
    itemId: ids.itemPaper,
    unitCost: 1000,
    quantity: 100, // 1,00,000
    title: 'Non-grant funding check',
  });

  expectStatus(await t.api('POST', `/api/requests/${nonGrantReq.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE' },
  }), 201);
  expectStatus(await t.api('POST', `/api/requests/${nonGrantReq.id}/actions`, {
    token: tok.principal,
    body: { action: 'ESCALATE' },
  }), 201);

  // Grant CDC member tries to act on Non-Grant request -> Forbidden or Not Found (RLS)
  const grantOnNonGrant = await t.api('POST', `/api/requests/${nonGrantReq.id}/actions`, {
    token: tok.cdcGrant,
    body: { action: 'APPROVE', comments: 'Unauthorized grant member on non-grant request' },
  });
  assert.ok([403, 404].includes(grantOnNonGrant.status));

  // Direct SQL assertion: fn_record_action strictly refuses Grant CDC member on Non-Grant request (SP004)
  const cdcGrantUserId = (await t.superuser.query("SELECT user_id FROM users WHERE email = 'cdc.grant@spcollege.edu'")).rows[0].user_id;
  await assert.rejects(
    t.superuser.query(
      'SELECT fn_record_action($1, $2, $3, NULL, $4, NULL, NULL)',
      [nonGrantReq.id, cdcGrantUserId, 'APPROVE', 'Direct SQL test'],
    ),
    (err) => {
      assert.equal(err.code, 'SP004');
      assert.match(err.message, /Only CDC Non-Grant Member can decide requests for Non-Grant departments/i);
      return true;
    },
  );

  // Non-Grant CDC member successfully decides Non-Grant request
  const validNonGrantApp = expectStatus(await t.api('POST', `/api/requests/${nonGrantReq.id}/actions`, {
    token: tok.cdcNonGrant,
    body: { action: 'APPROVE', comments: 'Sanctioned by Non-Grant CDC member' },
  }), 201);
  assert.equal(validNonGrantApp.request.status, 'APPROVED');
});

// ---------------------------------------------------------------------------
// 4. REJECTION BEHAVIOR REGRESSION TESTS
// ---------------------------------------------------------------------------

test('12. Rejection behavior: requires reason, marks request closed, freezes further actions', async () => {
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 25000,
    quantity: 1,
    title: 'Rejection test',
  });

  // Principal rejects with reason at Principal stage
  expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE' },
  }), 201);

  const rejRes = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'REJECT', rejectionReason: 'Equipment deemed unnecessary for this semester' },
  }), 201);

  assert.equal(rejRes.request.status, 'REJECTED');

  // Further actions are refused because request is closed
  const postRejAction = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.principal,
    body: { action: 'APPROVE', comments: 'Trying to approve closed request' },
  });
  assert.equal(postRejAction.status, 409);
  assert.match(postRejAction.body.error?.message || postRejAction.body.message, /already been decided|already closed|closed/i);

  // Resubmission is refused on rejected request
  const resubmitRes = await t.api('POST', `/api/requests/${req.id}/resubmit`, {
    token: tok.headCs,
    body: { comments: 'Trying to resubmit a rejected request' },
  });
  assert.equal(resubmitRes.status, 409);
});

// ---------------------------------------------------------------------------
// 5. RESUBMISSION CYCLE REGRESSION TESTS
// ---------------------------------------------------------------------------

test('13. Resubmission cycle: Returned request enters AWAITING_RESUBMISSION, locks approvers, permits resubmission', async () => {
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 40000,
    quantity: 1,
    title: 'Resubmission cycle test',
  });

  // Purchase Committee returns request for correction
  const retAction = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'RETURN', comments: 'Please attach detailed technical specifications' },
  }), 201);

  assert.equal(retAction.request.status, 'AWAITING_RESUBMISSION');

  // Approvers cannot advance request while awaiting resubmission
  const approverAdvance = await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE', comments: 'Trying to advance before resubmission' },
  });
  assert.equal(approverAdvance.status, 409);
  assert.match(approverAdvance.body.error?.message || approverAdvance.body.message, /waiting for the requester to correct and resubmit|awaiting resubmission/i);

  // Stranger/other user cannot resubmit
  const strangerResubmit = await t.api('POST', `/api/requests/${req.id}/resubmit`, {
    token: tok.incharge,
    body: { comments: 'Stranger trying to resubmit' },
  });
  assert.equal(strangerResubmit.status, 403);

  // Original requester resubmits
  const resubmitted = expectStatus(await t.api('POST', `/api/requests/${req.id}/resubmit`, {
    token: tok.headCs,
    body: { comments: 'Attached updated technical specifications' },
  }), 200);

  assert.equal(resubmitted.status, 'UNDER_PURCHASE_COMMITTEE_REVIEW');
  assert.equal(resubmitted.versionNumber, 2);

  // PC can now escalate to Principal
  const pcNext = expectStatus(await t.api('POST', `/api/requests/${req.id}/actions`, {
    token: tok.pc1,
    body: { action: 'ESCALATE', comments: 'Specifications verified' },
  }), 201);
  assert.equal(pcNext.request.status, 'UNDER_PRINCIPAL_REVIEW');
});

// ---------------------------------------------------------------------------
// 6. INVALID WORKFLOW TRANSITIONS VIA DIRECT SQL / TRIGGER ENFORCEMENT
// ---------------------------------------------------------------------------

test('14. Invalid transitions trigger enforcement: Skipping stages directly in DB is blocked', async () => {
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 150000,
    quantity: 1,
    title: 'Trigger enforcement test',
  });

  const cdcStageRes = await t.superuser.query("SELECT stage_id FROM workflow_stages WHERE code = 'CDC'");
  const cdcStageId = cdcStageRes.rows[0].stage_id;

  const faStageRes = await t.superuser.query("SELECT stage_id FROM workflow_stages WHERE code = 'FINAL_AUTHORITY'");
  const faStageId = faStageRes.rows[0].stage_id;

  // 1. Attempting to jump directly from PURCHASE_COMMITTEE to CDC skipping Principal
  await assert.rejects(
    t.superuser.query(
      'UPDATE requests SET current_stage_id = $1, current_status = $2 WHERE request_id = $3',
      [cdcStageId, 'UNDER_CDC_REVIEW', req.id],
    ),
    (err) => {
      assert.equal(err.code, 'SP016');
      assert.match(err.message, /without a prior Principal stage approval action|cannot skip the Principal stage/i);
      return true;
    },
  );

  // 2. Attempting to jump directly from PURCHASE_COMMITTEE to FINAL_AUTHORITY skipping Principal
  await assert.rejects(
    t.superuser.query(
      'UPDATE requests SET current_stage_id = $1, current_status = $2 WHERE request_id = $3',
      [faStageId, 'UNDER_FINAL_AUTHORITY_REVIEW', req.id],
    ),
    (err) => {
      assert.equal(err.code, 'SP016');
      assert.match(err.message, /without a prior Principal stage approval action|cannot skip the Principal stage/i);
      return true;
    },
  );
});

test('Zero rupees request is rejected: unit cost 0 and 0 rupees requests are not acceptable', async () => {
  // 1. Creating a request item with unit cost 0 is rejected with 422
  const zeroUnitCostRes = await t.api('POST', '/api/requests', {
    token: tok.headCs,
    body: {
      title: 'Free Items Zero Cost',
      budgetHeadId: ids.headIt,
      departmentId: ids.deptCs,
      items: [{ budgetItemId: ids.itemMic, quantity: 1, unitCost: 0 }],
    },
  });
  const zeroErr = expectStatus(zeroUnitCostRes, 422);
  assert.equal(zeroErr.error.code, 'VALIDATION');
  assert.match(JSON.stringify(zeroErr.error), /greater than zero/i);

  // 2. Creating a request item with negative unit cost is rejected with 422
  const negUnitCostRes = await t.api('POST', '/api/requests', {
    token: tok.headCs,
    body: {
      title: 'Negative Cost Item',
      budgetHeadId: ids.headIt,
      departmentId: ids.deptCs,
      items: [{ budgetItemId: ids.itemMic, quantity: 1, unitCost: -100 }],
    },
  });
  expectStatus(negUnitCostRes, 422);

  // 3. Creating a draft with valid item
  const validDraft = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.headCs,
    body: {
      title: 'Draft For Item Tests',
      budgetHeadId: ids.headIt,
      departmentId: ids.deptCs,
      items: [{ budgetItemId: ids.itemMic, quantity: 1, unitCost: 1000 }],
    },
  }), 201);

  // 4. Adding an item with unit cost 0 via POST /api/requests/:id/items is rejected with 422
  const addZeroRes = await t.api('POST', `/api/requests/${validDraft.id}/items`, {
    token: tok.headCs,
    body: { budgetItemId: ids.itemSpk, quantity: 2, unitCost: 0 },
  });
  expectStatus(addZeroRes, 422);

  // 5. Updating an item with unit cost 0 via PATCH is rejected with 422
  const patchZeroRes = await t.api('PATCH', `/api/requests/${validDraft.id}/items/${validDraft.items[0].id}`, {
    token: tok.headCs,
    body: { unitCost: 0 },
  });
  expectStatus(patchZeroRes, 422);

  // Cleanup
  expectStatus(await t.api('DELETE', `/api/requests/${validDraft.id}`, { token: tok.headCs }), 204);
});

test('Principal resolution correctly resolves active principal user without sql enum errors', async () => {
  // Verify database resolution matches Dr. V. Rane with principal@spcollege.edu
  const { rows } = await t.superuser.query(
    `SELECT u.full_name, u.email FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN roles r ON r.role_id = ur.role_id
       LEFT JOIN stage_approvers sa ON sa.user_id = u.user_id
       LEFT JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
      WHERE (r.code = 'PRINCIPAL' OR ws.code::text = 'PRINCIPAL') AND u.is_active
      ORDER BY sa.stage_id NULLS LAST
      LIMIT 1`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'principal@spcollege.edu');
  assert.match(rows[0].full_name, /Principal/i);

  // Create and submit a request to exercise notifyRequestAsync with the principal resolution
  const req = await createAndSubmitRequest({
    token: tok.headCs,
    deptId: ids.deptCs,
    headId: ids.headIt,
    itemId: ids.itemMic,
    unitCost: 15000,
    quantity: 1,
    title: 'Principal Mail Probe Request',
  });
  assert.equal(req.status, 'UNDER_PURCHASE_COMMITTEE_REVIEW');

  // PC refers to Principal -> triggers Principal Review Required notification
  const forwarded = expectStatus(
    await t.api('POST', `/api/requests/${req.id}/actions`, {
      token: tok.pc1,
      body: { action: 'ESCALATE', comments: 'Forwarding to Principal for review' },
    }),
    201,
  );
  assert.equal(forwarded.request.status, 'UNDER_PRINCIPAL_REVIEW');
});

