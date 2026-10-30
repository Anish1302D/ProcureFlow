import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';
import { canCreateIssues, canRaiseRequests } from '../../server/src/roles.js';

describe('Issue #25 - Align Creation Authorization Across Routes', () => {
  test('userPayload can flags reflect exact backend authorization restrictions', () => {
    function computeCanFlags(user) {
      return {
        raiseRequests: canRaiseRequests(user),
        logIssues: canCreateIssues(user),
        viewAudit: Boolean(user?.roles?.includes('ADMIN')),
      };
    }

    // 1. Admin user
    const adminFlags = computeCanFlags({ roles: ['ADMIN'] });
    assert.equal(adminFlags.raiseRequests, false, 'Admin cannot raise requests');
    assert.equal(adminFlags.logIssues, false, 'Admin cannot log issues');
    assert.equal(adminFlags.viewAudit, true, 'Admin can view audit log');

    // 2. Head of Department
    const headFlags = computeCanFlags({ roles: ['HEAD'] });
    assert.equal(headFlags.raiseRequests, true, 'Head can raise requests');
    assert.equal(headFlags.logIssues, true, 'Head can log issues');
    assert.equal(headFlags.viewAudit, false);

    // 3. Faculty
    const facultyFlags = computeCanFlags({ roles: ['FACULTY'] });
    assert.equal(facultyFlags.raiseRequests, false, 'Faculty cannot raise requests');
    assert.equal(facultyFlags.logIssues, true, 'Faculty can log issues');

    // 4. Activity Incharge
    const actFlags = computeCanFlags({ roles: ['ACTIVITY_INCHARGE'] });
    assert.equal(actFlags.raiseRequests, true, 'Activity Incharge can raise requests');
    assert.equal(actFlags.logIssues, true, 'Activity Incharge can log issues');
  });

  test('server/src/routes/auth.js binds can.raiseRequests and can.logIssues to helper functions', async () => {
    const authJs = await fs.readFile(path.resolve('server/src/routes/auth.js'), 'utf8');

    assert.ok(
      authJs.includes('raiseRequests: canRaiseRequests(user)'),
      'auth.js must use canRaiseRequests(user)',
    );
    assert.ok(
      authJs.includes('logIssues: canCreateIssues(user)'),
      'auth.js must use canCreateIssues(user)',
    );
  });
});

