/**
 * Deterministic validation rules for ProcureFlow procurement requests.
 *
 * Rules are strictly deterministic, authoritatively gate submission,
 * and run entirely locally in the browser with zero external calls.
 */

export const RULE_CODES = Object.freeze({
  TITLE_REQUIRED: 'TITLE_REQUIRED',
  JUSTIFICATION_REQUIRED: 'JUSTIFICATION_REQUIRED',
  ITEMS_REQUIRED: 'ITEMS_REQUIRED',
  ITEM_DESCRIPTION_REQUIRED: 'ITEM_DESCRIPTION_REQUIRED',
  ITEM_QUANTITY_POSITIVE: 'ITEM_QUANTITY_POSITIVE',
  ITEM_UNIT_COST_POSITIVE: 'ITEM_UNIT_COST_POSITIVE',
  ARITHMETIC_INTEGRITY: 'ARITHMETIC_INTEGRITY',
  BUDGET_HEAD_REQUIRED: 'BUDGET_HEAD_REQUIRED',
  URGENCY_REQUIRED: 'URGENCY_REQUIRED',
  SUPPORTING_DOCUMENTS_REQUIRED: 'SUPPORTING_DOCUMENTS_REQUIRED',
  DUPLICATE_ITEMS: 'DUPLICATE_ITEMS',
});

export const STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',
  NEEDS_CORRECTION: 'NEEDS_CORRECTION',
  NEEDS_CLARIFICATION: 'NEEDS_CLARIFICATION',
});

/**
 * Calculates exact line item amount in paise to avoid IEEE-754 floating-point drift.
 * @param {number|string} quantity
 * @param {number|string} unitCost
 * @returns {number} Amount in paise (integer)
 */
export function calculateLinePaise(quantity, unitCost) {
  const qty = Number(quantity);
  const cost = Number(unitCost);
  if (!Number.isFinite(qty) || !Number.isFinite(cost) || qty <= 0 || cost <= 0) {
    return 0;
  }
  return Math.round(Math.round(qty * 100) * Math.round(cost * 100) / 100);
}

/**
 * Validates a procurement request against authoritative institutional rules.
 *
 * @param {object} request
 * @param {string} [request.title]
 * @param {string} [request.description]
 * @param {string|number} [request.budgetHeadId]
 * @param {string} [request.urgency]
 * @param {Array<object>} [request.items]
 * @param {Array<object>} [request.files]
 * @param {number} [request.totalAmount]
 * @param {object} [options]
 * @param {number} [options.minJustificationLength=15]
 * @param {number} [options.documentThreshold=50000]
 * @param {boolean} [options.requireDocsAboveThreshold=true]
 * @returns {object} Validation result
 */
export function validateRequestRules(request = {}, options = {}) {
  const {
    minJustificationLength = 15,
    documentThreshold = 50000,
    requireDocsAboveThreshold = true,
  } = options;

  const errors = [];
  const warnings = [];
  const deterministicChecks = [];

  const addCheck = (code, passed, message, isError = true) => {
    deterministicChecks.push({ code, passed, message });
    if (!passed) {
      if (isError) {
        errors.push(message);
      } else {
        warnings.push(message);
      }
    }
  };

  // 1. Title validation
  const title = String(request.title ?? '').trim();
  const titlePassed = title.length >= 3;
  addCheck(
    RULE_CODES.TITLE_REQUIRED,
    titlePassed,
    titlePassed ? 'Request title is valid.' : 'Request title is required (at least 3 characters).'
  );

  // 2. Justification length validation
  const justification = String(request.description ?? '').trim();
  if (justification.length === 0) {
    addCheck(
      RULE_CODES.JUSTIFICATION_REQUIRED,
      false,
      'Justification is required explaining why items are needed.'
    );
  } else if (justification.length < minJustificationLength) {
    addCheck(
      RULE_CODES.JUSTIFICATION_REQUIRED,
      false,
      `Justification is too brief (${justification.length}/${minJustificationLength} characters). Please detail the educational or operational need.`,
      false // Warning for short, error for empty
    );
  } else {
    addCheck(
      RULE_CODES.JUSTIFICATION_REQUIRED,
      true,
      'Justification length meets requirements.'
    );
  }

  // 3. Budget Head
  const budgetHeadId = String(request.budgetHeadId ?? '').trim();
  const headPassed = budgetHeadId.length > 0;
  addCheck(
    RULE_CODES.BUDGET_HEAD_REQUIRED,
    headPassed,
    headPassed ? 'Budget head is selected.' : 'Budget head must be selected.'
  );

  // 4. Urgency
  const urgency = String(request.urgency ?? '').trim();
  const urgencyPassed = urgency.length > 0;
  addCheck(
    RULE_CODES.URGENCY_REQUIRED,
    urgencyPassed,
    urgencyPassed ? 'Urgency level is selected.' : 'Urgency level must be specified.'
  );

  // 5. Items array presence
  const rawItems = Array.isArray(request.items) ? request.items : [];
  const items = rawItems.filter((i) => i && (i.budgetItemId || i.name || i.customItemName || i.quantity || i.unitCost));
  const hasItems = items.length > 0;
  addCheck(
    RULE_CODES.ITEMS_REQUIRED,
    hasItems,
    hasItems ? `Request contains ${items.length} item(s).` : 'At least one item line must be added.'
  );

  // 6. Item details & line arithmetic
  let sumPaise = 0;
  let allQuantitiesPositive = true;
  let allUnitCostsPositive = true;
  let allDescriptionsPresent = true;
  let arithmeticConsistent = true;

  const itemNamesSeen = new Set();
  let hasDuplicateItems = false;

  items.forEach((item, index) => {
    const lineNum = index + 1;
    const name = String(item.customItemName || item.name || '').trim();
    const itemId = String(item.budgetItemId ?? '').trim();

    // Item description
    if (!name && !itemId) {
      allDescriptionsPresent = false;
      errors.push(`Item ${lineNum}: Description or catalogue item selection is missing.`);
    }

    // Duplicate detection (by catalogue item ID or custom item name)
    const duplicateKey = itemId && itemId !== 'OTHER'
      ? `id:${itemId}`
      : `name:${name.toLowerCase()}`;

    if (duplicateKey && duplicateKey !== 'name:' && duplicateKey !== 'id:') {
      if (itemNamesSeen.has(duplicateKey)) {
        hasDuplicateItems = true;
      } else {
        itemNamesSeen.add(duplicateKey);
      }
    }

    // Quantity check
    const qty = Number(item.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      allQuantitiesPositive = false;
      errors.push(`Item ${lineNum}${name ? ` ("${name}")` : ''}: Quantity must be greater than zero.`);
    }

    // Unit cost check
    const cost = Number(item.unitCost);
    if (!Number.isFinite(cost) || cost <= 0) {
      allUnitCostsPositive = false;
      errors.push(`Item ${lineNum}${name ? ` ("${name}")` : ''}: Unit cost must be greater than ₹0.`);
    }

    // Line sum
    const linePaise = calculateLinePaise(item.quantity, item.unitCost);
    sumPaise += linePaise;

    // Check individual line arithmetic if provided
    if (item.lineTotal !== undefined && item.lineTotal !== null) {
      const expectedTotalPaise = linePaise;
      const reportedTotalPaise = Math.round(Number(item.lineTotal) * 100);
      if (Math.abs(expectedTotalPaise - reportedTotalPaise) > 1) {
        arithmeticConsistent = false;
      }
    }
  });

  if (hasItems) {
    addCheck(
      RULE_CODES.ITEM_DESCRIPTION_REQUIRED,
      allDescriptionsPresent,
      allDescriptionsPresent ? 'All item descriptions are present.' : 'Some items have missing descriptions.'
    );

    addCheck(
      RULE_CODES.ITEM_QUANTITY_POSITIVE,
      allQuantitiesPositive,
      allQuantitiesPositive ? 'All item quantities are positive.' : 'Item quantities must be positive numbers.'
    );

    addCheck(
      RULE_CODES.ITEM_UNIT_COST_POSITIVE,
      allUnitCostsPositive,
      allUnitCostsPositive ? 'All item unit costs are positive.' : 'Item unit costs must be greater than ₹0.'
    );

    addCheck(
      RULE_CODES.DUPLICATE_ITEMS,
      !hasDuplicateItems,
      hasDuplicateItems ? 'Duplicate items detected in request. Consolidate duplicate lines.' : 'No duplicate items detected.'
    );
  }

  // 7. Overall Arithmetic Check
  const calculatedTotal = sumPaise / 100;
  if (request.totalAmount !== undefined && request.totalAmount !== null && hasItems) {
    const reportedPaise = Math.round(Number(request.totalAmount) * 100);
    if (Math.abs(sumPaise - reportedPaise) > 1) {
      arithmeticConsistent = false;
    }
  }

  addCheck(
    RULE_CODES.ARITHMETIC_INTEGRITY,
    arithmeticConsistent,
    arithmeticConsistent ? 'Quantity and cost calculations are consistent.' : 'Item totals do not match quantity × unit cost arithmetic.'
  );

  // 8. Supporting documents threshold requirement
  const files = Array.isArray(request.files) ? request.files : [];
  const thresholdExceeded = calculatedTotal >= documentThreshold;
  const docsAttached = files.length > 0;

  if (requireDocsAboveThreshold && thresholdExceeded) {
    addCheck(
      RULE_CODES.SUPPORTING_DOCUMENTS_REQUIRED,
      docsAttached,
      docsAttached
        ? 'Supporting documents/quotations are attached.'
        : `Requests of ₹${documentThreshold.toLocaleString('en-IN')} or above require supporting quotations or documents.`,
      true // Error if above threshold without documents
    );
  } else {
    addCheck(
      RULE_CODES.SUPPORTING_DOCUMENTS_REQUIRED,
      true,
      docsAttached ? 'Supporting documents attached.' : 'No supporting documents required for this amount.'
    );
  }

  // Status calculation
  let status = STATUS.COMPLETE;
  if (errors.length > 0) {
    status = STATUS.NEEDS_CORRECTION;
  } else if (warnings.length > 0) {
    status = STATUS.NEEDS_CLARIFICATION;
  }

  return {
    status,
    errors,
    warnings,
    deterministicChecks,
    calculatedTotal,
    hasItems,
  };
}

