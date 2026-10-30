import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runTokenVersionMigrationTest } from '../scripts/verify-token-version-migration.js';

test('MIGRATION: token_version migration upgrades pre-existing database and is idempotent', async (t) => {
  const result = await runTokenVersionMigrationTest({ throwOnOffline: false });
  if (result?.skipped) {
    t.skip(`Skipping migration test against real database: ${result.reason}`);
    return;
  }
  assert.equal(result.success, true);
});
