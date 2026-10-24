import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACCOUNT, NAV, accountNavFor, pagesFor } from './navigation.js';

describe('Issue #26: Remove Duplicate Approval Route Navigation', () => {
  it('omits redundant Approval Route tab from admin account navigation', () => {
    const adminAccountNav = accountNavFor('admin');
    const settingsItem = adminAccountNav.items.find((item) => item.id === 'settings');
    assert.equal(settingsItem, undefined, 'Admin account navigation must not contain settings (Approval route)');

    // Verify other account items (notifications, profile) are preserved
    const accountIds = adminAccountNav.items.map((item) => item.id);
    assert.deepEqual(accountIds, ['notifications', 'profile']);
  });

  it('preserves Approval Route tab in account navigation for non-admin portals', () => {
    for (const portal of ['principal', 'approver', 'faculty']) {
      const accountNav = accountNavFor(portal);
      const settingsItem = accountNav.items.find((item) => item.id === 'settings');
      assert.ok(settingsItem, `${portal} portal must retain Approval route in Account navigation`);
      assert.equal(settingsItem.label, 'Approval route');
    }
  });

  it('admin portal has exactly one settings navigation item across all groups (System configuration)', () => {
    const adminGroups = [...(NAV.admin ?? []), accountNavFor('admin')];
    const allAdminItems = adminGroups.flatMap((g) => g.items);
    const settingsItems = allAdminItems.filter((i) => i.id === 'settings');

    assert.equal(settingsItems.length, 1, 'Admin should have exactly 1 settings navigation entry');
    assert.equal(settingsItems[0].label, 'System configuration');

    const opsGroup = adminGroups.find((g) => g.title === 'Operations');
    assert.ok(
      opsGroup.items.some((i) => i.id === 'settings' && i.label === 'System configuration'),
      'System configuration must remain in Operations for admin',
    );
  });

  it('pagesFor includes settings for all portals to permit routing', () => {
    for (const portal of ['admin', 'principal', 'approver', 'faculty']) {
      const pages = pagesFor(portal);
      assert.ok(pages.has('settings'), `pagesFor('${portal}') must include 'settings'`);
    }
  });

  it('does not mutate the shared ACCOUNT object when serving admin', () => {
    accountNavFor('admin');
    assert.ok(ACCOUNT.items.some((i) => i.id === 'settings'), 'Global ACCOUNT must retain settings for other portals');
  });
});
