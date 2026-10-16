import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { queryAll, withUser } from '../db.js';
import { forbidden, notFound } from '../errors.js';
import { generatePdfReport } from '../pdfReport.js';
import { SECTIONS, assembleReport, renderReportHtml } from '../reporting.js';
import { hasAnyRole } from '../roles.js';
import { APPROVAL_BUDGET_ROLES } from './auth.js';
import { loadDetail } from './requests.js';
import { flag, intId, pagination, param } from '../validate.js';

// Dashboards, reports, exports, the audit log and notifications. All request
// figures come through security_invoker views, so every number is scoped to
// what the caller is allowed to see — the Principal's dashboard covers the
// college, a requester's covers their own requests.
export const reportsRouter = Router();

/** The requested financial year, or the active one when none is given. */
async function financialYear(db, financialYearId) {
  const { rows } = await db.query(
    `SELECT financial_year_id AS id, label FROM financial_years
      WHERE CASE WHEN $1::int IS NULL THEN is_active ELSE financial_year_id = $1 END`,
    [financialYearId ?? null],
  );
  return rows[0] ?? { id: null, label: null };
}

const pendingRow = (r) => ({
  id: r.request_id,
  requestNumber: r.request_number,
  title: r.title,
  raisedBy: { id: r.raised_by, name: r.raised_by_name },
  status: r.current_status,
  stage: r.current_stage_code ? { code: r.current_stage_code, name: r.current_stage_name } : null,
  tentativeTotalCost: r.tentative_total_cost,
  daysPending: r.days_pending,
  submittedAt: r.submitted_at,
});

reportsRouter.get('/dashboard', async (req, res) => {
  const { financialYearId } = z.object({ financialYearId: intId.optional() }).parse(req.query);

  const body = await withUser(req.user.id, async (db) => {
    const year = await financialYear(db, financialYearId);
    const fy = year.id;
    const [counts, attention, awaiting, recent, higher] = await queryAll(db, [
      ['SELECT * FROM v_dashboard_by_fy WHERE financial_year_id = $1', [fy]],
      [`SELECT count(*)::int AS n FROM v_pending_gt_3_days
         WHERE financial_year_id = $1 AND current_status <> 'DRAFT'`, [fy]],
      [`SELECT count(*)::int AS n FROM requests r
         WHERE left(r.current_status::text, 6) = 'UNDER_'
           AND EXISTS (SELECT 1 FROM stage_approvers sa
                        WHERE sa.stage_id = r.current_stage_id AND sa.user_id = $1)`, [req.user.id]],
      [`SELECT r.request_id, r.request_number, r.title, r.current_status, r.updated_at,
               ws.name AS stage_name
          FROM requests r LEFT JOIN workflow_stages ws ON ws.stage_id = r.current_stage_id
         WHERE r.financial_year_id = $1
         ORDER BY r.updated_at DESC LIMIT 5`, [fy]],
      // The view's "escalated" counts a status the workflow never sets; what
      // people mean by escalated is "with CDC or the final authority".
      [`SELECT count(*)::int AS n FROM requests r
         WHERE r.financial_year_id = $1
           AND r.current_status IN ('UNDER_CDC_REVIEW', 'UNDER_FINAL_AUTHORITY_REVIEW')`, [fy]],
    ]);
    const c = counts.rows[0] ?? {};
    return {
      financialYearId: fy,
      financialYear: year.label,
      counts: {
        total: c.total ?? 0,
        pending: c.pending ?? 0,
        approved: c.approved ?? 0,
        partiallyApproved: c.partial ?? 0,
        rejected: c.rejected ?? 0,
        withHigherAuthority: higher.rows[0].n,
        inFulfilment: c.fulfilment ?? 0,
        carriedForward: c.carried_forward ?? 0,
      },
      // "3 requests have been pending for more than 3 days" (design doc §16).
      attention: { pendingOverThreeDays: attention.rows[0].n },
      awaitingMyDecision: awaiting.rows[0].n,
      recent: recent.rows.map((r) => ({
        id: r.request_id,
        requestNumber: r.request_number,
        title: r.title,
        status: r.current_status,
        stageName: r.stage_name,
        updatedAt: r.updated_at,
      })),
    };
  });

  res.json(body);
});

// Where the money went, by budget head, for the reports page. Scoped like
// everything else: the Principal sees the college, a requester their own.
const DECIDED_FOR = ['APPROVED', 'PARTIALLY_APPROVED', 'FULFILMENT_PENDING', 'FULFILLED', 'CLOSED'];

reportsRouter.get('/reports/by-budget-head', async (req, res) => {
  const { financialYearId, departmentId } = z.object({
    financialYearId: intId.optional(),
    departmentId: intId.optional(),
  }).parse(req.query);

  const body = await withUser(req.user.id, async (db) => {
    const year = await financialYear(db, financialYearId);
    let dept = null;
    if (departmentId) {
      const { rows: dRows } = await db.query(
        'SELECT department_id AS id, code, name FROM departments WHERE department_id = $1',
        [departmentId],
      );
      dept = dRows[0] ?? null;
    }

    const { rows } = await db.query(
      `SELECT bh.budget_head_id, bh.name, bh.head_type,
              count(*)::int AS requests,
              count(*) FILTER (WHERE r.current_status::text = ANY($2::text[]))::int AS approved,
              count(*) FILTER (WHERE r.current_status = 'REJECTED')::int AS rejected,
              COALESCE(sum(r.tentative_total_cost), 0) AS requested,
              COALESCE(sum(r.sanctioned_amount) FILTER (WHERE r.current_status::text = ANY($2::text[])), 0) AS sanctioned
         FROM requests r
         JOIN budget_heads bh ON bh.budget_head_id = r.budget_head_id
        WHERE r.current_status <> 'DRAFT' AND r.financial_year_id = $1
          AND ($3::int IS NULL OR r.department_id = $3)
        GROUP BY bh.budget_head_id, bh.name, bh.head_type
        ORDER BY requested DESC, bh.name`,
      [year.id, DECIDED_FOR, departmentId ?? null],
    );
    return {
      financialYear: year.label,
      department: dept,
      rows: rows.map((r) => ({
        budgetHead: { id: r.budget_head_id, name: r.name, headType: r.head_type },
        requests: r.requests,
        approved: r.approved,
        rejected: r.rejected,
        requested: r.requested,
        sanctioned: r.sanctioned,
      })),
    };
  });
  res.json(body);
});

// Everything behind the Reports page — and the detail behind each figure — in
// one payload, for the downloadable institutional summary report. Every query
// runs under the caller's row-level security, so the report never contains a
// request its reader could not already open; the Principal's covers the
// college, a requester's their own requests.
reportsRouter.get('/reports/summary', async (req, res) => {
  const { financialYearId, departmentId, reportType } = z.object({
    financialYearId: intId.optional(),
    departmentId: intId.optional(),
    reportType: z.enum(['approval-budget', 'requests', 'issues']).optional(),
  }).parse(req.query);

  const isHigherAuthority = hasAnyRole(req.user, APPROVAL_BUDGET_ROLES);

  // Approval & budget reports are restricted to Principal, CDC, Chairman, Vice Chairman, Admin.
  if (reportType === 'approval-budget' && !isHigherAuthority) {
    throw forbidden('Approval & Budget Reports are restricted to Principal, CDC, Chairman and Vice Chairman');
  }

  // A requester/HOD who is not higher authority cannot inspect another department's separate data.
  if (!isHigherAuthority && departmentId && req.user.departmentId && departmentId !== req.user.departmentId) {
    throw forbidden('Access restricted to your own department');
  }

  const targetDeptId = departmentId ?? (!isHigherAuthority ? req.user.departmentId : null);

  const body = await withUser(req.user.id, async (db) => {
    const { rows: fyRows } = await db.query(
      `SELECT financial_year_id AS id, label, start_date::text AS start_date, end_date::text AS end_date
         FROM financial_years
        WHERE CASE WHEN $1::int IS NULL THEN is_active ELSE financial_year_id = $1 END`,
      [financialYearId ?? null],
    );
    const year = fyRows[0] ?? { id: null, label: null, start_date: null, end_date: null };
    const fy = year.id;
    const decided = DECIDED_FOR;

    let dept = null;
    if (targetDeptId) {
      const { rows: dRows } = await db.query(
        'SELECT department_id AS id, code, name FROM departments WHERE department_id = $1',
        [targetDeptId],
      );
      dept = dRows[0] ?? null;
    }

    // Submitted (non-draft) requests in the year, with their dimensions.
    const FROM_REQUESTS = `
      FROM requests r
      JOIN budget_heads bh         ON bh.budget_head_id = r.budget_head_id
      JOIN users u                 ON u.user_id = r.raised_by
      LEFT JOIN departments d      ON d.department_id = r.department_id
      LEFT JOIN courses c          ON c.course_id = r.course_id
      LEFT JOIN workflow_stages ws ON ws.stage_id = r.current_stage_id`;

    const WHERE_AGG = `
      ${FROM_REQUESTS}
     WHERE r.current_status <> 'DRAFT' AND r.financial_year_id = $1
       AND ($3::int IS NULL OR r.department_id = $3)`;

    const WHERE_BASE = `
      ${FROM_REQUESTS}
     WHERE r.current_status <> 'DRAFT' AND r.financial_year_id = $1
       AND ($2::int IS NULL OR r.department_id = $2)`;

    const AGG = `
      count(*)::int AS requests,
      count(*) FILTER (WHERE r.current_status::text = ANY($2::text[]))::int AS approved,
      count(*) FILTER (WHERE r.current_status = 'PARTIALLY_APPROVED')::int AS partial,
      count(*) FILTER (WHERE r.current_status = 'REJECTED')::int AS rejected,
      count(*) FILTER (WHERE r.current_status::text <> ALL($2::text[])
                         AND r.current_status NOT IN ('REJECTED', 'CARRIED_FORWARD'))::int AS pending,
      COALESCE(sum(r.tentative_total_cost), 0) AS requested,
      COALESCE(sum(r.sanctioned_amount) FILTER (WHERE r.current_status::text = ANY($2::text[])), 0) AS sanctioned`;

    const [heads, statuses, depts, stages, itemTypes, funding, monthly, provisions, ageing, register, issuesCounts, lineItems, issuesDetailed] =
      await queryAll(db, [
        [`SELECT bh.budget_head_id, bh.code, bh.name, bh.head_type, ${AGG}
            ${WHERE_AGG} GROUP BY bh.budget_head_id, bh.code, bh.name, bh.head_type
            ORDER BY requested DESC, bh.name`, [fy, decided, targetDeptId ?? null]],
        [`SELECT r.current_status::text AS status, count(*)::int AS requests,
                 COALESCE(sum(r.tentative_total_cost), 0) AS requested,
                 COALESCE(sum(r.sanctioned_amount), 0) AS sanctioned
            ${WHERE_BASE} GROUP BY r.current_status ORDER BY requests DESC`, [fy, targetDeptId ?? null]],
        [`SELECT COALESCE(d.name, 'Unassigned') AS name, d.code, ${AGG}
            ${WHERE_AGG} GROUP BY d.name, d.code ORDER BY requested DESC`, [fy, decided, targetDeptId ?? null]],
        [`SELECT ws.name AS stage, ws.code, count(*)::int AS requests,
                 COALESCE(sum(r.tentative_total_cost), 0) AS amount,
                 round(avg(EXTRACT(EPOCH FROM NOW() - COALESCE(r.submitted_at, r.created_at)) / 86400), 1) AS avg_days,
                 max(EXTRACT(DAY FROM NOW() - COALESCE(r.submitted_at, r.created_at)))::int AS max_days
            ${WHERE_BASE} AND left(r.current_status::text, 6) = 'UNDER_'
            GROUP BY ws.name, ws.code, ws.stage_id ORDER BY ws.stage_id`, [fy, targetDeptId ?? null]],
        [`SELECT ri.item_type_snapshot::text AS item_type, count(*)::int AS lines,
                 COALESCE(sum(ri.requested_quantity), 0) AS requested_qty,
                 COALESCE(sum(ri.approved_quantity), 0) AS approved_qty,
                 COALESCE(sum(ri.estimated_total), 0) AS requested,
                 COALESCE(sum(ri.approved_amount), 0) AS approved
            FROM request_items ri JOIN requests r ON r.request_id = ri.request_id
           WHERE r.current_status <> 'DRAFT' AND r.financial_year_id = $1
             AND ($2::int IS NULL OR r.department_id = $2)
           GROUP BY ri.item_type_snapshot ORDER BY requested DESC`, [fy, targetDeptId ?? null]],
        [`SELECT COALESCE(c.funding_type::text, 'UNSPECIFIED') AS funding, ${AGG}
            ${WHERE_AGG} GROUP BY c.funding_type ORDER BY requested DESC`, [fy, decided, targetDeptId ?? null]],
        [`SELECT to_char(date_trunc('month', COALESCE(r.submitted_at, r.created_at)), 'YYYY-MM') AS month, ${AGG}
            ${WHERE_AGG} GROUP BY 1 ORDER BY 1`, [fy, decided, targetDeptId ?? null]],
        [`SELECT department_name, budget_head_name, allocated_amount, utilized_amount,
                 committed_amount, remaining_amount
            FROM v_department_budget_summary WHERE financial_year_id = $1
             AND ($2::int IS NULL OR department_id = $2)
           ORDER BY department_name, budget_head_name NULLS FIRST`, [fy, targetDeptId ?? null]],
        [`SELECT r.request_number, r.title, u.full_name AS raised_by_name, r.current_status,
                 ws.name AS current_stage_name, r.tentative_total_cost,
                 EXTRACT(DAY FROM NOW() - COALESCE(r.submitted_at, r.created_at))::INT AS days_pending,
                 r.submitted_at
            FROM requests r
            JOIN users u ON u.user_id = r.raised_by
            LEFT JOIN workflow_stages ws ON ws.stage_id = r.current_stage_id
           WHERE r.financial_year_id = $1
             AND r.current_status <> 'DRAFT'
             AND EXTRACT(DAY FROM NOW() - COALESCE(r.submitted_at, r.created_at))::INT > 3
             AND ($2::int IS NULL OR r.department_id = $2)
           ORDER BY days_pending DESC, r.request_number`, [fy, targetDeptId ?? null]],
        [`SELECT r.request_id, r.request_number, r.title, r.current_status::text AS status, u.full_name AS raised_by,
                 d.name AS department, bh.name AS budget_head, ws.name AS stage,
                 r.tentative_total_cost AS requested, r.sanctioned_amount AS sanctioned,
                 r.submitted_at, r.closed_at
            ${WHERE_BASE} ORDER BY r.submitted_at NULLS LAST, r.request_number`, [fy, targetDeptId ?? null]],
        [`SELECT i.status::text AS status, count(*)::int AS n
            FROM issues i
            JOIN users u ON u.user_id = i.raised_by
           WHERE ($1::date IS NULL OR (i.created_at >= $1::date AND i.created_at < $2::date + 1))
             AND ($3::int IS NULL OR u.department_id = $3)
           GROUP BY i.status ORDER BY n DESC`, [year.start_date, year.end_date, targetDeptId ?? null]],
        [`SELECT ri.request_item_id, ri.request_id, r.request_number, r.title AS request_title,
                 bi.name AS item_name, bi.unit, ri.item_type_snapshot::text AS item_type,
                 ri.requested_quantity, ri.approved_quantity,
                 ri.estimated_unit_cost, ri.estimated_total, ri.approved_amount,
                 ri.item_status::text AS item_status, ri.remarks
            FROM request_items ri
            JOIN requests r        ON r.request_id = ri.request_id
            JOIN budget_items bi   ON bi.budget_item_id = ri.budget_item_id
           WHERE r.current_status <> 'DRAFT'
             AND r.financial_year_id = $1
             AND ($2::int IS NULL OR r.department_id = $2)
           ORDER BY r.request_number, bi.name`, [fy, targetDeptId ?? null]],
        [`SELECT i.issue_id, i.issue_number, i.title, i.description, i.status::text AS status,
                 i.created_at, i.updated_at, i.escalated_at, i.resolved_at,
                 u.full_name AS raised_by_name, d.name AS department_name, d.code AS department_code,
                 at.full_name AS assigned_to_name, et.full_name AS escalated_to_name
            FROM issues i
            JOIN users u            ON u.user_id = i.raised_by
            LEFT JOIN departments d ON d.department_id = u.department_id
            LEFT JOIN users at      ON at.user_id = i.assigned_to
            LEFT JOIN users et      ON et.user_id = i.escalated_to
           WHERE ($1::date IS NULL OR (i.created_at >= $1::date AND i.created_at < $2::date + 1))
             AND ($3::int IS NULL OR u.department_id = $3)
           ORDER BY i.created_at DESC, i.issue_number`, [year.start_date, year.end_date, targetDeptId ?? null]],
      ]);

    return {
      financialYear: { id: fy, label: year.label, startDate: year.start_date, endDate: year.end_date },
      department: dept,
      isHigherAuthority,
      canDownloadApprovalBudget: isHigherAuthority,
      generatedAt: new Date().toISOString(),
      generatedBy: { id: req.user.id, name: req.user.name, roles: req.user.roles },
      byBudgetHead: heads.rows.map((r) => ({
        budgetHead: { id: r.budget_head_id, code: r.code, name: r.name, headType: r.head_type },
        requests: r.requests, approved: r.approved, partial: r.partial, rejected: r.rejected,
        pending: r.pending, requested: r.requested, sanctioned: r.sanctioned,
      })),
      byStatus: statuses.rows,
      byDepartment: depts.rows,
      byStage: stages.rows.map((r) => ({ stage: r.stage, code: r.code, requests: r.requests, amount: r.amount, avgDays: r.avg_days, maxDays: r.max_days })),
      byItemType: itemTypes.rows.map((r) => ({
        itemType: r.item_type, lines: r.lines, requestedQty: r.requested_qty,
        approvedQty: r.approved_qty, requested: r.requested, approved: r.approved,
      })),
      byFunding: funding.rows,
      monthly: monthly.rows,
      provisions: provisions.rows.map((r) => ({
        department: r.department_name, budgetHead: r.budget_head_name,
        allocated: r.allocated_amount, utilized: r.utilized_amount,
        committed: r.committed_amount, remaining: r.remaining_amount,
      })),
      pendingOverThreeDays: ageing.rows.map((r) => ({
        requestNumber: r.request_number, title: r.title, raisedBy: r.raised_by_name,
        status: r.current_status, stage: r.current_stage_name, amount: r.tentative_total_cost,
        daysPending: r.days_pending, submittedAt: r.submitted_at,
      })),
      register: register.rows.map((r) => ({
        id: r.request_id, requestNumber: r.request_number, title: r.title, status: r.status, raisedBy: r.raised_by,
        department: r.department, budgetHead: r.budget_head, stage: r.stage,
        requested: r.requested, sanctioned: r.sanctioned, submittedAt: r.submitted_at, closedAt: r.closed_at,
      })),
      lineItems: lineItems.rows.map((r) => ({
        id: r.request_item_id,
        requestId: r.request_id,
        requestNumber: r.request_number,
        requestTitle: r.request_title,
        itemName: r.item_name,
        unit: r.unit,
        itemType: r.item_type,
        requestedQuantity: r.requested_quantity,
        approvedQuantity: r.approved_quantity,
        estimatedUnitCost: r.estimated_unit_cost,
        estimatedTotal: r.estimated_total,
        approvedAmount: r.approved_amount,
        itemStatus: r.item_status,
        remarks: r.remarks,
      })),
      issues: issuesCounts.rows,
      issuesDetailed: issuesDetailed.rows.map((r) => ({
        id: r.issue_id,
        issueNumber: r.issue_number,
        title: r.title,
        description: r.description,
        status: r.status,
        raisedBy: r.raised_by_name,
        department: r.department_name,
        departmentCode: r.department_code,
        assignedTo: r.assigned_to_name,
        escalatedTo: r.escalated_to_name,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        escalatedAt: r.escalated_at,
        resolvedAt: r.resolved_at,
      })),
    };
  });
  res.json(body);
});

// ---------------------------------------------------------------------------
// The formal report on one request
// ---------------------------------------------------------------------------

// The stage reports of the revised requirements, each a view of the same
// assembled data rather than a separate pipeline — so no report can quote a
// figure the complete one does not.
const STAGE_REPORTS = {
  complete: { title: 'Procurement Approval Report', sections: SECTIONS },
  'purchase-committee': { title: 'Purchase Committee Review Report', sections: ['request', 'items', 'budget', 'documents', 'workflow', 'route'] },
  principal: { title: 'Principal Review Report', sections: ['request', 'items', 'budget', 'documents', 'workflow', 'route'] },
  cdc: { title: 'CDC Review Report', sections: ['request', 'items', 'budget', 'workflow', 'route'] },
  board: { title: 'Chairman & Vice Chairman Review Report', sections: ['request', 'items', 'budget', 'workflow', 'route'] },
  resubmission: { title: 'Resubmission Report', sections: ['request', 'resubmissions', 'documents', 'workflow'] },
  rejection: { title: 'Rejection Report', sections: ['request', 'items', 'workflow'] },
  'partial-approval': { title: 'Partial Approval Report', sections: ['request', 'items', 'budget', 'workflow', 'route'] },
  decision: { title: 'Final Decision Report', sections: ['request', 'items', 'budget', 'workflow', 'route'] },
};

const reportKind = z.enum(Object.keys(STAGE_REPORTS)).default('complete');

/**
 * Loads the request as the caller may see it, then builds its report. Report
 * access needs no rules of its own: the request is read under the caller's own
 * row-level security, so anyone who cannot open the request cannot print it
 * either, and a report never contains a row its reader could not already see.
 */
async function buildReport(req, kind) {
  return withUser(req.user.id, async (db) => {
    const detail = await loadDetail(db, param(req, 'id'), req.user);
    if (!detail) throw notFound('Request not found');
    return { report: await assembleReport(db, detail), spec: STAGE_REPORTS[kind] };
  });
}

reportsRouter.get('/requests/:id/report', async (req, res) => {
  const kind = reportKind.parse(req.query.kind);
  const { report, spec } = await buildReport(req, kind);
  res.json({ kind, title: spec.title, sections: spec.sections, ...report });
});

reportsRouter.get('/requests/:id/report.html', async (req, res) => {
  const kind = reportKind.parse(req.query.kind);
  const { report, spec } = await buildReport(req, kind);
  res.type('text/html; charset=utf-8').send(renderReportHtml(report, spec));
});

// The same page, offered as a file Word opens and can edit. Word has read
// HTML in a .doc container since Office 2000, so this needs no converter.
reportsRouter.get('/requests/:id/report.doc', async (req, res) => {
  const kind = reportKind.parse(req.query.kind);
  const { report, spec } = await buildReport(req, kind);
  res.type('application/msword');
  res.attachment(`${report.request.requestNumber}-${kind}.doc`);
  res.send(renderReportHtml(report, spec));
});

// The official institutional print-ready PDF report
reportsRouter.get('/requests/:id/report.pdf', async (req, res) => {
  const kind = reportKind.parse(req.query.kind);
  const { report, spec } = await buildReport(req, kind);
  res.type('application/pdf');
  res.attachment(`${report.request.requestNumber}-${kind}.pdf`);
  await generatePdfReport(report, spec, res);
});

// The attention panel's target: opens straight onto the stale requests rather
// than the whole list.
reportsRouter.get('/reports/pending', async (req, res) => {
  const f = z.object({
    minDays: z.coerce.number().int().min(0).max(365).default(3),
    financialYearId: intId.optional(),
  }).parse(req.query);
  const rows = await withUser(req.user.id, async (db) => (await db.query(
    `SELECT * FROM v_pending_requests
      WHERE days_pending > $1 AND current_status <> 'DRAFT'
        AND ($2::int IS NULL OR financial_year_id = $2)
      ORDER BY days_pending DESC, request_number`,
    [f.minDays, f.financialYearId ?? null],
  )).rows);
  res.json(rows.map(pendingRow));
});

// A leading = + - @ (or tab / carriage return) makes spreadsheet software
// treat a cell as a formula. A request title of =HYPERLINK(...) would
// otherwise execute when the Principal opens the export in Excel.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

reportsRouter.get('/exports/requests.csv', async (req, res) => {
  const f = z.object({
    financialYearId: intId.optional(),
    status: z.string().max(400).optional(),
  }).parse(req.query);
  const statuses = f.status ? f.status.split(',').map((s) => s.trim().toUpperCase()) : null;

  const rows = await withUser(req.user.id, async (db) => (await db.query(
    `SELECT r.request_number, r.title, r.current_status, ws.name AS stage, fy.label AS financial_year,
            bh.name AS budget_head, bh.head_type, u.full_name AS raised_by,
            r.tentative_total_cost, r.sanctioned_amount, r.created_at, r.submitted_at, r.closed_at
       FROM requests r
       JOIN users u            ON u.user_id = r.raised_by
       JOIN budget_heads bh    ON bh.budget_head_id = r.budget_head_id
       JOIN financial_years fy ON fy.financial_year_id = r.financial_year_id
       LEFT JOIN workflow_stages ws ON ws.stage_id = r.current_stage_id
      WHERE ($1::int IS NULL OR r.financial_year_id = $1)
        AND ($2::text[] IS NULL OR r.current_status::text = ANY($2))
      ORDER BY r.created_at`,
    [f.financialYearId ?? null, statuses],
  )).rows);

  const header = ['Request number', 'Title', 'Status', 'Stage', 'Financial year', 'Budget head',
    'Head type', 'Raised by', 'Requested', 'Sanctioned', 'Created', 'Submitted', 'Closed'];
  const lines = [header, ...rows.map((r) => [
    r.request_number, r.title, r.current_status, r.stage, r.financial_year, r.budget_head,
    r.head_type, r.raised_by, r.tentative_total_cost, r.sanctioned_amount,
    r.created_at, r.submitted_at, r.closed_at,
  ])].map((cells) => cells.map(csvCell).join(','));

  res.type('text/csv; charset=utf-8');
  res.attachment(`requests-${new Date().toISOString().slice(0, 10)}.csv`);
  // Byte-order mark so Excel reads the ₹ and Devanagari names as UTF-8.
  res.send(String.fromCharCode(0xfeff) + lines.join('\r\n') + '\r\n');
});

reportsRouter.get('/audit', requireRole('ADMIN'), async (req, res) => {
  const f = z.object({
    entityType: z.string().trim().max(50).optional(),
    entityId: z.string().trim().max(100).optional(),
    ...pagination,
  }).parse(req.query);
  const rows = await withUser(req.user.id, async (db) => (await db.query(
    `SELECT al.*, u.full_name AS actor_name, count(*) OVER () AS total_count
       FROM audit_logs al LEFT JOIN users u ON u.user_id = al.actor_user_id
      WHERE ($1::text IS NULL OR al.entity_type = $1)
        AND ($2::text IS NULL OR al.entity_id = $2)
      ORDER BY al.created_at DESC, al.audit_id DESC
      LIMIT $3 OFFSET $4`,
    [f.entityType ?? null, f.entityId ?? null, f.limit, f.offset],
  )).rows);
  res.json({
    items: rows.map((r) => ({
      id: r.audit_id,
      at: r.created_at,
      entityType: r.entity_type,
      entityId: r.entity_id,
      action: r.action,
      actor: r.actor_user_id ? { id: r.actor_user_id, name: r.actor_name } : null,
      before: r.before_json,
      after: r.after_json,
    })),
    total: rows[0]?.total_count ?? 0,
    limit: f.limit,
    offset: f.offset,
  });
});

// ---------------------------------------------------------------------------
// Notifications — RLS limits every query to the caller's own.
// ---------------------------------------------------------------------------

reportsRouter.get('/notifications', async (req, res) => {
  const f = z.object({ unread: flag, ...pagination }).parse(req.query);
  const { rows, unread } = await withUser(req.user.id, async (db) => {
    const [list, count] = await queryAll(db, [
      [`SELECT n.*, r.request_number, i.issue_number, count(*) OVER () AS total_count
          FROM notifications n
          LEFT JOIN requests r ON r.request_id = n.request_id
          LEFT JOIN issues   i ON i.issue_id   = n.issue_id
         WHERE NOT $1 OR n.read_at IS NULL
         ORDER BY n.created_at DESC, n.notification_id
         LIMIT $2 OFFSET $3`, [f.unread ?? false, f.limit, f.offset]],
      ['SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL', []],
    ]);
    return { rows: list.rows, unread: count.rows[0].n };
  });
  res.json({
    items: rows.map((n) => ({
      id: n.notification_id,
      subject: n.subject,
      body: n.body,
      request: n.request_id ? { id: n.request_id, requestNumber: n.request_number } : null,
      issue: n.issue_id ? { id: n.issue_id, issueNumber: n.issue_number } : null,
      read: n.read_at !== null,
      createdAt: n.created_at,
    })),
    unread,
    total: rows[0]?.total_count ?? 0,
    limit: f.limit,
    offset: f.offset,
  });
});

reportsRouter.post('/notifications/:id/read', async (req, res) => {
  const notificationId = param(req, 'id');
  const { rowCount } = await withUser(req.user.id, (db) => db.query(
    `UPDATE notifications SET read_at = COALESCE(read_at, NOW()), status = 'READ'
      WHERE notification_id = $1`,
    [notificationId],
  ));
  if (!rowCount) throw notFound('Notification not found');
  res.status(204).end();
});

reportsRouter.post('/notifications/read-all', async (req, res) => {
  const { rowCount } = await withUser(req.user.id, (db) => db.query(
    "UPDATE notifications SET read_at = NOW(), status = 'READ' WHERE read_at IS NULL"));
  res.json({ marked: rowCount });
});
