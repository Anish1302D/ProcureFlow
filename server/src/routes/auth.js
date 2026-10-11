import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { issueToken, requireAuth } from '../auth.js';
import { anonQuery, withUser } from '../db.js';
import { configService } from '../configService.js';
import { HttpError, conflict } from '../errors.js';
import { REQUESTER_ROLES, ISSUE_MANAGER_ROLES, INVENTORY_READER_ROLES, hasAnyRole } from '../roles.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(2).max(200),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  departmentId: z.number().int().positive().optional().nullable(),
  role: z.enum(['HEAD', 'ACTIVITY_INCHARGE']).optional().default('HEAD'),
});

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
// Public self-registration (controlled by dynamic configuration flag)
// ---------------------------------------------------------------------------
authRouter.get('/registration-status', async (_req, res) => {
  const enabled = await configService.isSelfRegistrationEnabled();
  res.json({ enabled });
});

authRouter.post('/register', loginIpLimiter, async (req, res) => {
  const enabled = await configService.isSelfRegistrationEnabled();
  if (!enabled) {
    throw new HttpError(403, 'Self-registration is currently disabled by administrator');
  }

  // Prevent privilege escalation or arbitrary role assignment
  if (req.body?.roles || req.body?.roleIds) {
    throw new HttpError(400, 'Direct role assignment is prohibited during self-registration');
  }

  const { email, fullName, password, departmentId, role } = registerSchema.parse(req.body);

  const dup = await anonQuery('SELECT 1 FROM users WHERE email = $1', [email]);
  if (dup.rowCount) {
    throw conflict('An account with this email already exists');
  }

  if (departmentId) {
    const deptCheck = await anonQuery('SELECT 1 FROM departments WHERE department_id = $1', [departmentId]);
    if (!deptCheck.rowCount) {
      throw new HttpError(422, 'Selected department does not exist');
    }
  }

  const assignedRoleCode = role === 'ACTIVITY_INCHARGE' ? 'ACTIVITY_INCHARGE' : 'HEAD';
  const roleRow = await anonQuery('SELECT role_id FROM roles WHERE code = $1', [assignedRoleCode]);
  if (!roleRow.rowCount) {
    throw new HttpError(500, 'Assigned role not found');
  }
  const roleId = roleRow.rows[0].role_id;

  const passwordHash = await bcrypt.hash(password, 12);

  const { rows: userRows } = await anonQuery(
    `INSERT INTO users (email, full_name, password_hash, department_id, is_active, token_version)
     VALUES ($1, $2, $3, $4, TRUE, 1)
     RETURNING user_id`,
    [email, fullName, passwordHash, departmentId ?? null],
  );
  const newUserId = userRows[0].user_id;

  await anonQuery(
    `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [newUserId, roleId],
  );

  await anonQuery(
    `INSERT INTO audit_logs (entity_type, entity_id, action, after_json)
     VALUES ('user', $1::text, 'SELF_REGISTER', jsonb_build_object('ip', $2::text, 'role', $3::text))`,
    [newUserId, req.ip, assignedRoleCode],
  );

  res.status(201).json({
    token: issueToken(newUserId, 1),
    user: await describe(newUserId),
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
    newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
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

  const newHash = await bcrypt.hash(newPassword, 12);
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

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await describe(req.user.id));
});


export const APPROVAL_BUDGET_ROLES = [
  'PRINCIPAL', 'CHAIRMAN', 'VICE_PRESIDENT',
  'CDC_MEMBER', 'CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER', 'ADMIN',
];

async function describe(userId) {
  const { rows } = await anonQuery(
    `SELECT u.user_id, u.email, u.full_name, u.department_id,
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
