import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calculateBudgetSummary, validateRequestAgainstBudget } from './departmentBudgetCals.test.js';

/**
 * Simulates resolution of applicable departmental budget provision
 * matching PostgreSQL function fn_get_department_budget_context logic:
 * SELECT * FROM v_department_budget_summary v
 *  WHERE v.department_id = p_department_id
 *    AND v.financial_year_id = p_financial_year_id
 *    AND (p_budget_head_id IS NULL OR v.budget_head_id = p_budget_head_id OR v.budget_head_id IS NULL)
 *  ORDER BY v.budget_head_id NULLS LAST
 *  LIMIT 1;
 */
export function resolveApplicableProvision(provisions, { departmentId, financialYearId, budgetHeadId }) {
  const matches = provisions.filter(
    (p) =>
      p.departmentId === departmentId &&
      p.financialYearId === financialYearId &&
      (budgetHeadId == null || p.budgetHeadId === budgetHeadId || p.budgetHeadId == null)
  );

  if (!matches.length) return null;

  // Order by budgetHeadId NULLS LAST: exact budget head match takes precedence over department-wide (null)
  matches.sort((a, b) => {
    if (a.budgetHeadId != null && b.budgetHeadId == null) return -1;
    if (a.budgetHeadId == null && b.budgetHeadId != null) return 1;
    return 0;
  });

  return matches[0];
}

describe('Issue #20 - Budget Availability and Financial Year Test Cases', () => {
  const sampleProvisions = [
    // Dept 10 (CS), FY 2024-25 (FY 1), specific head 1 (Equipment)
    {
      id: 'prov-cs-eq',
      departmentId: 10,
      financialYearId: 1,
      budgetHeadId: 1,
      allocatedAmount: 500000,
      requests: [
        { status: 'APPROVED', sanctionedAmount: 300000 },
      ],
    },
    // Dept 10 (CS), FY 2024-25 (FY 1), department-wide provision (null head)
    {
      id: 'prov-cs-general',
      departmentId: 10,
      financialYearId: 1,
      budgetHeadId: null,
      allocatedAmount: 1000000,
      requests: [
        { status: 'APPROVED', sanctionedAmount: 150000 },
      ],
    },
    // Dept 10 (CS), previous FY 2023-24 (FY 2)
    {
      id: 'prov-cs-prev',
      departmentId: 10,
      financialYearId: 2,
      budgetHeadId: 1,
      allocatedAmount: 400000,
      requests: [
        { status: 'APPROVED', sanctionedAmount: 400000 },
      ],
    },
    // Dept 20 (Chemistry), FY 2024-25 (FY 1)
    {
      id: 'prov-chem-eq',
      departmentId: 20,
      financialYearId: 1,
      budgetHeadId: 1,
      allocatedAmount: 800000,
      requests: [
        { status: 'APPROVED', sanctionedAmount: 200000 },
      ],
    },
  ];

  test('Prefers exact budget head provision over department-wide fallback', () => {
    const prov = resolveApplicableProvision(sampleProvisions, {
      departmentId: 10,
      financialYearId: 1,
      budgetHeadId: 1,
    });

    assert.ok(prov, 'Must find a provision');
    assert.equal(prov.id, 'prov-cs-eq');
    assert.equal(prov.allocatedAmount, 500000);

    const summary = calculateBudgetSummary(prov.allocatedAmount, prov.requests);
    assert.equal(summary.remainingAmount, 200000);
  });

  test('Falls back to department-wide provision when specific budget head provision is absent', () => {
    // Budget head 99 (Consumables) has no specific provision for CS, should fall back to general
    const prov = resolveApplicableProvision(sampleProvisions, {
      departmentId: 10,
      financialYearId: 1,
      budgetHeadId: 99,
    });

    assert.ok(prov, 'Must fall back to department-wide provision');
    assert.equal(prov.id, 'prov-cs-general');
    assert.equal(prov.allocatedAmount, 1000000);

    const summary = calculateBudgetSummary(prov.allocatedAmount, prov.requests);
    assert.equal(summary.remainingAmount, 850000);
  });

  test('Returns null when no provision exists for the given department and financial year', () => {
    const prov = resolveApplicableProvision(sampleProvisions, {
      departmentId: 999, // Non-existent department
      financialYearId: 1,
      budgetHeadId: 1,
    });

    assert.equal(prov, null, 'Must return null for unallocated department');
  });

  test('Isolates departmental budgets: Chem budget never affects CS budget', () => {
    const csProv = resolveApplicableProvision(sampleProvisions, {
      departmentId: 10,
      financialYearId: 1,
      budgetHeadId: 1,
    });
    const chemProv = resolveApplicableProvision(sampleProvisions, {
      departmentId: 20,
      financialYearId: 1,
      budgetHeadId: 1,
    });

    const csSummary = calculateBudgetSummary(csProv.allocatedAmount, csProv.requests);
    const chemSummary = calculateBudgetSummary(chemProv.allocatedAmount, chemProv.requests);

    assert.equal(csSummary.remainingAmount, 200000);
    assert.equal(chemSummary.remainingAmount, 600000);

    // Validating 250,000 for CS fails, but for Chemistry passes
    const csVal = validateRequestAgainstBudget(csSummary, 250000);
    const chemVal = validateRequestAgainstBudget(chemSummary, 250000);

    assert.equal(csVal.isValid, false);
    assert.equal(chemVal.isValid, true);
  });

  test('Isolates financial years: prior financial year utilization does not drain current FY', () => {
    const currentProv = resolveApplicableProvision(sampleProvisions, {
      departmentId: 10,
      financialYearId: 1,
      budgetHeadId: 1,
    });
    const prevProv = resolveApplicableProvision(sampleProvisions, {
      departmentId: 10,
      financialYearId: 2,
      budgetHeadId: 1,
    });

    const currentSummary = calculateBudgetSummary(currentProv.allocatedAmount, currentProv.requests);
    const prevSummary = calculateBudgetSummary(prevProv.allocatedAmount, prevProv.requests);

    // Prev FY was fully utilized (remaining 0)
    assert.equal(prevSummary.remainingAmount, 0);
    // Current FY has 200,000 remaining
    assert.equal(currentSummary.remainingAmount, 200000);
  });
});

