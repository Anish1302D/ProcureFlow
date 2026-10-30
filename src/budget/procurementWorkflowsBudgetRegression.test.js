import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  calculateRemainingBudget,
  computeRequestAccountingImpact,
} from '../../server/src/budgetService.js';

describe('Issue #20 - Procurement Workflows & Budget Regression Integrity', () => {
  // Pure logic mirror of actionsAt from requests.js & fn_record_action
  function evaluateActionsAt({ stageCode, isFinalStage, amount, principalMax = 25000, cdcMax = 250000 }) {
    if (stageCode === 'PURCHASE_COMMITTEE') {
      return ['ESCALATE', 'RETURN', 'REJECT'];
    }
    if (stageCode === 'PRINCIPAL') {
      return amount <= principalMax
        ? ['APPROVE', 'PARTIAL_APPROVE', 'REJECT', 'RETURN']
        : ['ESCALATE', 'REJECT', 'RETURN'];
    }
    if (stageCode === 'CDC') {
      return amount <= cdcMax
        ? ['APPROVE', 'PARTIAL_APPROVE', 'REJECT']
        : ['ESCALATE', 'REJECT'];
    }
    if (stageCode === 'FINAL_AUTHORITY' || isFinalStage) {
      return ['APPROVE', 'PARTIAL_APPROVE', 'REJECT'];
    }
    return [];
  }

  test('Purchase Committee stage permissions remain unchanged', () => {
    // Purchase committee verifies and escalates/returns/rejects, never final approve
    const smallAmountActions = evaluateActionsAt({ stageCode: 'PURCHASE_COMMITTEE', isFinalStage: false, amount: 15000 });
    assert.deepEqual(smallAmountActions, ['ESCALATE', 'RETURN', 'REJECT']);

    const largeAmountActions = evaluateActionsAt({ stageCode: 'PURCHASE_COMMITTEE', isFinalStage: false, amount: 500000 });
    assert.deepEqual(largeAmountActions, ['ESCALATE', 'RETURN', 'REJECT']);
  });

  test('Principal stage authority respects configured monetary thresholds', () => {
    // Under principal threshold (<= 25,000 default): can decide
    const underThresholdActions = evaluateActionsAt({ stageCode: 'PRINCIPAL', isFinalStage: false, amount: 20000 });
    assert.ok(underThresholdActions.includes('APPROVE'));
    assert.ok(underThresholdActions.includes('PARTIAL_APPROVE'));
    assert.ok(underThresholdActions.includes('REJECT'));
    assert.ok(underThresholdActions.includes('RETURN'));
    assert.ok(!underThresholdActions.includes('ESCALATE'));

    // Above principal threshold (> 25,000 default): must escalate to CDC / Chairman
    const overThresholdActions = evaluateActionsAt({ stageCode: 'PRINCIPAL', isFinalStage: false, amount: 75000 });
    assert.ok(overThresholdActions.includes('ESCALATE'));
    assert.ok(!overThresholdActions.includes('APPROVE'));
    assert.ok(overThresholdActions.includes('REJECT'));
    assert.ok(overThresholdActions.includes('RETURN'));
  });

  test('CDC and Final Authority review stages remain untouched', () => {
    // CDC stage below cdcMax can approve
    const cdcActions = evaluateActionsAt({ stageCode: 'CDC', isFinalStage: false, amount: 100000 });
    assert.ok(cdcActions.includes('APPROVE'));

    // Final Authority stage (above cdcMax) decides joint Chairman/Vice Chairman
    const finalActions = evaluateActionsAt({ stageCode: 'FINAL_AUTHORITY', isFinalStage: true, amount: 600000 });
    assert.ok(finalActions.includes('APPROVE'));
    assert.ok(finalActions.includes('PARTIAL_APPROVE'));
    assert.ok(finalActions.includes('REJECT'));
  });

  test('Partial approval accounting releases unapproved amount back to department budget', () => {
    // Department has 5,00,000 allocated.
    // Request for 2,00,000 was committed.
    const inFlightStats = {
      utilizedAmount: 0.0,
      committedAmount: 200000.0,
    };
    const beforeDecision = calculateRemainingBudget(500000.0, inFlightStats);
    assert.equal(beforeDecision.remainingAmount, 300000.0);

    // Approver approves items totaling 1,40,000 and cuts 60,000.
    // Request transitions to PARTIALLY_APPROVED with sanctionedAmount = 140,000.
    const approvedImpact = computeRequestAccountingImpact({
      status: 'PARTIALLY_APPROVED',
      sanctionedAmount: 140000.0,
      tentativeTotalCost: 200000.0,
    });
    assert.equal(approvedImpact.type, 'UTILIZED');
    assert.equal(approvedImpact.effectiveAmount, 140000.0);

    // After decision: utilized = 140,000, committed = 0
    const afterDecisionStats = {
      utilizedAmount: 140000.0,
      committedAmount: 0.0,
    };
    const afterDecision = calculateRemainingBudget(500000.0, afterDecisionStats);
    // Remaining budget is 5,00,000 - 1,40,000 = 3,60,000 (the 60,000 cut is released!)
    assert.equal(afterDecision.remainingAmount, 360000.0);
  });

  test('Carry forward releases committed balance in original financial year', () => {
    // Request carried forward to next financial year
    const impact = computeRequestAccountingImpact({
      status: 'CARRIED_FORWARD',
      tentativeTotalCost: 80000.0,
    });
    assert.equal(impact.type, 'RELEASED');
    assert.equal(impact.isReleased, true);
    assert.equal(impact.effectiveAmount, 0.0);
  });
});
