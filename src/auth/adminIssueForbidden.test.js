import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { describe, test } from 'node:test';

describe('Issue #25 - Admin Issue Creation Forbidden (HTTP 403)', () => {
  test('Direct issue creation simulation rejects ADMIN with 403 Forbidden', () => {
    function simulatePostIssueEndpoint(user, body) {
      if (!user) {
        return { status: 401, error: 'Authentication required' };
      }
      // Issue #25 server guard
      if (user.roles?.includes('ADMIN')) {
        return { status: 403, error: 'Administrators cannot create or log issues' };
      }
      return { status: 201, created: true, body };
    }

    // 1. Pure Admin user
    const adminAttempt = simulatePostIssueEndpoint(
      { id: 'admin-1', roles: ['ADMIN'] },
      { title: 'Projector repair', description: 'Room 204' },
    );
    assert.equal(adminAttempt.status, 403);
    assert.equal(adminAttempt.error, 'Administrators cannot create or log issues');

    // 2. Multi-role admin user attempting escalation (Admin + Faculty)
    const multiRoleFaculty = simulatePostIssueEndpoint(
      { id: 'admin-2', roles: ['ADMIN', 'FACULTY'] },
      { title: 'Lab equipment issue', description: 'Chemistry lab' },
    );
    assert.equal(multiRoleFaculty.status, 403);
    assert.equal(multiRoleFaculty.error, 'Administrators cannot create or log issues');

    // 3. Multi-role admin user attempting escalation (Admin + Principal)
    const multiRolePrincipal = simulatePostIssueEndpoint(
      { id: 'admin-3', roles: ['ADMIN', 'PRINCIPAL'] },
      { title: 'Facilities maintenance', description: 'Main building' },
    );
    assert.equal(multiRolePrincipal.status, 403);
    assert.equal(multiRolePrincipal.error, 'Administrators cannot create or log issues');
  });

  test('server/src/routes/issues.js source code strictly enforces the 403 Forbidden guard for ADMIN', async () => {
    const issuesJs = await fs.readFile(path.resolve('server/src/routes/issues.js'), 'utf8');

    // Ensure the guard exists
    assert.ok(
      issuesJs.includes("if (req.user.roles.includes('ADMIN'))"),
      'server/src/routes/issues.js must check if req.user.roles.includes("ADMIN")',
    );
    assert.ok(
      issuesJs.includes("throw forbidden('Administrators cannot create or log issues')"),
      'server/src/routes/issues.js must throw forbidden with expected message',
    );
  });
});

