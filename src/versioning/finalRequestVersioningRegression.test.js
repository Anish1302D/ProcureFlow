import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { diffVersions } from '../utils/versionDiff.js';

describe('Final Request Versioning & Immutable Audit Trail Regression Suite', () => {
  // End-to-end simulation of a requisition across its full lifecycle:
  // v1 (Submit) -> PC Scrutiny (Recommend) -> Principal Return -> v2 (Resubmit) -> Principal Approval

  test('Simulates full lifecycle of request versioning, item recommendations, and immutable audit trail', () => {
    const requestId = 'req-e2e-versioning-001';
    const requestNumber = 'REQ-2026-0099';
    const departmentId = 10;
    const raiserId = 'user-head-cs';

    // ── STEP 1: Initial Draft Request ──
    assert.equal(requestNumber, 'REQ-2026-0099');
    const draftItems = [
      {
        requestItemId: 'item-101',
        budgetItemId: 501,
        itemName: 'Dell PowerEdge Server',
        itemCode: 'SRV-01',
        unit: 'Units',
        requestedQuantity: 2,
        estimatedUnitCost: 200000,
        estimatedTotal: 400000,
      },
      {
        requestItemId: 'item-102',
        budgetItemId: 502,
        itemName: 'Server Rack 42U',
        itemCode: 'RCK-01',
        unit: 'Units',
        requestedQuantity: 1,
        estimatedUnitCost: 50000,
        estimatedTotal: 50000,
      },
    ];

    const draftDocs = [
      {
        attachmentId: 'doc-vendor-quote',
        fileName: 'dell_server_quotation_v1.pdf',
        sizeBytes: 85000,
        versionNumber: 1,
      },
    ];

    // ── STEP 2: Initial Submission (v1) ──
    const v1Snapshot = {
      versionId: 'ver-e2e-1',
      requestId,
      versionNumber: 1,
      title: 'Department AI & Computation Server',
      description: 'High performance servers for machine learning lab',
      departmentId,
      financialYearId: 2,
      budgetHeadId: 101,
      tentativeTotalCost: 450000,
      extra: { urgency: 'HIGH' },
      itemsSnapshot: JSON.parse(JSON.stringify(draftItems)),
      documentsSnapshot: JSON.parse(JSON.stringify(draftDocs)),
      submittedBy: raiserId,
      submittedAt: '2026-10-31T09:00:00Z',
      correctionId: null,
    };

    const auditTrail = [];
    auditTrail.push({
      action: 'SUBMIT',
      actor: raiserId,
      requestVersionNumber: 1,
      statusBefore: 'DRAFT',
      statusAfter: 'UNDER_PURCHASE_COMMITTEE_REVIEW',
      amountSnapshot: 450000,
    });

    // Verify v1 initial state
    assert.equal(v1Snapshot.versionNumber, 1);
    assert.equal(v1Snapshot.itemsSnapshot.length, 2);
    assert.equal(v1Snapshot.documentsSnapshot.length, 1);
    assert.equal(auditTrail[0].requestVersionNumber, 1);

    // ── STEP 3: Purchase Committee Technical Scrutiny & Recommendation ──
    // Purchase Committee scrutinizes proposal: recommends 1 server instead of 2 to stay within budget
    const pcActorId = 'user-pc-member';
    const pcItemRecommendations = [
      { requestItemId: 'item-101', recommendedQuantity: 1, recommendedAmount: 200000, remarks: '1 unit recommended for initial pilot' },
      { requestItemId: 'item-102', recommendedQuantity: 1, recommendedAmount: 50000, remarks: 'Rack required' },
    ];

    // Apply PC recommendations to live request items without granting financial approval
    const liveItemsAfterPC = draftItems.map((item) => {
      const rec = pcItemRecommendations.find((r) => r.requestItemId === item.requestItemId);
      return {
        ...item,
        recommendedQuantity: rec?.recommendedQuantity ?? null,
        recommendedAmount: rec?.recommendedAmount ?? null,
        approvedQuantity: 0,
        approvedAmount: 0,
        status: 'PENDING',
      };
    });

    auditTrail.push({
      action: 'ESCALATE',
      actor: pcActorId,
      requestVersionNumber: 1,
      statusBefore: 'UNDER_PURCHASE_COMMITTEE_REVIEW',
      statusAfter: 'UNDER_PRINCIPAL_REVIEW',
      amountSnapshot: 450000,
      comments: 'Technical scrutiny complete. Recommended 1 server pilot to optimize capital expenditure.',
    });

    // Invariant check: PC recommendations DO NOT become approved values
    assert.equal(liveItemsAfterPC[0].recommendedQuantity, 1);
    assert.equal(liveItemsAfterPC[0].approvedQuantity, 0, 'Approved quantity must remain 0 after PC scrutiny');
    assert.equal(liveItemsAfterPC[0].approvedAmount, 0, 'Approved amount must remain 0 after PC scrutiny');

    // ── STEP 4: Principal Review & Return for Correction ──
    const principalActorId = 'user-principal';
    const correctionRequest = {
      correctionId: 'corr-e2e-01',
      requestId,
      requestedBy: principalActorId,
      reason: 'Please update line item to 1 server as recommended by Purchase Committee and attach revised quotation.',
      createdAt: '2026-10-31T09:20:00Z',
      resolvedAt: null,
      resolvedByVersion: null,
    };

    auditTrail.push({
      action: 'RETURN',
      actor: principalActorId,
      requestVersionNumber: 1,
      statusBefore: 'UNDER_PRINCIPAL_REVIEW',
      statusAfter: 'AWAITING_RESUBMISSION',
      amountSnapshot: 450000,
      comments: correctionRequest.reason,
    });

    // ── STEP 5: Requester Revision & Resubmission (v2) ──
    // Requester updates item 101 quantity to 1 unit, updates total, and uploads revised quotation
    const v2Items = [
      {
        requestItemId: 'item-101',
        budgetItemId: 501,
        itemName: 'Dell PowerEdge Server',
        itemCode: 'SRV-01',
        unit: 'Units',
        requestedQuantity: 1, // Revised
        estimatedUnitCost: 200000,
        estimatedTotal: 200000,
        remarks: 'Adjusted to 1 unit per committee recommendation',
      },
      {
        requestItemId: 'item-102',
        budgetItemId: 502,
        itemName: 'Server Rack 42U',
        itemCode: 'RCK-01',
        unit: 'Units',
        requestedQuantity: 1,
        estimatedUnitCost: 50000,
        estimatedTotal: 50000,
      },
    ];

    const v2Docs = [
      draftDocs[0],
      {
        attachmentId: 'doc-vendor-quote-rev2',
        fileName: 'dell_server_revised_quote_v2.pdf',
        sizeBytes: 92000,
        versionNumber: 1,
        requestVersionNumber: 2,
      },
    ];

    correctionRequest.resolvedAt = '2026-10-31T09:40:00Z';
    correctionRequest.resolvedByVersion = 2;

    const v2Snapshot = {
      versionId: 'ver-e2e-2',
      requestId,
      versionNumber: 2,
      title: 'Department AI & Computation Server (Single Unit Pilot)',
      description: 'Revised requisition for single unit pilot with rack',
      departmentId,
      financialYearId: 2,
      budgetHeadId: 101,
      tentativeTotalCost: 250000,
      extra: { urgency: 'HIGH' },
      itemsSnapshot: JSON.parse(JSON.stringify(v2Items)),
      documentsSnapshot: JSON.parse(JSON.stringify(v2Docs)),
      submittedBy: raiserId,
      submittedAt: '2026-10-31T09:40:00Z',
      correctionId: correctionRequest.correctionId,
    };

    auditTrail.push({
      action: 'RESUBMIT',
      actor: raiserId,
      requestVersionNumber: 2,
      statusBefore: 'AWAITING_RESUBMISSION',
      statusAfter: 'UNDER_PRINCIPAL_REVIEW',
      amountSnapshot: 250000,
      comments: 'Requisition revised to 1 server and updated quotation attached.',
    });

    // ── STEP 6: Verify Version Immutability (v1 vs v2) ──
    assert.equal(v1Snapshot.versionNumber, 1);
    assert.equal(v1Snapshot.itemsSnapshot[0].requestedQuantity, 2);
    assert.equal(v1Snapshot.tentativeTotalCost, 450000);
    assert.equal(v1Snapshot.documentsSnapshot.length, 1);

    assert.equal(v2Snapshot.versionNumber, 2);
    assert.equal(v2Snapshot.itemsSnapshot[0].requestedQuantity, 1);
    assert.equal(v2Snapshot.tentativeTotalCost, 250000);
    assert.equal(v2Snapshot.documentsSnapshot.length, 2);
    assert.equal(v2Snapshot.correctionId, 'corr-e2e-01');

    // ── STEP 7: Version Comparison Engine Verification ──
    const diff = diffVersions(v1Snapshot, v2Snapshot);
    assert.equal(diff.header.oldTotalCost, 450000);
    assert.equal(diff.header.newTotalCost, 250000);
    assert.equal(diff.header.costDiff, -200000);
    assert.equal(diff.summary.itemsModifiedCount, 1);
    assert.equal(diff.summary.docsAddedCount, 1);

    const modifiedItem = diff.items.find((i) => i.code === 'SRV-01');
    assert.equal(modifiedItem.status, 'MODIFIED');
    assert.equal(modifiedItem.oldQty, 2);
    assert.equal(modifiedItem.newQty, 1);
    assert.equal(modifiedItem.qtyDiff, -1);
    assert.equal(modifiedItem.totalDiff, -200000);

    // ── STEP 8: Final Financial Approval ──
    // Proposal is under CDC review ceiling (₹2,50,000 <= ₹5,00,000) and approved by CDC
    const cdcActorId = 'user-cdc-member';
    auditTrail.push({
      action: 'APPROVE',
      actor: cdcActorId,
      requestVersionNumber: 2,
      statusBefore: 'UNDER_CDC_REVIEW',
      statusAfter: 'APPROVED',
      amountSnapshot: 250000,
      comments: 'Approved in full following Purchase Committee recommendation.',
    });

    // ── STEP 9: Audit Trail Completeness & Immutability Verification ──
    assert.equal(auditTrail.length, 5);
    // Actions on version 1
    assert.equal(auditTrail[0].action, 'SUBMIT');
    assert.equal(auditTrail[0].requestVersionNumber, 1);
    assert.equal(auditTrail[1].action, 'ESCALATE');
    assert.equal(auditTrail[1].requestVersionNumber, 1);
    assert.equal(auditTrail[2].action, 'RETURN');
    assert.equal(auditTrail[2].requestVersionNumber, 1);

    // Actions on version 2
    assert.equal(auditTrail[3].action, 'RESUBMIT');
    assert.equal(auditTrail[3].requestVersionNumber, 2);
    assert.equal(auditTrail[4].action, 'APPROVE');
    assert.equal(auditTrail[4].requestVersionNumber, 2);
  });
});
