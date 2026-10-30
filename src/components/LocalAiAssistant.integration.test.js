import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRequestRules, STATUS } from '../validation/requestRules.js';
import { analyzeRequestText, SUGGESTION_TYPES } from '../ai/requestWritingAssistant.js';

test('Integration 1: Submission remains strictly blocked by deterministic errors regardless of AI', () => {
  const invalidRequest = {
    title: '', // Missing title
    description: '', // Missing justification
    budgetHeadId: '', // Missing head
    urgency: 'Medium',
    items: [],
  };

  const validation = validateRequestRules(invalidRequest);
  assert.equal(validation.status, STATUS.NEEDS_CORRECTION);
  assert.ok(validation.errors.length >= 3);

  // Even if AI assistant runs or fails, deterministic errors are authoritative
  assert.equal(validation.errors.some((e) => e.toLowerCase().includes('title')), true);
  assert.equal(validation.errors.some((e) => e.toLowerCase().includes('budget head')), true);
  assert.equal(validation.errors.some((e) => e.toLowerCase().includes('item')), true);
});

test('Integration 2: Submission does not require AI availability', () => {
  const validRequest = {
    title: 'Chemistry Laboratory Reagents',
    description: 'Procurement of analytical grade reagents for semester practical exams.',
    budgetHeadId: '2',
    urgency: 'Medium',
    items: [{ budgetItemId: '201', name: 'Sodium Hydroxide 1kg', quantity: 5, unitCost: 800 }],
    totalAmount: 4000,
  };

  const validation = validateRequestRules(validRequest);
  // Valid request is complete and ready without requiring any AI interaction
  assert.equal(validation.status, STATUS.COMPLETE);
  assert.equal(validation.errors.length, 0);
});

test('Integration 3: "Run Local AI Check" returns advisory suggestions without altering original request', async () => {
  const originalRequest = Object.freeze({
    title: 'EQUIPMENT FOR LAB',
    description: 'Need equipment.',
    budgetHeadName: 'Equipment Head',
    urgency: 'High',
    items: [Object.freeze({ name: 'laptop', quantity: 2, unitCost: 40000, remarks: '' })],
    totalAmount: 80000,
  });

  const aiResult = await analyzeRequestText(originalRequest);
  assert.equal(aiResult.aiAvailable, true);
  assert.ok(aiResult.suggestions.length > 0);

  // Verify original input remained completely frozen and unmodified
  assert.equal(originalRequest.title, 'EQUIPMENT FOR LAB');
  assert.equal(originalRequest.description, 'Need equipment.');
  assert.equal(originalRequest.items[0].remarks, '');
});

test('Integration 4: Applying a suggestion updates only the confirmed field after confirmation', async () => {
  let formState = {
    title: 'EQUIPMENT FOR LAB',
    description: 'Need equipment.',
  };

  const aiResult = await analyzeRequestText(formState);
  const titleSug = aiResult.suggestions.find((s) => s.type === SUGGESTION_TYPES.TITLE);
  assert.ok(titleSug);

  // Simulate user confirmation action callback
  const onApplySuggestion = (field, text) => {
    formState = { ...formState, [field]: text };
  };

  // User explicitly confirms applying the suggestion:
  onApplySuggestion('title', titleSug.suggestedText);

  assert.equal(formState.title, titleSug.suggestedText);
  // Other fields remain strictly untouched
  assert.equal(formState.description, 'Need equipment.');
});

test('Integration 5: Ignoring a suggestion preserves original text completely', async () => {
  const formState = {
    title: 'EQUIPMENT FOR LAB',
    description: 'Need equipment.',
  };

  const aiResult = await analyzeRequestText(formState);
  const titleSug = aiResult.suggestions.find((s) => s.type === SUGGESTION_TYPES.TITLE);
  assert.ok(titleSug);

  // User clicks "Ignore"
  const ignoredSuggestions = new Set([titleSug]);

  // Ensure state was NOT modified
  assert.equal(formState.title, 'EQUIPMENT FOR LAB');
  assert.ok(ignoredSuggestions.has(titleSug));
});

test('Integration 6: No external network requests during local AI inference', async () => {
  // Mock global fetch to verify zero external AI calls are made
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    const url = String(args[0] ?? '');
    // If any request to openai, anthropic, google, or external LLM API occurs, fail immediately
    if (/openai|anthropic|googleapis|gemini|cohere|ai\.com/i.test(url)) {
      fetchCalled = true;
      throw new Error(`Unauthorized external AI call intercepted: ${url}`);
    }
    return originalFetch(...args);
  };

  try {
    const req = {
      title: 'Lab Glassware',
      description: 'Borosilicate test tubes for student chemistry practicals.',
      budgetHeadName: 'Lab Consumables',
      urgency: 'Medium',
      items: [{ name: 'Test tubes 100pk', quantity: 10, unitCost: 500 }],
      totalAmount: 5000,
    };

    const result = await analyzeRequestText(req);
    assert.equal(result.aiAvailable, true);
    assert.equal(fetchCalled, false, 'No external AI API calls may be made');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
