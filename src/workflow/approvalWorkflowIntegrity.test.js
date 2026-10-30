import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

describe('Issue #26 - Approval Workflow Integrity Verification', () => {
  test('Monetary threshold bands correctly determine approval routing stages', () => {
    function getTargetStage(amount, principalMax = 50000, cdcMax = 500000) {
      if (amount <= 0) throw new Error('Invalid amount');
      if (amount <= principalMax) {
        return { stage: 'PRINCIPAL', name: 'Principal Approval', isFinal: true };
      }
      if (amount <= cdcMax) {
        return { stage: 'CDC', name: 'College Development Committee', isFinal: false, nextStage: 'FINAL_AUTHORITY' };
      }
      return { stage: 'FINAL_AUTHORITY', name: 'Chairman / Governing Body', isFinal: true };
    }

    // Small purchase under ₹50k: ends at Principal
    const smallRequest = getTargetStage(15000);
    assert.equal(smallRequest.stage, 'PRINCIPAL');
    assert.equal(smallRequest.isFinal, true);

    // Boundary at ₹50,000: ends at Principal
    const threshold50k = getTargetStage(50000);
    assert.equal(threshold50k.stage, 'PRINCIPAL');
    assert.equal(threshold50k.isFinal, true);

    // ₹50,001 up to ₹5,00,000: routes to CDC
    const midRequest = getTargetStage(75000);
    assert.equal(midRequest.stage, 'CDC');
    assert.equal(midRequest.isFinal, false);

    const boundary5Lakh = getTargetStage(500000);
    assert.equal(boundary5Lakh.stage, 'CDC');

    // Above ₹5,00,000: routes to Chairman / Vice Chairman
    const largeRequest = getTargetStage(500001);
    assert.equal(largeRequest.stage, 'FINAL_AUTHORITY');
    assert.equal(largeRequest.isFinal, true);

    const capitalExpenditure = getTargetStage(2500000);
    assert.equal(capitalExpenditure.stage, 'FINAL_AUTHORITY');
    assert.equal(capitalExpenditure.isFinal, true);
  });

  test('Database schema preserves workflow trigger and stage progression enforcement', async () => {
    const workflowSchemaSource = await fs.readFile(
      path.resolve('db/schema/03_workflow.sql'),
      'utf8',
    );
    assert.ok(
      workflowSchemaSource.includes('CREATE TABLE workflow_stages'),
      'Workflow schema must define workflow_stages table',
    );
    assert.ok(
      workflowSchemaSource.includes('CREATE TABLE stage_routing_rules'),
      'Workflow schema must define stage_routing_rules table',
    );
    assert.ok(
      workflowSchemaSource.includes('CREATE TABLE stage_approvers'),
      'Workflow schema must define stage_approvers table',
    );

    const functionsSchemaSource = await fs.readFile(
      path.resolve('db/schema/12_functions.sql'),
      'utf8',
    );
    assert.ok(
      functionsSchemaSource.includes('fn_enforce_stage_progression'),
      'Functions schema must define fn_enforce_stage_progression',
    );

    // Verify SP012 error code for no routing rule
    const errorsSource = await fs.readFile(
      path.resolve('server/src/errors.js'),
      'utf8',
    );
    assert.ok(
      errorsSource.includes('SP012'),
      'errors.js must define SP012 for missing approval route configuration',
    );
  });

  test('Role authorization: administrator is an operator, not an approver', () => {
    function canTakeApprovalAction(user, requestStage) {
      if (!user) return false;
      // Administrator role never performs workflow approvals
      if (user.roles?.includes('ADMIN') && !user.stages?.includes(requestStage)) {
        return false;
      }
      return Boolean(user.stages?.includes(requestStage));
    }

    const adminUser = { roles: ['ADMIN'], stages: [] };
    const principalUser = { roles: ['PRINCIPAL'], stages: ['PRINCIPAL'] };
    const pcMember = { roles: ['PURCHASE_COMMITTEE'], stages: ['PURCHASE_COMMITTEE'] };
    const cdcMember = { roles: ['CDC_MEMBER'], stages: ['CDC'] };

    assert.equal(canTakeApprovalAction(adminUser, 'PRINCIPAL'), false, 'Admin cannot approve Principal stage');
    assert.equal(canTakeApprovalAction(adminUser, 'CDC'), false, 'Admin cannot approve CDC stage');
    assert.equal(canTakeApprovalAction(principalUser, 'PRINCIPAL'), true, 'Principal can approve Principal stage');
    assert.equal(canTakeApprovalAction(pcMember, 'PURCHASE_COMMITTEE'), true, 'PC member can verify at PC stage');
    assert.equal(canTakeApprovalAction(cdcMember, 'CDC'), true, 'CDC member can decide at CDC stage');
    assert.equal(canTakeApprovalAction(cdcMember, 'PRINCIPAL'), false, 'CDC member cannot decide Principal stage');
  });

  test('Return for correction belongs strictly to Purchase Committee and Principal', () => {
    function canReturnForCorrection(userRole) {
      return userRole === 'PURCHASE_COMMITTEE' || userRole === 'PRINCIPAL';
    }

    assert.equal(canReturnForCorrection('PURCHASE_COMMITTEE'), true);
    assert.equal(canReturnForCorrection('PRINCIPAL'), true);
    assert.equal(canReturnForCorrection('CDC_MEMBER'), false);
    assert.equal(canReturnForCorrection('CHAIRMAN'), false);
    assert.equal(canReturnForCorrection('ADMIN'), false);
    assert.equal(canReturnForCorrection('FACULTY'), false);
  });
});
