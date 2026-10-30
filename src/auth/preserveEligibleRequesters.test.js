import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { REQUESTER_ROLES, canRaiseRequests } from '../../server/src/roles.js';

describe('Issue #25 - Preserve Eligible User Request Creation', () => {
  test('HEAD role can raise requests and is validated against assigned department', () => {
    const headUser = {
      id: 'head-dept-5',
      name: 'Dr. Head of Physics',
      roles: ['HEAD'],
      departmentId: 5,
    };

    assert.equal(canRaiseRequests(headUser), true, 'HEAD role must be allowed to raise requests');

    // Simulate department placement verification logic from POST /api/requests
    function validateDepartmentPlacement(user, requestedDepartmentId) {
      if (requestedDepartmentId != null && user.departmentId != null && requestedDepartmentId !== user.departmentId) {
        throw new Error('You can only raise requests for your own department');
      }
      return requestedDepartmentId ?? user.departmentId;
    }

    // Default to own department
    assert.equal(validateDepartmentPlacement(headUser, null), 5);
    // Explicit own department
    assert.equal(validateDepartmentPlacement(headUser, 5), 5);
    // Cross-department request should throw
    assert.throws(
      () => validateDepartmentPlacement(headUser, 6),
      /You can only raise requests for your own department/,
    );
  });

  test('ACTIVITY_INCHARGE role can raise eligible procurement requests', () => {
    const activityUser = {
      id: 'activity-lead-1',
      name: 'Sports & Cultural In-charge',
      roles: ['ACTIVITY_INCHARGE'],
      departmentId: null,
    };

    assert.equal(
      canRaiseRequests(activityUser),
      true,
      'ACTIVITY_INCHARGE role must be allowed to raise requests',
    );
    assert.ok(
      REQUESTER_ROLES.includes('ACTIVITY_INCHARGE'),
      'REQUESTER_ROLES must retain ACTIVITY_INCHARGE',
    );
  });

  test('Faculty member with HEAD appointment inherits request raising permission', () => {
    const dualRoleFaculty = {
      id: 'prof-dual-1',
      name: 'Prof. Chemist',
      roles: ['FACULTY', 'HEAD'],
      departmentId: 3,
    };

    assert.equal(
      canRaiseRequests(dualRoleFaculty),
      true,
      'User with FACULTY and HEAD must be able to raise requests',
    );
  });
});
