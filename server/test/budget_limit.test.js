import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateBudgetLimit, assertWithinBudgetLimit } from '../src/budgetLimit.js';
import { HttpError } from '../src/errors.js';

test('Issue #20: Department Budget Limit Enforcement and Concurrency Protection', async (t) => {
  await t.test('1. Core Budget Consumption Evaluation (evaluateBudgetLimit)', async (t) => {
    await t.test('within-budget request succeeds', () => {
      const res = evaluateBudgetLimit({
        allocated: 100000,
        consumed: 40000,
        requested: 30000,
      });
      assert.equal(res.allocated, 100000);
      assert.equal(res.consumed, 40000);
      assert.equal(res.remaining, 60000);
      assert.equal(res.requested, 30000);
      assert.equal(res.isExceeded, false);
      assert.equal(res.overrun, 0);
    });

    await t.test('exact-limit request succeeds (boundary condition)', () => {
      const res = evaluateBudgetLimit({
        allocated: 100000,
        consumed: 40000,
        requested: 60000,
      });
      assert.equal(res.remaining, 60000);
      assert.equal(res.requested, 60000);
      assert.equal(res.isExceeded, false);
      assert.equal(res.overrun, 0);
    });

    await t.test('over-budget request is detected with correct overrun amount', () => {
      const res = evaluateBudgetLimit({
        allocated: 100000,
        consumed: 40000,
        requested: 60001,
      });
      assert.equal(res.remaining, 60000);
      assert.equal(res.requested, 60001);
      assert.equal(res.isExceeded, true);
      assert.equal(res.overrun, 1);
    });

    await t.test('handles fractional currency and float precision correctly', () => {
      const res = evaluateBudgetLimit({
        allocated: 100000.50,
        consumed: 50000.25,
        requested: 50000.25,
      });
      assert.equal(res.remaining, 50000.25);
      assert.equal(res.isExceeded, false);
    });

    await t.test('rejects negative requested amount', () => {
      assert.throws(
        () => evaluateBudgetLimit({ allocated: 100000, consumed: 0, requested: -500 }),
        /Invalid requested amount/,
      );
    });

    await t.test('rejects non-finite monetary values', () => {
      assert.throws(
        () => evaluateBudgetLimit({ allocated: 100000, consumed: 0, requested: NaN }),
        /Invalid requested amount/,
      );
      assert.throws(
        () => evaluateBudgetLimit({ allocated: 100000, consumed: 0, requested: Infinity }),
        /Invalid requested amount/,
      );
    });
  });

  await t.test('2. Server-side assertWithinBudgetLimit with Database Mock', async (t) => {
    await t.test('allows request within available remaining budget', async () => {
      const mockDb = {
        async query(sql, params) {
          if (sql.includes('FROM budget_provisions')) {
            assert.match(sql, /FOR UPDATE/, 'Must lock budget_provisions FOR UPDATE');
            return {
              rows: [{
                budget_provision_id: '11111111-1111-1111-1111-111111111111',
                allocated_amount: '100000.00',
                department_id: 1,
                financial_year_id: 1,
                budget_head_id: 2,
              }],
            };
          }
          if (sql.includes('FROM requests r')) {
            return { rows: [{ total_consumed: '40000.00' }] };
          }
          return { rows: [] };
        },
      };

      // 50,000 requested against 60,000 remaining (100,000 allocated - 40,000 consumed)
      await assert.doesNotReject(async () => {
        await assertWithinBudgetLimit(mockDb, {
          departmentId: 1,
          financialYearId: 1,
          budgetHeadId: 2,
          amount: 50000,
        });
      });
    });

    await t.test('allows request exactly matching remaining budget', async () => {
      const mockDb = {
        async query(sql) {
          if (sql.includes('FROM budget_provisions')) {
            return {
              rows: [{
                budget_provision_id: '11111111-1111-1111-1111-111111111111',
                allocated_amount: '100000.00',
                department_id: 1,
                financial_year_id: 1,
                budget_head_id: null,
              }],
            };
          }
          if (sql.includes('FROM requests r')) {
            return { rows: [{ total_consumed: '75000.00' }] };
          }
          return { rows: [] };
        },
      };

      // Exactly 25,000 requested against 25,000 remaining
      await assert.doesNotReject(async () => {
        await assertWithinBudgetLimit(mockDb, {
          departmentId: 1,
          amount: 25000,
        });
      });
    });

    await t.test('rejects request exceeding remaining budget with 422 BUDGET_LIMIT_EXCEEDED', async () => {
      const mockDb = {
        async query(sql) {
          if (sql.includes('FROM budget_provisions')) {
            return {
              rows: [{
                budget_provision_id: '11111111-1111-1111-1111-111111111111',
                allocated_amount: '100000.00',
                department_id: 1,
                financial_year_id: 1,
                budget_head_id: null,
              }],
            };
          }
          if (sql.includes('FROM requests r')) {
            return { rows: [{ total_consumed: '85000.00' }] };
          }
          return { rows: [] };
        },
      };

      // 20,000 requested against 15,000 remaining
      await assert.rejects(
        async () => {
          await assertWithinBudgetLimit(mockDb, {
            departmentId: 1,
            amount: 20000,
          });
        },
        (err) => {
          assert.ok(err instanceof HttpError);
          assert.equal(err.status, 422);
          assert.equal(err.code, 'BUDGET_LIMIT_EXCEEDED');
          assert.match(err.message, /Department budget provision exceeded/);
          assert.equal(err.details.allocatedAmount, 100000);
          assert.equal(err.details.consumedAmount, 85000);
          assert.equal(err.details.remainingAmount, 15000);
          assert.equal(err.details.requestedAmount, 20000);
          assert.equal(err.details.overrunAmount, 5000);
          return true;
        },
      );
    });

    await t.test('excludes resubmitted request from its own previous committed total', async () => {
      let excludedParam = null;
      const targetRequestId = '99999999-9999-9999-9999-999999999999';

      const mockDb = {
        async query(sql, params) {
          if (sql.includes('FROM budget_provisions')) {
            return {
              rows: [{
                budget_provision_id: '11111111-1111-1111-1111-111111111111',
                allocated_amount: '100000.00',
                department_id: 1,
                financial_year_id: 1,
                budget_head_id: null,
              }],
            };
          }
          if (sql.includes('FROM requests r')) {
            excludedParam = params[3];
            return { rows: [{ total_consumed: '70000.00' }] };
          }
          return { rows: [] };
        },
      };

      await assertWithinBudgetLimit(mockDb, {
        departmentId: 1,
        amount: 30000,
        excludeRequestId: targetRequestId,
      });

      assert.equal(excludedParam, targetRequestId, 'excludeRequestId must be passed to consumed query');
    });

    await t.test('passes gracefully if no department budget provision is configured', async () => {
      const mockDb = {
        async query() {
          return { rows: [] }; // No provision row
        },
      };

      await assert.doesNotReject(async () => {
        await assertWithinBudgetLimit(mockDb, {
          departmentId: 99,
          amount: 500000,
        });
      });
    });
  });

  await t.test('3. Concurrency Protection & Race Condition Simulation', async (t) => {
    // Simulate shared state representing a department budget of 50,000 with 0 initial consumed
    let provisionLocked = false;
    let committedInDb = 0;
    const allocatedBudget = 50000;

    const createTransactionDb = () => ({
      async query(sql) {
        if (sql.includes('FROM budget_provisions') && sql.includes('FOR UPDATE')) {
          // Simulate acquiring row lock: if already locked by another concurrent tx, wait
          while (provisionLocked) {
            await new Promise((r) => setTimeout(r, 10));
          }
          provisionLocked = true;
          return {
            rows: [{
              budget_provision_id: 'bp-concurrency-test',
              allocated_amount: String(allocatedBudget),
              department_id: 5,
              financial_year_id: 1,
              budget_head_id: null,
            }],
          };
        }
        if (sql.includes('FROM requests r')) {
          return { rows: [{ total_consumed: String(committedInDb) }] };
        }
        return { rows: [] };
      },
      releaseLock() {
        provisionLocked = false;
      },
    });

    // Request 1 and Request 2 both attempt to submit for 35,000 simultaneously.
    // Total needed = 70,000, which exceeds the 50,000 budget.
    // Concurrency serialization must guarantee that only ONE can succeed, and the other must fail!
    const tx1 = createTransactionDb();
    const tx2 = createTransactionDb();

    let tx1Result = null;
    let tx2Result = null;

    const runTx1 = async () => {
      try {
        await assertWithinBudgetLimit(tx1, {
          departmentId: 5,
          amount: 35000,
        });
        // Simulate committing Request 1
        committedInDb += 35000;
        tx1Result = 'SUCCESS';
      } catch (err) {
        tx1Result = err.code;
      } finally {
        tx1.releaseLock();
      }
    };

    const runTx2 = async () => {
      try {
        await assertWithinBudgetLimit(tx2, {
          departmentId: 5,
          amount: 35000,
        });
        // Simulate committing Request 2
        committedInDb += 35000;
        tx2Result = 'SUCCESS';
      } catch (err) {
        tx2Result = err.code;
      } finally {
        tx2.releaseLock();
      }
    };

    // Run both transactions concurrently
    await Promise.all([runTx1(), runTx2()]);

    assert.ok(
      (tx1Result === 'SUCCESS' && tx2Result === 'BUDGET_LIMIT_EXCEEDED') ||
      (tx2Result === 'SUCCESS' && tx1Result === 'BUDGET_LIMIT_EXCEEDED'),
      `Exactly one transaction must succeed and one must be rejected. Results: tx1=${tx1Result}, tx2=${tx2Result}`,
    );
    assert.equal(committedInDb, 35000, 'Committed total in DB must not exceed allocated budget');
  });
});
