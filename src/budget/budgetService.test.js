import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  roundMoney,
  formatInr,
  calculateRemainingBudget,
  validateBudgetForRequest,
} from '../../server/src/budgetService.js';

describe('Issue #20 - Reusable Budget Service Calculations', () => {
  test('roundMoney accurately handles numbers, decimals and nulls', () => {
    assert.equal(roundMoney(10.556), 10.56);
    assert.equal(roundMoney(10.554), 10.55);
    assert.equal(roundMoney('100.50'), 100.5);
    assert.equal(roundMoney(null), 0);
  });

  test('formatInr formats Indian Rupee numbers with standard comma separators', () => {
    assert.equal(formatInr(50000), '50,000');
    assert.equal(formatInr(200000), '2,00,000');
    assert.equal(formatInr(1500000), '15,00,000');
  });

  test('calculateRemainingBudget computes remaining and available amounts correctly', () => {
    const res = calculateRemainingBudget(500000, {
      utilizedAmount: 300000,
      committedAmount: 50000,
    });

    assert.equal(res.allocatedAmount, 500000);
    assert.equal(res.utilizedAmount, 300000);
    assert.equal(res.committedAmount, 50000);
    assert.equal(res.remainingAmount, 150000);
    assert.equal(res.availableAmount, 200000);
  });

  test('validateBudgetForRequest returns valid when within budget', () => {
    const budgetStatus = {
      allocatedAmount: 500000,
      utilizedAmount: 300000,
      committedAmount: 0,
      remainingAmount: 200000,
    };

    const res = validateBudgetForRequest(budgetStatus, 150000);
    assert.equal(res.isValid, true);
    assert.equal(res.excessAmount, 0);
    assert.equal(res.remainingAmount, 200000);
  });

  test('validateBudgetForRequest flags excess when request exceeds remaining budget', () => {
    const budgetStatus = {
      allocatedAmount: 500000,
      utilizedAmount: 300000,
      committedAmount: 0,
      remainingAmount: 200000,
    };

    const res = validateBudgetForRequest(budgetStatus, 250000);
    assert.equal(res.isValid, false);
    assert.equal(res.reason, 'BUDGET_EXCEEDED');
    assert.equal(res.excessAmount, 50000);
    assert.equal(res.remainingAmount, 200000);
    assert.equal(
      res.error,
      'Request exceeds the available departmental budget by ₹50,000. Maximum permitted amount: ₹2,00,000.'
    );
  });

  test('validateBudgetForRequest rejects when budgetStatus is missing', () => {
    const res = validateBudgetForRequest(null, 10000);
    assert.equal(res.isValid, false);
    assert.equal(res.reason, 'NO_PROVISION');
    assert.equal(
      res.error,
      'No budget provision has been declared for this department for the selected financial year.'
    );
  });
});
