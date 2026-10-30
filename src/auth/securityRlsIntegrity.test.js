import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

describe('Issue #25 - Authorization and RLS Security Integrity', () => {
  const rlsPath = path.resolve('db/schema/14_rls.sql');
  const rlsSql = fs.readFileSync(rlsPath, 'utf8');

  test('Database schema strictly enables Row-Level Security on requests table', () => {
    assert.ok(
      rlsSql.includes('ALTER TABLE requests ENABLE ROW LEVEL SECURITY;'),
      'requests table must have RLS explicitly enabled'
    );
  });

  test('Database schema strictly enables Row-Level Security on issues table', () => {
    assert.ok(
      rlsSql.includes('ALTER TABLE issues ENABLE ROW LEVEL SECURITY;'),
      'issues table must have RLS explicitly enabled'
    );
  });

  test('RLS requests_admin policy grants comprehensive audit and viewing access to ADMIN', () => {
    assert.ok(
      rlsSql.includes('CREATE POLICY requests_admin ON requests') &&
      rlsSql.includes("USING (app_has_role('ADMIN'))"),
      'requests_admin policy must allow ADMIN to view and audit all requests'
    );
  });

  test('RLS issues_read policy ensures ADMIN can inspect and monitor all campus issues', () => {
    const issuesReadMatch = rlsSql.match(/CREATE POLICY issues_read ON issues[\s\S]*?;/);
    assert.ok(issuesReadMatch, 'issues_read policy must exist');
    assert.ok(
      issuesReadMatch[0].includes("app_has_role('ADMIN')"),
      'issues_read must grant read access to ADMIN'
    );
  });

  test('Defense-in-depth: Backend API rejects ADMIN before SQL queries are executed', () => {
    const requestsRoutePath = path.resolve('server/src/routes/requests.js');
    const issuesRoutePath = path.resolve('server/src/routes/issues.js');

    const requestsCode = fs.readFileSync(requestsRoutePath, 'utf8');
    const issuesCode = fs.readFileSync(issuesRoutePath, 'utf8');

    // In requests.js, the admin check is evaluated immediately at the top of POST /
    const reqPostIdx = requestsCode.indexOf("requestsRouter.post('/',");
    const reqAdminGuardIdx = requestsCode.indexOf("req.user.roles.includes('ADMIN')", reqPostIdx);
    const reqDbInsertIdx = requestsCode.indexOf("withUser(req.user.id", reqPostIdx);

    assert.ok(reqAdminGuardIdx > reqPostIdx, 'Admin guard must follow POST handler');
    assert.ok(reqAdminGuardIdx < reqDbInsertIdx, 'Admin guard must precede withUser database execution');

    // In issues.js, the admin check is evaluated immediately at the top of POST /
    const issuePostIdx = issuesCode.indexOf("issuesRouter.post('/',");
    const issueAdminGuardIdx = issuesCode.indexOf("req.user.roles.includes('ADMIN')", issuePostIdx);
    const issueDbInsertIdx = issuesCode.indexOf("withUser(req.user.id", issuePostIdx);

    assert.ok(issueAdminGuardIdx > issuePostIdx, 'Admin guard must follow POST handler in issues.js');
    assert.ok(issueAdminGuardIdx < issueDbInsertIdx, 'Admin guard must precede withUser database execution in issues.js');
  });

  test('Database security policies are preserved without modification', () => {
    // Confirm no security weakening has occurred
    assert.ok(
      rlsSql.includes('CREATE POLICY requests_own ON requests'),
      'requests_own policy must be preserved'
    );
    assert.ok(
      rlsSql.includes('CREATE POLICY requests_approver ON requests'),
      'requests_approver policy must be preserved'
    );
    assert.ok(
      rlsSql.includes('CREATE POLICY requests_principal_read ON requests'),
      'requests_principal_read policy must be preserved'
    );
  });
});
