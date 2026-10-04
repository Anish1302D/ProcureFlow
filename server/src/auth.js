import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { anonQuery } from './db.js';
import { HttpError } from './errors.js';
import { hasAnyRole } from './roles.js';

// The token carries only the user id. Roles and active status are read fresh
// on every request, so deactivating someone or changing their role takes
// effect immediately rather than when their token happens to expire.
export function issueToken(userId) {
  return jwt.sign({}, config.jwtSecret, {
    subject: userId,
    expiresIn: config.jwtExpiresIn,
    algorithm: 'HS256',
  });
}

export async function loadUser(userId) {
  const { rows } = await anonQuery(
    `SELECT u.user_id, u.email, u.full_name, u.department_id,
            ARRAY(SELECT r.code FROM user_roles ur
                    JOIN roles r ON r.role_id = ur.role_id
                   WHERE ur.user_id = u.user_id
                   ORDER BY r.code) AS roles
       FROM users u
      WHERE u.user_id = $1 AND u.is_active`,
    [userId],
  );
  if (!rows[0]) return null;
  const { user_id, email, full_name, department_id, roles } = rows[0];
  return { id: user_id, email, name: full_name, departmentId: department_id, roles };
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
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!hasAnyRole(req.user, roles)) {
    throw new HttpError(403, 'Your role does not allow this');
  }
  next();
};
