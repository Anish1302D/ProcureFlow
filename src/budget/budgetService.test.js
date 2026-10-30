import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  toPaise,
  fromPaise,
  roundMoney,
  formatInr,
  calculateRemainingBudget,
  validateBudgetForRequest,
  getDepartmentBudgetStatus,
  computeRequestAccountingImpact,
} from '../../server/src/budgetService.js';

describe('Issue #20 - Reusable Budget Service Calculations', () => {
  test('toPaise and fromPaise handle fractional paise and avoid floating point drift', () => {
    assert.equal(toPaise(0.1 + 0.2), 30);
    assert.equal(fromPaise(30), 0.3);
    assert.equal(toPaise(500000.05), 50000005);
    assert.equal(fromPaise(50000005), 500000.05);
  });

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

  test('calculateRemainingBudget computes remaining and available amounts correctly with exact decimal precision', () => {
    const res = calculateRemainingBudget(500000.75, {
      utilizedAmount: 300000.25,
      committedAmount: 50000.10,
    });

    assert.equal(res.allocatedAmount, 500000.75);
    assert.equal(res.utilizedAmount, 300000.25);
    assert.equal(res.committedAmount, 50000.10);
    assert.equal(res.remainingAmount, 150000.40);
    assert.equal(res.availableAmount, 200000.50);
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

  test('getDepartmentBudgetStatus resolves active financial year when omitted', async () => {
    let queriedQueries = [];
    const mockDb = {
      async query(sql, params) {
        queriedQueries.push({ sql, params });
        if (sql.includes('FROM financial_years WHERE is_active')) {
          return { rows: [{ financial_year_id: 101 }] };
        }
        if (sql.includes('FROM budget_provisions')) {
          return {
            rows: [
              {
                budget_provision_id: 'bp-uuid-1',
                department_id: 5,
                financial_year_id: 101,
                budget_head_id: 2,
                allocated_amount: 450000,
              },
            ],
          };
        }
        if (sql.includes('FROM v_department_budget_summary')) {
          return {
            rows: [
              {
                budget_provision_id: 'bp-uuid-1',
                department_id: 5,
                financial_year_id: 101,
                budget_head_id: 2,
                allocated_amount: '450000.00',
                utilized_amount: '150000.00',
                committed_amount: '50000.00',
                remaining_amount: '250000.00',
                available_amount: '300000.00',
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const status = await getDepartmentBudgetStatus(mockDb, {
      departmentId: 5,
      budgetHeadId: 2,
    });

    assert.ok(status, 'Must resolve status');
    assert.equal(status.departmentId, 5);
    assert.equal(status.financialYearId, 101);
    assert.equal(status.allocatedAmount, 450000);
    assert.equal(status.remainingAmount, 250000);
    assert.equal(queriedQueries.some((q) => q.sql.includes('FROM financial_years WHERE is_active')), true);
  });

  test('computeRequestAccountingImpact categorizes requests according to accounting rules', () => {
    const approved = computeRequestAccountingImpact({
      status: 'APPROVED',
      sanctionedAmount: 180000,
      tentativeTotalCost: 200000,
    });
    assert.equal(approved.type, 'UTILIZED');
    assert.equal(approved.effectiveAmount, 180000);
    assert.equal(approved.isUtilized, true);

    const underReview = computeRequestAccountingImpact({
      status: 'UNDER_PRINCIPAL_REVIEW',
      tentativeTotalCost: 75000,
    });
    assert.equal(underReview.type, 'COMMITTED');
    assert.equal(underReview.effectiveAmount, 75000);
    assert.equal(underReview.isCommitted, true);

    const rejected = computeRequestAccountingImpact({
      status: 'REJECTED',
      tentativeTotalCost: 90000,
    });
    assert.equal(rejected.type, 'RELEASED');
    assert.equal(rejected.effectiveAmount, 0);
    assert.equal(rejected.isReleased, true);

    const carriedForward = computeRequestAccountingImpact({
      status: 'CARRIED_FORWARD',
      tentativeTotalCost: 60000,
    });
    assert.equal(carriedForward.type, 'RELEASED');
    assert.equal(carriedForward.effectiveAmount, 0);
    assert.equal(carriedForward.isReleased, true);
  });
});
