import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { anonQuery } from './db.js';
import { HttpError } from './errors.js';
import { hasAnyRole } from './roles.js';

// The token carries only the user id. Roles and active status are read fresh
// on every request, so deactivating someone or changing their role takes
// effect immediately rather than when their token happens to expire.
export function issueToken(userId, pwdUpdated = null) {
  const claims = {};
  if (pwdUpdated != null) {
    claims.pwdUpdated = pwdUpdated instanceof Date ? pwdUpdated.getTime() : Number(pwdUpdated);
  }
  return jwt.sign(claims, config.jwtSecret, {
    subject: userId,
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

export async function loadUser(userId) {
  const { rows } = await anonQuery(
    `SELECT u.user_id, u.email, u.full_name, u.department_id,
            (EXTRACT(EPOCH FROM u.updated_at) * 1000)::bigint AS updated_ms,
            EXTRACT(EPOCH FROM u.updated_at)::int AS updated_epoch,
            ARRAY(SELECT r.code FROM user_roles ur
                    JOIN roles r ON r.role_id = ur.role_id
                   WHERE ur.user_id = u.user_id
                   ORDER BY r.code) AS roles
       FROM users u
      WHERE u.user_id = $1 AND u.is_active`,
    [userId],
  );
  if (!rows[0]) return null;
  const { user_id, email, full_name, department_id, updated_ms, updated_epoch, roles } = rows[0];
  return {
    id: user_id,
    email,
    name: full_name,
    departmentId: department_id,
    updatedMs: updated_ms != null ? Number(updated_ms) : null,
    updatedEpoch: updated_epoch,
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

  const user = payload.sub ? await loadUser(payload.sub) : null;
  if (!user) {
    throw new HttpError(401, 'Account not found or disabled');
  }
  // Invalidate tokens issued prior to the user's last password or credential update.
  if (payload.pwdUpdated != null) {
    if (user.updatedMs != null && payload.pwdUpdated < user.updatedMs) {
      throw new HttpError(401, 'Your session has expired due to a security update. Please sign in again.');
    }
  } else {
    // Legacy tokens without the required security-version claim (pwdUpdated) cannot
    // reliably establish sub-second validity against security updates. Require
    // reauthentication whenever the token was issued at or before the update second boundary.
    const updateSecondBoundary = user.updatedMs != null ? Math.ceil(user.updatedMs / 1000) : 0;
    if (!payload.iat || payload.iat <= updateSecondBoundary) {
      throw new HttpError(401, 'Your session has expired due to a security update. Please sign in again.');
    }
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
