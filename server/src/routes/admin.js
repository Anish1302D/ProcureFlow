import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { configService } from '../configService.js';
import { anonQuery, withUser } from '../db.js';
import { HttpError, conflict, notFound } from '../errors.js';

// Admin-only: user & role management. All routes require the ADMIN role.
// Passwords are always hashed here — plain text is never stored or logged.
export const adminRouter = Router();

adminRouter.use(requireRole('ADMIN'));

const BCRYPT_ROUNDS = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOWED_INSTITUTIONAL_ROLES = [
  'HEAD',
  'ACTIVITY_INCHARGE',
  'PURCHASE_COMMITTEE',
  'PRINCIPAL',
  'CDC_MEMBER',
  'CDC_GRANT_MEMBER',
  'CDC_NON_GRANT_MEMBER',
  'CHAIRMAN',
  'VICE_PRESIDENT',
  'ADMIN',
];

async function userDetail(userId) {
  const { rows } = await anonQuery(
    `SELECT u.user_id, u.email, u.full_name, u.is_active, u.created_at, u.updated_at,
            u.department_id, d.name AS department_name, d.code AS department_code,
            COALESCE(
              json_agg(
                json_build_object('id', r.role_id, 'code', r.code, 'name', r.name)
                ORDER BY r.code
              ) FILTER (WHERE r.role_id IS NOT NULL),
              '[]'
            ) AS roles
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN roles r       ON r.role_id  = ur.role_id
      WHERE u.user_id = $1
      GROUP BY u.user_id, d.name, d.code`,
    [userId],
  );
  if (!rows[0]) return null;
  const u = rows[0];
  return {
    id: u.user_id,
    email: u.email,
    name: u.full_name,
    isActive: u.is_active,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    departmentId: u.department_id,
    departmentName: u.department_name,
    departmentCode: u.department_code,
    roles: u.roles,
  };
}

async function validateRoleIds(db, roleIds) {
  if (!roleIds.length) return;
  const { rows } = await db.query(
    'SELECT role_id, code FROM roles WHERE role_id = ANY($1::int[])',
    [roleIds],
  );
  if (rows.length !== roleIds.length) {
    throw new HttpError(422, 'One or more role IDs are invalid');
  }
  for (const r of rows) {
    if (!ALLOWED_INSTITUTIONAL_ROLES.includes(r.code)) {
      throw new HttpError(422, `Role '${r.code}' is not an allowed institutional role`);
    }
  }
}

async function validateDepartmentId(db, departmentId) {
  if (departmentId === null || departmentId === undefined) return;
  const { rows } = await db.query(
    'SELECT department_id FROM departments WHERE department_id = $1',
    [departmentId],
  );
  if (!rows.length) {
    throw new HttpError(422, 'Department ID does not exist');
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/users  —  list every user with their roles
// ---------------------------------------------------------------------------
adminRouter.get('/users', async (_req, res) => {
  const { rows } = await anonQuery(
    `SELECT u.user_id, u.email, u.full_name, u.is_active, u.created_at, u.updated_at,
            u.department_id, d.name AS department_name, d.code AS department_code,
            COALESCE(
              json_agg(
                json_build_object('id', r.role_id, 'code', r.code, 'name', r.name)
                ORDER BY r.code
              ) FILTER (WHERE r.role_id IS NOT NULL),
              '[]'
            ) AS roles
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN roles r       ON r.role_id  = ur.role_id
      GROUP BY u.user_id, d.name, d.code
      ORDER BY u.full_name`,
  );
  res.json(rows.map((u) => ({
    id: u.user_id,
    email: u.email,
    name: u.full_name,
    isActive: u.is_active,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    departmentId: u.department_id,
    departmentName: u.department_name,
    departmentCode: u.department_code,
    roles: u.roles,
  })));
});

// ---------------------------------------------------------------------------
// GET /api/admin/roles  —  list all available roles
// ---------------------------------------------------------------------------
adminRouter.get('/roles', async (_req, res) => {
  const { rows } = await anonQuery(
    'SELECT role_id, code, name, description FROM roles ORDER BY name',
  );
  res.json(rows.map((r) => ({
    id: r.role_id,
    code: r.code,
    name: r.name,
    description: r.description,
  })));
});

// ---------------------------------------------------------------------------
// POST /api/admin/users  —  invite a new user with single-use setup token
// ---------------------------------------------------------------------------
const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(2).max(200),
  departmentId: z.number().int().positive().nullable().optional(),
  roleIds: z.array(z.number().int().positive()).min(1, 'Assign at least one role'),
  isActive: z.boolean().optional(),
});

adminRouter.post('/users', async (req, res) => {
  const body = createUserSchema.parse(req.body);

  // Generate an unusable placeholder password hash so unactivated accounts cannot log in.
  const randomPlaceholder = crypto.randomBytes(16).toString('hex');
  const initialPasswordHash = `$2a$12$unusable.placeholder.setup.required.${randomPlaceholder}`;

  // Issue a short-lived (24h) cryptographically random setup token.
  // The raw token is NEVER logged or stored in the database — only its SHA-256 hash.
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const created = await withUser(req.user.id, async (db) => {
    const dup = await db.query(
      'SELECT 1 FROM users WHERE email = $1', [body.email],
    );
    if (dup.rowCount) throw conflict('A user with this email already exists');

    await validateDepartmentId(db, body.departmentId);
    await validateRoleIds(db, body.roleIds);

    // Accounts start unactivated (is_active = FALSE) until the invitee completes password setup.
    const { rows } = await db.query(
      `INSERT INTO users (email, full_name, password_hash, department_id, is_active, token_version)
       VALUES ($1, $2, $3, $4, FALSE, 1) RETURNING user_id`,
      [body.email, body.fullName, initialPasswordHash, body.departmentId ?? null],
    );
    const userId = rows[0].user_id;

    await db.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
      [userId, body.roleIds],
    );

    if (body.roleIds && body.roleIds.length) {
      await db.query(
        `INSERT INTO stage_approvers (stage_id, user_id, role_id)
         SELECT ws.stage_id, $1, r.role_id
           FROM roles r
           JOIN workflow_stages ws ON (
             (r.code = 'PURCHASE_COMMITTEE' AND ws.code = 'PURCHASE_COMMITTEE') OR
             (r.code = 'PRINCIPAL' AND ws.code = 'PRINCIPAL') OR
             (r.code IN ('CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER', 'CDC_MEMBER') AND ws.code = 'CDC') OR
             (r.code IN ('CHAIRMAN', 'VICE_PRESIDENT') AND ws.code = 'FINAL_AUTHORITY')
           )
          WHERE r.role_id = ANY($2::int[])
         ON CONFLICT (stage_id, user_id) DO NOTHING`,
        [userId, body.roleIds],
      );
    }

    await db.query(
      `INSERT INTO account_setup_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt],
    );

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ('user', $1::text, $2::uuid, 'CREATE', $3::jsonb)`,
      [
        userId,
        req.user.id,
        JSON.stringify({
          email: body.email,
          fullName: body.fullName,
          departmentId: body.departmentId ?? null,
          roleIds: body.roleIds,
          isActive: false,
        }),
      ],
    );

    return userId;
  });

  const detail = await userDetail(created);
  res.status(201).json({
    ...detail,
    setupToken: rawToken,
    setupUrl: `/setup-account?token=${rawToken}`,
    expiresAt: expiresAt.toISOString(),
    emailDelivery: 'UNCONFIGURED',
    message: 'User created. Outbound email delivery is unconfigured in this environment. Provide the setup link directly to the invited institutional member.',
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/setup-token  —  generate new setup link for a user
// ---------------------------------------------------------------------------
adminRouter.post('/users/:id/setup-token', async (req, res) => {
  const userId = req.params.id;
  const user = await userDetail(userId);
  if (!user) throw notFound('User not found');

  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await withUser(req.user.id, async (db) => {
    await db.query(
      'UPDATE account_setup_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [userId],
    );
    await db.query(
      'INSERT INTO account_setup_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, tokenHash, expiresAt],
    );
    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ('user', $1::text, $2::uuid, 'SETUP_TOKEN_ISSUED', jsonb_build_object('expiresAt', $3::text))`,
      [userId, req.user.id, expiresAt.toISOString()],
    );
  });

  res.json({
    userId,
    setupToken: rawToken,
    setupUrl: `/setup-account?token=${rawToken}`,
    expiresAt: expiresAt.toISOString(),
    emailDelivery: 'UNCONFIGURED',
    message: 'New setup token generated. Outbound email delivery is unconfigured in this environment. Provide the setup link directly to the invited institutional member.',
  });
});


// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id  —  edit name/email/password/department/roles/active status
// ---------------------------------------------------------------------------
const updateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    fullName: z.string().trim().min(2).max(200).optional(),
    password: z.string().min(8).max(200).optional(),
    departmentId: z.number().int().positive().nullable().optional(),
    roleIds: z.array(z.number().int().positive()).min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

adminRouter.patch('/users/:id', async (req, res) => {
  const userId = req.params.id;
  const body = updateUserSchema.parse(req.body);

  if (body.isActive === false && userId === req.user.id) {
    throw new HttpError(400, 'You cannot deactivate your own account');
  }

  // Hash outside the transaction for the same reason as above.
  const hash = body.password ? await bcrypt.hash(body.password, BCRYPT_ROUNDS) : undefined;

  await withUser(req.user.id, async (db) => {
    const existing = await db.query(
      `SELECT u.user_id, u.email, u.full_name, u.department_id, u.is_active,
              COALESCE(array_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS role_ids
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.user_id
        WHERE u.user_id = $1
        GROUP BY u.user_id`,
      [userId],
    );
    if (!existing.rowCount) throw notFound('User not found');
    const beforeUser = existing.rows[0];

    if (body.departmentId !== undefined) {
      await validateDepartmentId(db, body.departmentId);
    }

    if (body.email) {
      const dup = await db.query(
        'SELECT 1 FROM users WHERE email = $1 AND user_id != $2', [body.email, userId],
      );
      if (dup.rowCount) throw conflict('This email is already taken by another user');
    }

    const adminRoleRes = await db.query("SELECT role_id FROM roles WHERE code = 'ADMIN'");
    const adminRoleId = adminRoleRes.rows[0]?.role_id;

    // Prevent deactivating the last active administrator
    if (body.isActive === false && adminRoleId) {
      const userHasAdmin = await db.query(
        'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [userId, adminRoleId],
      );
      if (userHasAdmin.rowCount > 0) {
        const otherAdmins = await db.query(
          `SELECT 1 FROM user_roles ur
             JOIN users u ON u.user_id = ur.user_id
            WHERE ur.role_id = $1 AND ur.user_id != $2 AND u.is_active`,
          [adminRoleId, userId],
        );
        if (otherAdmins.rowCount === 0) {
          throw new HttpError(400, 'Cannot deactivate the only active administrator');
        }
      }
    }

    // Prevent stripping the ADMIN role from the last active administrator
    if (body.roleIds !== undefined && adminRoleId) {
      const userHasAdmin = await db.query(
        'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [userId, adminRoleId],
      );
      if (userHasAdmin.rowCount > 0 && !body.roleIds.includes(adminRoleId)) {
        const otherAdmins = await db.query(
          `SELECT 1 FROM user_roles ur
             JOIN users u ON u.user_id = ur.user_id
            WHERE ur.role_id = $1 AND ur.user_id != $2 AND u.is_active`,
          [adminRoleId, userId],
        );
        if (otherAdmins.rowCount === 0) {
          throw new HttpError(400, 'Cannot remove the ADMIN role from the only active administrator');
        }
      }
    }

    // Build SET clause dynamically so we never blank out unmentioned columns.
    const sets = [];
    const vals = [];
    const push = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

    if (body.email !== undefined) push('email', body.email);
    if (body.fullName !== undefined) push('full_name', body.fullName);
    if (hash !== undefined) push('password_hash', hash);
    if (body.departmentId !== undefined) push('department_id', body.departmentId);
    if (body.isActive !== undefined) push('is_active', body.isActive);

    if (sets.length || body.roleIds !== undefined) {
      sets.push('token_version = COALESCE(token_version, 1) + 1');
      push('updated_at', new Date());
      vals.push(userId);
      try {
        await db.query(
          `UPDATE users SET ${sets.join(', ')} WHERE user_id = $${vals.length}`,
          vals,
        );
      } catch (err) {
        if (err.code === '42703') {
          throw new HttpError(
            503,
            'User update and session revocation unavailable: database migration 20261011T120000_add_user_token_version.sql is required',
            { code: 'MIGRATION_REQUIRED' },
          );
        }
        throw err;
      }
    }

    // Replace roles atomically when roleIds is given.
    if (body.roleIds !== undefined) {
      await validateRoleIds(db, body.roleIds);
      await db.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
      if (body.roleIds.length) {
        await db.query(
          `INSERT INTO user_roles (user_id, role_id)
           SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
          [userId, body.roleIds],
        );
      }
      await db.query('DELETE FROM stage_approvers WHERE user_id = $1', [userId]);
      if (body.roleIds.length) {
        await db.query(
          `INSERT INTO stage_approvers (stage_id, user_id, role_id)
           SELECT ws.stage_id, $1, r.role_id
             FROM roles r
             JOIN workflow_stages ws ON (
               (r.code = 'PURCHASE_COMMITTEE' AND ws.code = 'PURCHASE_COMMITTEE') OR
               (r.code = 'PRINCIPAL' AND ws.code = 'PRINCIPAL') OR
               (r.code IN ('CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER', 'CDC_MEMBER') AND ws.code = 'CDC') OR
               (r.code IN ('CHAIRMAN', 'VICE_PRESIDENT') AND ws.code = 'FINAL_AUTHORITY')
             )
            WHERE r.role_id = ANY($2::int[])
           ON CONFLICT (stage_id, user_id) DO NOTHING`,
          [userId, body.roleIds],
        );
      }
    }

    const afterRes = await db.query(
      `SELECT u.user_id, u.email, u.full_name, u.department_id, u.is_active,
              COALESCE(array_agg(ur.role_id) FILTER (WHERE ur.role_id IS NOT NULL), '{}') AS role_ids
         FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.user_id
        WHERE u.user_id = $1
        GROUP BY u.user_id`,
      [userId],
    );
    const afterUser = afterRes.rows[0];

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
       VALUES ('user', $1::text, $2::uuid, 'UPDATE', $3::jsonb, $4::jsonb)`,
      [
        userId,
        req.user.id,
        JSON.stringify({
          email: beforeUser.email,
          fullName: beforeUser.full_name,
          departmentId: beforeUser.department_id,
          roleIds: beforeUser.role_ids,
          isActive: beforeUser.is_active,
        }),
        JSON.stringify({
          email: afterUser.email,
          fullName: afterUser.full_name,
          departmentId: afterUser.department_id,
          roleIds: afterUser.role_ids,
          isActive: afterUser.is_active,
        }),
      ],
    );
  });

  res.json(await userDetail(userId));
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/users/:id  —  deactivate (soft-delete; preserves history)
// ---------------------------------------------------------------------------
adminRouter.delete('/users/:id', async (req, res) => {
  const userId = req.params.id;
  if (userId === req.user.id) {
    throw new HttpError(400, 'You cannot deactivate your own account');
  }

  await withUser(req.user.id, async (db) => {
    const adminRoleRes = await db.query("SELECT role_id FROM roles WHERE code = 'ADMIN'");
    const adminRoleId = adminRoleRes.rows[0]?.role_id;
    if (adminRoleId) {
      const userHasAdmin = await db.query(
        'SELECT 1 FROM user_roles WHERE user_id = $1 AND role_id = $2', [userId, adminRoleId],
      );
      if (userHasAdmin.rowCount > 0) {
        const otherAdmins = await db.query(
          `SELECT 1 FROM user_roles ur
             JOIN users u ON u.user_id = ur.user_id
            WHERE ur.role_id = $1 AND ur.user_id != $2 AND u.is_active`,
          [adminRoleId, userId],
        );
        if (otherAdmins.rowCount === 0) {
          throw new HttpError(400, 'Cannot deactivate the only active administrator');
        }
      }
    }

    try {
      const { rowCount } = await db.query(
        `UPDATE users SET is_active = FALSE, token_version = COALESCE(token_version, 1) + 1, updated_at = NOW()
          WHERE user_id = $1`,
        [userId],
      );
      if (!rowCount) throw notFound('User not found');
    } catch (err) {
      if (err.code === '42703') {
        throw new HttpError(
          503,
          'User deactivation and session revocation unavailable: database migration 20261011T120000_add_user_token_version.sql is required',
          { code: 'MIGRATION_REQUIRED' },
        );
      }
      throw err;
    }

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ('user', $1::text, $2::uuid, 'DEACTIVATE', jsonb_build_object('isActive', false))`,
      [userId, req.user.id],
    );
  });

  res.status(204).end();
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/reactivate  —  re-enable a deactivated account
// ---------------------------------------------------------------------------
adminRouter.post('/users/:id/reactivate', async (req, res) => {
  const userId = req.params.id;

  await withUser(req.user.id, async (db) => {
    try {
      const { rowCount } = await db.query(
        `UPDATE users SET is_active = TRUE, token_version = COALESCE(token_version, 1) + 1, updated_at = NOW()
          WHERE user_id = $1`,
        [userId],
      );
      if (!rowCount) throw notFound('User not found');
    } catch (err) {
      if (err.code === '42703') {
        throw new HttpError(
          503,
          'User reactivation and session revocation unavailable: database migration 20261011T120000_add_user_token_version.sql is required',
          { code: 'MIGRATION_REQUIRED' },
        );
      }
      throw err;
    }

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ('user', $1::text, $2::uuid, 'REACTIVATE', jsonb_build_object('isActive', true))`,
      [userId, req.user.id],
    );
  });

  res.json(await userDetail(userId));
});

// ---------------------------------------------------------------------------
// Departments — CRUD
// ---------------------------------------------------------------------------

const deptSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20).regex(/^[A-Z0-9_-]+$/, 'Code must be letters, numbers or hyphens'),
  name: z.string().trim().min(2).max(200),
  fundingType: z.enum(['GRANT', 'NON_GRANT']).optional(),
});

adminRouter.get('/departments', async (_req, res) => {
  const { rows } = await anonQuery(
    `SELECT d.department_id, d.code, d.name, d.funding_type,
            COUNT(c.course_id)::int AS course_count
       FROM departments d
       LEFT JOIN courses c ON c.department_id = d.department_id
      GROUP BY d.department_id ORDER BY d.name`,
  );
  res.json(rows.map((r) => ({ id: r.department_id, code: r.code, name: r.name, fundingType: r.funding_type, courseCount: r.course_count })));
});

adminRouter.post('/departments', async (req, res) => {
  const body = deptSchema.parse(req.body);
  const result = await withUser(req.user.id, async (db) => {
    const { rows } = await db.query(
      `INSERT INTO departments (code, name, funding_type) VALUES ($1, $2, $3) RETURNING department_id, code, name, funding_type`,
      [body.code, body.name, body.fundingType || 'GRANT'],
    );
    return rows[0];
  });
  res.status(201).json({ id: result.department_id, code: result.code, name: result.name, fundingType: result.funding_type, courseCount: 0 });
});

adminRouter.patch('/departments/:id', async (req, res) => {
  const deptId = Number(req.params.id);
  const body = deptSchema.partial().parse(req.body);
  const result = await withUser(req.user.id, async (db) => {
    const sets = []; const vals = [];
    const push = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (body.code !== undefined) push('code', body.code);
    if (body.name !== undefined) push('name', body.name);
    if (body.fundingType !== undefined) push('funding_type', body.fundingType);
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    vals.push(deptId);
    const { rows, rowCount } = await db.query(
      `UPDATE departments SET ${sets.join(', ')} WHERE department_id = $${vals.length} RETURNING department_id, code, name, funding_type`,
      vals,
    );
    if (!rowCount) throw notFound('Department not found');
    return rows[0];
  });
  res.json({ id: result.department_id, code: result.code, name: result.name, fundingType: result.funding_type });
});

adminRouter.delete('/departments/:id', async (req, res) => {
  const deptId = Number(req.params.id);
  await withUser(req.user.id, async (db) => {
    const { rows: deptRows } = await db.query(
      'SELECT department_id FROM departments WHERE department_id = $1', [deptId],
    );
    if (!deptRows.length) throw notFound('Department not found');

    const { rows: usageRows } = await db.query(
      `SELECT EXISTS (SELECT 1 FROM courses WHERE department_id = $1) AS has_courses,
              EXISTS (
                SELECT 1 FROM requests r
                LEFT JOIN courses c ON c.course_id = r.course_id
                WHERE r.department_id = $1 OR c.department_id = $1
              ) AS has_requests`,
      [deptId],
    );
    if (usageRows[0]?.has_courses || usageRows[0]?.has_requests) {
      throw conflict('Cannot delete department: it contains courses or associated procurement requests. Reassign or remove them first.');
    }

    await db.query('DELETE FROM departments WHERE department_id = $1', [deptId]);
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Courses — CRUD (scoped to a department)
// ---------------------------------------------------------------------------

const courseSchema = z.object({
  departmentId: z.number().int().positive(),
  code: z.string().trim().toUpperCase().min(1).max(30).regex(/^[A-Z0-9_-]+$/, 'Code must be letters, numbers or hyphens'),
  name: z.string().trim().min(2).max(200),
  fundingType: z.enum(['GRANT', 'NON_GRANT']).optional(),
});

const courseRow = (r) => ({
  id: r.course_id,
  departmentId: r.department_id,
  deptName: r.dept_name,
  code: r.code,
  name: r.name,
  fundingType: r.funding_type,
});

adminRouter.get('/courses', async (req, res) => {
  const { departmentId } = z.object({ departmentId: z.coerce.number().int().positive().optional() }).parse(req.query);
  const { rows } = await anonQuery(
    `SELECT c.course_id, c.department_id, c.code, c.name, c.funding_type, d.name AS dept_name
       FROM courses c JOIN departments d ON d.department_id = c.department_id
      WHERE $1::int IS NULL OR c.department_id = $1
      ORDER BY d.name, c.name`,
    [departmentId ?? null],
  );
  res.json(rows.map(courseRow));
});

adminRouter.post('/courses', async (req, res) => {
  const body = courseSchema.parse(req.body);
  const result = await withUser(req.user.id, async (db) => {
    const dept = await db.query('SELECT 1 FROM departments WHERE department_id = $1', [body.departmentId]);
    if (!dept.rowCount) throw notFound('Department not found');
    const { rows } = await db.query(
      `INSERT INTO courses (department_id, code, name, funding_type) VALUES ($1, $2, $3, COALESCE($4, 'GRANT'))
       RETURNING course_id, department_id, code, name, funding_type`,
      [body.departmentId, body.code, body.name, body.fundingType ?? null],
    );
    return rows[0];
  });
  res.status(201).json(courseRow(result));
});

adminRouter.patch('/courses/:id', async (req, res) => {
  const courseId = Number(req.params.id);
  const body = courseSchema.omit({ departmentId: true }).partial().parse(req.body);
  const result = await withUser(req.user.id, async (db) => {
    const sets = []; const vals = [];
    const push = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (body.code !== undefined) push('code', body.code);
    if (body.name !== undefined) push('name', body.name);
    if (body.fundingType !== undefined) push('funding_type', body.fundingType);
    if (!sets.length) throw new HttpError(400, 'Nothing to update');
    vals.push(courseId);
    const { rows, rowCount } = await db.query(
      `UPDATE courses SET ${sets.join(', ')} WHERE course_id = $${vals.length}
       RETURNING course_id, department_id, code, name, funding_type`,
      vals,
    );
    if (!rowCount) throw notFound('Course not found');
    return rows[0];
  });
  res.json(courseRow(result));
});

adminRouter.delete('/courses/:id', async (req, res) => {
  const courseId = Number(req.params.id);
  await withUser(req.user.id, async (db) => {
    const { rowCount } = await db.query('DELETE FROM courses WHERE course_id = $1', [courseId]);
    if (!rowCount) throw notFound('Course not found');
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// GET /api/admin/config  —  view all non-secret business configurations
// ---------------------------------------------------------------------------
adminRouter.get('/config', async (_req, res) => {
  const configs = await configService.getAll();
  res.json(configs);
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/config  —  update business configurations (admin only)
// ---------------------------------------------------------------------------
adminRouter.patch('/config', async (req, res) => {
  const updates = req.body?.settings ?? req.body;
  if (!updates || typeof updates !== 'object') {
    throw new HttpError(400, 'Invalid request body; expected configuration updates object');
  }
  const result = await configService.updateMultiple(updates, req.user.id);
  res.json({
    message: 'Configuration updated successfully',
    updated: result,
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/stages  —  view workflow stages with assigned approvers
// ---------------------------------------------------------------------------
adminRouter.get('/stages', async (_req, res) => {
  const { rows } = await anonQuery(
    `SELECT ws.stage_id, ws.code, ws.name, ws.sequence_no, ws.is_final,
            COALESCE(
              json_agg(
                json_build_object(
                  'userId', u.user_id,
                  'name', u.full_name,
                  'email', u.email,
                  'roleId', r.role_id,
                  'roleCode', r.code,
                  'roleName', r.name,
                  'memberClassification', sa.member_classification
                ) ORDER BY u.full_name
              ) FILTER (WHERE u.user_id IS NOT NULL),
              '[]'
            ) AS approvers
       FROM workflow_stages ws
       LEFT JOIN stage_approvers sa ON sa.stage_id = ws.stage_id
       LEFT JOIN users u ON u.user_id = sa.user_id
       LEFT JOIN roles r ON r.role_id = sa.role_id
      GROUP BY ws.stage_id
      ORDER BY ws.sequence_no`,
  );
  res.json(rows.map((s) => ({
    id: s.stage_id,
    code: s.code,
    name: s.name,
    sequence: s.sequence_no,
    isFinal: s.is_final,
    approvers: s.approvers,
  })));
});

// ---------------------------------------------------------------------------
// POST /api/admin/stages/:stageCode/approvers  —  assign approver to a stage
// ---------------------------------------------------------------------------
const assignApproverSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.number().int().positive().optional(),
  memberClassification: z.enum(['TEACHING', 'NON_TEACHING']).optional(),
});

adminRouter.post('/stages/:stageCode/approvers', async (req, res) => {
  const stageCode = req.params.stageCode.toUpperCase();
  const { userId, roleId, memberClassification } = assignApproverSchema.parse(req.body);

  const { rows: stageRows } = await anonQuery(
    'SELECT stage_id, code, name FROM workflow_stages WHERE code = $1',
    [stageCode]
  );
  if (!stageRows[0]) throw notFound(`Workflow stage '${stageCode}' not found`);
  const stage = stageRows[0];

  const { rows: userRows } = await anonQuery(
    'SELECT user_id, full_name, email, is_active FROM users WHERE user_id = $1',
    [userId]
  );
  if (!userRows[0]) throw notFound('User not found');
  if (!userRows[0].is_active) throw new HttpError(400, 'Cannot assign an inactive user as a stage approver');

  await withUser(req.user.id, async (db) => {
    let resolvedRoleId = roleId;

    if (stageCode === 'CDC') {
      const classification = memberClassification ?? 'TEACHING';
      const { teachingLimit, nonTeachingLimit } = await configService.getCdcLimits();

      const { rows: currentCdc } = await db.query(
        `SELECT sa.member_classification, count(*) AS cnt
           FROM stage_approvers sa
          WHERE sa.stage_id = $1 AND sa.user_id <> $2
          GROUP BY sa.member_classification`,
        [stage.stage_id, userId]
      );
      const counts = Object.fromEntries(currentCdc.map((r) => [r.member_classification, Number(r.cnt)]));

      if (classification === 'TEACHING' && (counts['TEACHING'] || 0) >= teachingLimit) {
        throw new HttpError(422, `CDC teaching member limit reached (maximum ${teachingLimit} teaching members allowed)`);
      }
      if (classification === 'NON_TEACHING' && (counts['NON_TEACHING'] || 0) >= nonTeachingLimit) {
        throw new HttpError(422, `CDC non-teaching member limit reached (maximum ${nonTeachingLimit} non-teaching members allowed)`);
      }

      if (!resolvedRoleId) {
        const { rows: defRole } = await db.query(
          "SELECT role_id FROM roles WHERE code = 'CDC_GRANT_MEMBER'"
        );
        resolvedRoleId = defRole[0]?.role_id;
      }
    } else if (stageCode === 'PRINCIPAL') {
      if (!resolvedRoleId) {
        const { rows: defRole } = await db.query("SELECT role_id FROM roles WHERE code = 'PRINCIPAL'");
        resolvedRoleId = defRole[0]?.role_id;
      }
    } else if (stageCode === 'PURCHASE_COMMITTEE') {
      if (!resolvedRoleId) {
        const { rows: defRole } = await db.query("SELECT role_id FROM roles WHERE code = 'PURCHASE_COMMITTEE'");
        resolvedRoleId = defRole[0]?.role_id;
      }
    } else if (stageCode === 'FINAL_AUTHORITY') {
      if (!resolvedRoleId) {
        const { rows: defRole } = await db.query("SELECT role_id FROM roles WHERE code = 'CHAIRMAN'");
        resolvedRoleId = defRole[0]?.role_id;
      }
    }

    if (resolvedRoleId) {
      const { rows: rRows } = await db.query('SELECT role_id, code FROM roles WHERE role_id = $1', [resolvedRoleId]);
      if (!rRows[0]) throw new HttpError(422, 'Invalid role ID');

      await db.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, resolvedRoleId]
      );
    }

    await db.query(
      `INSERT INTO stage_approvers (stage_id, user_id, role_id, member_classification)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stage_id, user_id) DO UPDATE SET
         role_id = EXCLUDED.role_id,
         member_classification = EXCLUDED.member_classification`,
      [stage.stage_id, userId, resolvedRoleId, memberClassification ?? 'TEACHING']
    );

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        'stage_approver',
        `${stageCode}:${userId}`,
        req.user.id,
        'ASSIGN',
        JSON.stringify({ stageCode, userId, roleId: resolvedRoleId, memberClassification: memberClassification ?? 'TEACHING' }),
      ]
    );
  });

  res.status(201).json({ message: `Approver assigned to ${stage.name}` });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/stages/:stageCode/approvers/:userId  —  remove approver
// ---------------------------------------------------------------------------
adminRouter.delete('/stages/:stageCode/approvers/:userId', async (req, res) => {
  const stageCode = req.params.stageCode.toUpperCase();
  const { userId } = req.params;

  const { rows: stageRows } = await anonQuery(
    'SELECT stage_id, code, name FROM workflow_stages WHERE code = $1',
    [stageCode]
  );
  if (!stageRows[0]) throw notFound(`Workflow stage '${stageCode}' not found`);
  const stage = stageRows[0];

  await withUser(req.user.id, async (db) => {
    if (stageCode === 'PRINCIPAL') {
      const { rows: countRows } = await db.query(
        'SELECT count(*) AS cnt FROM stage_approvers WHERE stage_id = $1 AND user_id <> $2',
        [stage.stage_id, userId]
      );
      if (Number(countRows[0]?.cnt || 0) === 0) {
        throw new HttpError(400, 'Cannot remove the last Principal approver. The Principal stage must remain staffed.');
      }
    }

    const { rowCount } = await db.query(
      'DELETE FROM stage_approvers WHERE stage_id = $1 AND user_id = $2',
      [stage.stage_id, userId]
    );
    if (!rowCount) throw notFound('User is not assigned to this stage');

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        'stage_approver',
        `${stageCode}:${userId}`,
        req.user.id,
        'REMOVE',
        JSON.stringify({ stageCode, userId }),
      ]
    );
  });

  res.status(204).end();
});


