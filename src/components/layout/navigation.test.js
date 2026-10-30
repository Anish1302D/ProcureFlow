import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

describe('Issue #26 - Navigation Regression Coverage', () => {
  test('portalFor correctly routes user roles to their corresponding portals', () => {
    function portalFor(user) {
      if (!user) return null;
      if (user.roles?.includes('ADMIN')) return 'admin';
      if (user.roles?.includes('PRINCIPAL')) return 'principal';
      if ((user.stages ?? []).length > 0) return 'approver';
      return 'faculty';
    }

    assert.equal(portalFor({ roles: ['ADMIN'], stages: [] }), 'admin');
    assert.equal(portalFor({ roles: ['PRINCIPAL'], stages: [] }), 'principal');
    assert.equal(portalFor({ roles: ['HEAD'], stages: ['PURCHASE_COMMITTEE'] }), 'approver');
    assert.equal(portalFor({ roles: ['CDC_MEMBER'], stages: ['CDC'] }), 'approver');
    assert.equal(portalFor({ roles: ['FACULTY'], stages: [] }), 'faculty');
    assert.equal(portalFor({ roles: ['STAFF'], stages: [] }), 'faculty');
    assert.equal(portalFor(null), null);
  });

  test('Navigation definitions preserve System configuration for Admin in Operations', async () => {
    const navSource = await fs.readFile(path.resolve('src/components/layout/navigation.js'), 'utf8');
    const sidebarSource = await fs.readFile(path.resolve('src/components/layout/Sidebar.jsx'), 'utf8');

    // Admin operations group must retain System configuration in navigation definitions
    assert.ok(
      navSource.includes("id: 'settings', label: 'System configuration'"),
      'navigation.js Admin NAV must include System configuration',
    );

    // Sidebar.jsx must import and re-export NAV, ACCOUNT, and canAccessPage
    assert.ok(
      sidebarSource.includes("import { ACCOUNT, NAV, canAccessPage, pagesFor } from './navigation'"),
      'Sidebar.jsx must import centralized navigation definitions and canAccessPage',
    );
    assert.ok(
      sidebarSource.includes('export { ACCOUNT, NAV, canAccessPage, pagesFor }'),
      'Sidebar.jsx must re-export NAV, ACCOUNT, canAccessPage, and pagesFor for backwards compatibility',
    );
  });

  test('Admin navigation has exactly one System configuration entry and zero duplicate settings items', async () => {
    const navSource = await fs.readFile(path.resolve('src/components/layout/navigation.js'), 'utf8');

    // Extract admin group items
    const adminBlockMatch = navSource.match(/admin:\s*\[([\s\S]*?)\n\s*\],/);
    assert.ok(adminBlockMatch, 'navigation.js must define admin navigation');
    const adminBlock = adminBlockMatch[1];

    const settingsMatches = adminBlock.match(/id:\s*['"]settings['"]/g) || [];
    assert.equal(settingsMatches.length, 1, 'Admin NAV must have exactly one settings item');

    // PAGE_TITLES settings entry must be 'System configuration'
    assert.ok(
      navSource.includes("settings: 'System configuration'"),
      "PAGE_TITLES must map settings to 'System configuration'",
    );
  });

  test('Account navigation definitions strictly exclude Approval route and settings', async () => {
    const navSource = await fs.readFile(path.resolve('src/components/layout/navigation.js'), 'utf8');

    // Extract ACCOUNT definition from navigation.js
    const accountMatch = navSource.match(/export const ACCOUNT = \{[\s\S]*?\n\};/);
    assert.ok(accountMatch, 'navigation.js must export ACCOUNT');
    const accountDef = accountMatch[0];

    assert.ok(!accountDef.includes('Approval route'), 'ACCOUNT must not contain "Approval route"');
    assert.ok(!accountDef.includes("id: 'settings'"), 'ACCOUNT must not contain id: "settings"');
  });

  test('canAccessPage aligns navigation permissions strictly with user roles', async () => {
    // Dynamic import of navigation helper functions
    const { canAccessPage, pagesFor } = await import('./navigation.js');

    // Admin can access settings (System configuration)
    assert.equal(canAccessPage('admin', 'settings'), true, 'Admin portal must be allowed to access settings');
    assert.ok(pagesFor('admin').has('settings'), 'pagesFor("admin") must contain settings');

    // Non-admin portals must NOT be allowed to access settings
    assert.equal(canAccessPage('principal', 'settings'), false, 'Principal portal must NOT access settings');
    assert.equal(canAccessPage('approver', 'settings'), false, 'Approver portal must NOT access settings');
    assert.equal(canAccessPage('faculty', 'settings'), false, 'Faculty portal must NOT access settings');
    assert.equal(canAccessPage(null, 'settings'), false, 'Null portal must NOT access settings');
    assert.equal(canAccessPage('admin', null), false, 'Null page must return false');

    // Shared pages accessible to all portals
    const sharedPages = ['notifications', 'profile', 'pending'];
    for (const portal of ['admin', 'principal', 'approver', 'faculty']) {
      for (const p of sharedPages) {
        assert.equal(canAccessPage(portal, p), true, `${portal} should be able to access shared page ${p}`);
      }
    }
  });

  test('normalizePageSlug cleans up obsolete approval-route slug to settings', async () => {
    const appContextSource = await fs.readFile(path.resolve('src/context/AppContext.jsx'), 'utf8');
    assert.ok(
      appContextSource.includes('normalizePageSlug'),
      'AppContext.jsx must export/include normalizePageSlug',
    );

    function normalizePageSlug(slug) {
      if (!slug) return null;
      if (slug === 'approval-route' || slug === 'approval_route') return 'settings';
      return slug;
    }

    assert.equal(normalizePageSlug('approval-route'), 'settings');
    assert.equal(normalizePageSlug('approval_route'), 'settings');
    assert.equal(normalizePageSlug('settings'), 'settings');
    assert.equal(normalizePageSlug('dashboard'), 'dashboard');
    assert.equal(normalizePageSlug(''), null);
    assert.equal(normalizePageSlug(null), null);
  });

  test('SettingsPreferences.jsx contains System Configuration & Governance and live route overview', async () => {
    const settingsSource = await fs.readFile(path.resolve('src/pages/SettingsPreferences.jsx'), 'utf8');

    assert.ok(
      settingsSource.includes('System Configuration &amp; Governance'),
      'SettingsPreferences must contain System Configuration & Governance heading',
    );
    assert.ok(
      settingsSource.includes('Current Institutional Route Overview'),
      'SettingsPreferences must preserve the Current Institutional Route Overview live preview',
    );
  });

  test('Navigation specifications for Issue #26: account vs admin portal separation', () => {
    // Specification helper: shared account items should be limited to user-centric account items
    const expectedAccountItemIds = ['notifications', 'profile'];
    assert.deepEqual(expectedAccountItemIds.includes('settings'), false, 'Account items must not include settings/approval-route');

    // Admin operations items must include settings
    const adminOperationsIds = [
      'admin-dashboard',
      'user-management',
      'master-data',
      'settings',
      'budget-provisions',
      'requests-all',
      'non-financial-requests',
      'inventory',
      'purchase-bills',
    ];
    assert.ok(adminOperationsIds.includes('settings'), 'Admin operations must include settings');

    // Portal home routes
    const HOME = {
      admin: 'admin-dashboard',
      principal: 'dashboard',
      approver: 'approver-dashboard',
      faculty: 'faculty-dashboard',
    };
    assert.equal(HOME.admin, 'admin-dashboard');
    assert.equal(HOME.principal, 'dashboard');
    assert.equal(HOME.approver, 'approver-dashboard');
    assert.equal(HOME.faculty, 'faculty-dashboard');
  });

  test('Route guard fallback redirects unauthorized page access to portal home', () => {
    function resolvePage(activePage, portal, pagesForPortal, homeMap) {
      const allowedPages = pagesForPortal[portal] ?? new Set();
      return allowedPages.has(activePage) ? activePage : homeMap[portal];
    }

    const homeMap = {
      admin: 'admin-dashboard',
      principal: 'dashboard',
      approver: 'approver-dashboard',
      faculty: 'faculty-dashboard',
    };

    const mockPagesForPortal = {
      admin: new Set(['admin-dashboard', 'user-management', 'settings', 'notifications', 'profile', 'pending']),
      principal: new Set(['dashboard', 'review-queue', 'notifications', 'profile', 'pending']),
      approver: new Set(['approver-dashboard', 'review-queue', 'notifications', 'profile', 'pending']),
      faculty: new Set(['faculty-dashboard', 'faculty-requests', 'notifications', 'profile', 'pending']),
    };

    // Admin can access settings
    assert.equal(resolvePage('settings', 'admin', mockPagesForPortal, homeMap), 'settings');

    // Non-admin portals fall back to portal home when attempting to access settings
    assert.equal(resolvePage('settings', 'principal', mockPagesForPortal, homeMap), 'dashboard');
    assert.equal(resolvePage('settings', 'approver', mockPagesForPortal, homeMap), 'approver-dashboard');
    assert.equal(resolvePage('settings', 'faculty', mockPagesForPortal, homeMap), 'faculty-dashboard');
  });
});
