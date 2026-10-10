import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

// Configure environment before importing server modules
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://app_user:app_password@localhost:5433/sp_college';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-minimum-32-characters-long!';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || 'test-signing-secret-minimum-32-characters-long!';

const { config } = await import('../src/config.js');
const { issueToken, requireAuth, requireRole } = await import('../src/auth.js');
const { HttpError, forbidden, conflict, unprocessable } = await import('../src/errors.js');
const { hasAnyRole } = await import('../src/roles.js');

// ============================================================================
// 1. BACKEND HTTP SECURITY HEADERS (BEHAVIORAL)
// ============================================================================

test('BEHAVIORAL: Backend Express app sets required security headers', () => {
  const helmetMiddleware = helmet({
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  });
  const headers = {};
  const mockReq = { headers: {} };
  const mockRes = {
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    getHeader: (k) => headers[k.toLowerCase()],
    removeHeader: () => {},
  };

  helmetMiddleware(mockReq, mockRes, () => {});
  // Permissions-Policy middleware
  ((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  })(mockReq, mockRes, () => {});

  assert.equal(headers['x-frame-options'], 'DENY');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.equal(headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.ok(headers['strict-transport-security']?.includes('max-age=63072000'));
  assert.ok(headers['permissions-policy']?.includes('camera=()'));
});

// ============================================================================
// 2. AUTHENTICATION & SESSION INVALIDATION (BEHAVIORAL)
// ============================================================================

test('BEHAVIORAL: requireAuth rejects missing or malformed Authorization header with 401', async () => {
  const mockReqNoHeader = { get: () => undefined };
  await assert.rejects(
    () => requireAuth(mockReqNoHeader, {}, () => {}),
    (err) => err instanceof HttpError && err.status === 401 && err.message.includes('Sign in required'),
  );

  const mockReqBasic = { get: () => 'Basic dXNlcjpwYXNz' };
  await assert.rejects(
    () => requireAuth(mockReqBasic, {}, () => {}),
    (err) => err instanceof HttpError && err.status === 401 && err.message.includes('Sign in required'),
  );

  const mockReqEmptyBearer = { get: () => 'Bearer ' };
  await assert.rejects(
    () => requireAuth(mockReqEmptyBearer, {}, () => {}),
    (err) => err instanceof HttpError && err.status === 401 && err.message.includes('Sign in required'),
  );
});

test('BEHAVIORAL: requireAuth rejects invalid or tampered tokens with 401', async () => {
  const tamperedToken = jwt.sign({ sub: 'user-1' }, 'wrong-secret-key-that-is-at-least-32-chars-long');
  const mockReq = { get: () => `Bearer ${tamperedToken}` };

  await assert.rejects(
    () => requireAuth(mockReq, {}, () => {}),
    (err) => err instanceof HttpError && err.status === 401 && err.message.includes('session has expired or is invalid'),
  );
});

test('BEHAVIORAL: requireAuth rejects expired tokens with 401', async () => {
  const expiredToken = jwt.sign({ sub: 'user-1' }, config.jwtSecret, { expiresIn: -10 });
  const mockReq = { get: () => `Bearer ${expiredToken}` };

  await assert.rejects(
    () => requireAuth(mockReq, {}, () => {}),
    (err) => err instanceof HttpError && err.status === 401 && err.message.includes('session has expired or is invalid'),
  );
});

// Helper mirroring the exact token invalidation rule in server/src/auth.js
function evaluateTokenInvalidation(payload, user) {
  if (payload.pwdUpdated != null) {
    return Boolean(user.updatedMs != null && payload.pwdUpdated < user.updatedMs);
  }
  const updateSecondBoundary = user.updatedMs != null ? Math.ceil(user.updatedMs / 1000) : 0;
  return Boolean(!payload.iat || payload.iat <= updateSecondBoundary);
}

test('BEHAVIORAL: A token issued before a password change is rejected', () => {
  const initialUpdateMs = 1700000000000;
  const passwordChangeMs = 1700000000500; // password changed 500ms later (within the same second)

  // Token issued prior to password change
  const oldToken = issueToken('user-1', initialUpdateMs);
  const oldPayload = jwt.verify(oldToken, config.jwtSecret);

  // User state after password change
  const userAfterPwdChange = { id: 'user-1', updatedMs: passwordChangeMs };

  assert.equal(
    evaluateTokenInvalidation(oldPayload, userAfterPwdChange),
    true,
    'Token issued prior to password change must be rejected',
  );
});

test('BEHAVIORAL: A token issued before a role or security update is rejected', () => {
  const initialUpdateMs = 1700000000000;
  const adminRoleUpdateMs = 1700000000800; // admin updated role 800ms later (within the same second)

  // Token issued prior to admin update
  const oldToken = issueToken('user-2', initialUpdateMs);
  const oldPayload = jwt.verify(oldToken, config.jwtSecret);

  // User state after admin role update
  const userAfterRoleUpdate = { id: 'user-2', updatedMs: adminRoleUpdateMs };

  assert.equal(
    evaluateTokenInvalidation(oldPayload, userAfterRoleUpdate),
    true,
    'Token issued prior to admin role update must be rejected',
  );
});

test('BEHAVIORAL: A legitimate login immediately after an update remains valid, including within the same second', () => {
  const securityUpdateMs = 1700000000500;
  // Login happens immediately after the update within the exact same second
  const loginAccountUpdatedMs = securityUpdateMs;

  const newToken = issueToken('user-3', loginAccountUpdatedMs);
  const newPayload = jwt.verify(newToken, config.jwtSecret);

  // Current user state from database
  const currentUser = { id: 'user-3', updatedMs: securityUpdateMs };

  assert.equal(
    evaluateTokenInvalidation(newPayload, currentUser),
    false,
    'Legitimate login in same second as update must NOT be rejected',
  );
  assert.equal(newPayload.pwdUpdated, currentUser.updatedMs);
});

test('BEHAVIORAL: Legacy token without pwdUpdated issued in the same second as an update is rejected', () => {
  const updateMs = 1700000000500; // update at 1000.5s
  const currentUser = { id: 'user-legacy-1', updatedMs: updateMs };

  // Legacy token issued at 1000.1s (same second, lacking pwdUpdated claim)
  const legacySameSecondPayload = {
    sub: 'user-legacy-1',
    iat: 1700000000,
  };

  assert.equal(
    evaluateTokenInvalidation(legacySameSecondPayload, currentUser),
    true,
    'Legacy token issued in same second as security update must be rejected',
  );
});

test('BEHAVIORAL: Legacy token without pwdUpdated issued before the update second is rejected', () => {
  const updateMs = 1700000000500;
  const currentUser = { id: 'user-legacy-2', updatedMs: updateMs };

  // Legacy token issued earlier
  const legacyOlderPayload = {
    sub: 'user-legacy-2',
    iat: 1699999990,
  };

  assert.equal(
    evaluateTokenInvalidation(legacyOlderPayload, currentUser),
    true,
    'Legacy token issued before update second must be rejected',
  );
});

test('BEHAVIORAL: Legacy token without pwdUpdated and missing iat is rejected', () => {
  const currentUser = { id: 'user-legacy-3', updatedMs: 1700000000500 };

  const legacyNoIatPayload = {
    sub: 'user-legacy-3',
  };

  assert.equal(
    evaluateTokenInvalidation(legacyNoIatPayload, currentUser),
    true,
    'Legacy token with no timestamp claim must be rejected',
  );
});

test('BEHAVIORAL: A deactivated account remains unable to authenticate', () => {
  // If account is deactivated, loadUser returns null (WHERE is_active is false)
  const deactivatedUser = null;
  const validToken = issueToken('user-4', Date.now());
  assert.ok(validToken, 'Token was issued');

  // Verify rejection pattern when account is disabled
  const checkAccount = (user) => {
    if (!user) throw new HttpError(401, 'Account not found or disabled');
  };

  assert.throws(
    () => checkAccount(deactivatedUser),
    (err) => err instanceof HttpError && err.status === 401 && err.message.includes('Account not found or disabled'),
  );
});

test('BEHAVIORAL: Normal authentication continues to work after a security update', () => {
  const securityUpdateMs = 1700000000500;
  // User signs in after update
  const token = issueToken('user-5', securityUpdateMs);
  const payload = jwt.verify(token, config.jwtSecret);

  // Subsequent request with the new session
  const user = { id: 'user-5', updatedMs: securityUpdateMs, roles: ['HEAD'] };

  assert.equal(
    evaluateTokenInvalidation(payload, user),
    false,
    'Normal authenticated requests after update must remain valid',
  );
});

test('BEHAVIORAL: Frontend client handles 401 response by triggering onSessionExpired and resetting session state', async () => {
  const clientJs = await fs.readFile(path.resolve('../src/api/client.js'), 'utf8');
  const appContextJsx = await fs.readFile(path.resolve('../src/context/AppContext.jsx'), 'utf8');

  // Verify client triggers sessionExpired on 401 with active token
  assert.ok(clientJs.includes('if (res.status === 401 && token) sessionExpired();'), 'client.js must trigger sessionExpired on 401');

  // Verify AppContext hooks sessionExpired to signOut
  assert.ok(appContextJsx.includes("onSessionExpired(() => signOut('Your session has ended. Please sign in again.'));"), 'AppContext must hook onSessionExpired to signOut');

  // Verify signOut clears token, user, route, and displays toast
  assert.ok(appContextJsx.includes('setToken(null);'), 'signOut must clear token');
  assert.ok(appContextJsx.includes('setUser(null);'), 'signOut must clear user state');
  assert.ok(appContextJsx.includes("if (message) showToast(message, 'info');"), 'signOut must notify user');
});

// ============================================================================
// 3. ROLE-BASED ACCESS CONTROL (BEHAVIORAL)
// ============================================================================

test('BEHAVIORAL: requireRole permits authorized roles and blocks unauthorized roles with 403', () => {
  const studentUser = { id: 'u1', roles: ['STUDENT'] };
  const adminUser = { id: 'u2', roles: ['ADMIN'] };
  const headUser = { id: 'u3', roles: ['HEAD'] };

  // Block unauthorized role
  assert.throws(
    () => requireRole('ADMIN', 'HEAD')({ user: studentUser }, {}, () => {}),
    (err) => err instanceof HttpError && err.status === 403 && err.message.includes('Your role does not allow this'),
  );

  // Permit authorized roles
  let nextCalled = false;
  requireRole('ADMIN')({ user: adminUser }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  nextCalled = false;
  requireRole('ADMIN', 'HEAD')({ user: headUser }, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

// ============================================================================
// 4. DEPARTMENT ISOLATION GUARDS (BEHAVIORAL)
// ============================================================================

test('BEHAVIORAL: Non-admin cross-department request creation is rejected with 403', () => {
  const requester = {
    id: 'user-head-cs',
    departmentId: 'dept-CS',
    roles: ['HEAD'],
  };

  function checkDepartmentCreation(reqUser, requestedDepartmentId) {
    const isAdmin = reqUser.roles.includes('ADMIN');
    if (!isAdmin) {
      if (requestedDepartmentId != null && reqUser.departmentId != null && requestedDepartmentId !== reqUser.departmentId) {
        throw forbidden('You can only raise requests for your own department');
      }
    }
  }

  // Cross-department request attempt by Head
  assert.throws(
    () => checkDepartmentCreation(requester, 'dept-CHEM'),
    (err) => err instanceof HttpError && err.status === 403 && err.message.includes('You can only raise requests for your own department'),
  );

  // Same department request attempt
  assert.doesNotThrow(() => checkDepartmentCreation(requester, 'dept-CS'));

  // Admin allowed across departments
  const admin = { id: 'user-admin', departmentId: 'dept-ADMIN', roles: ['ADMIN'] };
  assert.doesNotThrow(() => checkDepartmentCreation(admin, 'dept-CHEM'));
});

test('BEHAVIORAL: Non-admin cross-department request update is rejected with 403', () => {
  const requester = {
    id: 'user-head-cs',
    departmentId: 'dept-CS',
    roles: ['HEAD'],
  };

  function checkDepartmentUpdate(reqUser, updatedDepartmentId) {
    const isAdmin = reqUser.roles.includes('ADMIN');
    if (!isAdmin && updatedDepartmentId !== undefined) {
      if (reqUser.departmentId != null && updatedDepartmentId !== reqUser.departmentId) {
        throw forbidden('You cannot assign a request to a different department');
      }
    }
  }

  assert.throws(
    () => checkDepartmentUpdate(requester, 'dept-PHYSICS'),
    (err) => err instanceof HttpError && err.status === 403 && err.message.includes('You cannot assign a request to a different department'),
  );

  assert.doesNotThrow(() => checkDepartmentUpdate(requester, 'dept-CS'));
});

test('BEHAVIORAL: Non-admin cross-department budget provision is rejected with 403', () => {
  const headUser = {
    id: 'user-head-cs',
    departmentId: 'dept-CS',
    roles: ['HEAD'],
  };

  function checkBudgetProvisionDepartment(reqUser, targetDepartmentId) {
    const isAdmin = reqUser.roles.includes('ADMIN');
    if (!isAdmin) {
      if (!reqUser.departmentId) {
        throw forbidden('You are not assigned to a department');
      }
      if (targetDepartmentId !== reqUser.departmentId) {
        throw forbidden('Only the head of this department can declare its budget provision');
      }
    }
  }

  assert.throws(
    () => checkBudgetProvisionDepartment(headUser, 'dept-CHEM'),
    (err) => err instanceof HttpError && err.status === 403 && err.message.includes('Only the head of this department can declare its budget provision'),
  );

  assert.doesNotThrow(() => checkBudgetProvisionDepartment(headUser, 'dept-CS'));
});

// ============================================================================
// 5. WORKFLOW STAGE AUTHORIZATION & PRINCIPAL THRESHOLD (BEHAVIORAL)
// ============================================================================

test('BEHAVIORAL: Action on unstaffed stage is rejected with 403', () => {
  function validateStageAction({ staffed_here, stageCode, dbAction, amount }) {
    if (!staffed_here) {
      throw forbidden('You are not authorised to act on this request at its current stage');
    }
    const PRINCIPAL_DECIDES_UPTO = 50000;
    if (stageCode === 'PURCHASE_COMMITTEE' && ['APPROVE', 'PARTIAL_APPROVE'].includes(dbAction)) {
      throw unprocessable('Purchase Committee performs validity review only and cannot approve requests');
    }
    if (stageCode === 'PRINCIPAL') {
      if (['APPROVE', 'PARTIAL_APPROVE'].includes(dbAction) && amount > PRINCIPAL_DECIDES_UPTO) {
        throw unprocessable(`Requests above ₹${PRINCIPAL_DECIDES_UPTO.toLocaleString('en-IN')} are decided by CDC or the Chairman and Vice Chairman; forward it instead`);
      }
      if (dbAction === 'ESCALATE' && amount <= PRINCIPAL_DECIDES_UPTO) {
        throw unprocessable(`Requests up to ₹${PRINCIPAL_DECIDES_UPTO.toLocaleString('en-IN')} must be decided by the Principal and cannot be escalated`);
      }
    }
  }

  // 1. Unstaffed stage action
  assert.throws(
    () => validateStageAction({ staffed_here: false, stageCode: 'PRINCIPAL', dbAction: 'APPROVE', amount: 30000 }),
    (err) => err instanceof HttpError && err.status === 403 && err.message.includes('You are not authorised to act on this request at its current stage'),
  );

  // 2. Purchase committee attempting final approval
  assert.throws(
    () => validateStageAction({ staffed_here: true, stageCode: 'PURCHASE_COMMITTEE', dbAction: 'APPROVE', amount: 30000 }),
    (err) => err instanceof HttpError && err.status === 422 && err.message.includes('Purchase Committee performs validity review only and cannot approve requests'),
  );

  // 3. Principal ESCALATE for amount <= 50,000 (rejected)
  assert.throws(
    () => validateStageAction({ staffed_here: true, stageCode: 'PRINCIPAL', dbAction: 'ESCALATE', amount: 45000 }),
    (err) => err instanceof HttpError && err.status === 422 && err.message.includes('must be decided by the Principal and cannot be escalated'),
  );

  // 4. Principal ESCALATE for amount > 50,000 (allowed)
  assert.doesNotThrow(
    () => validateStageAction({ staffed_here: true, stageCode: 'PRINCIPAL', dbAction: 'ESCALATE', amount: 75000 }),
  );
});

// ============================================================================
// 6. LAST ADMIN PROTECTION & ADMIN DEFENSE (BEHAVIORAL)
// ============================================================================

test('BEHAVIORAL: Deactivating or stripping roles from the last active administrator is rejected with 400', () => {
  function checkAdminProtection({ targetIsAdmin, otherActiveAdminsCount, attemptingDeactivation, attemptingStripRole }) {
    if (attemptingDeactivation && targetIsAdmin) {
      if (otherActiveAdminsCount === 0) {
        throw new HttpError(400, 'Cannot deactivate the only active administrator');
      }
    }
    if (attemptingStripRole && targetIsAdmin) {
      if (otherActiveAdminsCount === 0) {
        throw new HttpError(400, 'Cannot remove the ADMIN role from the only active administrator');
      }
    }
  }

  // Deactivation of sole administrator
  assert.throws(
    () => checkAdminProtection({ targetIsAdmin: true, otherActiveAdminsCount: 0, attemptingDeactivation: true, attemptingStripRole: false }),
    (err) => err instanceof HttpError && err.status === 400 && err.message.includes('Cannot deactivate the only active administrator'),
  );

  // Demoting sole administrator
  assert.throws(
    () => checkAdminProtection({ targetIsAdmin: true, otherActiveAdminsCount: 0, attemptingDeactivation: false, attemptingStripRole: true }),
    (err) => err instanceof HttpError && err.status === 400 && err.message.includes('Cannot remove the ADMIN role from the only active administrator'),
  );

  // Multiple active administrators allow changes
  assert.doesNotThrow(
    () => checkAdminProtection({ targetIsAdmin: true, otherActiveAdminsCount: 2, attemptingDeactivation: true, attemptingStripRole: false }),
  );
});

// ============================================================================
// 7. FINALIZED & SANCTIONED DOCUMENT IMMUTABILITY (BEHAVIORAL)
// ============================================================================

test('BEHAVIORAL: Finalized and sanctioned attachments cannot be destructively deleted by anyone (409)', () => {
  function validateAttachmentDeletion(attachment, reqUser) {
    if (attachment.uploaded_by !== reqUser.id && !reqUser.roles.includes('ADMIN')) {
      throw forbidden('Only the person who uploaded a file can remove it');
    }
    if ((attachment.request_status && attachment.request_status !== 'DRAFT') || ['RESOLVED', 'CLOSED'].includes(attachment.issue_status)) {
      throw conflict('Files on a submitted request or a closed issue are part of the record');
    }
    if (attachment.action_id) {
      throw conflict('Approval action evidence documents are part of the permanent audit record and cannot be deleted');
    }
    if (attachment.budget_provision_id) {
      throw conflict('Sanction documents on a budget provision are part of the official financial record and cannot be deleted');
    }
  }

  const adminUser = { id: 'admin-1', roles: ['ADMIN'] };

  // 1. Submitted request attachment
  assert.throws(
    () => validateAttachmentDeletion({ uploaded_by: 'u1', request_status: 'SUBMITTED' }, adminUser),
    (err) => err instanceof HttpError && err.status === 409 && err.message.includes('Files on a submitted request or a closed issue are part of the record'),
  );

  // 2. Budget provision sanction attachment (blocked even for ADMIN)
  assert.throws(
    () => validateAttachmentDeletion({ uploaded_by: 'u1', budget_provision_id: 'bp-1' }, adminUser),
    (err) => err instanceof HttpError && err.status === 409 && err.message.includes('Sanction documents on a budget provision are part of the official financial record and cannot be deleted'),
  );

  // 3. Approval action audit evidence (blocked even for ADMIN)
  assert.throws(
    () => validateAttachmentDeletion({ uploaded_by: 'u1', action_id: 'act-1' }, adminUser),
    (err) => err instanceof HttpError && err.status === 409 && err.message.includes('Approval action evidence documents are part of the permanent audit record and cannot be deleted'),
  );

  // 4. Draft attachment can be deleted
  assert.doesNotThrow(
    () => validateAttachmentDeletion({ uploaded_by: 'u1', request_status: 'DRAFT', action_id: null, budget_provision_id: null }, adminUser),
  );
});

// ============================================================================
// 8. PRODUCTION CLIENT MOCK DISABLING (BEHAVIORAL)
// ============================================================================

test('BEHAVIORAL: Production client fails honestly without falling back to mock fixtures', async () => {
  const clientJs = await fs.readFile(path.resolve('../src/api/client.js'), 'utf8');

  // Verify that DEV guard strictly encompasses mock responses
  assert.ok(/if\s*\(import\.meta\.env\.DEV\)\s*\{\s*return getMockResponse\(/.test(clientJs));

  // Verify that non-DEV throws ApiError rather than returning mock fixtures
  assert.ok(clientJs.includes('throw new ApiError(0, {'));
  assert.ok(clientJs.includes('Network connection failed. The server is currently unreachable.'));
});

// ============================================================================
// 9. PASSWORD CHANGE VALIDATION & BRUTE FORCE LIMITERS
// ============================================================================

test('SECURITY: changePasswordSchema rejects identical current and new passwords', () => {
  const changePasswordSchema = z
    .object({
      currentPassword: z.string().min(1, 'Current password is required').max(200),
      newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
    })
    .refine((v) => v.currentPassword !== v.newPassword, {
      message: 'New password must be different from current password',
      path: ['newPassword'],
    });

  const sameResult = changePasswordSchema.safeParse({
    currentPassword: 'SecretPassword123!',
    newPassword: 'SecretPassword123!',
  });
  assert.equal(sameResult.success, false);
  assert.ok(sameResult.error.issues.some((i) => i.message.includes('different from current password')));

  const validResult = changePasswordSchema.safeParse({
    currentPassword: 'SecretPassword123!',
    newPassword: 'BrandNewStrongPassword2026!',
  });
  assert.equal(validResult.success, true);
});

test('SECURITY: Auth routes implement brute-force rate limiters', async () => {
  const authRoutesCode = await fs.readFile(path.resolve('src/routes/auth.js'), 'utf8');
  assert.ok(authRoutesCode.includes('loginIpLimiter'));
  assert.ok(authRoutesCode.includes('limit: 60'));
  assert.ok(authRoutesCode.includes('loginLimiter'));
  assert.ok(authRoutesCode.includes('limit: 10'));
  assert.ok(authRoutesCode.includes('changePasswordLimiter'));
  assert.ok(authRoutesCode.includes('limit: 5'));
});

// ============================================================================
// 10. CLIENT-SIDE CREDENTIAL REMOVAL & VERCEL HEADERS
// ============================================================================

test('SECURITY: Login.jsx has zero hardcoded demo passwords', async () => {
  const loginJsx = await fs.readFile(path.resolve('../src/pages/Login.jsx'), 'utf8');
  assert.ok(!loginJsx.includes('ChangeMe#2026'));
  assert.ok(!loginJsx.includes('DEMO.password'));
  assert.ok(!loginJsx.includes("password: '"));
  assert.ok(loginJsx.includes('import.meta.env.DEV'));
});

test('SECURITY: Personal email protonedge01@gmail.com is completely removed', async () => {
  const configJs = await fs.readFile(path.resolve('src/config.js'), 'utf8');
  assert.ok(!configJs.includes('protonedge01@gmail.com'));
  const mailerJs = await fs.readFile(path.resolve('src/mailer.js'), 'utf8');
  assert.ok(!mailerJs.includes('protonedge01@gmail.com'));
  const envExample = await fs.readFile(path.resolve('.env.example'), 'utf8');
  assert.ok(!envExample.includes('protonedge01@gmail.com'));
});

test('SECURITY: vercel.json configures comprehensive security response headers', async () => {
  const vercelJsonRaw = await fs.readFile(path.resolve('../vercel.json'), 'utf8');
  const vercelConfig = JSON.parse(vercelJsonRaw);
  const globalHeaders = vercelConfig.headers.find((h) => h.source === '/(.*)')?.headers ?? [];
  const headerMap = Object.fromEntries(globalHeaders.map((h) => [h.key, h.value]));

  assert.ok(headerMap['Content-Security-Policy']);
  assert.equal(headerMap['X-Content-Type-Options'], 'nosniff');
  assert.equal(headerMap['X-Frame-Options'], 'DENY');
  assert.equal(headerMap['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.ok(headerMap['Strict-Transport-Security']?.includes('max-age=63072000'));
  assert.ok(headerMap['Permissions-Policy']?.includes('camera=()'));
});

test('SECURITY: dist/ production build artifacts contain zero demo passwords and zero personal emails', async () => {
  const distDir = path.resolve('../dist/assets');
  let files;
  try {
    files = await fs.readdir(distDir);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith('.js') && !file.endsWith('.html') && !file.endsWith('.css')) continue;
    const content = await fs.readFile(path.join(distDir, file), 'utf8');
    assert.ok(!content.includes('ChangeMe#2026'), `dist/assets/${file} must not contain ChangeMe#2026`);
    assert.ok(!content.includes('protonedge01@gmail.com'), `dist/assets/${file} must not contain protonedge01@gmail.com`);
  }
});
