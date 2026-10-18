import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { issueToken, requireAuth } from '../auth.js';
import { anonQuery, withUser } from '../db.js';
import { HttpError } from '../errors.js';
import { NO_STORE, assertTokenShape, hashToken, linkError } from '../oneTimeLinks.js';
import { assertPasswordAcceptable, hashPassword, passwordRules } from '../passwordPolicy.js';
import { REQUESTER_ROLES, ISSUE_MANAGER_ROLES, INVENTORY_READER_ROLES, hasAnyRole } from '../roles.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

const setupAccountSchema = z.object({
  token: z.string().trim().min(1).max(256),
  password: z.string().min(1, 'Choose a password').max(200),
});

const tokenOnlySchema = z.object({ token: z.string().trim().min(1).max(256) });

// Global IP rate limiter to protect against credential stuffing across accounts.
// 60 attempts per 15 minutes per IP allows shared campus networks while blocking automated attacks.
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, _res, next) => {
    next(new HttpError(429, 'Too many sign-in attempts from this network. Try again later.'));
  },
});

// Ten attempts per quarter hour for each address from each client. Keyed on
// both, so one person mistyping cannot lock out a shared college network.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${String(req.body?.email ?? '').toLowerCase()}`,
  handler: (_req, _res, next) => {
    next(new HttpError(429, 'Too many sign-in attempts. Try again in a few minutes.'));
  },
});

// Thirty attempts per 15 minutes per IP for verifying setup tokens to mitigate brute-forcing.
export const verifySetupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, _res, next) => {
    next(new HttpError(429, 'Too many token verification attempts. Try again later.'));
  },
});

// Ten attempts per 15 minutes per IP for completing account setup.
export const setupAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, _res, next) => {
    next(new HttpError(429, 'Too many account setup attempts. Try again later.'));
  },
});


// An unknown address is checked against this hash anyway, so a missing
// account and a wrong password take the same time to answer. Otherwise the
// response time alone would reveal which addresses have accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

authRouter.post('/login', loginIpLimiter, loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  // Passwords are compared here, in the API, rather than with crypt() in SQL:
  // that would send the plaintext to the database, where statement logging
  // could record it. pgcrypto's bcrypt hashes are standard $2a$ hashes.
  let rows;
  try {
    const res = await anonQuery(
      `SELECT user_id, password_hash, COALESCE(token_version, 1) AS token_version
         FROM users WHERE email = $1 AND is_active`,
      [email],
    );
    rows = res.rows;
  } catch (err) {
    if (err.code === '42703') {
      throw new HttpError(
        503,
        'Authentication service unavailable: required database migration 20261011T120000_add_user_token_version.sql is required',
        { code: 'MIGRATION_REQUIRED' },
      );
    }
    throw err;
  }
  const account = rows[0];
  const valid = await bcrypt.compare(password, account?.password_hash ?? DUMMY_HASH);

  if (!account || !valid) {
    await anonQuery(
      `INSERT INTO audit_logs (entity_type, entity_id, action, after_json)
       VALUES ('user', $1, 'LOGIN_FAILED', jsonb_build_object('ip', $2::text))`,
      [email, req.ip],
    );
    throw new HttpError(401, 'Incorrect email or password');
  }

  await withUser(account.user_id, (db) =>
    db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ('user', $1::text, $1::uuid, 'LOGIN', jsonb_build_object('ip', $2::text))`,
      [account.user_id, req.ip],
    ),
  );

  res.json({
    token: issueToken(account.user_id, account.token_version),
    user: await describe(account.user_id),
  });
});

// Signing out is the client discarding its token; there is no server session.
authRouter.post('/logout', requireAuth, (_req, res) => {
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Accepting an invitation
// ---------------------------------------------------------------------------
// The link's token travels in the request body, never in a URL, so it cannot
// be written to an access log. Responses are never cached.

/** The invitation behind a token, or the reason it cannot be used. */
async function liveInvitation(token) {
  assertTokenShape(token);
  const { rows } = await anonQuery(
    'SELECT status, user_id, email, full_name FROM fn_verify_account_setup_token($1)',
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row || row.status !== 'VALID') throw linkError(row?.status ?? 'INVALID', 'invitation');
  return row;
}

authRouter.post('/verify-setup-token', verifySetupLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { token } = tokenOnlySchema.parse(req.body ?? {});
  const invite = await liveInvitation(token);
  const { rows: roles } = await anonQuery(
    'SELECT r.name FROM user_roles ur JOIN roles r ON r.role_id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name',
    [invite.user_id],
  );
  res.json({
    valid: true,
    email: invite.email,
    fullName: invite.full_name,
    roles: roles.map((r) => r.name),
    passwordRules: await passwordRules(),
  });
});

authRouter.post('/setup-account', setupAccountLimiter, loginIpLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { token, password } = setupAccountSchema.parse(req.body);

  // The policy is checked against the invitee before the link is used, so a
  // refused password leaves the invitation intact to try again.
  const invite = await liveInvitation(token);
  await assertPasswordAcceptable(password, { email: invite.email, fullName: invite.full_name });

  let consumed;
  try {
    ({ rows: [consumed] } = await anonQuery(
      'SELECT user_id, token_version FROM fn_consume_account_setup_token($1, $2, $3)',
      [hashToken(token), await hashPassword(password), req.ip || 'unknown'],
    ));
  } catch (err) {
    throw linkError(err.code, 'invitation') ?? err;
  }
  if (!consumed) throw linkError('INVALID', 'invitation');

  res.json({
    token: issueToken(consumed.user_id, consumed.token_version ?? 1),
    user: await describe(consumed.user_id),
  });
});


// Five password change attempts per quarter hour per user/IP.
const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${req.user?.id || ''}`,
  handler: (_req, _res, next) => {
    next(new HttpError(429, 'Too many password change attempts. Try again in 15 minutes.'));
  },
});

// Self-service password change. Requires knowing the current password.
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required').max(200),
    newPassword: z.string().min(1, 'Choose a new password').max(200),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

authRouter.post('/change-password', requireAuth, changePasswordLimiter, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

  const { rows } = await anonQuery(
    'SELECT password_hash FROM users WHERE user_id = $1 AND is_active',
    [req.user.id],
  );
  const account = rows[0];
  if (!account) throw new HttpError(401, 'Account not found');

  const valid = await bcrypt.compare(currentPassword, account.password_hash);
  if (!valid) throw new HttpError(401, 'Current password is incorrect');

  await assertPasswordAcceptable(newPassword, { email: req.user.email, fullName: req.user.name });
  const newHash = await hashPassword(newPassword);
  await withUser(req.user.id, async (db) => {
    try {
      await db.query(
        'UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 1) + 1, updated_at = NOW() WHERE user_id = $2',
        [newHash, req.user.id],
      );
    } catch (err) {
      if (err.code === '42703') {
        throw new HttpError(
          503,
          'Password change and session revocation unavailable: database migration 20261011T120000_add_user_token_version.sql is required',
          { code: 'MIGRATION_REQUIRED' },
        );
      }
      throw err;
    }
  });

  res.status(204).end();
});

// The password rules, so every page shows the real policy rather than a copy.
authRouter.get('/password-policy', async (_req, res) => {
  res.json(await passwordRules());
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await describe(req.user.id));
});


export const APPROVAL_BUDGET_ROLES = [
  'PRINCIPAL', 'CHAIRMAN', 'VICE_PRESIDENT',
  'CDC_MEMBER', 'CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER', 'ADMIN',
];

async function describe(userId) {
  const { rows } = await anonQuery(
    `SELECT u.user_id, u.email, u.full_name, u.employee_id, u.department_id,
            d.name AS department_name, d.code AS department_code,
            ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.role_id = ur.role_id
                   WHERE ur.user_id = u.user_id ORDER BY r.code) AS roles,
            COALESCE((SELECT json_agg(json_build_object('stageId', ws.stage_id, 'code', ws.code,
                                                        'name', ws.name) ORDER BY ws.sequence_no)
                        FROM stage_approvers sa JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
                       WHERE sa.user_id = u.user_id), '[]') AS stages
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
      WHERE u.user_id = $1`,
    [userId],
  );
  const u = rows[0];
  const user = { id: u.user_id, roles: u.roles };
  return {
    id: u.user_id,
    email: u.email,
    name: u.full_name,
    employeeId: u.employee_id ?? null,
    departmentId: u.department_id,
    departmentName: u.department_name,
    departmentCode: u.department_code,
    roles: u.roles,
    stages: u.stages,
    // Hints for showing and hiding UI. The server enforces every one of these
    // independently — they grant nothing on their own.
    can: {
      raiseRequests: hasAnyRole(user, REQUESTER_ROLES),
      manageIssues: hasAnyRole(user, ISSUE_MANAGER_ROLES),
      viewInventory: hasAnyRole(user, INVENTORY_READER_ROLES),
      viewAudit: u.roles.includes('ADMIN'),
      approve: u.stages.length > 0,
      downloadApprovalBudget: hasAnyRole(user, APPROVAL_BUDGET_ROLES),
    },
  };
}
