import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  getDepartmentBudgetStatus,
  assertDepartmentBudgetAvailable,
} from '../../server/src/budgetService.js';

describe('Issue #20 - Budget Head and Financial Year Validation', () => {
  const provisionsDatabase = [
    // Dept 1, FY 2024 (id: 2024), Head 10 (Hardware): 5,00,000
    {
      budget_provision_id: 'prov-hw-2024',
      department_id: 1,
      financial_year_id: 2024,
      budget_head_id: 10,
      allocated_amount: '500000.00',
      utilized_amount: '300000.00',
      committed_amount: '0.00',
      remaining_amount: '200000.00',
      available_amount: '200000.00',
    },
    // Dept 1, FY 2024 (id: 2024), Head 20 (Software): 3,00,000
    {
      budget_provision_id: 'prov-sw-2024',
      department_id: 1,
      financial_year_id: 2024,
      budget_head_id: 20,
      allocated_amount: '300000.00',
      utilized_amount: '100000.00',
      committed_amount: '50000.00',
      remaining_amount: '150000.00',
      available_amount: '200000.00',
    },
    // Dept 1, FY 2024 (id: 2024), General Department Provision (Head null): 15,00,000
    {
      budget_provision_id: 'prov-gen-2024',
      department_id: 1,
      financial_year_id: 2024,
      budget_head_id: null,
      allocated_amount: '1500000.00',
      utilized_amount: '200000.00',
      committed_amount: '100000.00',
      remaining_amount: '1200000.00',
      available_amount: '1300000.00',
    },
    // Dept 1, Past FY 2023 (id: 2023), Head 10 (Hardware): 4,00,000 (fully spent)
    {
      budget_provision_id: 'prov-hw-2023',
      department_id: 1,
      financial_year_id: 2023,
      budget_head_id: 10,
      allocated_amount: '400000.00',
      utilized_amount: '400000.00',
      committed_amount: '0.00',
      remaining_amount: '0.00',
      available_amount: '0.00',
    },
  ];

  const createMockDb = () => ({
    async query(sql, params) {
      if (sql.includes('FROM financial_years WHERE is_active')) {
        return { rows: [{ financial_year_id: 2024 }] };
      }
      if (sql.includes('FROM budget_provisions')) {
        const [deptId, fyId, headId] = params;
        const matches = provisionsDatabase.filter(
          (p) =>
            p.department_id === deptId &&
            p.financial_year_id === fyId &&
            (headId == null || p.budget_head_id === headId || p.budget_head_id == null)
        );
        matches.sort((a, b) => {
          if (a.budget_head_id != null && b.budget_head_id == null) return -1;
          if (a.budget_head_id == null && b.budget_head_id != null) return 1;
          return 0;
        });
        return { rows: matches.slice(0, 1) };
      }
      if (sql.includes('FROM v_department_budget_summary')) {
        const [provId] = params;
        const match = provisionsDatabase.find((p) => p.budget_provision_id === provId);
        return { rows: match ? [match] : [] };
      }
      return { rows: [] };
    },
  });

  test('Validates Hardware requests strictly against Hardware budget head', async () => {
    const db = createMockDb();
    const status = await getDepartmentBudgetStatus(db, {
      departmentId: 1,
      financialYearId: 2024,
      budgetHeadId: 10,
    });

    assert.ok(status);
    assert.equal(status.budgetHeadId, 10);
    assert.equal(status.remainingAmount, 200000);

    // Request of 180,000 is allowed
    const valid = assertDepartmentBudgetAvailable(status, 180000);
    assert.equal(valid.isValid, true);

    // Request of 250,000 exceeds Hardware budget (remaining 200,000)
    assert.throws(
      () => assertDepartmentBudgetAvailable(status, 250000),
      (err) => err.details?.code === 'BUDGET_EXCEEDED' && err.details?.excessAmount === 50000
    );
  });

  test('Validates Software requests strictly against Software budget head', async () => {
    const db = createMockDb();
    const status = await getDepartmentBudgetStatus(db, {
      departmentId: 1,
      financialYearId: 2024,
      budgetHeadId: 20,
    });

    assert.ok(status);
    assert.equal(status.budgetHeadId, 20);
    assert.equal(status.remainingAmount, 150000);

    // Request of 150,000 is allowed
    const valid = assertDepartmentBudgetAvailable(status, 150000);
    assert.equal(valid.isValid, true);

    // Request of 160,000 exceeds Software budget (remaining 150,000)
    assert.throws(
      () => assertDepartmentBudgetAvailable(status, 160000),
      (err) => err.details?.code === 'BUDGET_EXCEEDED' && err.details?.excessAmount === 10000
    );
  });

  test('Falls back to general department-wide provision for other budget heads', async () => {
    const db = createMockDb();
    const status = await getDepartmentBudgetStatus(db, {
      departmentId: 1,
      financialYearId: 2024,
      budgetHeadId: 99, // Unspecified budget head (e.g. Consumables)
    });

    assert.ok(status);
    assert.equal(status.budgetHeadId, null);
    assert.equal(status.remainingAmount, 1200000);

    // Request of 10,00,000 is allowed under general provision
    const valid = assertDepartmentBudgetAvailable(status, 1000000);
    assert.equal(valid.isValid, true);
  });

  test('Automatically resolves active financial year when financialYearId is omitted', async () => {
    const db = createMockDb();
    const status = await getDepartmentBudgetStatus(db, {
      departmentId: 1,
      budgetHeadId: 10,
    });

    assert.ok(status);
    assert.equal(status.financialYearId, 2024);
    assert.equal(status.remainingAmount, 200000);
  });

  test('Throws NO_PROVISION error when department has no provision for specified financial year', async () => {
    const db = createMockDb();
    const status = await getDepartmentBudgetStatus(db, {
      departmentId: 999, // Non-existent department
      financialYearId: 2024,
      budgetHeadId: 10,
    });

    assert.equal(status, null);
    assert.throws(
      () => assertDepartmentBudgetAvailable(status, 1000),
      (err) => err.status === 422 && err.details?.code === 'NO_PROVISION'
    );
  });
});
