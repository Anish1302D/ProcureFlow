import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { withUser } from '../db.js';

export const usersRouter = Router();

const INSTITUTIONAL_DIRECTORY_ROLES = [
  'ADMIN',
  'PRINCIPAL',
  'CHAIRMAN',
  'VICE_PRESIDENT',
  'CDC_MEMBER',
  'CDC_GRANT_MEMBER',
  'CDC_NON_GRANT_MEMBER',
  'PURCHASE_COMMITTEE',
  'HEAD',
];

// Member directory with persistent identity details (no password/security hashes)
usersRouter.get('/members', requireRole(...INSTITUTIONAL_DIRECTORY_ROLES), async (req, res) => {
  const rows = await withUser(req.user.id, async (db) => (await db.query(
    `SELECT u.user_id, u.full_name, u.email, u.employee_id, u.is_active,
            u.created_at, u.updated_at,
            d.department_id, d.name AS department_name, d.code AS department_code,
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
       LEFT JOIN roles r ON r.role_id = ur.role_id
      GROUP BY u.user_id, d.department_id, d.name, d.code
      ORDER BY u.full_name`,
  )).rows);

  res.json(rows.map((u) => ({
    id: u.user_id,
    name: u.full_name,
    email: u.email,
    employeeId: u.employee_id,
    isActive: u.is_active,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
    department: u.department_id ? {
      id: u.department_id,
      name: u.department_name,
      code: u.department_code,
    } : null,
    roles: u.roles,
  })));
});

// Role appointments and tenure history (enforced via database RLS)
usersRouter.get('/members/tenure-history', async (req, res) => {
  const { roleCode, userId } = z.object({
    roleCode: z.string().trim().toUpperCase().max(40).optional(),
    userId: z.string().uuid().optional(),
  }).parse(req.query);

  const rows = await withUser(req.user.id, async (db) => (await db.query(
    `SELECT ra.appointment_id, ra.user_id, ra.role_id, ra.department_id, ra.stage_id,
            ra.member_classification, ra.start_date, ra.end_date, ra.is_active,
            ra.appointment_order_no, ra.remarks, ra.created_at, ra.updated_at,
            u.full_name AS user_name, u.email AS user_email, u.employee_id,
            r.code AS role_code, r.name AS role_name,
            d.name AS department_name, d.code AS department_code,
            ws.name AS stage_name
       FROM role_appointments ra
       JOIN users u ON u.user_id = ra.user_id
       JOIN roles r ON r.role_id = ra.role_id
       LEFT JOIN departments d ON d.department_id = ra.department_id
       LEFT JOIN workflow_stages ws ON ws.stage_id = ra.stage_id
      WHERE ($1::text IS NULL OR r.code = $1)
        AND ($2::uuid IS NULL OR ra.user_id = $2)
      ORDER BY r.name, ra.is_active DESC, ra.start_date DESC`,
    [roleCode ?? null, userId ?? null],
  )).rows);

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
