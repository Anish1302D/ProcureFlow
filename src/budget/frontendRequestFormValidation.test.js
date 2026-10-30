import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { money } from '../../src/api/format.js';
import { calculateItemsTotal } from '../../server/src/budgetService.js';

describe('Issue #20 - Frontend Request Form Budget Validation', () => {
  // Simulated frontend validation helper mirroring NewRequestModal logic
  function evaluateFormBudgetState({ budgetStatus, lines, deptIdForBudget }) {
    const filled = lines.filter((l) => l.budgetItemId || l.quantity || l.unitCost);
    const total = calculateItemsTotal(
      filled.map((l) => ({
        budgetItemId: l.budgetItemId,
        quantity: Number(l.quantity) || 0,
        unitCost: Number(l.unitCost) || 0,
      }))
    );

    if (!deptIdForBudget) {
      return { total, isValid: true, excessAmount: 0, problems: [] };
    }

    if (!budgetStatus) {
      const error = 'No budget provision has been declared for this department for the selected financial year.';
      return {
        total,
        isValid: false,
        reason: 'NO_PROVISION',
        excessAmount: 0,
        error,
        problems: [error],
      };
    }

    const remaining = Number(budgetStatus.remainingAmount ?? 0);
    const excess = Math.max(0, Math.round((total - remaining) * 100) / 100);

    if (excess > 0) {
      const error = `Request exceeds the available departmental budget by ${money(excess)}. Maximum permitted amount: ${money(remaining)}.`;
      return {
        total,
        isValid: false,
        reason: 'BUDGET_EXCEEDED',
        excessAmount: excess,
        remainingAmount: remaining,
        error,
        problems: [error],
      };
    }

    return {
      total,
      isValid: true,
      excessAmount: 0,
      remainingAmount: remaining,
      problems: [],
    };
  }

  const sampleBudgetStatus = {
    allocatedAmount: 500000.0,
    utilizedAmount: 300000.0,
    committedAmount: 0.0,
    remainingAmount: 200000.0,
  };

  test('Validates request within remaining departmental budget', () => {
    const lines = [
      { budgetItemId: 1, quantity: 2, unitCost: 50000 }, // 100,000
      { budgetItemId: 2, quantity: 1, unitCost: 50000 }, // 50,000
    ];

    const state = evaluateFormBudgetState({
      budgetStatus: sampleBudgetStatus,
      lines,
      deptIdForBudget: '10',
    });

    assert.equal(state.total, 150000.0);
    assert.equal(state.isValid, true);
    assert.equal(state.excessAmount, 0);
    assert.equal(state.problems.length, 0);
  });

  test('Flags excess and generates exact warning banner when budget is exceeded', () => {
    // 5 units @ 50,000 = 2,50,000 vs 2,00,000 remaining
    const lines = [
      { budgetItemId: 1, quantity: 5, unitCost: 50000 },
    ];

    const state = evaluateFormBudgetState({
      budgetStatus: sampleBudgetStatus,
      lines,
      deptIdForBudget: '10',
    });

    assert.equal(state.total, 250000.0);
    assert.equal(state.isValid, false);
    assert.equal(state.reason, 'BUDGET_EXCEEDED');
    assert.equal(state.excessAmount, 50000.0);
    assert.equal(state.remainingAmount, 200000.0);
    assert.match(state.error, /Request exceeds the available departmental budget by/i);
    assert.match(state.error, /50,000/);
    assert.match(state.error, /2,00,000/);
    assert.equal(state.problems.length, 1);
  });

  test('Dynamically recovers when item quantity is adjusted downward within budget', () => {
    // Initial state: 5 units = 250,000 (exceeds)
    let lines = [{ budgetItemId: 1, quantity: 5, unitCost: 50000 }];
    let state = evaluateFormBudgetState({
      budgetStatus: sampleBudgetStatus,
      lines,
      deptIdForBudget: '10',
    });
    assert.equal(state.isValid, false);

    // User edits quantity in form from 5 to 4: 4 * 50,000 = 200,000 (exact budget)
    lines = [{ budgetItemId: 1, quantity: 4, unitCost: 50000 }];
    state = evaluateFormBudgetState({
      budgetStatus: sampleBudgetStatus,
      lines,
      deptIdForBudget: '10',
    });
    assert.equal(state.total, 200000.0);
    assert.equal(state.isValid, true);
    assert.equal(state.excessAmount, 0);
    assert.equal(state.problems.length, 0);
  });

  test('Blocks submission and flags error when no budget provision exists', () => {
    const lines = [{ budgetItemId: 1, quantity: 1, unitCost: 10000 }];
    const state = evaluateFormBudgetState({
      budgetStatus: null,
      lines,
      deptIdForBudget: '10',
    });

    assert.equal(state.isValid, false);
    assert.equal(state.reason, 'NO_PROVISION');
    assert.match(state.error, /No budget provision has been declared/i);
    assert.equal(state.problems.length, 1);
  });
});

