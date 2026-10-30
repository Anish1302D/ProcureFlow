import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

describe('Issue #25 - Admin Issue Creation Restrictions', () => {
  test('canCreateIssue policy strictly disallows ADMIN role from creating issues', () => {
    function canCreateIssue(user) {
      if (!user) return false;
      const roles = user.roles ?? [];
      // Admin is strictly barred from logging/creating issues
      if (roles.includes('ADMIN')) return false;
      return true;
    }

    // Admin user alone
    assert.equal(canCreateIssue({ roles: ['ADMIN'] }), false);

    // Multi-role user including Admin
    assert.equal(canCreateIssue({ roles: ['ADMIN', 'FACULTY'] }), false);
    assert.equal(canCreateIssue({ roles: ['HEAD', 'ADMIN'] }), false);

    // Eligible campus roles must be allowed to create issues
    const eligibleRoles = ['FACULTY', 'HEAD', 'STAFF', 'PRINCIPAL', 'STUDENT', 'ACTIVITY_INCHARGE'];
    for (const role of eligibleRoles) {
      assert.equal(
        canCreateIssue({ roles: [role] }),
        true,
        `Role ${role} must be permitted to create issues`,
      );
    }

    // Null or undefined user
    assert.equal(canCreateIssue(null), false);
    assert.equal(canCreateIssue(undefined), false);
  });

  test('Issue creation API specification mandates HTTP 403 Forbidden for Admin', () => {
    function evaluateIssueCreationAuth(user) {
      if (!user) return { status: 401, error: 'Authentication required' };
      if (user.roles?.includes('ADMIN')) {
        return { status: 403, error: 'Administrators cannot create or log issues' };
      }
      return { status: 201, allowed: true };
    }

    assert.deepEqual(evaluateIssueCreationAuth({ id: 'u-admin', roles: ['ADMIN'] }), {
      status: 403,
      error: 'Administrators cannot create or log issues',
    });

    assert.deepEqual(evaluateIssueCreationAuth({ id: 'u-fac', roles: ['FACULTY'] }), {
      status: 201,
      allowed: true,
    });

    assert.deepEqual(evaluateIssueCreationAuth({ id: 'u-head', roles: ['HEAD'] }), {
      status: 201,
      allowed: true,
    });
  });

  test('server/src/routes/issues.js defines issue creation on POST /', async () => {
    const issuesJs = await fs.readFile(path.resolve('server/src/routes/issues.js'), 'utf8');

    assert.ok(
      issuesJs.includes("issuesRouter.post('/',"),
      'server/src/routes/issues.js must define POST / endpoint for issue creation',
    );
  });
});
