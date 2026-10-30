import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure domain logic for departmental budget availability calculation
 * mirroring v_department_budget_summary and fn_get_department_budget_context.
 */
export const UTILIZED_STATUSES = ['APPROVED', 'PARTIALLY_APPROVED', 'FULFILMENT_PENDING', 'FULFILLED'];
export const COMMITTED_STATUSES = [
  'SUBMITTED',
  'UNDER_PURCHASE_COMMITTEE_REVIEW',
  'UNDER_PRINCIPAL_REVIEW',
  'UNDER_CDC_REVIEW',
  'UNDER_FINAL_AUTHORITY_REVIEW',
  'AWAITING_RESUBMISSION',
];
export const RELEASED_STATUSES = ['DRAFT', 'REJECTED', 'CLOSED', 'CARRIED_FORWARD'];

export function calculateBudgetSummary(allocatedAmount, requests = []) {
  const allocated = Math.round(Number(allocatedAmount) * 100) / 100;

  let utilized = 0;
  let committed = 0;

  for (const r of requests) {
    const cost = Math.round(Number(r.sanctionedAmount ?? r.tentativeTotalCost ?? 0) * 100) / 100;
    const tentative = Math.round(Number(r.tentativeTotalCost ?? 0) * 100) / 100;

    if (UTILIZED_STATUSES.includes(r.status)) {
      utilized += cost;
    } else if (COMMITTED_STATUSES.includes(r.status)) {
      committed += tentative;
    }
    // RELEASED_STATUSES (DRAFT, REJECTED, CLOSED) add 0
  }

  utilized = Math.round(utilized * 100) / 100;
  committed = Math.round(committed * 100) / 100;
  const remaining = Math.round((allocated - (utilized + committed)) * 100) / 100;
  const available = Math.round((allocated - utilized) * 100) / 100;

  return {
    allocatedAmount: allocated,
    utilizedAmount: utilized,
    committedAmount: committed,
    remainingAmount: remaining,
    availableAmount: available,
  };
}

export function validateRequestAgainstBudget(budgetSummary, requestedTotal) {
  const reqTotal = Math.round(Number(requestedTotal) * 100) / 100;
  const remaining = budgetSummary.remainingAmount;

  if (reqTotal <= remaining) {
    return {
      isValid: true,
      requestedAmount: reqTotal,
      remainingAmount: remaining,
      excessAmount: 0,
    };
  }

  const excess = Math.round((reqTotal - remaining) * 100) / 100;
  return {
    isValid: false,
    requestedAmount: reqTotal,
    remainingAmount: remaining,
    excessAmount: excess,
    error: `Request exceeds the available departmental budget by ₹${excess.toLocaleString('en-IN')}. Maximum permitted amount: ₹${remaining.toLocaleString('en-IN')}.`,
  };
}

describe('Issue #20 - Departmental Budget Calculation Regression Tests', () => {
  test('Accurately calculates budget summary matching issue specification', () => {
    const allocated = 500000;
    const requests = [
      { status: 'APPROVED', sanctionedAmount: 200000, tentativeTotalCost: 200000 },
      { status: 'FULFILLED', sanctionedAmount: 100000, tentativeTotalCost: 100000 },
    ];

    const summary = calculateBudgetSummary(allocated, requests);
    assert.equal(summary.allocatedAmount, 500000);
    assert.equal(summary.utilizedAmount, 300000);
    assert.equal(summary.committedAmount, 0);
    assert.equal(summary.remainingAmount, 200000);
    assert.equal(summary.availableAmount, 200000);
  });

  test('Rejects request exceeding available budget by ₹50,000', () => {
    const summary = {
      allocatedAmount: 500000,
      utilizedAmount: 300000,
      committedAmount: 0,
      remainingAmount: 200000,
      availableAmount: 200000,
    };

    const result = validateRequestAgainstBudget(summary, 250000);
    assert.equal(result.isValid, false);
    assert.equal(result.excessAmount, 50000);
    assert.equal(result.remainingAmount, 200000);
    assert.ok(result.error.includes('exceeds the available departmental budget by ₹50,000'));
    assert.ok(result.error.includes('Maximum permitted amount: ₹2,00,000'));
  });

  test('Permits request exactly matching the remaining budget', () => {
    const summary = {
      allocatedAmount: 500000,
      utilizedAmount: 300000,
      committedAmount: 0,
      remainingAmount: 200000,
      availableAmount: 200000,
    };

    const result = validateRequestAgainstBudget(summary, 200000);
    assert.equal(result.isValid, true);
    assert.equal(result.excessAmount, 0);
  });

  test('Permits request strictly below remaining budget', () => {
    const summary = {
      allocatedAmount: 500000,
      utilizedAmount: 300000,
      committedAmount: 0,
      remainingAmount: 200000,
      availableAmount: 200000,
    };

    const result = validateRequestAgainstBudget(summary, 199999);
    assert.equal(result.isValid, true);
  });

  test('Rejects request exceeding remaining budget by ₹1', () => {
    const summary = {
      allocatedAmount: 500000,
      utilizedAmount: 300000,
      committedAmount: 0,
      remainingAmount: 200000,
      availableAmount: 200000,
    };

    const result = validateRequestAgainstBudget(summary, 200001);
    assert.equal(result.isValid, false);
    assert.equal(result.excessAmount, 1);
  });

  test('Rejects any positive request when remaining budget is zero', () => {
    const summary = {
      allocatedAmount: 500000,
      utilizedAmount: 400000,
      committedAmount: 100000,
      remainingAmount: 0,
      availableAmount: 100000,
    };

    const result = validateRequestAgainstBudget(summary, 500);
    assert.equal(result.isValid, false);
    assert.equal(result.excessAmount, 500);
    assert.equal(result.remainingAmount, 0);
  });

  test('Committed in-flight requests reduce remaining budget for new requests', () => {
    const allocated = 100000;
    const requests = [
      { status: 'UNDER_PURCHASE_COMMITTEE_REVIEW', tentativeTotalCost: 70000 },
    ];

    const summary = calculateBudgetSummary(allocated, requests);
    assert.equal(summary.utilizedAmount, 0);
    assert.equal(summary.committedAmount, 70000);
    assert.equal(summary.remainingAmount, 30000);

    // Attempting a 60,000 request must now be rejected
    const validation = validateRequestAgainstBudget(summary, 60000);
    assert.equal(validation.isValid, false);
    assert.equal(validation.excessAmount, 30000);
    assert.equal(validation.remainingAmount, 30000);
  });

  test('Rejected and closed requests do not consume remaining budget', () => {
    const allocated = 100000;
    const requests = [
      { status: 'REJECTED', tentativeTotalCost: 80000 },
      { status: 'CLOSED', tentativeTotalCost: 20000 },
      { status: 'DRAFT', tentativeTotalCost: 50000 },
    ];

    const summary = calculateBudgetSummary(allocated, requests);
    assert.equal(summary.utilizedAmount, 0);
    assert.equal(summary.committedAmount, 0);
    assert.equal(summary.remainingAmount, 100000);
  });
});
