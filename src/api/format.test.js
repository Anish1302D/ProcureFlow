import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROLE_LABELS, roleLabel, statusInfo } from './format.js';

test('format.js maps VICE_PRESIDENT role code to Vice Chairman display label', () => {
  assert.strictEqual(ROLE_LABELS.VICE_PRESIDENT, 'Vice Chairman');
  assert.strictEqual(roleLabel('VICE_PRESIDENT'), 'Vice Chairman');
});

test('format.js maps UNDER_FINAL_AUTHORITY_REVIEW to With Chairman & Vice Chairman', () => {
  const info = statusInfo('UNDER_FINAL_AUTHORITY_REVIEW', 'request');
  assert.strictEqual(info.label, 'With Chairman & Vice Chairman');
});
