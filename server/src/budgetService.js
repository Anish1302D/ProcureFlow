// Centralized departmental budget service and calculations.
// Authoritative calculation logic aligns with v_department_budget_summary
// and fn_get_department_budget_context.

import { unprocessable } from './errors.js';

/** Request statuses that count towards utilized budget (sanctioned/fulfilled). */
export const STATUSES_UTILIZED = [
  'APPROVED',
  'PARTIALLY_APPROVED',
  'FULFILMENT_PENDING',
  'FULFILLED',
];

/** Request statuses that count towards committed budget (in-flight under review). */
export const STATUSES_COMMITTED = [
  'SUBMITTED',
  'UNDER_PURCHASE_COMMITTEE_REVIEW',
  'UNDER_PRINCIPAL_REVIEW',
  'UNDER_CDC_REVIEW',
  'UNDER_FINAL_AUTHORITY_REVIEW',
  'AWAITING_RESUBMISSION',
];

/** Request statuses that release or do not consume budget (drafts, rejections, closed). */
export const STATUSES_RELEASED = [
  'DRAFT',
  'REJECTED',
  'CLOSED',
  'CARRIED_FORWARD',
];

/** Converts an Indian Rupee amount to integer paise to ensure exact arithmetic. */
export const toPaise = (val) => Math.round(Number(val ?? 0) * 100);

/** Converts integer paise back to Indian Rupees with 2 decimal precision. */
export const fromPaise = (paise) => (Math.round(paise) / 100);

/** Round a monetary figure to 2 decimal places using exact paise arithmetic. */
export const roundMoney = (val) => fromPaise(toPaise(val));

/** Format an Indian Rupee amount for user-facing error messages. */
export const formatInr = (val) => Math.round(Number(val ?? 0)).toLocaleString('en-IN');

/**
 * Categorizes a request's accounting impact based on its current status.
 * Returns { isUtilized, isCommitted, isReleased, effectiveAmount }
 */
export function computeRequestAccountingImpact(req) {
  const status = req?.status ?? req?.current_status;
  const tentative = roundMoney(req?.tentativeTotalCost ?? req?.tentative_total_cost ?? 0);
  const sanctioned = req?.sanctionedAmount ?? req?.sanctioned_amount;
  const sanctionedOrTentative = sanctioned != null ? roundMoney(sanctioned) : tentative;

  if (STATUSES_UTILIZED.includes(status)) {
    return {
      type: 'UTILIZED',
      effectiveAmount: sanctionedOrTentative,
      isUtilized: true,
      isCommitted: false,
      isReleased: false,
    };
  }

  if (STATUSES_COMMITTED.includes(status)) {
    return {
      type: 'COMMITTED',
      effectiveAmount: tentative,
      isUtilized: false,
      isCommitted: true,
      isReleased: false,
    };
  }

  return {
    type: 'RELEASED',
    effectiveAmount: 0,
    isUtilized: false,
    isCommitted: false,
    isReleased: true,
  };
}

/**
 * Calculates remaining and available budget amounts from allocation, utilization and commitments
 * using integer paise arithmetic to prevent floating point inaccuracies.
 */
export function calculateRemainingBudget(allocatedAmount, { utilizedAmount = 0, committedAmount = 0 } = {}) {
  const allocPaise = toPaise(allocatedAmount);
  const utilPaise = toPaise(utilizedAmount);
  const commPaise = toPaise(committedAmount);

  const remainingPaise = allocPaise - (utilPaise + commPaise);
  const availPaise = allocPaise - utilPaise;

  return {
    allocatedAmount: fromPaise(allocPaise),
    utilizedAmount: fromPaise(utilPaise),
    committedAmount: fromPaise(commPaise),
    remainingAmount: fromPaise(remainingPaise),
    availableAmount: fromPaise(availPaise),
  };
}

/**
 * Validates whether a proposed request total is within the department's remaining budget.
 * Uses exact paise comparison so requests are never falsely rejected or accepted due to rounding.
 */
export function validateBudgetForRequest(budgetStatus, requestedTotal) {
  const reqPaise = toPaise(requestedTotal);
  const requested = fromPaise(reqPaise);

  if (!budgetStatus) {
    return {
      isValid: false,
      reason: 'NO_PROVISION',
      requestedAmount: requested,
      error: 'No budget provision has been declared for this department for the selected financial year.',
    };
  }

  const remainingPaise = toPaise(budgetStatus.remainingAmount);
  const remaining = fromPaise(remainingPaise);

  if (reqPaise <= remainingPaise) {
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

  const excessPaise = reqPaise - remainingPaise;
  const excess = fromPaise(excessPaise);

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
 * Asserts that the proposed request total is within the department's available budget.
 * Throws unprocessable (HTTP 422) if missing provision or budget exceeded.
 */
export function assertDepartmentBudgetAvailable(budgetStatus, requestedTotal) {
  const result = validateBudgetForRequest(budgetStatus, requestedTotal);
  if (!result.isValid) {
    throw unprocessable(result.error, {
      code: result.reason,
      requestedAmount: result.requestedAmount,
      allocatedAmount: result.allocatedAmount ?? 0,
      utilizedAmount: result.utilizedAmount ?? 0,
      committedAmount: result.committedAmount ?? 0,
      remainingAmount: result.remainingAmount ?? 0,
      excessAmount: result.excessAmount ?? 0,
    });
  }
  return result;
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

  // Use paise-exact calculateRemainingBudget to guarantee decimal integrity
  const exactRemaining = calculateRemainingBudget(summary.allocated_amount, {
    utilizedAmount: summary.utilized_amount,
    committedAmount: summary.committed_amount,
  });

  return {
    budgetProvisionId: summary.budget_provision_id,
    departmentId: summary.department_id,
    financialYearId: summary.financial_year_id,
    budgetHeadId: summary.budget_head_id,
    allocatedAmount: exactRemaining.allocatedAmount,
    utilizedAmount: exactRemaining.utilizedAmount,
    committedAmount: exactRemaining.committedAmount,
    remainingAmount: exactRemaining.remainingAmount,
    availableAmount: exactRemaining.availableAmount,
  };
}
