import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';

describe('Versioning Authorization, Approval Hierarchy & Audit Integrity Suite', () => {
  // ── 1. RLS Read Authorization Evaluation ──
  function canReadRequestVersions(user, request) {
    if (!user) return false;
    const reviewerRoles = [
      'ADMIN',
      'PRINCIPAL',
      'PURCHASE_COMMITTEE',
      'CDC_GRANT_MEMBER',
      'CDC_NON_GRANT_MEMBER',
      'CHAIRMAN',
      'VICE_PRESIDENT',
    ];
    if (user.roles.some((r) => reviewerRoles.includes(r))) return true;
    if (user.id === request.raised_by) return true;
    if (user.roles.includes('HEAD') && user.departmentId != null && user.departmentId === request.department_id) return true;
    return false;
  }

  // ── 2. Append-Only Trigger Simulation ──
  function simulateTableMutation(tableName, operation) {
    const immutableTables = ['request_versions', 'audit_logs', 'digital_signatures'];
    if (immutableTables.includes(tableName) && ['UPDATE', 'DELETE'].includes(operation)) {
      const err = new Error(`Table ${tableName} is strictly append-only and immutable; historical records cannot be updated or deleted`);
      err.code = 'SP019';
      throw err;
    }
    if (tableName === 'approval_actions' && operation === 'DELETE') {
      const err = new Error('Approval actions are permanent workflow audit records and cannot be deleted');
      err.code = 'SP019';
      throw err;
    }
    return true;
  }

  // ── 3. Digital Signature / Seal Generator & Verifier ──
  const SECRET = 'test-signing-secret-procureflow-2026';
  function createSeal(payload) {
    const canonical = JSON.stringify([
      'v1',
      payload.requestId,
      payload.action,
      payload.actorId,
      [...payload.decisions]
        .map((d) => [d.requestItemId, Number(d.approvedQuantity).toFixed(2), Number(d.approvedAmount).toFixed(2)])
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
      payload.comments ?? null,
      payload.rejectionReason ?? null,
    ]);
    const mac = crypto.createHmac('sha256', SECRET).update(canonical).digest('hex');
    return `hmac-sha256:v1:${mac}`;
  }

  function verifyDecisionSeal(signature, payload) {
    const expected = Buffer.from(createSeal(payload));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  // ── 4. Workflow Stage Hierarchy & Threshold Evaluator ──
  function evaluateStageAction({ stageCode, action, amount, thresholds = { principalMax: 50000, cdcMax: 500000 } }) {
    if (stageCode === 'PURCHASE_COMMITTEE') {
      if (['APPROVE', 'PARTIAL_APPROVE'].includes(action)) {
        const err = new Error('Purchase Committee performs validity review only and cannot approve requests');
        err.code = 'SP005';
        throw err;
      }
    }
    if (stageCode === 'PRINCIPAL') {
      if (['APPROVE', 'PARTIAL_APPROVE'].includes(action) && amount > thresholds.principalMax) {
        const err = new Error(`Principal cannot final-approve requests exceeding ₹${thresholds.principalMax}`);
        err.code = 'SP005';
        throw err;
      }
      if (action === 'ESCALATE' && amount <= thresholds.principalMax) {
        const err = new Error(`Requests up to ₹${thresholds.principalMax} must be decided by Principal and cannot be escalated`);
        err.code = 'SP005';
        throw err;
      }
    }
    if (stageCode === 'CDC') {
      if (['APPROVE', 'PARTIAL_APPROVE', 'REJECT'].includes(action) && amount > thresholds.cdcMax) {
        const err = new Error(`CDC cannot decide requests exceeding ₹${thresholds.cdcMax}; Chairman and Vice Chairman hold the final authority`);
        err.code = 'SP005';
        throw err;
      }
      if (action === 'ESCALATE') {
        const err = new Error('CDC holds the decision at this amount and cannot escalate');
        err.code = 'SP005';
        throw err;
      }
    }
    return { permitted: true };
  }

  // ────────────────── TESTS ──────────────────

  test('RLS policy permits Requester, Department Head, Approvers, and Admin to read versions', () => {
    const csRequest = { raised_by: 'user-raiser-cs', department_id: 10 };

    assert.equal(canReadRequestVersions({ id: 'user-raiser-cs', roles: ['HEAD'], departmentId: 10 }, csRequest), true);
    assert.equal(canReadRequestVersions({ id: 'user-head-cs', roles: ['HEAD'], departmentId: 10 }, csRequest), true);
    assert.equal(canReadRequestVersions({ id: 'user-principal', roles: ['PRINCIPAL'], departmentId: null }, csRequest), true);
    assert.equal(canReadRequestVersions({ id: 'user-pc', roles: ['PURCHASE_COMMITTEE'], departmentId: null }, csRequest), true);
    assert.equal(canReadRequestVersions({ id: 'user-admin', roles: ['ADMIN'], departmentId: null }, csRequest), true);
  });

  test('RLS policy strictly refuses users from other departments and unauthorized roles', () => {
    const csRequest = { raised_by: 'user-raiser-cs', department_id: 10 };

    assert.equal(canReadRequestVersions({ id: 'user-head-chem', roles: ['HEAD'], departmentId: 14 }, csRequest), false);
    assert.equal(canReadRequestVersions({ id: 'user-faculty-arts', roles: ['ACTIVITY_INCHARGE'], departmentId: 22 }, csRequest), false);
    assert.equal(canReadRequestVersions(null, csRequest), false);
  });

  test('Trigger guards strictly block UPDATE and DELETE on immutable request_versions', () => {
    assert.throws(
      () => simulateTableMutation('request_versions', 'UPDATE'),
      (err) => err.code === 'SP019' && err.message.includes('request_versions')
    );
    assert.throws(
      () => simulateTableMutation('request_versions', 'DELETE'),
      (err) => err.code === 'SP019' && err.message.includes('request_versions')
    );
  });

  test('Trigger guards strictly block UPDATE and DELETE on audit_logs and digital_signatures', () => {
    assert.throws(
      () => simulateTableMutation('audit_logs', 'UPDATE'),
      (err) => err.code === 'SP019' && err.message.includes('audit_logs')
    );
    assert.throws(
      () => simulateTableMutation('audit_logs', 'DELETE'),
      (err) => err.code === 'SP019' && err.message.includes('audit_logs')
    );
    assert.throws(
      () => simulateTableMutation('digital_signatures', 'DELETE'),
      (err) => err.code === 'SP019' && err.message.includes('digital_signatures')
    );
  });

  test('Trigger guards strictly block DELETE on workflow approval_actions', () => {
    assert.throws(
      () => simulateTableMutation('approval_actions', 'DELETE'),
      (err) => err.code === 'SP019' && err.message.includes('Approval actions are permanent')
    );
  });

  test('Digital signature verification succeeds on unaltered decision and fails on tampering', () => {
    const validPayload = {
      requestId: 'req-sig-01',
      action: 'PARTIAL_APPROVE',
      actorId: 'user-principal-01',
      decisions: [{ requestItemId: 'item-1', approvedQuantity: 5, approvedAmount: 50000 }],
      comments: 'Approved 5 units for semester laboratory',
      rejectionReason: null,
    };

    const signature = createSeal(validPayload);
    assert.equal(verifyDecisionSeal(signature, validPayload), true, 'Valid signature must verify');

    // Tampering test 1: altering approved amount
    const tamperedAmount = {
      ...validPayload,
      decisions: [{ requestItemId: 'item-1', approvedQuantity: 5, approvedAmount: 75000 }],
    };
    assert.equal(verifyDecisionSeal(signature, tamperedAmount), false, 'Tampered amount must be rejected');

    // Tampering test 2: altering actor
    const tamperedActor = {
      ...validPayload,
      actorId: 'user-forged-actor',
    };
    assert.equal(verifyDecisionSeal(signature, tamperedActor), false, 'Tampered actor must be rejected');
  });

  test('Enforces stage authority hierarchy and financial ceilings strictly', () => {
    // 1. Purchase Committee cannot APPROVE or PARTIAL_APPROVE
    assert.throws(
      () => evaluateStageAction({ stageCode: 'PURCHASE_COMMITTEE', action: 'APPROVE', amount: 30000 }),
      (err) => err.code === 'SP005'
    );
    assert.throws(
      () => evaluateStageAction({ stageCode: 'PURCHASE_COMMITTEE', action: 'PARTIAL_APPROVE', amount: 30000 }),
      (err) => err.code === 'SP005'
    );

    // 2. Principal: <= ₹50,000 can approve; cannot escalate
    assert.equal(evaluateStageAction({ stageCode: 'PRINCIPAL', action: 'APPROVE', amount: 45000 }).permitted, true);
    assert.throws(
      () => evaluateStageAction({ stageCode: 'PRINCIPAL', action: 'ESCALATE', amount: 45000 }),
      (err) => err.code === 'SP005'
    );

    // 3. Principal: > ₹50,000 cannot approve; must escalate
    assert.throws(
      () => evaluateStageAction({ stageCode: 'PRINCIPAL', action: 'APPROVE', amount: 75000 }),
      (err) => err.code === 'SP005'
    );
    assert.equal(evaluateStageAction({ stageCode: 'PRINCIPAL', action: 'ESCALATE', amount: 75000 }).permitted, true);

    // 4. CDC: <= ₹5,00,000 can decide; cannot escalate
    assert.equal(evaluateStageAction({ stageCode: 'CDC', action: 'APPROVE', amount: 250000 }).permitted, true);
    assert.throws(
      () => evaluateStageAction({ stageCode: 'CDC', action: 'ESCALATE', amount: 250000 }),
      (err) => err.code === 'SP005'
    );

    // 5. CDC: > ₹5,00,000 cannot decide; Chairman/Vice Chairman final authority holds it
    assert.throws(
      () => evaluateStageAction({ stageCode: 'CDC', action: 'APPROVE', amount: 750000 }),
      (err) => err.code === 'SP005'
    );
  });
});
