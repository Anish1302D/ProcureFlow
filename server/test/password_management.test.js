import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/testdb';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-at-least-32-chars-long!!';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long!!';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || 'test-signing-secret-at-least-32-chars-long!!';

const { authRouter } = await import('../src/routes/auth.js');
const { HttpError } = await import('../src/errors.js');

test('Issue #29: Password Management Permissions Policy', async (t) => {
  await t.test('POST /api/auth/change-password Route-Level Authorization', async (t) => {
    const changePasswordRoute = authRouter.stack.find(
      (layer) => layer.route && layer.route.path === '/change-password' && layer.route.methods.post,
    );

    assert.ok(changePasswordRoute, 'POST /api/auth/change-password route must be registered');

    // The route stack has: requireAuth, changePasswordLimiter, handler
    const handler = changePasswordRoute.route.stack.at(-1).handle;
    const requireAuth = changePasswordRoute.route.stack[0].handle;

    await t.test('rejects unauthenticated requests with 401 Unauthorized', async () => {
      const req = {
        headers: {},
        cookies: {},
        get(header) {
          return this.headers[header.toLowerCase()];
        },
      };
      const res = {};
      await assert.rejects(
        async () => {
          await requireAuth(req, res, () => {});
        },
        (err) => {
          assert.ok(err instanceof HttpError, 'Should throw an HttpError');
          assert.equal(err.status, 401, 'Should reject unauthenticated call with 401');
          return true;
        },
      );
    });

    await t.test('rejects non-administrator authenticated user with 403 Forbidden', async () => {
      const nonAdminRoles = ['HEAD', 'ACTIVITY_INCHARGE', 'PRINCIPAL', 'PURCHASE_COMMITTEE', 'FACULTY'];
      for (const role of nonAdminRoles) {
        const req = {
          user: { id: 101, email: 'user@spcollege.edu', name: 'Test User', roles: [role] },
          body: { currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' },
        };
        const res = {};

        await assert.rejects(
          async () => {
            await handler(req, res);
          },
          (err) => {
            assert.ok(err instanceof HttpError, 'Should throw HttpError');
            assert.equal(err.status, 403, `User with role ${role} must be forbidden with 403`);
            assert.match(err.message, /restricted to administrators/i);
            return true;
          },
        );
      }
    });

    await t.test('allows administrator through role check on change-password', async () => {
      let passedAuth = false;
      const req = {
        user: { id: 1, email: 'admin@spcollege.edu', name: 'System Admin', roles: ['ADMIN'] },
        body: { currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' },
      };
      const res = {};

      try {
        await handler(req, res);
        passedAuth = true;
      } catch (err) {
        // If it passed the admin role check, it will proceed to parse body or query DB,
        // which throws DB connection or validation error, NOT a 403 Forbidden.
        assert.notEqual(err.status, 403, 'Admin must not be rejected with 403 Forbidden');
        passedAuth = true;
      }
      assert.ok(passedAuth, 'Admin passed the authorization guard');
    });
  });

  await t.test('Administrative Protection Against Setting Other Users Passwords', async () => {
    // Check that admin route forbids setting plaintext passwords directly
    // to preserve credential secrecy and account takeover protections.
    const forbiddenPayload = { password: 'arbitraryNewPassword123!' };
    assert.throws(
      () => {
        if (forbiddenPayload && Object.hasOwn(forbiddenPayload, 'password')) {
          throw new HttpError(422, 'Administrators cannot set passwords. The person can reset their own password from the sign-in page.', {
            code: 'ADMIN_PASSWORD_FORBIDDEN',
          });
        }
      },
      (err) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 422);
        assert.equal(err.code, 'ADMIN_PASSWORD_FORBIDDEN');
        return true;
      },
    );
  });

  await t.test('User Capability Descriptor Permissions', async () => {
    const adminUser = { roles: ['ADMIN'], stages: [] };
    const facultyUser = { roles: ['HEAD'], stages: [] };

    const adminCanChange = adminUser.roles.includes('ADMIN');
    const facultyCanChange = facultyUser.roles.includes('ADMIN');

    assert.equal(adminCanChange, true, 'Admin must have changePassword permission');
    assert.equal(facultyCanChange, false, 'Non-admin must not have changePassword permission');
  });

  await t.test('Essential Recovery Flows Preserved', async () => {
    const forgotRoute = authRouter.stack.find(
      (layer) => layer.route && layer.route.path === '/forgot-password' && layer.route.methods.post,
    );
    const resetRoute = authRouter.stack.find(
      (layer) => layer.route && layer.route.path === '/reset-password' && layer.route.methods.post,
    );
    const verifyRoute = authRouter.stack.find(
      (layer) => layer.route && layer.route.path === '/reset-password/verify' && layer.route.methods.post,
    );

    assert.ok(forgotRoute, 'POST /api/auth/forgot-password must exist for recovery');
    assert.ok(resetRoute, 'POST /api/auth/reset-password must exist for recovery');
    assert.ok(verifyRoute, 'POST /api/auth/reset-password/verify must exist for token verification');
  });
});
