import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Issue #25 - Admin Viewing & Monitoring Capabilities Preserved', () => {
  const sidebarPath = path.resolve('src/components/layout/Sidebar.jsx');
  const sidebarCode = fs.readFileSync(sidebarPath, 'utf8');

  test('Admin sidebar navigation preserves All requests and Faculty issues links', () => {
    assert.ok(
      sidebarCode.includes("id: 'requests-all'") && sidebarCode.includes("label: 'All requests'"),
      'Sidebar NAV.admin must preserve All requests link'
    );
    assert.ok(
      sidebarCode.includes("id: 'non-financial-requests'") && sidebarCode.includes("label: 'Faculty issues'"),
      'Sidebar NAV.admin must preserve Faculty issues link'
    );
  });

  test('Admin sidebar navigation preserves full suite of administrative modules', () => {
    const expectedModules = [
      'admin-dashboard',
      'user-management',
      'master-data',
      'settings',
      'budget-provisions',
      'requests-all',
      'non-financial-requests',
      'inventory',
      'purchase-bills',
      'reports',
      'exports',
      'audit-history',
    ];

    for (const mod of expectedModules) {
      assert.ok(
        sidebarCode.includes(`id: '${mod}'`),
        `Admin navigation must retain module: ${mod}`
      );
    }
  });

  test('AdminClerkDashboard stat cards link to request and issue management', () => {
    const dashboardPath = path.resolve('src/pages/AdminClerkDashboard.jsx');
    const dashboardCode = fs.readFileSync(dashboardPath, 'utf8');

    assert.ok(
      dashboardCode.includes("onClick={() => setActivePage('requests-all')}"),
      'Dashboard must allow clicking Requests stat card to navigate to requests-all'
    );
    assert.ok(
      dashboardCode.includes("onClick={() => setActivePage('non-financial-requests')}"),
      'Dashboard must allow clicking Open faculty issues stat card to navigate to non-financial-requests'
    );
  });

  test('AdminClerkDashboard queries requests and issues for overview metrics', () => {
    const dashboardPath = path.resolve('src/pages/AdminClerkDashboard.jsx');
    const dashboardCode = fs.readFileSync(dashboardPath, 'utf8');

    assert.ok(
      dashboardCode.includes("useApi('/api/dashboard')"),
      'Dashboard must query dashboard metrics for total and pending requests'
    );
    assert.ok(
      dashboardCode.includes("useApi('/api/issues?status=SUBMITTED,IN_REVIEW&limit=1')"),
      'Dashboard must query issues API for open faculty issues count'
    );
  });

  test('Backend request and issue routes do not restrict GET endpoints by requester roles', () => {
    const requestsRoutePath = path.resolve('server/src/routes/requests.js');
    const issuesRoutePath = path.resolve('server/src/routes/issues.js');

    const reqCode = fs.readFileSync(requestsRoutePath, 'utf8');
    const issueCode = fs.readFileSync(issuesRoutePath, 'utf8');

    // GET / on requestsRouter does not enforce requireRole(...REQUESTER_ROLES)
    const getRequestsMatch = reqCode.match(/requestsRouter\.get\('\/',[\s\S]*?async \(req, res\)/);
    assert.ok(getRequestsMatch, 'requestsRouter.get("/") must exist');
    assert.ok(
      !getRequestsMatch[0].includes('requireRole'),
      'requestsRouter.get("/") must be open to authenticated users (including ADMIN) under RLS'
    );

    // GET / on issuesRouter does not enforce disallowed roles check
    const getIssuesMatch = issueCode.match(/issuesRouter\.get\('\/',[\s\S]*?async \(req, res\)/);
    assert.ok(getIssuesMatch, 'issuesRouter.get("/") must exist');
    assert.ok(
      !getIssuesMatch[0].includes('forbidden'),
      'issuesRouter.get("/") must not block ADMIN from listing issues'
    );
  });
});
