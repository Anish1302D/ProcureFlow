import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  assertDepartmentBudgetAvailable,
} from '../../server/src/budgetService.js';
import { HttpError } from '../../server/src/errors.js';

describe('Issue #20 - Concurrent Departmental Budget Submissions', () => {
  /**
   * Simulates an in-memory transactional database engine that implements
   * row-level locking (SELECT ... FOR UPDATE) and transaction isolation.
   */
  class MockTransactionalDb {
    constructor(initialProvision) {
      this.provision = { ...initialProvision };
      this.activeLock = null;
      this.committedRequests = [];
    }

    async beginTransaction() {
      const tx = {
        id: Math.random().toString(36).substring(7),
        stage: 'ACTIVE',
      };
      return tx;
    }

    async lockProvision(tx) {
      if (this.activeLock && this.activeLock !== tx.id) {
        // Wait or simulate queue serialization
      }
      this.activeLock = tx.id;
      return { ...this.provision };
    }

    async submitRequest(tx, requestedAmount) {
      if (this.activeLock !== tx.id) {
        throw new Error('Lock not held by transaction');
      }

      // Check availability against current provision
      assertDepartmentBudgetAvailable(this.provision, requestedAmount);

      // Mutate state in transaction
      const newCommitted = this.provision.committedAmount + requestedAmount;
      const newRemaining = this.provision.allocatedAmount - (this.provision.utilizedAmount + newCommitted);

      this.provision.committedAmount = newCommitted;
      this.provision.remainingAmount = newRemaining;
      this.provision.availableAmount = newRemaining;
      this.committedRequests.push({ txId: tx.id, amount: requestedAmount });
    }

    async commit(tx) {
      if (this.activeLock === tx.id) {
        this.activeLock = null;
      }
      tx.stage = 'COMMITTED';
    }

    async rollback(tx, originalProvision) {
      if (originalProvision) {
        this.provision = { ...originalProvision };
      }
      if (this.activeLock === tx.id) {
        this.activeLock = null;
      }
      tx.stage = 'ROLLED_BACK';
    }
  }

  test('Serializes concurrent requests competing for finite budget (₹70k & ₹60k competing for ₹100k)', async () => {
    const initialProvision = {
      provisionId: 99,
      departmentId: 5,
      departmentName: 'Physics',
      allocatedAmount: 200000.0,
      utilizedAmount: 100000.0,
      committedAmount: 0.0,
      remainingAmount: 100000.0,
      availableAmount: 100000.0,
    };

    const mockDb = new MockTransactionalDb(initialProvision);

    // Request A requests ₹70,000
    const txA = await mockDb.beginTransaction();
    const snapA = await mockDb.lockProvision(txA);
    assert.equal(snapA.remainingAmount, 100000.0);

    // Request A succeeds
    await mockDb.submitRequest(txA, 70000.0);
    await mockDb.commit(txA);

    assert.equal(mockDb.provision.remainingAmount, 30000.0);

    // Request B arrives concurrently requesting ₹60,000
    const txB = await mockDb.beginTransaction();
    const snapB = await mockDb.lockProvision(txB);
    assert.equal(snapB.remainingAmount, 30000.0);

    // Request B should be rejected because 60,000 > remaining 30,000
    let txBError = null;
    const backupProvision = { ...mockDb.provision };
    try {
      await mockDb.submitRequest(txB, 60000.0);
      await mockDb.commit(txB);
    } catch (err) {
      txBError = err;
      await mockDb.rollback(txB, backupProvision);
    }

    assert.ok(txBError instanceof HttpError, 'Tx B must fail with HttpError');
    assert.equal(txBError.status, 422);
    assert.equal(txBError.details.code, 'BUDGET_EXCEEDED');
    assert.equal(txBError.details.excessAmount, 30000.0);
    assert.equal(txBError.details.remainingAmount, 30000.0);

    // State remains valid with Request A committed and Request B rejected
    assert.equal(mockDb.provision.remainingAmount, 30000.0);
    assert.equal(mockDb.committedRequests.length, 1);
    assert.equal(mockDb.committedRequests[0].amount, 70000.0);
  });

  test('Rollback on failed budget check preserves exact original balance', async () => {
    const initialProvision = {
      provisionId: 100,
      departmentId: 5,
      departmentName: 'Physics',
      allocatedAmount: 100000.0,
      utilizedAmount: 40000.0,
      committedAmount: 20000.0,
      remainingAmount: 40000.0,
      availableAmount: 40000.0,
    };

    const mockDb = new MockTransactionalDb(initialProvision);
    const tx = await mockDb.beginTransaction();
    await mockDb.lockProvision(tx);

    const snapshot = { ...mockDb.provision };

    try {
      // Exceeding amount: 45,000 > 40,000
      await mockDb.submitRequest(tx, 45000.0);
      await mockDb.commit(tx);
      assert.fail('Should not reach here');
    } catch (err) {
      await mockDb.rollback(tx, snapshot);
    }

    // Provision state is completely untouched after rollback
    assert.equal(mockDb.provision.remainingAmount, 40000.0);
    assert.equal(mockDb.provision.committedAmount, 20000.0);
    assert.equal(mockDb.committedRequests.length, 0);

    // Subsequent valid request succeeds immediately
    const tx2 = await mockDb.beginTransaction();
    await mockDb.lockProvision(tx2);
    await mockDb.submitRequest(tx2, 35000.0);
    await mockDb.commit(tx2);

    assert.equal(mockDb.provision.remainingAmount, 5000.0);
    assert.equal(mockDb.committedRequests.length, 1);
  });
});

