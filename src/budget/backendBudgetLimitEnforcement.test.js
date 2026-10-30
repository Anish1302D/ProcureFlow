import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assertDepartmentBudgetAvailable,
  calculateItemsTotal,
  validateBudgetForRequest,
} from '../../server/src/budgetService.js';
import { HttpError } from '../../server/src/errors.js';

describe('Issue #20 - Backend Budget Limit Enforcement', () => {
  const sampleBudgetStatus = {
    provisionId: 42,
    departmentId: 10,
    departmentName: 'Computer Science',
    financialYearId: 2,
    financialYearCode: '2025-26',
    budgetHeadId: 101,
    budgetHeadName: 'Hardware & Infrastructure',
    allocatedAmount: 500000.0,
    utilizedAmount: 300000.0,
    committedAmount: 0.0,
    remainingAmount: 200000.0,
    availableAmount: 200000.0,
  };

  test('Permits request strictly under remaining budget', () => {
    const items = [
      { budgetItemId: 1, quantity: 2, unitCost: 40000 }, // 80,000
      { budgetItemId: 2, quantity: 1, unitCost: 50000 }, // 50,000
    ];
    const total = calculateItemsTotal(items);
    assert.equal(total, 130000.0);

    const validation = validateBudgetForRequest(sampleBudgetStatus, total);
    assert.equal(validation.isValid, true);
    assert.equal(validation.excessAmount, 0);

    // assertDepartmentBudgetAvailable should not throw
    assert.doesNotThrow(() => {
      assertDepartmentBudgetAvailable(sampleBudgetStatus, total);
    });
  });

  test('Permits request matching exact available budget (₹2,00,000)', () => {
    const items = [
      { budgetItemId: 1, quantity: 4, unitCost: 50000 }, // 200,000
    ];
    const total = calculateItemsTotal(items);
    assert.equal(total, 200000.0);

    const validation = validateBudgetForRequest(sampleBudgetStatus, total);
    assert.equal(validation.isValid, true);
    assert.equal(validation.excessAmount, 0);
    assert.doesNotThrow(() => {
      assertDepartmentBudgetAvailable(sampleBudgetStatus, total);
    });
  });

  test('Rejects request exceeding available budget by ₹50,000 (₹2,50,000 vs ₹2,00,000)', () => {
    const requestedAmount = 250000.0;
    const validation = validateBudgetForRequest(sampleBudgetStatus, requestedAmount);

    assert.equal(validation.isValid, false);
    assert.equal(validation.reason, 'BUDGET_EXCEEDED');
    assert.equal(validation.excessAmount, 50000.0);
    assert.equal(validation.remainingAmount, 200000.0);

    assert.throws(
      () => assertDepartmentBudgetAvailable(sampleBudgetStatus, requestedAmount),
      (err) => {
        assert.ok(err instanceof HttpError, 'Must throw an HttpError');
        assert.equal(err.status, 422, 'Must be HTTP 422 Unprocessable Entity');
        assert.equal(err.details.code, 'BUDGET_EXCEEDED');
        assert.equal(err.details.excessAmount, 50000.0);
        assert.equal(err.details.remainingAmount, 200000.0);
        assert.match(err.message, /exceeds the available departmental budget/i);
        return true;
      },
    );
  });

  test('Rejects request exceeding available budget by ₹1', () => {
    const requestedAmount = 200001.0;
    const validation = validateBudgetForRequest(sampleBudgetStatus, requestedAmount);

    assert.equal(validation.isValid, false);
    assert.equal(validation.reason, 'BUDGET_EXCEEDED');
    assert.equal(validation.excessAmount, 1.0);

    assert.throws(
      () => assertDepartmentBudgetAvailable(sampleBudgetStatus, requestedAmount),
      (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 422);
        assert.equal(err.details.code, 'BUDGET_EXCEEDED');
        assert.equal(err.details.excessAmount, 1.0);
        return true;
      },
    );
  });

  test('Rejects request when available budget is ₹0', () => {
    const exhaustedBudget = {
      ...sampleBudgetStatus,
      utilizedAmount: 400000.0,
      committedAmount: 100000.0,
      remainingAmount: 0.0,
      availableAmount: 0.0,
    };
    const requestedAmount = 500.0;

    const validation = validateBudgetForRequest(exhaustedBudget, requestedAmount);
    assert.equal(validation.isValid, false);
    assert.equal(validation.reason, 'BUDGET_EXCEEDED');
    assert.equal(validation.excessAmount, 500.0);

    assert.throws(
      () => assertDepartmentBudgetAvailable(exhaustedBudget, requestedAmount),
      (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 422);
        assert.equal(err.details.code, 'BUDGET_EXCEEDED');
        assert.equal(err.details.remainingAmount, 0.0);
        assert.equal(err.details.excessAmount, 500.0);
        return true;
      },
    );
  });

  test('Rejects request when no departmental provision exists', () => {
    const requestedAmount = 10000.0;

    const validation = validateBudgetForRequest(null, requestedAmount);
    assert.equal(validation.isValid, false);
    assert.equal(validation.reason, 'NO_PROVISION');

    assert.throws(
      () => assertDepartmentBudgetAvailable(null, requestedAmount),
      (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 422);
        assert.equal(err.details.code, 'NO_PROVISION');
        assert.match(err.message, /No budget provision has been declared/i);
        return true;
      },
    );
  });

  test('Enforces Department Head ownership and rejects cross-department attempts', () => {
    const headUser = {
      id: 'head-cs-1',
      roles: ['HEAD'],
      departmentId: 10,
    };

    // Simulated handler logic from requestsRouter.post
    function processRequestCreation(user, inputDepartmentId) {
      if (user.roles.includes('HEAD')) {
        if (!user.departmentId) {
          throw new HttpError(403, 'Department Head must be assigned to a department to raise requests');
        }
        if (inputDepartmentId != null && inputDepartmentId !== user.departmentId) {
          throw new HttpError(403, 'You can only raise requests for your own department');
        }
        return user.departmentId;
      }
      return inputDepartmentId ?? user.departmentId;
    }

    // 1. Unassigned HEAD is forbidden
    assert.throws(
      () => processRequestCreation({ roles: ['HEAD'], departmentId: null }, 10),
      (err) => err.status === 403 && /Department Head must be assigned/.test(err.message),
    );

    // 2. Cross-department is forbidden
    assert.throws(
      () => processRequestCreation(headUser, 99),
      (err) => err.status === 403 && /You can only raise requests for your own department/.test(err.message),
    );

    // 3. Own department or null defaults to assigned department
    assert.equal(processRequestCreation(headUser, 10), 10);
    assert.equal(processRequestCreation(headUser, null), 10);
  });
});
