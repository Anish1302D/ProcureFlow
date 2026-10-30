// Centralized departmental budget service and calculations.
// Authoritative calculation logic aligns with v_department_budget_summary
// and fn_get_department_budget_context.

/** Round a monetary figure to 2 decimal places to avoid floating point drift. */
export const roundMoney = (val) => Math.round(Number(val ?? 0) * 100) / 100;

/** Format an Indian Rupee amount for user-facing error messages. */
export const formatInr = (val) => Math.round(Number(val ?? 0)).toLocaleString('en-IN');

/**
 * Calculates remaining and available budget amounts from allocation, utilization and commitments.
 */
export function calculateRemainingBudget(allocatedAmount, { utilizedAmount = 0, committedAmount = 0 } = {}) {
  const allocated = roundMoney(allocatedAmount);
  const utilized = roundMoney(utilizedAmount);
  const committed = roundMoney(committedAmount);

  const remaining = roundMoney(allocated - (utilized + committed));
  const available = roundMoney(allocated - utilized);

  return {
    allocatedAmount: allocated,
    utilizedAmount: utilized,
    committedAmount: committed,
    remainingAmount: remaining,
    availableAmount: available,
  };
}

/**
 * Validates whether a proposed request total is within the department's remaining budget.
 */
export function validateBudgetForRequest(budgetStatus, requestedTotal) {
  const requested = roundMoney(requestedTotal);

  if (!budgetStatus) {
    return {
      isValid: false,
      reason: 'NO_PROVISION',
      requestedAmount: requested,
      error: 'No budget provision has been declared for this department for the selected financial year.',
    };
  }

  const remaining = roundMoney(budgetStatus.remainingAmount);

  if (requested <= remaining) {
    return {
      isValid: true,
      requestedAmount: requested,
      allocatedAmount: roundMoney(budgetStatus.allocatedAmount),
      utilizedAmount: roundMoney(budgetStatus.utilizedAmount),
      committedAmount: roundMoney(budgetStatus.committedAmount),
      remainingAmount: remaining,
      excessAmount: 0,
    };
  }

  const excess = roundMoney(requested - remaining);
  return {
    isValid: false,
    reason: 'BUDGET_EXCEEDED',
    requestedAmount: requested,
    allocatedAmount: roundMoney(budgetStatus.allocatedAmount),
    utilizedAmount: roundMoney(budgetStatus.utilizedAmount),
    committedAmount: roundMoney(budgetStatus.committedAmount),
    remainingAmount: remaining,
    excessAmount: excess,
    error: `Request exceeds the available departmental budget by ₹${formatInr(excess)}. Maximum permitted amount: ₹${formatInr(remaining)}.`,
  };
}

/**
 * Fetches the active departmental budget status from the database.
 * If financialYearId is omitted, resolves the active financial year.
 * If forUpdate is true, places a row-level lock on the budget_provisions record
 * to serialize concurrent submissions and prevent race conditions.
 */
export async function getDepartmentBudgetStatus(db, { departmentId, financialYearId, budgetHeadId, forUpdate = false }) {
  if (!departmentId) return null;

  let fyId = financialYearId ? Number(financialYearId) : null;
  if (!fyId) {
    const { rows: fyRows } = await db.query(
      'SELECT financial_year_id FROM financial_years WHERE is_active LIMIT 1',
    );
    fyId = fyRows[0]?.financial_year_id ?? null;
  }
  if (!fyId) return null;

  const targetHeadId = budgetHeadId != null ? Number(budgetHeadId) : null;

  // 1. Resolve applicable provision matching stored procedure logic:
  // specific budget_head_id first, falling back to department-wide (null)
  const { rows: provRows } = await db.query(
    `SELECT budget_provision_id, department_id, financial_year_id, budget_head_id, allocated_amount
       FROM budget_provisions
      WHERE department_id = $1
        AND financial_year_id = $2
        AND ($3::int IS NULL OR budget_head_id = $3 OR budget_head_id IS NULL)
      ORDER BY budget_head_id NULLS LAST
      LIMIT 1`,
    [Number(departmentId), fyId, targetHeadId],
  );

  const provision = provRows[0];
  if (!provision) return null;

  // 2. If row locking requested for concurrency protection, lock the provision row
  if (forUpdate) {
    await db.query(
      'SELECT budget_provision_id FROM budget_provisions WHERE budget_provision_id = $1 FOR UPDATE',
      [provision.budget_provision_id],
    );
  }

  // 3. Query v_department_budget_summary for the provision's computed accounting stats
  const { rows: summaryRows } = await db.query(
    `SELECT budget_provision_id, department_id, financial_year_id, budget_head_id,
            allocated_amount, utilized_amount, committed_amount, remaining_amount, available_amount
       FROM v_department_budget_summary
      WHERE budget_provision_id = $1`,
    [provision.budget_provision_id],
  );

  const summary = summaryRows[0];
  if (!summary) return null;

  return {
    budgetProvisionId: summary.budget_provision_id,
    departmentId: summary.department_id,
    financialYearId: summary.financial_year_id,
    budgetHeadId: summary.budget_head_id,
    allocatedAmount: Number(summary.allocated_amount),
    utilizedAmount: Number(summary.utilized_amount),
    committedAmount: Number(summary.committed_amount),
    remainingAmount: Number(summary.remaining_amount),
    availableAmount: Number(summary.available_amount),
  };
}
