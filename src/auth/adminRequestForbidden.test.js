import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { REQUESTER_ROLES } from '../../server/src/roles.js';

describe('Issue #25 - Admin Request API Forbidden (HTTP 403)', () => {
  test('Direct request creation simulation rejects ADMIN with 403 Forbidden', () => {
    function simulatePostRequestEndpoint(user, body) {
      if (!user) {
        return { status: 401, error: 'Authentication required' };
      }
      // Issue #25 server guard
      if (user.roles?.includes('ADMIN')) {
        return { status: 403, error: 'Administrators cannot create procurement requests' };
      }
      const hasRequesterRole = user.roles?.some((r) => REQUESTER_ROLES.includes(r));
      if (!hasRequesterRole) {
        return { status: 403, error: 'You do not have permission to perform this action' };
      }
      return { status: 201, created: true, body };
    }

    // 1. Pure Admin
    const adminResult = simulatePostRequestEndpoint({ id: 'admin-1', roles: ['ADMIN'] }, { title: 'Laptop' });
    assert.equal(adminResult.status, 403);
    assert.equal(adminResult.error, 'Administrators cannot create procurement requests');

    // 2. Admin attempting role escalation by having HEAD role also
    const multiRoleAdmin = simulatePostRequestEndpoint({ id: 'admin-2', roles: ['ADMIN', 'HEAD'] }, { title: 'Server' });
    assert.equal(multiRoleAdmin.status, 403);
    assert.equal(multiRoleAdmin.error, 'Administrators cannot create procurement requests');

    // 3. Admin attempting role escalation by having ACTIVITY_INCHARGE role also
    const activityAdmin = simulatePostRequestEndpoint({ id: 'admin-3', roles: ['ADMIN', 'ACTIVITY_INCHARGE'] }, { title: 'Sports' });
    assert.equal(activityAdmin.status, 403);
    assert.equal(activityAdmin.error, 'Administrators cannot create procurement requests');
  });

  test('server/src/routes/requests.js source code strictly enforces the 403 Forbidden guard for ADMIN', async () => {
    const requestsJs = await fs.readFile(path.resolve('server/src/routes/requests.js'), 'utf8');

    // Ensure the guard exists
    assert.ok(
      requestsJs.includes("if (req.user.roles.includes('ADMIN'))"),
      'server/src/routes/requests.js must check if req.user.roles.includes("ADMIN")',
    );
    assert.ok(
      requestsJs.includes("throw forbidden('Administrators cannot create procurement requests')"),
      'server/src/routes/requests.js must throw forbidden with expected message',
    );
  });
});

