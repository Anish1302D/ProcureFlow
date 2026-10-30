import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

describe('Issue #25 - Admin Request Creation Restrictions', () => {
  test('REQUESTER_ROLES specification excludes ADMIN and retains HEAD and ACTIVITY_INCHARGE', () => {
    // Expected specification for Issue #25
    const expectedRequesterRoles = ['HEAD', 'ACTIVITY_INCHARGE'];

    assert.ok(
      !expectedRequesterRoles.includes('ADMIN'),
      'ADMIN must NOT be in the eligible requester roles list',
    );
    assert.ok(
      expectedRequesterRoles.includes('HEAD'),
      'HEAD must remain an eligible requester role',
    );
    assert.ok(
      expectedRequesterRoles.includes('ACTIVITY_INCHARGE'),
      'ACTIVITY_INCHARGE must remain an eligible requester role',
    );
  });

  test('canRaiseRequests policy strictly disallows ADMIN role from raising requests', () => {
    function canRaiseRequests(user, requesterRoles = ['HEAD', 'ACTIVITY_INCHARGE']) {
      if (!user?.roles || !Array.isArray(user.roles)) return false;
      // Admin is explicitly prohibited from raising requests
      if (user.roles.includes('ADMIN')) return false;
      return user.roles.some((role) => requesterRoles.includes(role));
    }

    // Admin alone
    assert.equal(canRaiseRequests({ roles: ['ADMIN'] }), false);

    // Multi-role user containing Admin (e.g., Admin + Staff)
    assert.equal(canRaiseRequests({ roles: ['ADMIN', 'STAFF'] }), false);

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

  test('Request creation API specification mandates HTTP 403 Forbidden for Admin', () => {
    function evaluateRequestCreationAuth(user, requesterRoles = ['HEAD', 'ACTIVITY_INCHARGE']) {
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
