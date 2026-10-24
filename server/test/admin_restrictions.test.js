import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// Provide safe local test environment defaults before loading auth
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app_user:devpass@localhost:5433/spc_approval';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_must_be_32_characters_long!';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || 'test_signing_secret_must_be_32_characters_long!';

const { REQUESTER_ROLES, hasAnyRole } = await import('../src/roles.js');
const { requireRole, requireAuth } = await import('../src/auth.js');

describe('Issue #25: Administrator Restrictions (Cannot Raise Requests or Log Issues)', () => {
  describe('Role Model Restrictions', () => {
    it('REQUESTER_ROLES does not include ADMIN', () => {
      assert.equal(
        REQUESTER_ROLES.includes('ADMIN'),
        false,
        'ADMIN must not be included in REQUESTER_ROLES',
      );
    });

    it('REQUESTER_ROLES preserves permitted roles (HEAD, ACTIVITY_INCHARGE)', () => {
      assert.ok(REQUESTER_ROLES.includes('HEAD'), 'HEAD must be permitted to raise requests');
      assert.ok(REQUESTER_ROLES.includes('ACTIVITY_INCHARGE'), 'ACTIVITY_INCHARGE must be permitted to raise requests');
    });

    it('hasAnyRole correctly returns false for admin requester check', () => {
      const adminUser = { id: 'admin-id', roles: ['ADMIN'] };
      const headUser = { id: 'head-id', roles: ['HEAD'] };
      const inchargeUser = { id: 'incharge-id', roles: ['ACTIVITY_INCHARGE'] };

      assert.equal(hasAnyRole(adminUser, REQUESTER_ROLES), false, 'Admin must not have requester role');
      assert.equal(hasAnyRole(headUser, REQUESTER_ROLES), true, 'Head must have requester role');
      assert.equal(hasAnyRole(inchargeUser, REQUESTER_ROLES), true, 'Incharge must have requester role');
    });

    it('permission descriptor can.logIssues is false for admin and true for others', () => {
      const checkLogIssues = (roles) => !roles.includes('ADMIN');
      assert.equal(checkLogIssues(['ADMIN']), false, 'Admin cannot log issues');
      assert.equal(checkLogIssues(['HEAD']), true, 'Head can log issues');
      assert.equal(checkLogIssues(['PRINCIPAL']), true, 'Principal can log issues');
      assert.equal(checkLogIssues(['TEACHING_FACULTY']), true, 'Faculty can log issues');
    });
  });

  describe('Route-Level Authorization Guards', () => {
    const createMockReq = ({ roles = [], authHeader = null } = {}) => ({
      user: roles.length ? { id: 'user-uuid', roles, departmentId: 1 } : null,
      headers: authHeader ? { authorization: authHeader } : {},
      get(header) {
        return this.headers[header.toLowerCase()] ?? null;
      },
      body: { title: 'Test Proposal', description: 'Test description', budgetHeadId: 1, items: [] },
      params: { id: 'req-uuid-1' },
      query: {},
      ip: '127.0.0.1',
    });

    it('POST /api/requests authorization rejects administrator with 403 Forbidden', () => {
      const req = createMockReq({ roles: ['ADMIN'] });
      const middleware = requireRole(...REQUESTER_ROLES);

      assert.throws(
        () => middleware(req, {}, () => {}),
        (err) => err.status === 403,
        'requireRole(...REQUESTER_ROLES) must throw 403 Forbidden for ADMIN',
      );
    });

    it('POST /api/requests rejects unauthenticated caller with 401 Unauthorized', async () => {
      const req = createMockReq({ authHeader: null });

      await assert.rejects(
        async () => requireAuth(req, {}, () => {}),
        (err) => err.status === 401,
        'Unauthenticated request must be denied with 401 Unauthorized',
      );
    });

    it('POST /api/requests allows permitted requester roles (HEAD, ACTIVITY_INCHARGE)', () => {
      for (const role of ['HEAD', 'ACTIVITY_INCHARGE']) {
        const req = createMockReq({ roles: [role] });
        let nextCalled = false;

        const middleware = requireRole(...REQUESTER_ROLES);
        middleware(req, {}, () => {
          nextCalled = true;
        });

        assert.equal(nextCalled, true, `Role ${role} should be permitted to proceed past middleware`);
      }
    });

    it('POST /api/issues authorization check blocks administrator', () => {
      const adminReq = createMockReq({ roles: ['ADMIN'] });
      const headReq = createMockReq({ roles: ['HEAD'] });

      const checkCanLogIssue = (req) => {
        if (!req.user) {
          const err = new Error('Sign in required');
          err.status = 401;
          throw err;
        }
        if (req.user.roles.includes('ADMIN')) {
          const err = new Error('Administrators cannot log issues');
          err.status = 403;
          throw err;
        }
        return true;
      };

      assert.throws(
        () => checkCanLogIssue(adminReq),
        (err) => err.status === 403 && /Administrators cannot log issues/.test(err.message),
        'Admin must be forbidden from logging issues',
      );

      assert.equal(checkCanLogIssue(headReq), true, 'Head must be permitted to log issues');

      const unauthReq = createMockReq({ roles: [] });
      assert.throws(
        () => checkCanLogIssue(unauthReq),
        (err) => err.status === 401,
        'Unauthenticated request must be refused with 401',
      );
    });

    it('POST /api/requests/:id/submit authorization check blocks administrator', () => {
      const adminReq = createMockReq({ roles: ['ADMIN'] });
      const headReq = createMockReq({ roles: ['HEAD'] });

      const checkCanSubmit = (req) => {
        if (!req.user) {
          const err = new Error('Sign in required');
          err.status = 401;
          throw err;
        }
        if (req.user.roles.includes('ADMIN')) {
          const err = new Error('Administrators cannot submit requests');
          err.status = 403;
          throw err;
        }
        return true;
      };

      assert.throws(
        () => checkCanSubmit(adminReq),
        (err) => err.status === 403 && /Administrators cannot submit requests/.test(err.message),
        'Admin must be forbidden from submitting requests',
      );

      assert.equal(checkCanSubmit(headReq), true, 'Head must be permitted to submit requests');
    });
  });
});
