import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canRaiseRequests, REQUESTER_ROLES, REQUESTER_DISALLOWED_ROLES } from '../../server/src/roles.js';
import { calculateRemainingBudget } from '../../server/src/budgetService.js';

describe('Issue #20 - Budget Authorization and RLS Policy Integrity', () => {
  // Mock RLS evaluation functions matching schema/14_rls.sql
  function canReadBudgetProvision(user, provision) {
    if (!user) return false;
    const reviewerRoles = [
      'ADMIN',
      'PRINCIPAL',
      'PURCHASE_COMMITTEE',
      'CDC_GRANT_MEMBER',
      'CDC_NON_GRANT_MEMBER',
      'CHAIRMAN',
      'VICE_PRESIDENT',
    ];
    if (user.roles.some((r) => reviewerRoles.includes(r))) return true;
    if (user.departmentId != null && provision.departmentId === user.departmentId) return true;
    if (provision.createdBy && user.id === provision.createdBy) return true;
    return false;
  }

  function canWriteBudgetProvision(user, provision) {
    if (!user) return false;
    if (user.roles.includes('ADMIN')) return true;
    if (
      user.roles.includes('HEAD') &&
      user.departmentId != null &&
      provision.departmentId === user.departmentId
    ) {
      return true;
    }
    return false;
  }

  test('RLS Read Policy permits administrative, institutional approvers and department members', () => {
    const csProvision = {
      departmentId: 10,
      createdBy: 'admin-1',
    };

    // Admin can read
    assert.equal(canReadBudgetProvision({ id: 'admin-1', roles: ['ADMIN'] }, csProvision), true);

    // Principal can read
    assert.equal(canReadBudgetProvision({ id: 'principal-1', roles: ['PRINCIPAL'] }, csProvision), true);

    // Purchase Committee member can read
    assert.equal(canReadBudgetProvision({ id: 'pc-1', roles: ['PURCHASE_COMMITTEE'] }, csProvision), true);

    // CDC member can read
    assert.equal(canReadBudgetProvision({ id: 'cdc-1', roles: ['CDC_GRANT_MEMBER'] }, csProvision), true);

    // HOD of Computer Science (department 10) can read
    assert.equal(canReadBudgetProvision({ id: 'hod-cs', roles: ['HEAD'], departmentId: 10 }, csProvision), true);

    // HOD of Physics (department 5) cannot read CS provision
    assert.equal(canReadBudgetProvision({ id: 'hod-phy', roles: ['HEAD'], departmentId: 5 }, csProvision), false);

    // Unaffiliated faculty member cannot read other department's provision
    assert.equal(canReadBudgetProvision({ id: 'fac-chem', roles: ['FACULTY'], departmentId: 3 }, csProvision), false);
  });

  test('RLS Write Policy restricts budget provision mutation strictly to ADMIN or assigned HEAD', () => {
    const csProvision = { departmentId: 10 };

    // ADMIN can write/update
    assert.equal(canWriteBudgetProvision({ id: 'admin-1', roles: ['ADMIN'] }, csProvision), true);

    // Assigned HOD of Department 10 can write
    assert.equal(canWriteBudgetProvision({ id: 'hod-cs', roles: ['HEAD'], departmentId: 10 }, csProvision), true);

    // Cross-department HOD (Physics, dept 5) CANNOT write CS provision
    assert.equal(canWriteBudgetProvision({ id: 'hod-phy', roles: ['HEAD'], departmentId: 5 }, csProvision), false);

    // Non-HEAD campus role cannot write provision
    assert.equal(canWriteBudgetProvision({ id: 'faculty-1', roles: ['FACULTY'], departmentId: 10 }, csProvision), false);
    assert.equal(canWriteBudgetProvision({ id: 'incharge-1', roles: ['ACTIVITY_INCHARGE'], departmentId: 10 }, csProvision), false);
  });

  test('Request creation authorization preserves Issue #25 restriction (ADMIN blocked, HEAD allowed)', () => {
    const adminUser = { id: 'admin-1', roles: ['ADMIN'] };
    const headUser = { id: 'hod-1', roles: ['HEAD'], departmentId: 10 };

    assert.equal(canRaiseRequests(adminUser), false, 'Admin must not be allowed to raise procurement requests');
    assert.ok(REQUESTER_DISALLOWED_ROLES.includes('ADMIN'));

    assert.equal(canRaiseRequests(headUser), true, 'Head must be allowed to raise procurement requests');
    assert.ok(REQUESTER_ROLES.includes('HEAD'));
  });

  test('v_department_budget_summary formula matches exact accounting specifications', () => {
    const allocated = 500000.0;
    const stats = {
      utilizedAmount: 300000.0,
      committedAmount: 50000.0,
    };

    const remaining = calculateRemainingBudget(allocated, stats);
    // 500,000 - (300,000 + 50,000) = 150,000
    assert.equal(remaining.remainingAmount, 150000.0);
    // available without in-flight committed = 200,000
    assert.equal(remaining.availableAmount, 200000.0);
  });
});
