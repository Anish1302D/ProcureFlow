import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { issueToken, requireAuth } from '../auth.js';
import { anonQuery, withUser } from '../db.js';
import { HttpError, forbidden } from '../errors.js';
import {
  sendAccountLocked, sendEmailChanged, sendPasswordChanged, sendPasswordReset, sendRecoveryCodeUsed, sendTwoStepEnabled,
} from '../accountEmails.js';
import {
  decryptSecret, encryptSecret, hashRecoveryCode, issueChallenge, newRecoveryCodes, readChallenge,
} from '../mfa.js';
import { matchingStep, newSecret, otpauthUri } from '../totp.js';
import { config } from '../config.js';
import { configService } from '../configService.js';
import { NO_STORE, assertTokenShape, hashToken, linkError, newToken } from '../oneTimeLinks.js';
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


// Forgotten-password requests, per network: enough for a shared campus
// connection, too few to be useful for flooding. Each account is also capped
// in the database (auth.reset_requests_per_hour).
export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, _res, next) => {
    next(new HttpError(429, 'Too many requests from this network. Try again in a few minutes.'));
  },
});

export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, _res, next) => {
    next(new HttpError(429, 'Too many attempts. Try again in a few minutes.'));
  },
});

// Every failed sign-in gets the same answer, whether the address is unknown,
// the password wrong, or the account paused: telling them apart would reveal
// which addresses have accounts.
const SIGN_IN_REFUSED = 'Incorrect email or password. After several wrong attempts sign-in pauses for a few minutes; "Forgot password?" gets you back in straight away.';

// An unknown address is checked against this hash anyway, so a missing
// account and a wrong password take the same time to answer. Otherwise the
// response time alone would reveal which addresses have accounts.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

// Counts a wrong password against an account. At the configured threshold the
// account pauses for the configured minutes (kept in the database, so a
// restart does not clear it) and its owner is told by email.
async function recordFailedSignIn(account) {
  const threshold = await configService.get('auth.lockout_threshold');
  const minutes = await configService.get('auth.lockout_minutes');
  const { rows } = await anonQuery(
    `UPDATE users
        SET failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
            locked_until = CASE WHEN failed_login_count + 1 >= $2 THEN NOW() + make_interval(mins => $3) ELSE locked_until END
      WHERE user_id = $1
  RETURNING locked_until, locked_until > NOW() AS now_locked`,
    [account.user_id, threshold, minutes],
  );
  if (rows[0]?.now_locked) {
    await anonQuery(
      `INSERT INTO audit_logs (entity_type, entity_id, action, after_json)
       VALUES ('user', $1::text, 'ACCOUNT_LOCKED', jsonb_build_object('until', $2::text))`,
      [account.user_id, rows[0].locked_until.toISOString()],
    );
    sendAccountLocked({ to: account.email, fullName: account.full_name, until: rows[0].locked_until })
      .catch((err) => console.error(`[auth] lock notice to ${account.email} failed: ${err.message}`));
  }
}

// 'verify' when the account has 2-step verification, 'enrol' when one of its
// roles requires it but it is not set up yet, otherwise null.
async function secondStepFor(userId) {
  const { rows: [u] } = await anonQuery(
    `SELECT u.mfa_enabled_at IS NOT NULL AS enabled,
            ARRAY(SELECT r.code FROM user_roles ur JOIN roles r ON r.role_id = ur.role_id WHERE ur.user_id = u.user_id) AS roles
       FROM users u WHERE u.user_id = $1`,
    [userId],
  );
  if (u?.enabled) return 'verify';
  const required = await configService.get('auth.mfa_required_roles');
  return u?.roles?.some((r) => required.includes(r)) ? 'enrol' : null;
}

authRouter.post('/login', loginIpLimiter, loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  // Passwords are compared here, in the API, rather than with crypt() in SQL:
  // that would send the plaintext to the database, where statement logging
  // could record it. pgcrypto's bcrypt hashes are standard $2a$ hashes.
  let rows;
  try {
    const res = await anonQuery(
      `SELECT user_id, email, full_name, password_hash, COALESCE(token_version, 1) AS token_version,
              locked_until IS NOT NULL AND locked_until > NOW() AS locked
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
  // Always compare, so a paused or unknown account takes as long to refuse.
  const valid = await bcrypt.compare(password, account?.password_hash ?? DUMMY_HASH);

  if (!account || !valid || account.locked) {
    await anonQuery(
      `INSERT INTO audit_logs (entity_type, entity_id, action, after_json)
       VALUES ('user', $1, 'LOGIN_FAILED', jsonb_build_object('ip', $2::text))`,
      [email, req.ip],
    );
    if (account && !account.locked) await recordFailedSignIn(account);
    throw new HttpError(401, SIGN_IN_REFUSED, { code: 'SIGN_IN_REFUSED' });
  }

  if (account.locked === false) {
    await anonQuery(
      `UPDATE users SET failed_login_count = 0
        WHERE user_id = $1 AND failed_login_count <> 0`,
      [account.user_id],
    );
  }

  // The password was right. Accounts with 2-step verification — and roles
  // that must have it — get a short-lived challenge instead of a session.
  const step = await secondStepFor(account.user_id);
  if (step) {
    return res.json({ mfa: { step, challenge: issueChallenge(account.user_id, account.token_version, step) } });
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
  if (!req.user.roles.includes('ADMIN')) {
    throw forbidden('Self-service password change is restricted to administrators. Use the password reset recovery flow if needed.');
  }
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
  const notify = () => sendPasswordChanged({ to: req.user.email, fullName: req.user.name })
    .catch((err) => console.error(`[auth] password-changed notice failed: ${err.message}`));
  await withUser(req.user.id, async (db) => {
    try {
      await db.query(
        `UPDATE users SET password_hash = $1, token_version = COALESCE(token_version, 1) + 1,
                password_changed_at = NOW(), updated_at = NOW() WHERE user_id = $2`,
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

  notify();
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Forgotten password
// ---------------------------------------------------------------------------
// The answer never depends on whether the address has an account, and the
// email is sent after replying, so neither the words nor the timing tell.

const FORGOT_REPLY = {
  message: 'If an account uses that email address, a link to choose a new password is on its way. Check your inbox (and spam folder) in a few minutes.',
};

authRouter.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(req.body ?? {});

  if (!config.appUrl) {
    console.error('[auth] password reset requested but APP_URL is not configured; no email sent');
    return res.status(202).json(FORGOT_REPLY);
  }

  const token = newToken();
  const issuedAt = new Date();
  const ttl = await configService.get('auth.reset_ttl_minutes');
  const { rows } = await anonQuery(
    'SELECT user_id, email, full_name FROM fn_issue_password_reset($1, $2, $3, $4, $5)',
    [email, hashToken(token), ttl, req.ip || 'unknown', await configService.get('auth.reset_requests_per_hour')],
  );
  res.status(202).json(FORGOT_REPLY);

  const person = rows[0];
  if (person) {
    sendPasswordReset({
      to: person.email, fullName: person.full_name, token,
      issuedAt, expiresAt: new Date(issuedAt.getTime() + ttl * 60_000),
    }).catch((err) => console.error(`[auth] reset email to ${person.email} failed: ${err.message}`));
  }
});

async function liveReset(token) {
  assertTokenShape(token);
  const { rows } = await anonQuery(
    'SELECT status, user_id, email, full_name FROM fn_verify_password_reset($1)', [hashToken(token)],
  );
  const row = rows[0];
  if (!row || row.status !== 'VALID') throw linkError(row?.status ?? 'INVALID', 'password reset');
  return row;
}

authRouter.post('/reset-password/verify', resetPasswordLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { token } = tokenOnlySchema.parse(req.body ?? {});
  const reset = await liveReset(token);
  res.json({ valid: true, email: reset.email, fullName: reset.full_name, passwordRules: await passwordRules() });
});

// Does not sign the person in: they sign in with the new password, so an
// administrator's 2-step verification still applies.
authRouter.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { token, password } = setupAccountSchema.parse(req.body ?? {});
  const reset = await liveReset(token);
  await assertPasswordAcceptable(password, { email: reset.email, fullName: reset.full_name });

  try {
    await anonQuery(
      'SELECT user_id FROM fn_consume_password_reset($1, $2, $3)',
      [hashToken(token), await hashPassword(password), req.ip || 'unknown'],
    );
  } catch (err) {
    throw linkError(err.code, 'password reset') ?? err;
  }

  sendPasswordChanged({ to: reset.email, fullName: reset.full_name })
    .catch((err) => console.error(`[auth] password-changed notice failed: ${err.message}`));
  res.json({ done: true, message: 'Your password has been changed. Sign in with your new password.' });
});

// ---------------------------------------------------------------------------
// Confirming a new email address
// ---------------------------------------------------------------------------

async function liveEmailChange(token) {
  assertTokenShape(token);
  const { rows } = await anonQuery(
    'SELECT status, user_id, email, full_name, new_email FROM fn_verify_email_change($1)', [hashToken(token)],
  );
  const row = rows[0];
  if (!row || row.status !== 'VALID') throw linkError(row?.status ?? 'INVALID', 'email confirmation');
  return row;
}

authRouter.post('/confirm-email/verify', resetPasswordLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { token } = tokenOnlySchema.parse(req.body ?? {});
  const change = await liveEmailChange(token);
  res.json({ valid: true, fullName: change.full_name, email: change.email, newEmail: change.new_email });
});

authRouter.post('/confirm-email', resetPasswordLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { token } = tokenOnlySchema.parse(req.body ?? {});
  const change = await liveEmailChange(token);
  let done;
  try {
    ({ rows: [done] } = await anonQuery(
      'SELECT user_id, old_email, new_email FROM fn_consume_email_change($1, $2)', [hashToken(token), req.ip || 'unknown'],
    ));
  } catch (err) {
    if (err.code === 'ST005') {
      throw new HttpError(409, 'Another account already uses this email address. Ask the college administrator for help.', { code: 'EMAIL_TAKEN' });
    }
    throw linkError(err.code, 'email confirmation') ?? err;
  }
  sendEmailChanged({ to: done.old_email, fullName: change.full_name, newEmail: done.new_email })
    .catch((err) => console.error(`[auth] email-changed notice failed: ${err.message}`));
  res.json({ done: true, email: done.new_email, message: `Your account now uses ${done.new_email}. Sign in with it.` });
});

// ---------------------------------------------------------------------------
// 2-step verification
// ---------------------------------------------------------------------------

export const mfaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  skip: () => process.env.NODE_ENV === 'test',
  handler: (_req, _res, next) => {
    next(new HttpError(429, 'Too many attempts. Try again in a few minutes.'));
  },
});

const CODE_REFUSED = 'That code is not right. Check the time on your phone is set automatically, and use the newest code.';

/** The person behind a challenge, still active and not signed out since. */
async function challengedAccount(challenge, step) {
  const { userId, tokenVersion } = readChallenge(challenge, step);
  const { rows: [u] } = await anonQuery(
    `SELECT user_id, email, full_name, COALESCE(token_version, 1) AS token_version,
            mfa_secret_enc, mfa_pending_secret_enc, mfa_enabled_at, mfa_last_step,
            locked_until IS NOT NULL AND locked_until > NOW() AS locked
       FROM users WHERE user_id = $1 AND is_active`,
    [userId],
  );
  if (!u || u.token_version !== tokenVersion) {
    throw new HttpError(401, 'This sign-in attempt has expired. Please sign in again.', { code: 'CHALLENGE_EXPIRED' });
  }
  if (u.locked) throw new HttpError(401, SIGN_IN_REFUSED, { code: 'SIGN_IN_REFUSED' });
  return u;
}

async function completeSignIn(res, account, method, extra = {}) {
  await anonQuery('UPDATE users SET failed_login_count = 0 WHERE user_id = $1 AND failed_login_count <> 0', [account.user_id]);
  await withUser(account.user_id, (db) => db.query(
    `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
     VALUES ('user', $1::text, $1::uuid, 'LOGIN', jsonb_build_object('second_step', $2::text))`,
    [account.user_id, method],
  ));
  res.json({ token: issueToken(account.user_id, account.token_version), user: await describe(account.user_id), ...extra });
}

const verifySchema = z.object({
  challenge: z.string().min(1).max(4000),
  code: z.string().trim().max(20).optional(),
  recoveryCode: z.string().trim().max(40).optional(),
}).refine((v) => v.code || v.recoveryCode, 'Enter the code');

authRouter.post('/mfa/verify', loginIpLimiter, mfaLimiter, async (req, res) => {
  res.set(NO_STORE);
  const body = verifySchema.parse(req.body ?? {});
  const account = await challengedAccount(body.challenge, 'verify');
  if (!account.mfa_enabled_at) {
    throw new HttpError(401, 'This sign-in attempt has expired. Please sign in again.', { code: 'CHALLENGE_EXPIRED' });
  }

  if (body.recoveryCode) {
    const { rows } = await anonQuery(
      `UPDATE mfa_recovery_codes SET used_at = NOW()
        WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING code_id`,
      [account.user_id, hashRecoveryCode(body.recoveryCode)],
    );
    if (!rows.length) {
      await recordFailedSignIn(account);
      throw new HttpError(401, 'That recovery code is not right, or it has already been used.', { code: 'MFA_CODE_INVALID' });
    }
    const { rows: [left] } = await anonQuery(
      'SELECT count(*)::int AS n FROM mfa_recovery_codes WHERE user_id = $1 AND used_at IS NULL', [account.user_id],
    );
    sendRecoveryCodeUsed({ to: account.email, fullName: account.full_name, left: left.n })
      .catch((err) => console.error(`[auth] recovery-code notice failed: ${err.message}`));
    return completeSignIn(res, account, 'recovery_code', { recoveryCodesLeft: left.n });
  }

  const matched = matchingStep(decryptSecret(account.mfa_secret_enc), body.code);
  // A code may be used once: anything at or before the last accepted step is a replay.
  if (matched === null || (account.mfa_last_step !== null && matched <= Number(account.mfa_last_step))) {
    await recordFailedSignIn(account);
    throw new HttpError(401, CODE_REFUSED, { code: 'MFA_CODE_INVALID' });
  }
  await anonQuery('UPDATE users SET mfa_last_step = $2 WHERE user_id = $1', [account.user_id, matched]);
  return completeSignIn(res, account, 'authenticator');
});

authRouter.post('/mfa/setup/start', loginIpLimiter, mfaLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { challenge } = z.object({ challenge: z.string().min(1).max(4000) }).parse(req.body ?? {});
  const account = await challengedAccount(challenge, 'enrol');
  if (account.mfa_enabled_at) throw conflictTwoStep();

  const secret = newSecret();
  await anonQuery('UPDATE users SET mfa_pending_secret_enc = $2 WHERE user_id = $1', [account.user_id, encryptSecret(secret)]);
  let issuer = 'Approval hub';
  try { issuer = (await configService.get('institution.name')) || issuer; } catch { /* default */ }
  res.json({ secret, issuer, account: account.email, otpauthUri: otpauthUri({ secret, account: account.email, issuer }) });
});

function conflictTwoStep() {
  return new HttpError(409, '2-step verification is already set up for this account. Sign in again.', { code: 'MFA_ALREADY_ON' });
}

async function replaceRecoveryCodes(userId) {
  const codes = newRecoveryCodes();
  await anonQuery('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
  for (const code of codes) {
    await anonQuery('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, hashRecoveryCode(code)]);
  }
  return codes;
}

authRouter.post('/mfa/setup/confirm', loginIpLimiter, mfaLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { challenge, code } = z.object({ challenge: z.string().min(1).max(4000), code: z.string().trim().max(20) }).parse(req.body ?? {});
  const account = await challengedAccount(challenge, 'enrol');
  if (account.mfa_enabled_at) throw conflictTwoStep();
  if (!account.mfa_pending_secret_enc) {
    throw new HttpError(409, 'Start the setup again.', { code: 'MFA_SETUP_RESTART' });
  }

  const matched = matchingStep(decryptSecret(account.mfa_pending_secret_enc), code);
  if (matched === null) {
    await recordFailedSignIn(account);
    throw new HttpError(401, CODE_REFUSED, { code: 'MFA_CODE_INVALID' });
  }
  await anonQuery(
    `UPDATE users SET mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL,
            mfa_enabled_at = NOW(), mfa_last_step = $2 WHERE user_id = $1`,
    [account.user_id, matched],
  );
  const recoveryCodes = await replaceRecoveryCodes(account.user_id);
  await anonQuery(
    `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action) VALUES ('user', $1::text, $1::uuid, 'MFA_ENABLED')`,
    [account.user_id],
  );
  sendTwoStepEnabled({ to: account.email, fullName: account.full_name })
    .catch((err) => console.error(`[auth] 2-step notice failed: ${err.message}`));
  return completeSignIn(res, account, 'enrolled', { recoveryCodes });
});

// New recovery codes (the old ones stop working). Needs a current code, so a
// borrowed session alone cannot do it.
authRouter.post('/mfa/recovery-codes', requireAuth, mfaLimiter, async (req, res) => {
  res.set(NO_STORE);
  const { code } = z.object({ code: z.string().trim().max(20) }).parse(req.body ?? {});
  const { rows: [u] } = await anonQuery(
    'SELECT user_id, mfa_secret_enc, mfa_last_step FROM users WHERE user_id = $1 AND mfa_enabled_at IS NOT NULL', [req.user.id],
  );
  if (!u) throw new HttpError(409, '2-step verification is not set up for this account.', { code: 'MFA_NOT_ON' });
  const matched = matchingStep(decryptSecret(u.mfa_secret_enc), code);
  if (matched === null || (u.mfa_last_step !== null && matched <= Number(u.mfa_last_step))) {
    throw new HttpError(401, CODE_REFUSED, { code: 'MFA_CODE_INVALID' });
  }
  await anonQuery('UPDATE users SET mfa_last_step = $2 WHERE user_id = $1', [u.user_id, matched]);
  const recoveryCodes = await replaceRecoveryCodes(u.user_id);
  await anonQuery(
    `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action) VALUES ('user', $1::text, $1::uuid, 'MFA_RECOVERY_CODES_REPLACED')`,
    [u.user_id],
  );
  res.json({ recoveryCodes });
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
    `SELECT u.user_id, u.email, u.full_name, u.employee_id, u.department_id, u.mfa_enabled_at,
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
    // Whether 2-step verification is on; never the secret itself.
    mfa: { enabled: u.mfa_enabled_at !== null, enabledAt: u.mfa_enabled_at },
    // Hints for showing and hiding UI. The server enforces every one of these
    // independently — they grant nothing on their own.
    can: {
      raiseRequests: hasAnyRole(user, REQUESTER_ROLES),
      manageIssues: hasAnyRole(user, ISSUE_MANAGER_ROLES),
      viewInventory: hasAnyRole(user, INVENTORY_READER_ROLES),
      viewAudit: u.roles.includes('ADMIN'),
      approve: u.stages.length > 0,
      downloadApprovalBudget: hasAnyRole(user, APPROVAL_BUDGET_ROLES),
      changePassword: u.roles.includes('ADMIN'),
    },
  };
}
