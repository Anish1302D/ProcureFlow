import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ACCOUNT,
  NAV,
  PAGE_TITLES,
  canAccessPage,
  pagesFor,
} from './navigation.js';

describe('Issue #26 - End-to-End Regression & Integration Suite', () => {
  test('Complete portal navigation inventory verifies isolated System configuration', () => {
    // 1. Admin Portal
    const adminPages = pagesFor('admin');
    assert.ok(adminPages.has('settings'), 'Admin must have access to settings');
    assert.ok(adminPages.has('admin-dashboard'), 'Admin must have access to dashboard');
    assert.ok(adminPages.has('user-management'), 'Admin must have access to user management');

    // 2. Principal Portal
    const principalPages = pagesFor('principal');
    assert.equal(principalPages.has('settings'), false, 'Principal must not have access to settings');
    assert.ok(principalPages.has('dashboard'), 'Principal must have access to overview');
    assert.ok(principalPages.has('review-queue'), 'Principal must have access to review queue');

    // 3. Approver Portal
    const approverPages = pagesFor('approver');
    assert.equal(approverPages.has('settings'), false, 'Approver must not have access to settings');
    assert.ok(approverPages.has('approver-dashboard'), 'Approver must have access to approver dashboard');

    // 4. Faculty Portal
    const facultyPages = pagesFor('faculty');
    assert.equal(facultyPages.has('settings'), false, 'Faculty must not have access to settings');
    assert.ok(facultyPages.has('faculty-dashboard'), 'Faculty must have access to faculty dashboard');
  });

  test('Shared Account navigation group contains only notifications and profile', () => {
    assert.equal(ACCOUNT.title, 'Account');
    assert.equal(ACCOUNT.items.length, 2, 'Account must have exactly two items');

    const itemIds = ACCOUNT.items.map((i) => i.id);
    assert.deepEqual(itemIds, ['notifications', 'profile']);

    const settingsItem = ACCOUNT.items.find((i) => i.id === 'settings');
    assert.equal(settingsItem, undefined, 'Account must not include settings');

    const approvalRouteItem = ACCOUNT.items.find((i) => i.label?.toLowerCase().includes('approval route'));
    assert.equal(approvalRouteItem, undefined, 'Account must not include Approval route');
  });

  test('PAGE_TITLES accurately mirrors System configuration for settings route', () => {
    assert.equal(PAGE_TITLES.settings, 'System configuration');
    assert.equal(PAGE_TITLES['approval-route'], 'System configuration');
  });

  test('Route authorization matrix: canAccessPage correctly enforces portal boundaries', () => {
    // Portals that can access settings
    const portals = ['admin', 'principal', 'approver', 'faculty'];

    for (const portal of portals) {
      const allowed = canAccessPage(portal, 'settings');
      if (portal === 'admin') {
        assert.equal(allowed, true, 'Admin portal must be allowed to access settings');
      } else {
        assert.equal(allowed, false, `${portal} portal must NOT be allowed to access settings`);
      }
    }
  });

  test('Admin navigation groups contain exactly one Settings item with correct label', () => {
    const adminGroups = NAV.admin;
    const allAdminItems = adminGroups.flatMap((g) => g.items);

    const settingsItems = allAdminItems.filter((i) => i.id === 'settings');
    assert.equal(settingsItems.length, 1, 'Admin NAV must have exactly one settings item');
    assert.equal(settingsItems[0].label, 'System configuration');
    assert.ok(settingsItems[0].icon, 'Settings item must have an icon configured');
  });
});

