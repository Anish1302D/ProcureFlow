import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { canAccessPage, pagesFor } from '../components/layout/navigation.js';

describe('Issue #26 - System Configuration Route Accessibility', () => {
  test('Admin user has full access to System Configuration in pagesFor and canAccessPage', () => {
    assert.equal(canAccessPage('admin', 'settings'), true, 'Admin portal must have access to settings');
    assert.ok(pagesFor('admin').has('settings'), 'pagesFor("admin") must include settings');
  });

  test('All non-admin portals are rejected from accessing settings route', () => {
    const nonAdminPortals = ['principal', 'approver', 'faculty'];

    for (const portal of nonAdminPortals) {
      assert.equal(
        canAccessPage(portal, 'settings'),
        false,
        `Portal "${portal}" must NOT have access to settings`,
      );
      assert.equal(
        pagesFor(portal).has('settings'),
        false,
        `pagesFor("${portal}") must NOT contain settings`,
      );
    }
  });

  test('SettingsPreferences.jsx implements isAdmin role check and guards administrative APIs', async () => {
    const settingsSource = await fs.readFile(
      path.resolve('src/pages/SettingsPreferences.jsx'),
      'utf8',
    );

    // Verify role check
    assert.ok(
      settingsSource.includes("const isAdmin = user?.roles?.includes('ADMIN')"),
      'SettingsPreferences must check for ADMIN role',
    );

    // Verify admin config API guard
    assert.ok(
      settingsSource.includes('if (!isAdmin) return;'),
      'loadAdminConfigs must abort immediately for non-admin users',
    );

    // Verify admin tabs exist
    assert.ok(settingsSource.includes("activeTab === 'rules'"), 'Must contain rules tab');
    assert.ok(settingsSource.includes("activeTab === 'approvers'"), 'Must contain approvers tab');
    assert.ok(settingsSource.includes("activeTab === 'flags'"), 'Must contain flags tab');
    assert.ok(settingsSource.includes("activeTab === 'preview'"), 'Must contain preview tab');
  });

  test('SettingsPreferences.jsx preserves full workflow configuration and institutional controls for Admin', async () => {
    const settingsSource = await fs.readFile(
      path.resolve('src/pages/SettingsPreferences.jsx'),
      'utf8',
    );

    // Verify threshold inputs
    assert.ok(
      settingsSource.includes('principalMax'),
      'SettingsPreferences must manage Principal max threshold',
    );
    assert.ok(
      settingsSource.includes('cdcMax'),
      'SettingsPreferences must manage CDC max threshold',
    );
    assert.ok(
      settingsSource.includes('vcTitle'),
      'SettingsPreferences must manage Vice Chairman title',
    );

    // Verify save actions
    assert.ok(
      settingsSource.includes('saveThresholds'),
      'SettingsPreferences must have saveThresholds handler',
    );
    assert.ok(
      settingsSource.includes('saveFlagsAndMetadata'),
      'SettingsPreferences must have saveFlagsAndMetadata handler',
    );
  });
});
