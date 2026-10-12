import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { issueToken, requireAuth } from '../auth.js';
import { anonQuery, withUser } from '../db.js';
import { HttpError } from '../errors.js';
import { REQUESTER_ROLES, ISSUE_MANAGER_ROLES, INVENTORY_READER_ROLES, hasAnyRole } from '../roles.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

// Ten attempts per quarter hour for each address from each client. Keyed on
// both, so one person mistyping cannot lock out a shared college network.
const loginLimiter = rateLimit({
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

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  // Passwords are compared here, in the API, rather than with crypt() in SQL:
  // that would send the plaintext to the database, where statement logging
  // could record it. pgcrypto's bcrypt hashes are standard $2a$ hashes.
  const { rows } = await anonQuery(
    'SELECT user_id, password_hash FROM users WHERE email = $1 AND is_active',
    [email],
  );
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

  res.json({ token: issueToken(account.user_id), user: await describe(account.user_id) });
});

// Signing out is the client discarding its token; there is no server session.
authRouter.post('/logout', requireAuth, (_req, res) => {
  res.status(204).end();
});

// Self-service password change. Requires knowing the current password.
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
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
  await withUser(req.user.id, (db) =>
    db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2',
      [newHash, req.user.id],
    ),
  );

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
