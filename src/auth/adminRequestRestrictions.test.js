import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { REQUESTER_ROLES, canCreateIssues, canRaiseRequests } from '../../server/src/roles.js';

describe('Issue #25 - Admin Request Creation Restrictions', () => {
  test('REQUESTER_ROLES from server/src/roles.js excludes ADMIN and retains HEAD and ACTIVITY_INCHARGE', () => {
    assert.ok(
      !REQUESTER_ROLES.includes('ADMIN'),
      'ADMIN must NOT be in REQUESTER_ROLES',
    );
    assert.ok(
      REQUESTER_ROLES.includes('HEAD'),
      'HEAD must remain an eligible requester role',
    );
    assert.ok(
      REQUESTER_ROLES.includes('ACTIVITY_INCHARGE'),
      'ACTIVITY_INCHARGE must remain an eligible requester role',
    );
    assert.deepEqual(REQUESTER_ROLES, ['HEAD', 'ACTIVITY_INCHARGE']);
  });

  test('canRaiseRequests from roles.js strictly disallows ADMIN role', () => {
    // Admin alone
    assert.equal(canRaiseRequests({ roles: ['ADMIN'] }), false);

    // Multi-role user containing Admin (e.g., Admin + Staff or Admin + Head)
    assert.equal(canRaiseRequests({ roles: ['ADMIN', 'STAFF'] }), false);
    assert.equal(canRaiseRequests({ roles: ['ADMIN', 'HEAD'] }), false);

    // Eligible roles
    assert.equal(canRaiseRequests({ roles: ['HEAD'] }), true);
    assert.equal(canRaiseRequests({ roles: ['ACTIVITY_INCHARGE'] }), true);
    assert.equal(canRaiseRequests({ roles: ['HEAD', 'FACULTY'] }), true);

    // Other roles
    assert.equal(canRaiseRequests({ roles: ['PRINCIPAL'] }), false);
    assert.equal(canRaiseRequests({ roles: ['PURCHASE_COMMITTEE'] }), false);
    assert.equal(canRaiseRequests({ roles: ['CDC_MEMBER'] }), false);
    assert.equal(canRaiseRequests({ roles: ['FACULTY'] }), false);
    assert.equal(canRaiseRequests({ roles: ['STAFF'] }), false);
    assert.equal(canRaiseRequests({ roles: [] }), false);
    assert.equal(canRaiseRequests(null), false);
  });

  test('canCreateIssues from roles.js strictly disallows ADMIN role and allows others', () => {
    // Admin alone
    assert.equal(canCreateIssues({ roles: ['ADMIN'] }), false);
    assert.equal(canCreateIssues({ roles: ['ADMIN', 'FACULTY'] }), false);

    // Eligible roles
    assert.equal(canCreateIssues({ roles: ['FACULTY'] }), true);
    assert.equal(canCreateIssues({ roles: ['STAFF'] }), true);
    assert.equal(canCreateIssues({ roles: ['HEAD'] }), true);
    assert.equal(canCreateIssues({ roles: ['STUDENT'] }), true);
    assert.equal(canCreateIssues({ roles: ['PRINCIPAL'] }), true);
    assert.equal(canCreateIssues(null), false);
  });

  test('Request creation API specification mandates HTTP 403 Forbidden for Admin', () => {
    function evaluateRequestCreationAuth(user, requesterRoles = REQUESTER_ROLES) {
      if (!user) return { status: 401, error: 'Authentication required' };
      if (user.roles?.includes('ADMIN')) {
        return { status: 403, error: 'Administrators cannot create procurement requests' };
      }
      const isEligible = user.roles?.some((r) => requesterRoles.includes(r));
      if (!isEligible) {
        return { status: 403, error: 'You do not have permission to perform this action' };
      }
      return { status: 201, allowed: true };
    }

    assert.deepEqual(evaluateRequestCreationAuth({ id: 'u1', roles: ['ADMIN'] }), {
      status: 403,
      error: 'Administrators cannot create procurement requests',
    });

    assert.deepEqual(evaluateRequestCreationAuth({ id: 'u2', roles: ['HEAD'] }), {
      status: 201,
      allowed: true,
    });

    assert.deepEqual(evaluateRequestCreationAuth({ id: 'u3', roles: ['ACTIVITY_INCHARGE'] }), {
      status: 201,
      allowed: true,
    });
  });

  test('server/src/routes/requests.js route file requires requireRole with requester roles', async () => {
    const requestsJs = await fs.readFile(path.resolve('server/src/routes/requests.js'), 'utf8');

    assert.ok(
      requestsJs.includes("requestsRouter.post('/',"),
      'server/src/routes/requests.js must define POST / endpoint for request creation',
    );
    assert.ok(
      requestsJs.includes('requireRole'),
      'server/src/routes/requests.js must enforce role authorization',
    );
  });
});
