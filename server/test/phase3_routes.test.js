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
    cdc: 'cdc.grant@spcollege.edu',
    chairman: 'chairman@spcollege.edu',
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

  const fys = expectStatus(await t.api('GET', '/api/financial-years', { token: tok.head }), 200);
  ids.fy = fys[0].id;
});

after(() => t?.close());

test('1. Purchase Committee actions & restrictions', async (s) => {
  let smallReqId;
  let returnReqId;

  await s.test('create draft request for testing PC actions', async () => {
    const draft = expectStatus(await t.api('POST', '/api/requests', {
      token: tok.head,
      body: {
        title: 'PC action test request (small)',
        budgetHeadId: ids.it,
        departmentId: ids.csDept,
        items: [{ budgetItemId: ids['MIC-01'], quantity: 1, unitCost: 30000 }],
      },
    }), 201);
    smallReqId = draft.id;
    await t.api('POST', `/api/requests/${smallReqId}/submit`, { token: tok.head });
  });

  await s.test('Purchase Committee CANNOT approve request directly (must fail)', async () => {
    const res = await t.api('POST', `/api/requests/${smallReqId}/actions`, {
      token: tok.pc1,
      body: { action: 'APPROVE', comments: 'PC direct approval attempt' },
    });
    assert.equal(res.status === 422 || res.status === 400 || res.status === 403, true);
  });

  await s.test('Purchase Committee forwards request to Principal', async () => {
    const res = expectStatus(await t.api('POST', `/api/requests/${smallReqId}/actions`, {
      token: tok.pc1,
      body: { action: 'FORWARD', comments: 'PC reviewed and found complete' },
    }), 201);
    assert.equal(res.request.status, 'UNDER_PRINCIPAL_REVIEW');
  });

  await s.test('Purchase Committee sends back request for resubmission (RETURN)', async () => {
    const draft2 = expectStatus(await t.api('POST', '/api/requests', {
      token: tok.head,
      body: {
        title: 'PC return test request',
        budgetHeadId: ids.it,
        departmentId: ids.csDept,
        items: [{ budgetItemId: ids['SPK-01'], quantity: 1, unitCost: 15000 }],
      },
    }), 201);
    returnReqId = draft2.id;
    await t.api('POST', `/api/requests/${returnReqId}/submit`, { token: tok.head });

    const retRes = expectStatus(await t.api('POST', `/api/requests/${returnReqId}/actions`, {
      token: tok.pc1,
      body: { action: 'RETURN', comments: 'Please attach detailed specs' },
    }), 201);
    assert.equal(retRes.request.status, 'AWAITING_RESUBMISSION');
    ids.returnReqId = returnReqId;
  });
});

test('2. Principal actions', async (s) => {
  let smallReqId;
  let bigReqId;

  await s.test('setup small and big requests', async () => {
    // <= 50k request
    const smallDraft = expectStatus(await t.api('POST', '/api/requests', {
      token: tok.head,
      body: {
        title: 'Small lab items',
        budgetHeadId: ids.it,
        departmentId: ids.csDept,
        items: [{ budgetItemId: ids['SPK-01'], quantity: 1, unitCost: 20000 }],
      },
    }), 201);
    smallReqId = smallDraft.id;
    await t.api('POST', `/api/requests/${smallReqId}/submit`, { token: tok.head });
    await t.api('POST', `/api/requests/${smallReqId}/actions`, { token: tok.pc1, body: { action: 'FORWARD', comments: 'OK' } });

    // > 50k request
    const bigDraft = expectStatus(await t.api('POST', '/api/requests', {
      token: tok.head,
      body: {
        title: 'Big server purchase',
        budgetHeadId: ids.it,
        departmentId: ids.csDept,
        items: [{ budgetItemId: ids['MIC-01'], quantity: 1, unitCost: 200000 }],
      },
    }), 201);
    bigReqId = bigDraft.id;
    await t.api('POST', `/api/requests/${bigReqId}/submit`, { token: tok.head });
    await t.api('POST', `/api/requests/${bigReqId}/actions`, { token: tok.pc1, body: { action: 'FORWARD', comments: 'OK' } });
  });

  await s.test('Principal approves request <= ₹50,000 directly as final authority', async () => {
    const res = expectStatus(await t.api('POST', `/api/requests/${smallReqId}/actions`, {
      token: tok.principal,
      body: { action: 'APPROVE', comments: 'Approved by Principal' },
    }), 201);
    assert.equal(res.request.status, 'APPROVED');
  });

  await s.test('Principal forwards request > ₹50,000 to CDC', async () => {
    const res = expectStatus(await t.api('POST', `/api/requests/${bigReqId}/actions`, {
      token: tok.principal,
      body: { action: 'ESCALATE', comments: 'Forwarding 200k request to CDC' },
    }), 201);
    assert.equal(res.request.status, 'UNDER_CDC_REVIEW');
  });

  await s.test('Principal can view every request', async () => {
    const reqDetail = expectStatus(await t.api('GET', `/api/requests/${bigReqId}`, { token: tok.principal }), 200);
    assert.equal(reqDetail.id, bigReqId);
  });
});

test('3. Resubmission under same request ID', async () => {
  const reqId = ids.returnReqId;
  const resubRes = expectStatus(await t.api('POST', `/api/requests/${reqId}/resubmit`, {
    token: tok.head,
    body: { comments: 'Attached specs as requested' },
  }), 200);

  assert.equal(resubRes.id, reqId);
  assert.equal(resubRes.status, 'UNDER_PURCHASE_COMMITTEE_REVIEW');

  // Verify timeline history contains RESUBMIT entry
  const timeline = expectStatus(await t.api('GET', `/api/requests/${reqId}/timeline`, { token: tok.head }), 200);
  assert.equal(timeline.some((t) => t.action === 'RESUBMIT'), true);
});

test('4. Versioned documents', async (s) => {
  let draftId;
  let attId;

  await s.test('upload initial document', async () => {
    const draft = expectStatus(await t.api('POST', '/api/requests', {
      token: tok.head,
      body: { title: 'Doc versioning test', budgetHeadId: ids.it },
    }), 201);
    draftId = draft.id;

    const file = pdf('spec_v1.pdf', 100);
    const uploaded = expectStatus(await t.api('POST', `/api/requests/${draftId}/attachments`, {
      token: tok.head, form: file.form,
    }), 201);
    attId = uploaded.id;
    assert.equal(uploaded.versionNumber, 1);
  });

  await s.test('supersede document with new version', async () => {
    const fileV2 = pdf('spec_v2.pdf', 200);
    const v2Res = expectStatus(await t.api('POST', `/api/attachments/${attId}/supersede`, {
      token: tok.head, form: fileV2.form,
    }), 201);
    assert.equal(v2Res.versionNumber, 2);
    assert.equal(v2Res.supersededById, null);
  });

  await s.test('list document versions for request', async () => {
    const list = expectStatus(await t.api('GET', `/api/requests/${draftId}/attachments`, { token: tok.head }), 200);
    assert.equal(list.length >= 2, true);
    assert.equal(list[0].supersededById !== null, true);
  });

  await s.test('download specific attachment version', async () => {
    const dl = await t.api('GET', `/api/attachments/${attId}`, { token: tok.head });
    assert.equal(dl.status, 200);
  });

  // fn_supersede_attachment runs as its owner, so RLS does not stand between
  // a caller and someone else's documents — it has to refuse them itself.
  await s.test('a stranger cannot replace a document on a request they cannot see', async () => {
    const outsider = await t.login('head.chem@spcollege.edu');
    const res = await t.api('POST', `/api/attachments/${attId}/supersede`, {
      token: outsider, form: pdf('forged.pdf', 120).form,
    });
    assert.equal(res.status, 403, `expected a refusal, got ${res.status}`);

    const list = expectStatus(await t.api('GET', `/api/requests/${draftId}/attachments`, { token: tok.head }), 200);
    assert.equal(list.some((a) => a.fileName === 'forged.pdf'), false, 'nothing was written');
  });
});

test('5. Budget provision endpoints', async (s) => {
  await s.test('HOD creates departmental budget provision', async () => {
    const created = expectStatus(await t.api('POST', '/api/budget-provisions', {
      token: tok.head,
      body: {
        departmentId: ids.csDept,
        financialYearId: ids.fy,
        budgetHeadId: ids.it,
        allocatedAmount: 1000000,
        remarks: 'Annual IT allocation',
      },
    }), 201);
    assert.equal(created.allocatedAmount, 1000000);
  });

  await s.test('list budget provisions with computed figures', async () => {
    const list = expectStatus(await t.api('GET', `/api/budget-provisions?departmentId=${ids.csDept}`, { token: tok.head }), 200);
    assert.equal(list.length > 0, true);
    assert.equal(typeof list[0].remainingAmount, 'number');
  });

  await s.test('fetch budget context for a request', async () => {
    const draft = expectStatus(await t.api('POST', '/api/requests', {
      token: tok.head,
      body: {
        title: 'Budget context probe',
        budgetHeadId: ids.it,
        departmentId: ids.csDept,
        items: [{ budgetItemId: ids['SPK-01'], quantity: 1, unitCost: 10000 }],
      },
    }), 201);
    const ctx = expectStatus(await t.api('GET', `/api/requests/${draft.id}/budget-context`, { token: tok.head }), 200);
    assert.equal(ctx.allocatedAmount, 1000000);
  });
});
