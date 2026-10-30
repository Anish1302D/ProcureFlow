import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { NAV, PAGE_TITLES } from './navigation.js';

describe('Issue #26 - Desktop and Mobile Navigation Responsive Behavior', () => {
  test('Sidebar.jsx implements mobile drawer toggle, backdrop, and responsive classes', async () => {
    const sidebarSource = await fs.readFile(
      path.resolve('src/components/layout/Sidebar.jsx'),
      'utf8',
    );

    // Mobile backdrop only rendered when isOpen is true
    assert.ok(
      sidebarSource.includes('{isOpen && <div onClick={closeSidebar} className="fixed inset-0 bg-gray-900/30 z-40 lg:hidden backdrop-blur-sm" />}'),
      'Sidebar must render mobile backdrop with lg:hidden only when isOpen is true',
    );

    // Aside has responsive slide-in transitions
    assert.ok(
      sidebarSource.includes("isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'"),
      'Sidebar aside must slide off-screen on mobile when closed and remain visible on lg screens',
    );
  });

  test('Sidebar auto-closes on mobile when a navigation link is clicked', async () => {
    const sidebarSource = await fs.readFile(
      path.resolve('src/components/layout/Sidebar.jsx'),
      'utf8',
    );

    // Clicking an item invokes setActivePage and closes sidebar on viewports < 1024px
    assert.ok(
      sidebarSource.includes('if (window.innerWidth < 1024) closeSidebar()'),
      'Sidebar must auto-close on mobile viewports (< 1024px) when navigation item is clicked',
    );
  });

  test('Active navigation highlighting applies correctly to active items', async () => {
    const sidebarSource = await fs.readFile(
      path.resolve('src/components/layout/Sidebar.jsx'),
      'utf8',
    );

    // aria-current="page"
    assert.ok(
      sidebarSource.includes("aria-current={isActive ? 'page' : undefined}"),
      'Active item must have aria-current="page"',
    );

    // Indigo active styling
    assert.ok(
      sidebarSource.includes("isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'"),
      'Active item must apply indigo active background and text styling',
    );
  });

  test('Header.jsx provides mobile menu toggle button hidden on desktop', async () => {
    const headerSource = await fs.readFile(
      path.resolve('src/components/layout/Header.jsx'),
      'utf8',
    );

    // Toggle button with lg:hidden
    assert.ok(
      headerSource.includes('onClick={toggleSidebar} aria-label="Open menu"'),
      'Header must render toggleSidebar button with aria-label="Open menu"',
    );
    assert.ok(
      headerSource.includes('lg:hidden'),
      'Mobile menu toggle button must be hidden on desktop (lg:hidden)',
    );
  });

  test('Header dynamically reflects PAGE_TITLES including System configuration on mobile & desktop', () => {
    assert.equal(PAGE_TITLES['settings'], 'System configuration');
    assert.equal(PAGE_TITLES['admin-dashboard'], 'Dashboard');
    assert.equal(PAGE_TITLES['dashboard'], 'Overview');
    assert.equal(PAGE_TITLES['profile'], 'Profile');
    assert.equal(PAGE_TITLES['notifications'], 'Notifications');
  });

  test('Admin navigation groups render System configuration without redundant Approval route', () => {
    const adminGroups = NAV.admin;
    const allAdminItems = adminGroups.flatMap((g) => g.items);

    const settingsItem = allAdminItems.find((i) => i.id === 'settings');
    assert.ok(settingsItem, 'Admin navigation must include settings item');
    assert.equal(settingsItem.label, 'System configuration');

    const duplicateItems = allAdminItems.filter((i) => i.id === 'settings');
    assert.equal(duplicateItems.length, 1, 'Admin items must have exactly one settings entry');

    const approvalRouteItem = allAdminItems.find((i) => i.label === 'Approval route');
    assert.equal(approvalRouteItem, undefined, 'Admin items must not have any item labelled Approval route');
  });
});

