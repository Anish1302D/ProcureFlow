import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRequestRules, RULE_CODES, STATUS, calculateLinePaise } from './requestRules.js';

const validRequest = {
  title: 'Physics Lab Laser Optics Replacement',
  description: 'Procurement of helium-neon lasers for undergraduate advanced optics experiments.',
  budgetHeadId: '1',
  urgency: 'Medium',
  items: [
    {
      budgetItemId: '101',
      name: 'He-Ne Laser 632.8nm',
      quantity: 2,
      unitCost: 15000,
    },
    {
      budgetItemId: '102',
      name: 'Optical Bench Mounts',
      quantity: 4,
      unitCost: 2500,
    },
  ],
  files: [{ name: 'quotation_laser_corp.pdf', size: 102400 }],
  totalAmount: 40000,
};

test('1. Valid request passes all checks with status COMPLETE', () => {
  const result = validateRequestRules(validRequest);
  assert.equal(result.status, STATUS.COMPLETE);
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.calculatedTotal, 40000);
});

test('2. Empty or missing title fails TITLE_REQUIRED check', () => {
  const req = { ...validRequest, title: '  ' };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const titleCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.TITLE_REQUIRED);
  assert.equal(titleCheck.passed, false);
  assert.ok(result.errors.some((e) => e.toLowerCase().includes('title')));
});

test('3. Short justification produces warning and NEEDS_CLARIFICATION status', () => {
  const req = { ...validRequest, description: 'Short note' };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CLARIFICATION);
  const justCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.JUSTIFICATION_REQUIRED);
  assert.equal(justCheck.passed, false);
  assert.ok(result.warnings.some((w) => w.toLowerCase().includes('brief')));
});

test('4. Empty justification produces error and NEEDS_CORRECTION status', () => {
  const req = { ...validRequest, description: '' };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const justCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.JUSTIFICATION_REQUIRED);
  assert.equal(justCheck.passed, false);
  assert.ok(result.errors.some((e) => e.toLowerCase().includes('justification')));
});

test('5. Missing or empty items list fails ITEMS_REQUIRED check', () => {
  const req = { ...validRequest, items: [] };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const itemCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.ITEMS_REQUIRED);
  assert.equal(itemCheck.passed, false);
});

test('6. Missing item description fails ITEM_DESCRIPTION_REQUIRED check', () => {
  const req = {
    ...validRequest,
    items: [{ budgetItemId: '', name: '', quantity: 2, unitCost: 100 }],
  };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const descCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.ITEM_DESCRIPTION_REQUIRED);
  assert.equal(descCheck.passed, false);
});

test('7. Zero quantity fails ITEM_QUANTITY_POSITIVE check', () => {
  const req = {
    ...validRequest,
    items: [{ budgetItemId: '101', name: 'Lens', quantity: 0, unitCost: 1000 }],
  };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const qtyCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.ITEM_QUANTITY_POSITIVE);
  assert.equal(qtyCheck.passed, false);
});

test('8. Negative quantity fails ITEM_QUANTITY_POSITIVE check', () => {
  const req = {
    ...validRequest,
    items: [{ budgetItemId: '101', name: 'Lens', quantity: -5, unitCost: 1000 }],
  };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const qtyCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.ITEM_QUANTITY_POSITIVE);
  assert.equal(qtyCheck.passed, false);
});

test('9. Zero unit cost fails ITEM_UNIT_COST_POSITIVE check', () => {
  const req = {
    ...validRequest,
    items: [{ budgetItemId: '101', name: 'Lens', quantity: 2, unitCost: 0 }],
  };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const costCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.ITEM_UNIT_COST_POSITIVE);
  assert.equal(costCheck.passed, false);
});

test('10. Negative unit cost fails ITEM_UNIT_COST_POSITIVE check', () => {
  const req = {
    ...validRequest,
    items: [{ budgetItemId: '101', name: 'Lens', quantity: 2, unitCost: -50 }],
  };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const costCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.ITEM_UNIT_COST_POSITIVE);
  assert.equal(costCheck.passed, false);
});

test('11. Quantity and amount mismatch fails ARITHMETIC_INTEGRITY check', () => {
  const req = {
    ...validRequest,
    items: [{ budgetItemId: '101', name: 'Lens', quantity: 2, unitCost: 1000 }],
    totalAmount: 5000, // Expected 2000
  };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const arithCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.ARITHMETIC_INTEGRITY);
  assert.equal(arithCheck.passed, false);
});

test('12. Missing budget head fails BUDGET_HEAD_REQUIRED check', () => {
  const req = { ...validRequest, budgetHeadId: '' };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const headCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.BUDGET_HEAD_REQUIRED);
  assert.equal(headCheck.passed, false);
});

test('13. Missing urgency fails URGENCY_REQUIRED check', () => {
  const req = { ...validRequest, urgency: '' };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const urgCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.URGENCY_REQUIRED);
  assert.equal(urgCheck.passed, false);
});

test('14. Duplicate item names inside same request fails DUPLICATE_ITEMS check', () => {
  const req = {
    ...validRequest,
    items: [
      { budgetItemId: '101', name: 'Oscilloscope', quantity: 1, unitCost: 20000 },
      { budgetItemId: '101', name: 'Oscilloscope', quantity: 2, unitCost: 20000 },
    ],
    totalAmount: 60000,
    files: [{ name: 'quote.pdf' }],
  };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const dupCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.DUPLICATE_ITEMS);
  assert.equal(dupCheck.passed, false);
});

test('15. Requests >= ₹50,000 without documents fail SUPPORTING_DOCUMENTS_REQUIRED', () => {
  const req = {
    ...validRequest,
    items: [{ budgetItemId: '101', name: 'High-end Spectrometer', quantity: 1, unitCost: 75000 }],
    files: [], // No documents
    totalAmount: 75000,
  };
  const result = validateRequestRules(req);
  assert.equal(result.status, STATUS.NEEDS_CORRECTION);
  const docCheck = result.deterministicChecks.find((c) => c.code === RULE_CODES.SUPPORTING_DOCUMENTS_REQUIRED);
  assert.equal(docCheck.passed, false);
});

test('16. calculateLinePaise accurately calculates integers without floating drift', () => {
  assert.equal(calculateLinePaise(3, 19.99), 5997);
  assert.equal(calculateLinePaise('2', '50.50'), 10100);
  assert.equal(calculateLinePaise(-1, 50), 0);
  assert.equal(calculateLinePaise(1, 'abc'), 0);
});

