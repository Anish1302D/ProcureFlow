import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
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

async function userDetail(userId) {
  const { rows } = await anonQuery(
    `SELECT u.user_id, u.email, u.full_name, u.is_active, u.created_at, u.updated_at,
            COALESCE(
              json_agg(
                json_build_object('id', r.role_id, 'code', r.code, 'name', r.name)
                ORDER BY r.code
              ) FILTER (WHERE r.role_id IS NOT NULL),
              '[]'
            ) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN roles r       ON r.role_id  = ur.role_id
      WHERE u.user_id = $1
      GROUP BY u.user_id`,
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
    roles: u.roles,
  };
}

async function validateRoleIds(db, roleIds) {
  if (!roleIds.length) return;
  const { rows } = await db.query(
    'SELECT role_id FROM roles WHERE role_id = ANY($1::int[])',
    [roleIds],
  );
  if (rows.length !== roleIds.length) {
    throw new HttpError(422, 'One or more role IDs are invalid');
  }
}

// ---------------------------------------------------------------------------
// GET /api/admin/users  —  list every user with their roles
// ---------------------------------------------------------------------------
adminRouter.get('/users', async (_req, res) => {
  const { rows } = await anonQuery(
    `SELECT u.user_id, u.email, u.full_name, u.is_active, u.created_at, u.updated_at,
            COALESCE(
              json_agg(
                json_build_object('id', r.role_id, 'code', r.code, 'name', r.name)
                ORDER BY r.code
              ) FILTER (WHERE r.role_id IS NOT NULL),
              '[]'
            ) AS roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN roles r       ON r.role_id  = ur.role_id
      GROUP BY u.user_id
      ORDER BY u.full_name`,
  );
  res.json(rows.map((u) => ({
    id: u.user_id,
    email: u.email,
    name: u.full_name,
    isActive: u.is_active,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
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
// POST /api/admin/users  —  create a new user
// ---------------------------------------------------------------------------
const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(2).max(200),
  password: z.string().min(8).max(200),
  roleIds: z.array(z.number().int().positive()).min(1, 'Assign at least one role'),
  isActive: z.boolean().default(true),
});

adminRouter.post('/users', async (req, res) => {
  const body = createUserSchema.parse(req.body);
  // Hash before opening the transaction — bcrypt is CPU-bound and slow;
  // holding a DB connection while it runs would waste pool capacity.
  const hash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);

  const created = await withUser(req.user.id, async (db) => {
    const dup = await db.query(
      'SELECT 1 FROM users WHERE email = $1', [body.email],
    );
    if (dup.rowCount) throw conflict('A user with this email already exists');

    await validateRoleIds(db, body.roleIds);

    const { rows } = await db.query(
      `INSERT INTO users (email, full_name, password_hash, is_active)
       VALUES ($1, $2, $3, $4) RETURNING user_id`,
      [body.email, body.fullName, hash, body.isActive],
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

    return userId;
  });

  res.status(201).json(await userDetail(created));
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id  —  edit name/email/password/roles/active status
// ---------------------------------------------------------------------------
const updateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    fullName: z.string().trim().min(2).max(200).optional(),
    password: z.string().min(8).max(200).optional(),
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
      'SELECT user_id FROM users WHERE user_id = $1', [userId],
    );
    if (!existing.rowCount) throw notFound('User not found');

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
    if (body.isActive !== undefined) push('is_active', body.isActive);

    if (sets.length || body.roleIds !== undefined) {
      sets.push('token_version = COALESCE(token_version, 1) + 1');
      push('updated_at', new Date());
      vals.push(userId);
      await db.query(
        `UPDATE users SET ${sets.join(', ')} WHERE user_id = $${vals.length}`,
        vals,
      );
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

    const { rowCount } = await db.query(
      `UPDATE users SET is_active = FALSE, token_version = COALESCE(token_version, 1) + 1, updated_at = NOW()
        WHERE user_id = $1`,
      [userId],
    );
    if (!rowCount) throw notFound('User not found');
  });

  res.status(204).end();
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/reactivate  —  re-enable a deactivated account
// ---------------------------------------------------------------------------
adminRouter.post('/users/:id/reactivate', async (req, res) => {
  const userId = req.params.id;

  await withUser(req.user.id, async (db) => {
    const { rowCount } = await db.query(
      `UPDATE users SET is_active = TRUE, token_version = COALESCE(token_version, 1) + 1, updated_at = NOW()
        WHERE user_id = $1`,
      [userId],
    );
    if (!rowCount) throw notFound('User not found');
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

