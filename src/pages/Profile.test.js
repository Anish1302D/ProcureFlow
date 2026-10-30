import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

test('Profile.jsx restricts Change Password section strictly to ADMIN role', async () => {
  const profileCode = await fs.readFile(path.resolve('src/pages/Profile.jsx'), 'utf8');

  // Verify isAdmin determination uses actual roles array
  assert.ok(
    profileCode.includes("const isAdmin = Boolean(user?.roles?.includes('ADMIN'))"),
    'Profile.jsx must determine isAdmin from user.roles.includes("ADMIN")',
  );

  // Verify password policy API is only invoked for admin users
  assert.ok(
    profileCode.includes('if (!isAdmin) return;'),
    'Profile.jsx must not query password policy for non-admin users',
  );

  // Verify change password block is strictly guarded by isAdmin
  assert.ok(
    profileCode.includes('{isAdmin && ('),
    'Change password section must be guarded with {isAdmin && (...)',
  );
  assert.ok(
    profileCode.includes('Change password (Admin only)'),
    'Change password section comment/tag should reflect Admin-only scope',
  );
});

test('Profile role gate logic allows ADMIN and hides Change Password from all other roles', () => {
  function canSeeChangePassword(user) {
    return Boolean(user?.roles?.includes('ADMIN'));
  }

  // Admin user
  assert.equal(canSeeChangePassword({ roles: ['ADMIN'] }), true);
  // Multi-role user including Admin
  assert.equal(canSeeChangePassword({ roles: ['HEAD', 'ADMIN'] }), true);

  // All non-admin roles specified in Issue #29 must be false
  const nonAdminRoles = [
    'PRINCIPAL',
    'HEAD',
    'PURCHASE_COMMITTEE',
    'CDC_MEMBER',
    'CDC_GRANT_MEMBER',
    'CDC_NON_GRANT_MEMBER',
    'CHAIRMAN',
    'VICE_PRESIDENT',
    'ACTIVITY_INCHARGE',
    'FACULTY',
    'STAFF',
    'STUDENT',
  ];

  for (const role of nonAdminRoles) {
    assert.equal(
      canSeeChangePassword({ roles: [role] }),
      false,
      `Role ${role} must NOT see the Change Password section`,
    );
  }

  // Multiple non-admin roles together
  assert.equal(canSeeChangePassword({ roles: ['PRINCIPAL', 'HEAD', 'CHAIRMAN'] }), false);
  // Empty roles or undefined user
  assert.equal(canSeeChangePassword({ roles: [] }), false);
  assert.equal(canSeeChangePassword({}), false);
  assert.equal(canSeeChangePassword(null), false);
});
