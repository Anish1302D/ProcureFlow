import { HttpError, unprocessable } from './errors.js';

/**
 * Pure evaluation function for budget limit checks.
 * Calculates allocated, consumed, remaining, and whether the requested amount exceeds budget.
 */
export function evaluateBudgetLimit({ allocated, consumed, requested }) {
  const numAllocated = Math.round(Number(allocated) * 100) / 100;
  const numConsumed = Math.round(Number(consumed) * 100) / 100;
  const numRequested = Math.round(Number(requested) * 100) / 100;

  if (!Number.isFinite(numRequested) || numRequested < 0) {
    throw new Error('Invalid requested amount');
  }
  if (!Number.isFinite(numAllocated) || numAllocated < 0) {
    throw new Error('Invalid allocated amount');
  }
  if (!Number.isFinite(numConsumed) || numConsumed < 0) {
    throw new Error('Invalid consumed amount');
  }

  const remaining = Math.round(Math.max(0, numAllocated - numConsumed) * 100) / 100;
  const isExceeded = numRequested > remaining;

  return {
    allocated: numAllocated,
    consumed: numConsumed,
    remaining,
    requested: numRequested,
    isExceeded,
    overrun: isExceeded ? Math.round((numRequested - remaining) * 100) / 100 : 0,
  };
}

/**
 * Verifies that a request's total cost does not exceed the remaining
 * department budget provision. Locks the budget_provisions row FOR UPDATE
 * to prevent concurrent submissions from overrunning the budget.
 *
 * @param {object} db - Database client or pool connection
 * @param {object} params
 * @param {number} params.departmentId
 * @param {number} [params.financialYearId]
 * @param {number} [params.budgetHeadId]
 * @param {number} params.amount - Total cost to validate
 * @param {string} [params.excludeRequestId] - Request ID to exclude from consumed total
 */
export async function assertWithinBudgetLimit(db, {
  departmentId,
  financialYearId,
  budgetHeadId,
  amount,
  excludeRequestId = null,
}) {
  if (!departmentId || amount == null || Number(amount) <= 0) return;

  const numAmount = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(numAmount) || numAmount < 0) {
    throw unprocessable('Invalid monetary amount');
  }

  // 1. Lock the budget provision row FOR UPDATE to serialize concurrent submissions
  // for the same department and financial year.
  const { rows: provRows } = await db.query(
    `SELECT budget_provision_id, allocated_amount, department_id, financial_year_id, budget_head_id
     FROM budget_provisions
     WHERE department_id = $1
       AND financial_year_id = COALESCE($2, (SELECT financial_year_id FROM financial_years WHERE is_active LIMIT 1))
       AND ($3::int IS NULL OR budget_head_id = $3::int OR budget_head_id IS NULL)
     ORDER BY budget_head_id NULLS LAST
     LIMIT 1
     FOR UPDATE`,
    [departmentId, financialYearId ?? null, budgetHeadId ?? null],
  );

  const provision = provRows[0];
  if (!provision) {
    // If no budget provision is set for this department/year, no budget limit is configured.
    return;
  }

  const allocated = Number(provision.allocated_amount);

  // 2. Sum utilized and committed spending from other requests (matching v_department_budget_summary)
  const { rows: sumRows } = await db.query(
    `SELECT
       COALESCE(SUM(CASE
         WHEN r.current_status IN ('APPROVED', 'PARTIALLY_APPROVED', 'FULFILMENT_PENDING', 'FULFILLED')
           THEN COALESCE(r.sanctioned_amount, r.tentative_total_cost)
         WHEN r.current_status IN ('SUBMITTED', 'UNDER_PURCHASE_COMMITTEE_REVIEW', 'UNDER_PRINCIPAL_REVIEW',
                                  'UNDER_CDC_REVIEW', 'UNDER_FINAL_AUTHORITY_REVIEW', 'AWAITING_RESUBMISSION')
           THEN r.tentative_total_cost
         ELSE 0
       END), 0) AS total_consumed
     FROM requests r
     WHERE r.department_id = $1
       AND r.financial_year_id = $2
       AND ($3::int IS NULL OR r.budget_head_id = $3::int)
       AND ($4::uuid IS NULL OR r.request_id <> $4::uuid)`,
    [
      provision.department_id,
      provision.financial_year_id,
      provision.budget_head_id,
      excludeRequestId,
    ],
  );

  const consumed = Math.round(Number(sumRows[0]?.total_consumed ?? 0) * 100) / 100;
  const evaluation = evaluateBudgetLimit({
    allocated,
    consumed,
    requested: numAmount,
  });

  if (evaluation.isExceeded) {
    throw new HttpError(
      422,
      `Department budget provision exceeded: requested amount ₹${numAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })} exceeds remaining available budget ₹${evaluation.remaining.toLocaleString('en-IN', { minimumFractionDigits: 2 })} (allocated: ₹${allocated.toLocaleString('en-IN', { minimumFractionDigits: 2 })}, already committed/utilized: ₹${consumed.toLocaleString('en-IN', { minimumFractionDigits: 2 })})`,
      {
        code: 'BUDGET_LIMIT_EXCEEDED',
        details: {
          allocatedAmount: allocated,
          consumedAmount: consumed,
          remainingAmount: evaluation.remaining,
          requestedAmount: numAmount,
          overrunAmount: evaluation.overrun,
        },
      },
    );
  }
}
