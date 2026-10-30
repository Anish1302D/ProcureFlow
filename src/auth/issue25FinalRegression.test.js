import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REQUESTER_ROLES,
  REQUESTER_DISALLOWED_ROLES,
  ISSUE_CREATOR_DISALLOWED_ROLES,
  canRaiseRequests,
  canCreateIssues,
} from '../../server/src/roles.js';

describe('Issue #25 - Final Admin Authorization Regression Suite', () => {
  test('Negative Authorization: ADMIN is strictly forbidden from request creation', () => {
    assert.equal(
      REQUESTER_ROLES.includes('ADMIN'),
      false,
      'REQUESTER_ROLES must not include ADMIN'
    );
    assert.equal(
      REQUESTER_DISALLOWED_ROLES.includes('ADMIN'),
      true,
      'REQUESTER_DISALLOWED_ROLES must include ADMIN'
    );

    const adminUser = { id: 'admin-1', roles: ['ADMIN'] };
    assert.equal(canRaiseRequests(adminUser), false, 'canRaiseRequests must return false for ADMIN');

    // Multi-role admin
    const multiRoleAdmin = { id: 'admin-2', roles: ['ADMIN', 'HEAD', 'ACTIVITY_INCHARGE'] };
    assert.equal(canRaiseRequests(multiRoleAdmin), false, 'canRaiseRequests must return false for multi-role ADMIN');
  });

  test('Negative Authorization: ADMIN is strictly forbidden from issue creation', () => {
    assert.equal(
      ISSUE_CREATOR_DISALLOWED_ROLES.includes('ADMIN'),
      true,
      'ISSUE_CREATOR_DISALLOWED_ROLES must include ADMIN'
    );

    const adminUser = { id: 'admin-1', roles: ['ADMIN'] };
    assert.equal(canCreateIssues(adminUser), false, 'canCreateIssues must return false for ADMIN');

    const multiRoleAdmin = { id: 'admin-2', roles: ['ADMIN', 'FACULTY', 'STAFF'] };
    assert.equal(canCreateIssues(multiRoleAdmin), false, 'canCreateIssues must return false for multi-role ADMIN');
  });

  test('Positive Authorization: HEAD and ACTIVITY_INCHARGE retain request creation capability', () => {
    const headUser = { id: 'head-1', roles: ['HEAD'], assignedDepartmentId: 'dept-1' };
    const actIncharge = { id: 'act-1', roles: ['ACTIVITY_INCHARGE'] };

    assert.equal(canRaiseRequests(headUser), true, 'HEAD must be allowed to raise requests');
    assert.equal(canRaiseRequests(actIncharge), true, 'ACTIVITY_INCHARGE must be allowed to raise requests');
  });

  test('Positive Authorization: Non-admin campus roles retain issue creation capability', () => {
    const campusRoles = [
      'HEAD',
      'FACULTY',
      'STAFF',
      'ACTIVITY_INCHARGE',
      'PRINCIPAL',
      'PURCHASE_COMMITTEE',
      'CDC_MEMBER',
      'REGISTRAR',
    ];

    for (const role of campusRoles) {
      const user = { id: `u-${role}`, roles: [role] };
      assert.equal(canCreateIssues(user), true, `Role ${role} must be permitted to log issues`);
    }
  });

  test('Backend Contract: HTTP 403 Forbidden guards in requests.js and issues.js', () => {
    const requestsCode = fs.readFileSync(path.resolve('server/src/routes/requests.js'), 'utf8');
    const issuesCode = fs.readFileSync(path.resolve('server/src/routes/issues.js'), 'utf8');

    assert.ok(
      requestsCode.includes("throw forbidden('Administrators cannot create procurement requests')"),
      'requests.js must throw 403 Forbidden with exact contract message for ADMIN'
    );
    assert.ok(
      issuesCode.includes("throw forbidden('Administrators cannot create or log issues')"),
      'issues.js must throw 403 Forbidden with exact contract message for ADMIN'
    );
  });

  test('Frontend Contract: UI actions and modals exclude ADMIN', () => {
    const headerCode = fs.readFileSync(path.resolve('src/components/layout/Header.jsx'), 'utf8');
    const finCode = fs.readFileSync(path.resolve('src/pages/FinancialRequestsManagement.jsx'), 'utf8');
    const nonFinCode = fs.readFileSync(path.resolve('src/pages/NonFinancialRequestsManagement.jsx'), 'utf8');
    const reqModalCode = fs.readFileSync(path.resolve('src/components/modals/NewRequestModal.jsx'), 'utf8');
    const issueModalCode = fs.readFileSync(path.resolve('src/components/modals/NewIssueModal.jsx'), 'utf8');

    assert.ok(
      headerCode.includes("user.can?.raiseRequests && !user.roles?.includes('ADMIN')"),
      'Header New request action must exclude ADMIN'
    );
    assert.ok(
      headerCode.includes("user.can?.logIssues && !user.roles?.includes('ADMIN')"),
      'Header Log issue action must exclude ADMIN'
    );
    assert.ok(
      finCode.includes("user.can?.raiseRequests && !user.roles?.includes('ADMIN')"),
      'Financial requests page New request button must exclude ADMIN'
    );
    assert.ok(
      nonFinCode.includes("user?.can?.logIssues && !user?.roles?.includes('ADMIN')"),
      'Non-financial requests page Log issue button must exclude ADMIN'
    );
    assert.ok(
      reqModalCode.includes("user?.roles?.includes('ADMIN')") && reqModalCode.includes('return null'),
      'NewRequestModal must block rendering for ADMIN'
    );
    assert.ok(
      issueModalCode.includes("user?.roles?.includes('ADMIN')") && issueModalCode.includes('return null'),
      'NewIssueModal must block rendering for ADMIN'
    );
  });

  test('Administrative Integrity: Admin retains full viewing, monitoring, and operations', () => {
    const sidebarCode = fs.readFileSync(path.resolve('src/components/layout/Sidebar.jsx'), 'utf8');
    const adminDashboardCode = fs.readFileSync(path.resolve('src/pages/AdminClerkDashboard.jsx'), 'utf8');

    assert.ok(
      sidebarCode.includes("id: 'requests-all'") && sidebarCode.includes("label: 'All requests'"),
      'Admin navigation must retain All requests'
    );
    assert.ok(
      sidebarCode.includes("id: 'non-financial-requests'") && sidebarCode.includes("label: 'Faculty issues'"),
      'Admin navigation must retain Faculty issues'
    );
    assert.ok(
      adminDashboardCode.includes("setActivePage('requests-all')"),
      'Admin dashboard must navigate to requests-all'
    );
    assert.ok(
      adminDashboardCode.includes("setActivePage('non-financial-requests')"),
      'Admin dashboard must navigate to non-financial-requests'
    );
  });
});

