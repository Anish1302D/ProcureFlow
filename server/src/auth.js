import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { anonQuery } from './db.js';
import { HttpError } from './errors.js';
import { hasAnyRole } from './roles.js';

// The token carries only the user id. Roles and active status are read fresh
// on every request, so deactivating someone or changing their role takes
// effect immediately rather than when their token happens to expire.
export function issueToken(userId, tokenVersion = 1) {
  const version = typeof tokenVersion === 'object' && tokenVersion !== null
    ? Number(tokenVersion.token_version ?? tokenVersion.tokenVersion ?? tokenVersion.v ?? 1)
    : Number(tokenVersion ?? 1);

  return jwt.sign({ v: version, tokenVersion: version }, config.jwtSecret, {
    subject: userId,
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

export async function loadUser(userId) {
  let rows;
  try {
    const res = await anonQuery(
      `SELECT u.user_id, u.email, u.full_name, u.department_id,
              COALESCE(u.token_version, 1) AS token_version,
              ARRAY(SELECT r.code FROM user_roles ur
                      JOIN roles r ON r.role_id = ur.role_id
                     WHERE ur.user_id = u.user_id
                     ORDER BY r.code) AS roles
         FROM users u
        WHERE u.user_id = $1 AND u.is_active`,
      [userId],
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
  if (!rows[0]) return null;
  const { user_id, email, full_name, department_id, token_version, roles } = rows[0];
  return {
    id: user_id,
    email,
    name: full_name,
    departmentId: department_id,
    tokenVersion: Number(token_version ?? 1),
    roles,
  };
}

export async function requireAuth(req, _res, next) {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new HttpError(401, 'Sign in required');
  }

  let payload;
  try {
    // Pinning the algorithm stops a token signed with "none" or a different
    // scheme from being accepted.
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Your session has expired or is invalid');
  }

  // Tokens without the dedicated security-version claim require reauthentication
  // and are not permitted to bypass revocation.
  const tokenVer = payload.tokenVersion ?? payload.v;
  if (tokenVer == null) {
    throw new HttpError(401, 'Your session has expired due to a security update. Please sign in again.');
  }

  const user = payload.sub ? await loadUser(payload.sub) : null;
  if (!user) {
    throw new HttpError(401, 'Account not found or disabled');
  }

  // Atomically revokes sessions whenever token_version is incremented on the user
  if (Number(tokenVer) !== user.tokenVersion) {
    throw new HttpError(401, 'Your session has expired due to a security update. Please sign in again.');
  }

  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!hasAnyRole(req.user, roles)) {
    throw new HttpError(403, 'Your role does not allow this');
  }
  next();
};
