import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canRaiseRequests, canCreateIssues } from '../../server/src/roles.js';

describe('Issue #25 - Role-Based Request and Issue Visibility', () => {
  const isRequestActionVisible = (user) => {
    return Boolean(canRaiseRequests(user) && !user.roles?.includes('ADMIN'));
  };

  const isIssueActionVisible = (user) => {
    return Boolean(canCreateIssues(user) && !user.roles?.includes('ADMIN'));
  };

  test('ADMIN user cannot see or access request or issue creation actions', () => {
    const adminUser = {
      id: 'admin-uuid-1',
      name: 'System Admin',
      roles: ['ADMIN'],
    };

    assert.equal(isRequestActionVisible(adminUser), false, 'Admin must not see request creation action');
    assert.equal(isIssueActionVisible(adminUser), false, 'Admin must not see issue creation action');
  });

  test('Multi-role user with ADMIN cannot see or access creation actions', () => {
    const multiRoleAdmin = {
      id: 'admin-multi-1',
      name: 'Admin with Faculty Role',
      roles: ['ADMIN', 'FACULTY', 'HEAD'],
    };

    assert.equal(isRequestActionVisible(multiRoleAdmin), false, 'Admin multi-role must not see request creation');
    assert.equal(isIssueActionVisible(multiRoleAdmin), false, 'Admin multi-role must not see issue creation');
  });

  test('Eligible roles retain visible request creation actions', () => {
    const headUser = {
      id: 'head-uuid-1',
      name: 'Department Head',
      roles: ['HEAD'],
      assignedDepartmentId: 'dept-cs',
    };

    const inchargeUser = {
      id: 'incharge-uuid-1',
      name: 'Activity In-Charge',
      roles: ['ACTIVITY_INCHARGE'],
    };

    assert.equal(isRequestActionVisible(headUser), true, 'HEAD role must see request creation action');
    assert.equal(isRequestActionVisible(inchargeUser), true, 'ACTIVITY_INCHARGE role must see request creation action');
  });

  test('Eligible non-admin roles retain visible issue creation actions', () => {
    const rolesToTest = ['HEAD', 'FACULTY', 'STAFF', 'ACTIVITY_INCHARGE', 'PRINCIPAL', 'PURCHASE_COMMITTEE'];

    for (const role of rolesToTest) {
      const user = {
        id: `user-${role}`,
        name: `User ${role}`,
        roles: [role],
      };
      assert.equal(
        isIssueActionVisible(user),
        true,
        `Role ${role} must have issue creation action visible`
      );
    }
  });

  test('Header.jsx gates New request and Log issue buttons against ADMIN', () => {
    const headerPath = path.resolve('src/components/layout/Header.jsx');
    const headerCode = fs.readFileSync(headerPath, 'utf8');

    assert.ok(
      headerCode.includes("user.can?.raiseRequests && !user.roles?.includes('ADMIN')"),
      'Header.jsx must gate New request with !user.roles?.includes("ADMIN")'
    );
    assert.ok(
      headerCode.includes("user.can?.logIssues && !user.roles?.includes('ADMIN')"),
      'Header.jsx must gate Log issue with !user.roles?.includes("ADMIN")'
    );
  });

  test('Financial and Non-Financial management pages gate creation actions against ADMIN', () => {
    const financialPath = path.resolve('src/pages/FinancialRequestsManagement.jsx');
    const nonFinancialPath = path.resolve('src/pages/NonFinancialRequestsManagement.jsx');

    const financialCode = fs.readFileSync(financialPath, 'utf8');
    const nonFinancialCode = fs.readFileSync(nonFinancialPath, 'utf8');

    assert.ok(
      financialCode.includes("user.can?.raiseRequests && !user.roles?.includes('ADMIN')"),
      'FinancialRequestsManagement must gate New request button against ADMIN'
    );
    assert.ok(
      nonFinancialCode.includes("user?.can?.logIssues && !user?.roles?.includes('ADMIN')"),
      'NonFinancialRequestsManagement must gate Log issue button against ADMIN'
    );
  });

  test('Modal components NewRequestModal and NewIssueModal immediately refuse ADMIN render', () => {
    const reqModalPath = path.resolve('src/components/modals/NewRequestModal.jsx');
    const issueModalPath = path.resolve('src/components/modals/NewIssueModal.jsx');

    const reqModalCode = fs.readFileSync(reqModalPath, 'utf8');
    const issueModalCode = fs.readFileSync(issueModalPath, 'utf8');

    assert.ok(
      reqModalCode.includes("user?.roles?.includes('ADMIN')") && reqModalCode.includes('return null'),
      'NewRequestModal must return null for ADMIN users'
    );
    assert.ok(
      issueModalCode.includes("user?.roles?.includes('ADMIN')") && issueModalCode.includes('return null'),
      'NewIssueModal must return null for ADMIN users'
    );
  });
});

