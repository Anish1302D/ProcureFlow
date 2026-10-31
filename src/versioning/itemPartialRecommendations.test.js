import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('Item-Level Partial Recommendations vs Final Financial Approval', () => {
  // Helper simulating the database function fn_record_action item processing logic
  function processActionItemDecisions({
    stageCode,
    action,
    requestItems,
    decisions = [],
  }) {
    // Stage rule enforcement matching schema/13_record_action.sql
    if (stageCode === 'PURCHASE_COMMITTEE' && ['APPROVE', 'PARTIAL_APPROVE'].includes(action)) {
      const err = new Error('Purchase Committee performs validity review only and cannot approve requests');
      err.code = 'SP005';
      throw err;
    }

    const updatedItems = requestItems.map((item) => ({ ...item }));
    const decisionsByItemId = new Map(
      decisions.map((d) => [d.requestItemId, d])
    );

    if (stageCode === 'PURCHASE_COMMITTEE' && action === 'ESCALATE') {
      // Purchase Committee recommendations only update recommended_* fields
      for (const item of updatedItems) {
        const dec = decisionsByItemId.get(item.id);
        if (dec) {
          item.recommendedQuantity = dec.recommendedQuantity ?? dec.approvedQuantity ?? null;
          item.recommendedAmount = dec.recommendedAmount ?? dec.approvedAmount ?? null;
          if (dec.remarks) item.remarks = dec.remarks;
        }
        // Crucial invariant: approved fields MUST NOT be modified
        assert.equal(item.approvedQuantity, 0, 'Purchase Committee cannot approve item quantities');
        assert.equal(item.approvedAmount, 0, 'Purchase Committee cannot approve item amounts');
      }
    } else if (['PRINCIPAL', 'CDC', 'FINAL_AUTHORITY'].includes(stageCode) && action === 'PARTIAL_APPROVE') {
      // Final authority approval updates approved_* fields
      for (const item of updatedItems) {
        const dec = decisionsByItemId.get(item.id);
        if (dec) {
          item.approvedQuantity = dec.approvedQuantity;
          item.approvedAmount = dec.approvedAmount ?? Math.round(dec.approvedQuantity * item.unitCost * 100) / 100;
          if (dec.remarks) item.remarks = dec.remarks;
          item.status = item.approvedQuantity === 0 ? 'REJECTED' : item.approvedQuantity >= item.requestedQuantity ? 'APPROVED' : 'PARTIALLY_APPROVED';
        }
      }
    } else if (['PRINCIPAL', 'CDC', 'FINAL_AUTHORITY'].includes(stageCode) && action === 'APPROVE') {
      for (const item of updatedItems) {
        item.approvedQuantity = item.requestedQuantity;
        item.approvedAmount = item.estimatedTotal;
        item.status = 'APPROVED';
      }
    }

    // Compute unapproved quantities and amounts
    return updatedItems.map((item) => ({
      ...item,
      unapprovedQuantity: Math.round((item.requestedQuantity - item.approvedQuantity) * 100) / 100,
      unapprovedAmount: Math.round((item.estimatedTotal - item.approvedAmount) * 100) / 100,
    }));
  }

  const initialItems = [
    {
      id: 'item-pc-1',
      itemName: 'Scientific Microscopes',
      requestedQuantity: 10,
      unitCost: 15000,
      estimatedTotal: 150000,
      recommendedQuantity: null,
      recommendedAmount: null,
      approvedQuantity: 0,
      approvedAmount: 0,
      status: 'PENDING',
    },
    {
      id: 'item-pc-2',
      itemName: 'Glass Slides Box',
      requestedQuantity: 20,
      unitCost: 500,
      estimatedTotal: 10000,
      recommendedQuantity: null,
      recommendedAmount: null,
      approvedQuantity: 0,
      approvedAmount: 0,
      status: 'PENDING',
    },
  ];

  test('Purchase Committee ESCALATE records recommendations while approved values stay zero', () => {
    const pcDecisions = [
      { requestItemId: 'item-pc-1', recommendedQuantity: 6, recommendedAmount: 90000, remarks: '6 units sufficient for sem 1' },
      { requestItemId: 'item-pc-2', recommendedQuantity: 20, recommendedAmount: 10000, remarks: 'Slides count ok' },
    ];

    const result = processActionItemDecisions({
      stageCode: 'PURCHASE_COMMITTEE',
      action: 'ESCALATE',
      requestItems: initialItems,
      decisions: pcDecisions,
    });

    // Invariant 1: Original requested values are completely preserved
    assert.equal(result[0].requestedQuantity, 10);
    assert.equal(result[0].estimatedTotal, 150000);
    assert.equal(result[1].requestedQuantity, 20);
    assert.equal(result[1].estimatedTotal, 10000);

    // Invariant 2: Recommended values are recorded
    assert.equal(result[0].recommendedQuantity, 6);
    assert.equal(result[0].recommendedAmount, 90000);
    assert.equal(result[1].recommendedQuantity, 20);
    assert.equal(result[1].recommendedAmount, 10000);

    // Invariant 3: Approved values remain 0 (PC cannot final-approve)
    assert.equal(result[0].approvedQuantity, 0);
    assert.equal(result[0].approvedAmount, 0);
    assert.equal(result[1].approvedQuantity, 0);
    assert.equal(result[1].approvedAmount, 0);
    assert.equal(result[0].status, 'PENDING');
  });

  test('Purchase Committee cannot execute APPROVE or PARTIAL_APPROVE', () => {
    assert.throws(
      () =>
        processActionItemDecisions({
          stageCode: 'PURCHASE_COMMITTEE',
          action: 'PARTIAL_APPROVE',
          requestItems: initialItems,
          decisions: [{ requestItemId: 'item-pc-1', approvedQuantity: 6 }],
        }),
      (err) => err.code === 'SP005'
    );
  });

  test('Principal / CDC PARTIAL_APPROVE sets approved values and computes unapproved balances', () => {
    // Items having prior PC recommendations
    const itemsWithRecommendations = [
      {
        ...initialItems[0],
        recommendedQuantity: 6,
        recommendedAmount: 90000,
      },
      {
        ...initialItems[1],
        recommendedQuantity: 20,
        recommendedAmount: 10000,
      },
    ];

    // CDC approves 6 microscopes and 15 slide boxes
    const cdcDecisions = [
      { requestItemId: 'item-pc-1', approvedQuantity: 6, approvedAmount: 90000 },
      { requestItemId: 'item-pc-2', approvedQuantity: 15, approvedAmount: 7500 },
    ];

    const result = processActionItemDecisions({
      stageCode: 'CDC',
      action: 'PARTIAL_APPROVE',
      requestItems: itemsWithRecommendations,
      decisions: cdcDecisions,
    });

    // Item 1: Requested 10, Recommended 6, Approved 6
    assert.equal(result[0].requestedQuantity, 10);
    assert.equal(result[0].recommendedQuantity, 6);
    assert.equal(result[0].approvedQuantity, 6);
    assert.equal(result[0].unapprovedQuantity, 4);
    assert.equal(result[0].estimatedTotal, 150000);
    assert.equal(result[0].recommendedAmount, 90000);
    assert.equal(result[0].approvedAmount, 90000);
    assert.equal(result[0].unapprovedAmount, 60000);
    assert.equal(result[0].status, 'PARTIALLY_APPROVED');

    // Item 2: Requested 20, Recommended 20, Approved 15
    assert.equal(result[1].requestedQuantity, 20);
    assert.equal(result[1].recommendedQuantity, 20);
    assert.equal(result[1].approvedQuantity, 15);
    assert.equal(result[1].unapprovedQuantity, 5);
    assert.equal(result[1].estimatedTotal, 10000);
    assert.equal(result[1].recommendedAmount, 10000);
    assert.equal(result[1].approvedAmount, 7500);
    assert.equal(result[1].unapprovedAmount, 2500);
    assert.equal(result[1].status, 'PARTIALLY_APPROVED');
  });
});
