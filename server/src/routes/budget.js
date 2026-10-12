import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { withUser } from '../db.js';
import { notFound } from '../errors.js';
import { amount, intId, param } from '../validate.js';

export const budgetRouter = Router();

const provisionInput = z.object({
  departmentId: intId,
  financialYearId: intId,
  budgetHeadId: intId.nullable().optional(),
  allocatedAmount: amount,
  remarks: z.string().trim().max(1000).optional(),
});

const summaryRow = (r, { attachments = [], canEdit = false } = {}) => ({
  id: r.budget_provision_id,
  department: { id: r.department_id, code: r.department_code, name: r.department_name },
  financialYear: { id: r.financial_year_id, label: r.financial_year },
  budgetHead: r.budget_head_id
    ? { id: r.budget_head_id, code: r.budget_head_code, name: r.budget_head_name }
    : null,
  allocatedAmount: Number(r.allocated_amount),
  utilizedAmount: Number(r.utilized_amount),
  committedAmount: Number(r.committed_amount),
  remainingAmount: Number(r.remaining_amount),
  availableAmount: Number(r.available_amount),
  remarks: r.remarks,
  attachments,
  canEdit,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const provisionAttachment = (a) => ({
  id: a.attachment_id,
  budgetProvisionId: a.budget_provision_id,
  fileName: a.file_name,
  mimeType: a.mime_type,
  sizeBytes: a.size_bytes,
  versionNumber: a.version_number ?? 1,
  supersededById: a.superseded_by_id ?? null,
  replacementReason: a.replacement_reason ?? null,
  uploadedBy: { id: a.uploaded_by, name: a.uploaded_by_name },
  uploadedAt: a.uploaded_at,
});

/** The sanction letters and supporting files, by provision. */
async function attachmentsByProvision(db, provisionIds) {
  if (!provisionIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT a.*, u.full_name AS uploaded_by_name
       FROM attachments a JOIN users u ON u.user_id = a.uploaded_by
      WHERE a.budget_provision_id = ANY($1::uuid[])
      ORDER BY a.version_number, a.uploaded_at`,
    [provisionIds],
  );
  const byProvision = new Map();
  for (const row of rows) {
    const list = byProvision.get(row.budget_provision_id) ?? [];
    list.push(provisionAttachment(row));
    byProvision.set(row.budget_provision_id, list);
  }
  return byProvision;
}

/** Whose provision a head may change: their own department's, and no other. */
async function ownDepartment(db, user) {
  if (user.roles.includes('ADMIN')) return 'ALL';
  if (!user.roles.includes('HEAD')) return null;
  const { rows } = await db.query('SELECT department_id FROM users WHERE user_id = $1', [user.id]);
  return rows[0]?.department_id ?? null;
}

const editable = (scope, departmentId) => scope === 'ALL' || (scope !== null && scope === departmentId);

// GET /api/budget-provisions — List provisions with computed figures.
// Who may see which department's provision is decided by the
// budget_provisions_read policy, so no role list is repeated here: a head sees
// their own department, the Principal, Purchase Committee, CDC and the
// Chairman/Vice Chairman see them all.
budgetRouter.get('/budget-provisions', async (req, res) => {
  const { departmentId, financialYearId } = z.object({
    departmentId: intId.optional(), financialYearId: intId.optional(),
  }).parse(req.query);

  const body = await withUser(req.user.id, async (db) => {
    const { rows: summaries } = await db.query(
      `SELECT * FROM v_department_budget_summary
        WHERE ($1::int IS NULL OR department_id = $1)
          AND ($2::int IS NULL OR financial_year_id = $2)
        ORDER BY department_name, financial_year DESC`,
      [departmentId ?? null, financialYearId ?? null],
    );
    const scope = await ownDepartment(db, req.user);
    const files = await attachmentsByProvision(db, summaries.map((s) => s.budget_provision_id));
    return summaries.map((s) => summaryRow(s, {
      attachments: files.get(s.budget_provision_id) ?? [],
      canEdit: editable(scope, s.department_id),
    }));
  });

  res.json(body);
});

// GET /api/budget-provisions/:id
budgetRouter.get('/budget-provisions/:id', async (req, res) => {
  const provisionId = param(req, 'id');

  const body = await withUser(req.user.id, async (db) => {
    const { rows } = await db.query(
      'SELECT * FROM v_department_budget_summary WHERE budget_provision_id = $1',
      [provisionId],
    );
    if (!rows[0]) return null;
    const scope = await ownDepartment(db, req.user);
    const files = await attachmentsByProvision(db, [provisionId]);
    return summaryRow(rows[0], {
      attachments: files.get(provisionId) ?? [],
      canEdit: editable(scope, rows[0].department_id),
    });
  });

  if (!body) throw notFound('Budget provision not found');
  res.json(body);
});

// POST /api/budget-provisions — Upsert provision.
// The head of a department declares its annual provision; the
// budget_provisions_write policy confines a head to their own department.
budgetRouter.post('/budget-provisions', requireRole('HEAD', 'ADMIN'), async (req, res) => {
  const body = provisionInput.parse(req.body);

  const detail = await withUser(req.user.id, async (db) => {
    const { rows } = await db.query(
      `INSERT INTO budget_provisions (department_id, financial_year_id, budget_head_id, allocated_amount, remarks, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (department_id, financial_year_id, COALESCE(budget_head_id, -1))
       DO UPDATE SET allocated_amount = EXCLUDED.allocated_amount,
                     remarks = EXCLUDED.remarks,
                     updated_at = NOW()
       RETURNING budget_provision_id`,
      [body.departmentId, body.financialYearId, body.budgetHeadId ?? null, body.allocatedAmount, body.remarks || null, req.user.id],
    );
    const id = rows[0].budget_provision_id;
    const { rows: fetched } = await db.query(
      'SELECT * FROM v_department_budget_summary WHERE budget_provision_id = $1',
      [id],
    );
    const scope = await ownDepartment(db, req.user);
    return summaryRow(fetched[0], { canEdit: editable(scope, fetched[0].department_id) });
  });

  res.status(201).json(detail);
});
