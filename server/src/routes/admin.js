import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { sendEmailChangeConfirmation, sendEmailChangeNotice, sendInvitation } from '../accountEmails.js';
import { requireRole } from '../auth.js';
import { config } from '../config.js';
import { configService } from '../configService.js';
import { NO_STORE, hashToken, newToken } from '../oneTimeLinks.js';
import { anonQuery, withUser } from '../db.js';
import { HttpError, conflict, notFound } from '../errors.js';

// Admin-only: user & role management. All routes require the ADMIN role.
// Passwords are always hashed here — plain text is never stored or logged.
export const adminRouter = Router();

adminRouter.use(requireRole('ADMIN'));


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

// Accounts created by invitation start with this unusable password hash until
// the invitee chooses their own password.
const UNSET_PASSWORD_PREFIX = '$2a$12$unusable.placeholder';

// Every account with its roles and where it stands: ACTIVE, INVITED (link
// live), INVITE_EXPIRED, INVITE_CANCELLED, DEACTIVATED or NOT_INVITED. Read
// as the signed-in administrator, because invitation rows are visible only
// to administrators under row-level security.
async function loadUsers(viewerId, userId = null) {
  const { rows } = await withUser(viewerId, (db) => db.query(
    `SELECT u.user_id, u.email, u.full_name, u.employee_id, u.is_active, u.created_at, u.updated_at,
            u.department_id, d.name AS department_name, d.code AS department_code,
            u.invited_at, u.activated_at, inv.expires_at AS invite_expires_at,
            CASE
              WHEN u.is_active THEN 'ACTIVE'
              WHEN u.activated_at IS NOT NULL OR u.password_hash NOT LIKE $2 || '%' THEN 'DEACTIVATED'
              WHEN inv.token_id IS NULL THEN 'NOT_INVITED'
              WHEN inv.revoked_at IS NOT NULL THEN 'INVITE_CANCELLED'
              WHEN inv.expires_at < NOW() THEN 'INVITE_EXPIRED'
              ELSE 'INVITED'
            END AS account_status,
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
       LEFT JOIN LATERAL (
         SELECT t.token_id, t.expires_at, t.revoked_at
           FROM account_setup_tokens t
          WHERE t.user_id = u.user_id AND t.purpose = 'INVITE'
          ORDER BY t.created_at DESC, t.token_id
          LIMIT 1
       ) inv ON TRUE
      WHERE $1::uuid IS NULL OR u.user_id = $1::uuid
      GROUP BY u.user_id, d.name, d.code, inv.token_id, inv.expires_at, inv.revoked_at
      ORDER BY u.full_name`,
    [userId, UNSET_PASSWORD_PREFIX],
  ));
  return rows.map((u) => ({
    id: u.user_id,
    email: u.email,
    name: u.full_name,
    employeeId: u.employee_id ?? null,
    isActive: u.is_active,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    departmentId: u.department_id,
    departmentName: u.department_name,
    departmentCode: u.department_code,
    roles: u.roles,
    account: {
      status: u.account_status,
      invitedAt: u.invited_at,
      activatedAt: u.activated_at,
      inviteExpiresAt: u.account_status === 'INVITED' || u.account_status === 'INVITE_EXPIRED' ? u.invite_expires_at : null,
    },
  }));
}

async function userDetail(viewerId, userId) {
  return (await loadUsers(viewerId, userId))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

function assertInvitesDeliverable() {
  if (!config.appUrl) {
    throw new HttpError(503,
      'Invitations cannot be sent until APP_URL — the address people open the app at — is configured on the server.',
      { code: 'APP_URL_REQUIRED' });
  }
}

async function assertEmailDomainAllowed(email) {
  const allowed = await configService.get('auth.allowed_email_domains');
  const domain = email.split('@')[1]?.toLowerCase();
  if (allowed.length && !allowed.includes(domain)) {
    throw new HttpError(422, `Invitations can only be sent to these email domains: ${allowed.join(', ')}`,
      { code: 'EMAIL_DOMAIN_NOT_ALLOWED' });
  }
}

// A fresh invitation link inside the caller's transaction; any live one is
// revoked first. Returns the raw token, which must go only into the email.
async function issueInvite(db, { userId, email, ip }) {
  const hours = await configService.get('auth.invite_ttl_hours');
  const token = newToken();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + hours * 3_600_000);
  await db.query(
    `UPDATE account_setup_tokens SET revoked_at = NOW()
      WHERE user_id = $1 AND purpose = 'INVITE' AND used_at IS NULL AND revoked_at IS NULL`,
    [userId],
  );
  await db.query(
    `INSERT INTO account_setup_tokens (user_id, token_hash, expires_at, purpose, sent_to_email, requested_ip)
     VALUES ($1, $2, $3, 'INVITE', $4, $5)`,
    [userId, hashToken(token), expiresAt, email, ip ?? null],
  );
  return { token, issuedAt, expiresAt };
}

// Emails the link after the transaction has committed. The response says only
// whether it was sent — the link itself is never shown to the administrator.
async function deliverInvite(viewerId, { userId, email, fullName, invitedBy, link }) {
  const { rows } = await withUser(viewerId, (db) => db.query(
    'SELECT r.name FROM user_roles ur JOIN roles r ON r.role_id = ur.role_id WHERE ur.user_id = $1 ORDER BY r.name',
    [userId],
  ));
  const invitation = { sentTo: email, expiresAt: link.expiresAt.toISOString() };
  try {
    await sendInvitation({
      to: email, fullName, roleNames: rows.map((r) => r.name), invitedBy,
      token: link.token, issuedAt: link.issuedAt, expiresAt: link.expiresAt,
    });
    return { ...invitation, delivery: 'SENT' };
  } catch (err) {
    console.error(`[invite] could not email ${email}: ${err.message}`);
    return { ...invitation, delivery: 'FAILED' };
  }
}

function inviteMessage(invitation, fullName) {
  return invitation.delivery === 'SENT'
    ? `Invitation emailed to ${invitation.sentTo}. ${fullName} chooses their own password from the link.`
    : `The invitation email to ${invitation.sentTo} could not be sent. Check the email settings, then use "Resend invitation".`;
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

// A Head of Department raises requests for the department they head, and the
// new-request form locks to it. Without one they would be offered every
// department, so the role cannot be given without a department.
async function assertHeadHasDepartment(db, roleIds, departmentId) {
  if (departmentId !== null && departmentId !== undefined) return;
  const { rowCount } = await db.query(
    "SELECT 1 FROM roles WHERE code = 'HEAD' AND role_id = ANY($1::int[])",
    [roleIds],
  );
  if (rowCount) {
    throw new HttpError(422, 'A Head of Department must be assigned the department they head', { code: 'HEAD_NEEDS_DEPARTMENT' });
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
adminRouter.get('/users', async (req, res) => {
  res.json(await loadUsers(req.user.id));
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
// POST /api/admin/users  —  invite a new user (the link is emailed to them)
// ---------------------------------------------------------------------------
const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  fullName: z.string().trim().min(2).max(200),
  employeeId: z.string().trim().max(100).nullable().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  roleIds: z.array(z.number().int().positive()).min(1, 'Assign at least one role'),
  isActive: z.boolean().optional(),
});

adminRouter.post('/users', async (req, res) => {
  const body = createUserSchema.parse(req.body);
  assertInvitesDeliverable();
  await assertEmailDomainAllowed(body.email);

  // An unusable password hash, so the account cannot sign in until the
  // invitee chooses their own password from the emailed link.
  const initialPasswordHash = `${UNSET_PASSWORD_PREFIX}.setup.required.${crypto.randomBytes(16).toString('hex')}`;

  const created = await withUser(req.user.id, async (db) => {
    const dup = await db.query(
      'SELECT 1 FROM users WHERE email = $1', [body.email],
    );
    if (dup.rowCount) throw conflict('A user with this email already exists');

    if (body.employeeId) {
      const dupEmp = await db.query(
        'SELECT 1 FROM users WHERE employee_id = $1', [body.employeeId],
      );
      if (dupEmp.rowCount) throw conflict('A user with this employee ID already exists');
    }

    await validateDepartmentId(db, body.departmentId);
    await validateRoleIds(db, body.roleIds);
    await assertHeadHasDepartment(db, body.roleIds, body.departmentId);

    // Accounts start unactivated (is_active = FALSE) until the invitee completes password setup.
    const { rows } = await db.query(
      `INSERT INTO users (email, full_name, password_hash, department_id, employee_id, is_active, token_version,
                          invited_by, invited_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, 1, $6, NOW()) RETURNING user_id`,
      [body.email, body.fullName, initialPasswordHash, body.departmentId ?? null, body.employeeId ?? null, req.user.id],
    );
    const userId = rows[0].user_id;

    await db.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
      [userId, body.roleIds],
    );

    if (body.roleIds && body.roleIds.length) {
      for (const rId of body.roleIds) {
        await db.query(
          `INSERT INTO role_appointments (user_id, role_id, department_id, start_date, is_active, remarks)
           VALUES ($1, $2, $3, CURRENT_DATE, TRUE, 'Initial institutional appointment')
           ON CONFLICT DO NOTHING`,
          [userId, rId, body.departmentId ?? null],
        );
      }

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

    const link = await issueInvite(db, { userId, email: body.email, ip: req.ip });

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ('user', $1::text, $2::uuid, 'CREATE', $3::jsonb)`,
      [
        userId,
        req.user.id,
        JSON.stringify({
          email: body.email,
          fullName: body.fullName,
          employeeId: body.employeeId ?? null,
          departmentId: body.departmentId ?? null,
          roleIds: body.roleIds,
          isActive: false,
        }),
      ],
    );

    return { userId, link };
  });

  const invitation = await deliverInvite(req.user.id, {
    userId: created.userId, email: body.email, fullName: body.fullName,
    invitedBy: req.user.name, link: created.link,
  });
  res.set(NO_STORE).status(201).json({
    ...(await userDetail(req.user.id, created.userId)),
    invitation,
    message: inviteMessage(invitation, body.fullName),
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/invite  —  resend: a new link, the old one stops working
// DELETE /api/admin/users/:id/invite —  cancel a pending invitation
// ---------------------------------------------------------------------------
async function pendingInvitee(db, userId) {
  const { rows } = await db.query(
    `SELECT user_id, email, full_name, is_active, activated_at,
            password_hash LIKE $2 || '%' AS never_set_password
       FROM users WHERE user_id = $1`,
    [userId, UNSET_PASSWORD_PREFIX],
  );
  const u = rows[0];
  if (!u) throw notFound('User not found');
  if (u.is_active || u.activated_at || !u.never_set_password) {
    throw conflict('This person has already set up their account. If they have forgotten their password, they can reset it from the sign-in page.');
  }
  return u;
}

// Turning an account on is for people who have set their own password. An
// invitee who has not would otherwise show as active with no way to sign in.
async function assertHasSetPassword(db, userId) {
  const { rows } = await db.query(
    `SELECT activated_at IS NULL AND password_hash LIKE $2 || '%' AS never_set
       FROM users WHERE user_id = $1`,
    [userId, UNSET_PASSWORD_PREFIX],
  );
  if (rows[0]?.never_set) {
    throw conflict('This person has not accepted their invitation yet. Resend the invitation instead.');
  }
}

adminRouter.post('/users/:id/invite', async (req, res) => {
  assertInvitesDeliverable();
  const userId = req.params.id;
  const sent = await withUser(req.user.id, async (db) => {
    const u = await pendingInvitee(db, userId);
    const link = await issueInvite(db, { userId, email: u.email, ip: req.ip });
    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ('user', $1::text, $2::uuid, 'INVITE_RESENT', jsonb_build_object('expiresAt', $3::text))`,
      [userId, req.user.id, link.expiresAt.toISOString()],
    );
    return { link, email: u.email, fullName: u.full_name };
  });

  const invitation = await deliverInvite(req.user.id, {
    userId, email: sent.email, fullName: sent.fullName, invitedBy: req.user.name, link: sent.link,
  });
  res.set(NO_STORE).json({
    ...(await userDetail(req.user.id, userId)),
    invitation,
    message: inviteMessage(invitation, sent.fullName),
  });
});

adminRouter.delete('/users/:id/invite', async (req, res) => {
  const userId = req.params.id;
  await withUser(req.user.id, async (db) => {
    await pendingInvitee(db, userId);
    const { rowCount } = await db.query(
      `UPDATE account_setup_tokens SET revoked_at = NOW()
        WHERE user_id = $1 AND purpose = 'INVITE' AND used_at IS NULL AND revoked_at IS NULL`,
      [userId],
    );
    if (!rowCount) throw notFound('There is no pending invitation to cancel');
    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action)
       VALUES ('user', $1::text, $2::uuid, 'INVITE_CANCELLED')`,
      [userId, req.user.id],
    );
  });
  res.json(await userDetail(req.user.id, userId));
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id  —  edit name/email/password/department/roles/active status
// ---------------------------------------------------------------------------
const updateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    fullName: z.string().trim().min(2).max(200).optional(),
    employeeId: z.string().trim().max(100).nullable().optional(),
    departmentId: z.number().int().positive().nullable().optional(),
    roleIds: z.array(z.number().int().positive()).min(1).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

adminRouter.patch('/users/:id', async (req, res) => {
  const userId = req.params.id;
  // Only the person themselves may set their password — through their
  // invitation, a reset link, or by changing it. An administrator who could
  // set it could sign in as anyone, so the request is refused outright
  // rather than having the field quietly ignored.
  if (req.body && Object.hasOwn(req.body, 'password')) {
    throw new HttpError(422, 'Administrators cannot set passwords. The person can reset their own password from the sign-in page.', { code: 'ADMIN_PASSWORD_FORBIDDEN' });
  }
  const body = updateUserSchema.parse(req.body);

  if (body.isActive === false && userId === req.user.id) {
    throw new HttpError(400, 'You cannot deactivate your own account');
  }

  let emailChange = await withUser(req.user.id, async (db) => {
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
    if (body.isActive === true) await assertHasSetPassword(db, userId);

    if (body.departmentId !== undefined) {
      await validateDepartmentId(db, body.departmentId);
    }
    if (body.departmentId !== undefined || body.roleIds !== undefined) {
      await assertHeadHasDepartment(
        db,
        body.roleIds ?? beforeUser.role_ids,
        body.departmentId !== undefined ? body.departmentId : beforeUser.department_id,
      );
    }

    if (body.email) {
      const dup = await db.query(
        'SELECT 1 FROM users WHERE email = $1 AND user_id != $2', [body.email, userId],
      );
      if (dup.rowCount) throw conflict('This email is already taken by another user');
    }

    if (body.employeeId) {
      const dupEmp = await db.query(
        'SELECT 1 FROM users WHERE employee_id = $1 AND user_id != $2', [body.employeeId, userId],
      );
      if (dupEmp.rowCount) throw conflict('This employee ID is already in use by another user');
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

    // Email is how a person proves who they are, so for an account that has
    // been set up a new address must confirm before it takes over; until then
    // sign-in and password resets stay with the current one. An invitation
    // nobody has accepted yet is simply re-addressed (its old link is
    // cancelled; resend it to the new address).
    let emailChange = null;
    const newEmail = body.email !== undefined && body.email !== String(beforeUser.email).toLowerCase()
      ? body.email : null;
    if (newEmail) {
      await assertEmailDomainAllowed(newEmail);
      const { rows: [state] } = await db.query(
        `SELECT activated_at IS NULL AND password_hash LIKE $2 || '%' AS pending FROM users WHERE user_id = $1`,
        [userId, UNSET_PASSWORD_PREFIX],
      );
      if (state.pending) {
        push('email', newEmail);
        await db.query(
          `UPDATE account_setup_tokens SET revoked_at = NOW()
            WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
          [userId],
        );
        emailChange = { status: 'CHANGED_INVITATION_CANCELLED', to: newEmail };
      } else {
        assertInvitesDeliverable();
        const hours = await configService.get('auth.invite_ttl_hours');
        const token = newToken();
        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + hours * 3_600_000);
        await db.query(
          `UPDATE account_setup_tokens SET revoked_at = NOW()
            WHERE user_id = $1 AND purpose = 'EMAIL_CHANGE' AND used_at IS NULL AND revoked_at IS NULL`,
          [userId],
        );
        await db.query(
          `INSERT INTO account_setup_tokens (user_id, token_hash, expires_at, purpose, sent_to_email, new_email, requested_ip)
           VALUES ($1, $2, $3, 'EMAIL_CHANGE', $4, $4, $5)`,
          [userId, hashToken(token), expiresAt, newEmail, req.ip ?? null],
        );
        await db.query(
          `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
           VALUES ('user', $1::text, $2::uuid, 'EMAIL_CHANGE_REQUESTED', $3::jsonb, $4::jsonb)`,
          [userId, req.user.id, JSON.stringify({ email: beforeUser.email }), JSON.stringify({ email: newEmail })],
        );
        emailChange = {
          status: 'PENDING_CONFIRMATION', to: newEmail, expiresAt: expiresAt.toISOString(),
          send: { token, issuedAt, expiresAt, oldEmail: String(beforeUser.email), fullName: body.fullName ?? beforeUser.full_name },
        };
      }
    }
    if (body.fullName !== undefined) push('full_name', body.fullName);
    if (body.employeeId !== undefined) push('employee_id', body.employeeId || null);
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
    return emailChange;
  });

  // After the transaction: the confirmation goes to the new address and a
  // heads-up to the current one. The link never appears in the response.
  let message;
  if (emailChange?.send) {
    const { send, ...shown } = emailChange;
    try {
      await sendEmailChangeConfirmation({
        to: shown.to, fullName: send.fullName, oldEmail: send.oldEmail,
        token: send.token, issuedAt: send.issuedAt, expiresAt: send.expiresAt,
      });
      await sendEmailChangeNotice({ to: send.oldEmail, fullName: send.fullName, newEmail: shown.to });
      message = `A confirmation link was emailed to ${shown.to}. The email changes when they confirm it; until then sign-in stays with ${send.oldEmail}.`;
    } catch (err) {
      console.error(`[admin] email-change confirmation to ${shown.to} failed: ${err.message}`);
      message = `The confirmation email to ${shown.to} could not be sent. Check the email settings and save the change again.`;
    }
    emailChange = shown;
  } else if (emailChange) {
    message = `Email changed to ${emailChange.to}. The earlier invitation link was cancelled — use "Resend invitation".`;
  }

  res.set(NO_STORE).json({
    ...(await userDetail(req.user.id, userId)),
    ...(emailChange ? { emailChange, message } : {}),
  });
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
    await assertHasSetPassword(db, userId);
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

  res.json(await userDetail(req.user.id, userId));
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

      // The classification picks the route: a non-teaching member sits on the
      // Non-Grant side. Defaulting everyone to CDC_GRANT_MEMBER left Non-Grant
      // requests with no one able to see or decide them.
      if (!resolvedRoleId) {
        const { rows: defRole } = await db.query(
          'SELECT role_id FROM roles WHERE code = $1',
          [classification === 'NON_TEACHING' ? 'CDC_NON_GRANT_MEMBER' : 'CDC_GRANT_MEMBER'],
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

// ---------------------------------------------------------------------------
// GET /api/admin/appointments  —  list historical and active role appointments
// ---------------------------------------------------------------------------
const appointmentQuerySchema = z.object({
  roleId: z.coerce.number().int().positive().optional(),
  userId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

adminRouter.get('/appointments', async (req, res) => {
  const query = appointmentQuerySchema.parse(req.query);

  const { rows } = await anonQuery(
    `SELECT ra.appointment_id, ra.user_id, ra.role_id, ra.department_id, ra.stage_id,
            ra.member_classification, ra.start_date, ra.end_date, ra.is_active,
            ra.appointment_order_no, ra.remarks, ra.created_at, ra.updated_at,
            u.full_name AS user_name, u.email AS user_email, u.employee_id,
            r.code AS role_code, r.name AS role_name,
            d.name AS department_name, d.code AS department_code,
            ws.code AS stage_code, ws.name AS stage_name
       FROM role_appointments ra
       JOIN users u ON u.user_id = ra.user_id
       JOIN roles r ON r.role_id = ra.role_id
       LEFT JOIN departments d ON d.department_id = ra.department_id
       LEFT JOIN workflow_stages ws ON ws.stage_id = ra.stage_id
      WHERE ($1::int IS NULL OR ra.role_id = $1)
        AND ($2::uuid IS NULL OR ra.user_id = $2)
        AND ($3::boolean IS NULL OR ra.is_active = $3)
      ORDER BY r.name, ra.is_active DESC, ra.start_date DESC`,
    [query.roleId ?? null, query.userId ?? null, query.isActive ?? null],
  );

  res.json(rows.map((ra) => ({
    appointmentId: ra.appointment_id,
    user: {
      id: ra.user_id,
      name: ra.user_name,
      email: ra.user_email,
      employeeId: ra.employee_id,
    },
    role: {
      id: ra.role_id,
      code: ra.role_code,
      name: ra.role_name,
    },
    department: ra.department_id ? {
      id: ra.department_id,
      name: ra.department_name,
      code: ra.department_code,
    } : null,
    stage: ra.stage_id ? {
      id: ra.stage_id,
      code: ra.stage_code,
      name: ra.stage_name,
    } : null,
    memberClassification: ra.member_classification,
    startDate: ra.start_date,
    endDate: ra.end_date,
    isActive: ra.is_active,
    appointmentOrderNo: ra.appointment_order_no,
    remarks: ra.remarks,
    createdAt: ra.created_at,
    updatedAt: ra.updated_at,
  })));
});

// ---------------------------------------------------------------------------
// POST /api/admin/appointments  —  appoint or transition a member to a role
// ---------------------------------------------------------------------------
const SINGLE_HOLDER_ROLES = ['PRINCIPAL', 'CHAIRMAN', 'VICE_PRESIDENT'];

const createAppointmentSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.number().int().positive(),
  departmentId: z.number().int().positive().nullable().optional(),
  stageId: z.number().int().positive().nullable().optional(),
  memberClassification: z.enum(['TEACHING', 'NON_TEACHING']).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  isActive: z.boolean().optional().default(true),
  appointmentOrderNo: z.string().trim().max(100).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
  autoTransitionPrevious: z.boolean().optional().default(true),
});

adminRouter.post('/appointments', async (req, res) => {
  const body = createAppointmentSchema.parse(req.body);
  const startDate = body.startDate || new Date().toISOString().split('T')[0];

  const appointmentId = await withUser(req.user.id, async (db) => {
    const userRes = await db.query('SELECT user_id, full_name, is_active FROM users WHERE user_id = $1', [body.userId]);
    if (!userRes.rowCount) throw notFound('User not found');

    const roleRes = await db.query('SELECT role_id, code, name FROM roles WHERE role_id = $1', [body.roleId]);
    if (!roleRes.rowCount) throw notFound('Role not found');
    const role = roleRes.rows[0];

    if (body.departmentId) {
      await validateDepartmentId(db, body.departmentId);
    }

    // Resolve stageId if not provided
    let stageId = body.stageId ?? null;
    if (!stageId) {
      if (role.code === 'PURCHASE_COMMITTEE') {
        const s = await db.query("SELECT stage_id FROM workflow_stages WHERE code = 'PURCHASE_COMMITTEE'");
        stageId = s.rows[0]?.stage_id ?? null;
      } else if (role.code === 'PRINCIPAL') {
        const s = await db.query("SELECT stage_id FROM workflow_stages WHERE code = 'PRINCIPAL'");
        stageId = s.rows[0]?.stage_id ?? null;
      } else if (['CDC_MEMBER', 'CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER'].includes(role.code)) {
        const s = await db.query("SELECT stage_id FROM workflow_stages WHERE code = 'CDC'");
        stageId = s.rows[0]?.stage_id ?? null;
      } else if (['CHAIRMAN', 'VICE_PRESIDENT'].includes(role.code)) {
        const s = await db.query("SELECT stage_id FROM workflow_stages WHERE code = 'FINAL_AUTHORITY'");
        stageId = s.rows[0]?.stage_id ?? null;
      }
    }

    // Classification defaults for CDC members
    let classification = body.memberClassification;
    if (!classification) {
      if (role.code === 'CDC_NON_GRANT_MEMBER') {
        classification = 'NON_TEACHING';
      } else if (role.code === 'CDC_GRANT_MEMBER') {
        classification = 'TEACHING';
      }
    }

    // Statutory member limits check for CDC
    if (body.isActive && ['CDC_MEMBER', 'CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER'].includes(role.code)) {
      if (classification === 'TEACHING') {
        const teachingLimit = await configService.get('cdc.teaching_members_limit');
        const countRes = await db.query(
          `SELECT count(DISTINCT user_id) AS cnt FROM stage_approvers sa
             JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
            WHERE ws.code = 'CDC' AND sa.member_classification = 'TEACHING' AND sa.user_id <> $1`,
          [body.userId],
        );
        if (Number(countRes.rows[0]?.cnt || 0) >= teachingLimit) {
          throw new HttpError(422, `Cannot exceed statutory limit of ${teachingLimit} teaching CDC members`);
        }
      } else if (classification === 'NON_TEACHING') {
        const nonTeachingLimit = await configService.get('cdc.non_teaching_members_limit');
        const countRes = await db.query(
          `SELECT count(DISTINCT user_id) AS cnt FROM stage_approvers sa
             JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
            WHERE ws.code = 'CDC' AND sa.member_classification = 'NON_TEACHING' AND sa.user_id <> $1`,
          [body.userId],
        );
        if (Number(countRes.rows[0]?.cnt || 0) >= nonTeachingLimit) {
          throw new HttpError(422, `Cannot exceed statutory limit of ${nonTeachingLimit} non-teaching CDC members`);
        }
      }
    }

    // Single-holder role automatic transition
    if (body.isActive && SINGLE_HOLDER_ROLES.includes(role.code) && body.autoTransitionPrevious) {
      // Deactivate previous active appointments for this role
      await db.query(
        `UPDATE role_appointments
            SET is_active = FALSE,
                end_date = COALESCE(end_date, $1::date),
                updated_at = NOW()
          WHERE role_id = $2 AND is_active = TRUE AND user_id <> $3`,
        [startDate, body.roleId, body.userId],
      );

      // Remove previous holder from stage_approvers for single-holder stage
      if (stageId && role.code === 'PRINCIPAL') {
        await db.query(
          'DELETE FROM stage_approvers WHERE stage_id = $1 AND user_id <> $2',
          [stageId, body.userId],
        );
      }
    }

    // Insert new appointment
    const { rows: apptRows } = await db.query(
      `INSERT INTO role_appointments (
         user_id, role_id, department_id, stage_id, member_classification,
         start_date, end_date, is_active, appointment_order_no, remarks
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING appointment_id`,
      [
        body.userId,
        body.roleId,
        body.departmentId ?? null,
        stageId,
        classification ?? null,
        startDate,
        body.endDate ?? null,
        body.isActive,
        body.appointmentOrderNo ?? null,
        body.remarks ?? null,
      ],
    );

    const newApptId = apptRows[0].appointment_id;

    // Maintain user_roles and stage_approvers if active
    if (body.isActive) {
      await db.query(
        'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [body.userId, body.roleId],
      );

      if (stageId) {
        await db.query(
          `INSERT INTO stage_approvers (stage_id, user_id, role_id, member_classification)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (stage_id, user_id) DO UPDATE
             SET role_id = EXCLUDED.role_id,
                 member_classification = EXCLUDED.member_classification`,
          [stageId, body.userId, body.roleId, classification ?? null],
        );
      }
    }

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ('role_appointment', $1::text, $2::uuid, 'CREATE', $3::jsonb)`,
      [
        newApptId,
        req.user.id,
        JSON.stringify({
          appointmentId: newApptId,
          userId: body.userId,
          roleCode: role.code,
          startDate,
          endDate: body.endDate,
          isActive: body.isActive,
        }),
      ],
    );

    return newApptId;
  });

  const { rows } = await anonQuery(
    `SELECT ra.appointment_id, ra.user_id, ra.role_id, ra.department_id, ra.stage_id,
            ra.member_classification, ra.start_date, ra.end_date, ra.is_active,
            ra.appointment_order_no, ra.remarks, ra.created_at, ra.updated_at,
            u.full_name AS user_name, u.email AS user_email, u.employee_id,
            r.code AS role_code, r.name AS role_name,
            d.name AS department_name, d.code AS department_code,
            ws.code AS stage_code, ws.name AS stage_name
       FROM role_appointments ra
       JOIN users u ON u.user_id = ra.user_id
       JOIN roles r ON r.role_id = ra.role_id
       LEFT JOIN departments d ON d.department_id = ra.department_id
       LEFT JOIN workflow_stages ws ON ws.stage_id = ra.stage_id
      WHERE ra.appointment_id = $1`,
    [appointmentId],
  );

  const ra = rows[0];
  res.status(201).json({
    appointmentId: ra.appointment_id,
    user: {
      id: ra.user_id,
      name: ra.user_name,
      email: ra.user_email,
      employeeId: ra.employee_id,
    },
    role: {
      id: ra.role_id,
      code: ra.role_code,
      name: ra.role_name,
    },
    department: ra.department_id ? {
      id: ra.department_id,
      name: ra.department_name,
      code: ra.department_code,
    } : null,
    stage: ra.stage_id ? {
      id: ra.stage_id,
      code: ra.stage_code,
      name: ra.stage_name,
    } : null,
    memberClassification: ra.member_classification,
    startDate: ra.start_date,
    endDate: ra.end_date,
    isActive: ra.is_active,
    appointmentOrderNo: ra.appointment_order_no,
    remarks: ra.remarks,
    createdAt: ra.created_at,
    updatedAt: ra.updated_at,
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/appointments/:id  —  update tenure, dates, active status
// ---------------------------------------------------------------------------
const updateAppointmentSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  isActive: z.boolean().optional(),
  memberClassification: z.enum(['TEACHING', 'NON_TEACHING']).nullable().optional(),
  appointmentOrderNo: z.string().trim().max(100).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Nothing to update');

adminRouter.patch('/appointments/:id', async (req, res) => {
  const appointmentId = req.params.id;
  const body = updateAppointmentSchema.parse(req.body);

  await withUser(req.user.id, async (db) => {
    const existing = await db.query(
      'SELECT * FROM role_appointments WHERE appointment_id = $1',
      [appointmentId],
    );
    if (!existing.rowCount) throw notFound('Appointment not found');
    const prev = existing.rows[0];

    // A CDC member's classification is their route (teaching = Grant,
    // non-teaching = Non-Grant), and routing reads stage_approvers. A change
    // made only here left them notified of, and able to decide, the old route.
    const { rows: stageRows } = prev.stage_id
      ? await db.query('SELECT code FROM workflow_stages WHERE stage_id = $1', [prev.stage_id])
      : { rows: [] };
    const reclassifyCdc = stageRows[0]?.code === 'CDC'
      && body.memberClassification
      && body.memberClassification !== prev.member_classification;

    if (reclassifyCdc) {
      const limitKey = body.memberClassification === 'TEACHING'
        ? 'cdc.teaching_members_limit' : 'cdc.non_teaching_members_limit';
      const limit = await configService.get(limitKey);
      const { rows: countRows } = await db.query(
        `SELECT count(DISTINCT user_id) AS cnt FROM stage_approvers
          WHERE stage_id = $1 AND member_classification = $2 AND user_id <> $3`,
        [prev.stage_id, body.memberClassification, prev.user_id],
      );
      if (Number(countRows[0]?.cnt || 0) >= limit) {
        const kind = body.memberClassification === 'TEACHING' ? 'teaching' : 'non-teaching';
        throw new HttpError(422, `Cannot exceed statutory limit of ${limit} ${kind} CDC members`);
      }
    }

    const sets = [];
    const vals = [];
    const push = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

    if (body.startDate !== undefined) push('start_date', body.startDate);
    if (body.endDate !== undefined) push('end_date', body.endDate);
    if (body.isActive !== undefined) push('is_active', body.isActive);
    if (body.memberClassification !== undefined) push('member_classification', body.memberClassification);
    if (body.appointmentOrderNo !== undefined) push('appointment_order_no', body.appointmentOrderNo);
    if (body.remarks !== undefined) push('remarks', body.remarks);

    push('updated_at', new Date());
    vals.push(appointmentId);

    await db.query(
      `UPDATE role_appointments SET ${sets.join(', ')} WHERE appointment_id = $${vals.length}`,
      vals,
    );

    if (reclassifyCdc) {
      await db.query(
        'UPDATE stage_approvers SET member_classification = $1 WHERE stage_id = $2 AND user_id = $3',
        [body.memberClassification, prev.stage_id, prev.user_id],
      );
    }

    // If deactivated and was seated at stage_approvers, update stage_approvers
    if (body.isActive === false && prev.stage_id) {
      // Check if user has any other active appointment for this stage
      const otherActive = await db.query(
        `SELECT 1 FROM role_appointments
          WHERE user_id = $1 AND stage_id = $2 AND is_active = TRUE AND appointment_id <> $3`,
        [prev.user_id, prev.stage_id, appointmentId],
      );
      if (!otherActive.rowCount) {
        await db.query(
          'DELETE FROM stage_approvers WHERE stage_id = $1 AND user_id = $2',
          [prev.stage_id, prev.user_id],
        );
      }
    }

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
       VALUES ('role_appointment', $1::text, $2::uuid, 'UPDATE', $3::jsonb)`,
      [
        appointmentId,
        req.user.id,
        JSON.stringify(body),
      ],
    );
  });

  const { rows } = await anonQuery(
    `SELECT ra.appointment_id, ra.user_id, ra.role_id, ra.department_id, ra.stage_id,
            ra.member_classification, ra.start_date, ra.end_date, ra.is_active,
            ra.appointment_order_no, ra.remarks, ra.created_at, ra.updated_at,
            u.full_name AS user_name, u.email AS user_email, u.employee_id,
            r.code AS role_code, r.name AS role_name,
            d.name AS department_name, d.code AS department_code,
            ws.code AS stage_code, ws.name AS stage_name
       FROM role_appointments ra
       JOIN users u ON u.user_id = ra.user_id
       JOIN roles r ON r.role_id = ra.role_id
       LEFT JOIN departments d ON d.department_id = ra.department_id
       LEFT JOIN workflow_stages ws ON ws.stage_id = ra.stage_id
      WHERE ra.appointment_id = $1`,
    [appointmentId],
  );

  const ra = rows[0];
  res.json({
    appointmentId: ra.appointment_id,
    user: {
      id: ra.user_id,
      name: ra.user_name,
      email: ra.user_email,
      employeeId: ra.employee_id,
    },
    role: {
      id: ra.role_id,
      code: ra.role_code,
      name: ra.role_name,
    },
    department: ra.department_id ? {
      id: ra.department_id,
      name: ra.department_name,
      code: ra.department_code,
    } : null,
    stage: ra.stage_id ? {
      id: ra.stage_id,
      code: ra.stage_code,
      name: ra.stage_name,
    } : null,
    memberClassification: ra.member_classification,
    startDate: ra.start_date,
    endDate: ra.end_date,
    isActive: ra.is_active,
    appointmentOrderNo: ra.appointment_order_no,
    remarks: ra.remarks,
    createdAt: ra.created_at,
    updatedAt: ra.updated_at,
  });
});
