// The formal report behind a request: what was asked for, what the budget
// allowed, who decided what, and what remained unapproved.
//
// Every figure here is read from the same rows the workflow itself writes —
// request_items for quantities and amounts, approval_actions for decisions,
// the budget view for the department's position. Nothing is stored as a
// separate report total, so a report cannot drift out of step with the
// approvals it describes.

import { parseCustomItem } from './customItem.js';

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2,
});

/** ₹6,50,000.5 — Indian digit grouping, as the rest of the system shows it. */
const money = (value) => (value === null || value === undefined ? '—' : inr.format(value));
const quantity = (value) =>
  (value === null || value === undefined ? '—' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/** Sections the report is made of, in the order they are printed. */
export const SECTIONS = ['request', 'items', 'budget', 'documents', 'workflow', 'resubmissions', 'audit', 'route'];

/** The stage a decision belongs to, named the way the college says it. */
const STAGE_NAMES = {
  PURCHASE_COMMITTEE: 'Purchase Committee',
  PRINCIPAL: 'Principal',
  CDC: 'CDC',
  FINAL_AUTHORITY: 'Chairman & Vice Chairman',
};

const ACTION_VERB = {
  SUBMIT: 'submitted the request',
  ESCALATE: 'reviewed it and passed it on',
  FORWARD: 'reviewed it and passed it on',
  APPROVE: 'approved it in full',
  PARTIAL_APPROVE: 'approved it in part',
  REJECT: 'rejected it',
  RETURN: 'returned it for correction',
  RESUBMIT: 'resubmitted it',
  COMMENT: 'recorded an observation',
  CARRY_FORWARD: 'carried it forward to the next financial year',
};

/**
 * One sentence per step, built only from what was actually recorded. A stage
 * the request never visited has no row, so it can never be described; a stage
 * it did visit always has one, so none can be left out.
 */
// The requester acts on their own request, not on behalf of the stage it
// happens to be sitting at, so those steps are not attributed to a stage.
const REQUESTER_ACTIONS = ['SUBMIT', 'RESUBMIT', 'CARRY_FORWARD'];

function narrate(entry) {
  const stage = REQUESTER_ACTIONS.includes(entry.action) || !entry.stage
    ? null
    : STAGE_NAMES[entry.stage.code] ?? entry.stage.name;
  const verb = ACTION_VERB[entry.action] ?? `recorded ${entry.action}`;
  const parts = [`${entry.by}${stage ? ` (${stage})` : ''} ${verb}`];

  if (entry.action === 'PARTIAL_APPROVE' && entry.amountApproved != null) {
    parts.push(`${money(entry.amountApproved)} of ${money(entry.amountRequested)} was sanctioned`);
  } else if (entry.action === 'APPROVE' && entry.amountApproved != null) {
    parts.push(`${money(entry.amountApproved)} was sanctioned`);
  }
  if (entry.rejectionReason) parts.push(`reason: ${entry.rejectionReason}`);
  if (entry.comments) parts.push(`remarks: ${entry.comments}`);
  // Whoever wrote the remark may or may not have ended it with a full stop.
  return `${parts.join('; ').replace(/\.$/, '')}.`;
}

/**
 * The stages this particular request passed through, in order, each marked
 * with what happened there. Computed from its own history, so a request that
 * never reached CDC never shows a CDC box.
 */
function routeTaken(timeline, current) {
  const seen = [];
  for (const entry of timeline) {
    if (!entry.stage) continue;
    const last = seen[seen.length - 1];
    if (last && last.code === entry.stage.code) {
      last.actions.push(entry.action);
      continue;
    }
    seen.push({ code: entry.stage.code, name: STAGE_NAMES[entry.stage.code] ?? entry.stage.name, actions: [entry.action] });
  }
  return seen.map((s) => ({
    ...s,
    current: current != null && s.code === current,
  }));
}

/**
 * Everything the report needs for one request. `detail` is the request as the
 * caller may see it (loaded under their own row-level security), so a caller
 * who cannot see the request never reaches this function at all.
 */
export async function assembleReport(db, detail) {
  const requestId = detail.id;

  const [timelineRows, auditRows, versionRows, budgetRows, commentRows] = await Promise.all([
    db.query(
      `SELECT t.*, a.performed_by
         FROM v_request_timeline t
         JOIN approval_actions a ON a.action_id = t.action_id
        WHERE t.request_id = $1
        ORDER BY t.created_at, t.action_id`,
      [requestId],
    ),
    // Row-level security keeps the audit log to administrators; for everyone
    // else this simply comes back empty and the section is omitted.
    db.query(
      `SELECT al.*, u.full_name AS actor_name
         FROM audit_logs al LEFT JOIN users u ON u.user_id = al.actor_user_id
        WHERE al.entity_type = 'request' AND al.entity_id = $1::text
        ORDER BY al.created_at, al.audit_id`,
      [requestId],
    ),
    db.query(
      `SELECT rv.*, u.full_name AS submitted_by_name
         FROM request_versions rv JOIN users u ON u.user_id = rv.submitted_by
        WHERE rv.request_id = $1 ORDER BY rv.version_number`,
      [requestId],
    ),
    detail.department
      ? db.query('SELECT * FROM fn_get_department_budget_context($1, $2, $3)',
        [detail.department.id, detail.financialYear.id, detail.budgetHead.id])
      : Promise.resolve({ rows: [] }),
    db.query(
      `SELECT c.*, u.full_name AS author_name, ws.code AS stage_code, ws.name AS stage_name
         FROM comments c
         JOIN users u ON u.user_id = c.author_user_id
         LEFT JOIN workflow_stages ws ON ws.stage_id = c.stage_id
        WHERE c.request_id = $1
        ORDER BY c.created_at, c.comment_id`,
      [requestId],
    ),
  ]);

  const timeline = timelineRows.rows.map((r) => ({
    at: r.created_at,
    action: r.action,
    stage: r.stage_code ? { code: r.stage_code, name: r.stage_name } : null,
    by: r.performed_by_name,
    role: r.role_name || r.role_code || null,
    employeeId: r.performed_by_employee_id || null,
    previousStatus: r.previous_status,
    newStatus: r.new_status,
    amountRequested: r.amount_requested_snapshot === null ? null : Number(r.amount_requested_snapshot),
    amountApproved: r.amount_approved === null ? null : Number(r.amount_approved),
    rejectionReason: r.rejection_reason,
    comments: r.comments,
  }));

  const budget = budgetRows.rows[0]
    ? {
      allocatedAmount: Number(budgetRows.rows[0].allocated_amount),
      utilizedAmount: Number(budgetRows.rows[0].utilized_amount),
      committedAmount: Number(budgetRows.rows[0].committed_amount),
      remainingAmount: Number(budgetRows.rows[0].remaining_amount),
      availableAmount: Number(budgetRows.rows[0].available_amount),
    }
    : null;

  // Only the versions after the first are resubmissions; version 1 is the
  // original submission.
  const resubmissions = versionRows.rows.slice(1).map((v, index) => {
    const correction = detail.corrections.find((c) => c.resolvedByVersion === v.version_number);
    return {
      versionNumber: v.version_number,
      submittedBy: v.submitted_by_name,
      submittedAt: v.submitted_at,
      previousTotal: Number(versionRows.rows[index].tentative_total_cost),
      newTotal: Number(v.tentative_total_cost),
      correctionReason: correction?.reason ?? null,
      correctionRequestedBy: correction?.requestedBy?.name ?? null,
      correctionRequestedAt: correction?.createdAt ?? null,
    };
  });

  const DECIDED_SET = ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'FULFILMENT_PENDING', 'FULFILLED', 'CLOSED'];
  const isDecided = DECIDED_SET.includes(detail.status);
  const lastAction = [...timeline].reverse().find((t) => ['APPROVE', 'PARTIAL_APPROVE', 'REJECT'].includes(t.action)) || timeline[timeline.length - 1];

  return {
    generatedAt: new Date().toISOString(),
    // A. Request information
    request: {
      requestNumber: detail.requestNumber,
      title: detail.title,
      status: detail.status,
      stage: detail.stage,
      versionNumber: detail.versionNumber,
      raisedBy: detail.raisedBy.name,
      department: detail.department?.name ?? null,
      course: detail.course?.name ?? null,
      financialYear: detail.financialYear.label,
      budgetHead: `${detail.budgetHead.name} (${detail.budgetHead.headType.toLowerCase()})`,
      createdAt: detail.createdAt,
      submittedAt: detail.submittedAt,
      closedAt: detail.closedAt,
      justification: detail.description,
      requestedAmount: Number(detail.tentativeTotalCost),
      sanctionedAmount: Number(detail.sanctionedAmount),
      unapprovedAmount: Number(detail.tentativeTotalCost) - Number(detail.sanctionedAmount),
      extra: detail.extra,
      carriedForwardFrom: detail.carriedForwardFrom,
    },
    // B. Item details
    items: detail.items.map((i) => {
      const { displayName, displayRemarks } = parseCustomItem(i.budgetItem, i.remarks);
      return {
        name: displayName,
        budgetItem: i.budgetItem.code,
        requestedQuantity: i.requestedQuantity,
        approvedQuantity: i.approvedQuantity,
        unapprovedQuantity: i.unapprovedQuantity,
        unitCost: i.unitCost,
        requestedAmount: i.estimatedTotal,
        approvedAmount: i.approvedAmount,
        unapprovedAmount: Math.round((i.estimatedTotal - i.approvedAmount) * 100) / 100,
        status: i.status,
        remarks: displayRemarks ?? i.remarks,
      };
    }),
    // C. Budget information
    budget,
    // D. Supporting documents, every version of each
    documents: detail.attachments.map((a) => ({
      fileName: a.fileName,
      versionNumber: a.versionNumber,
      requestVersionNumber: a.requestVersionNumber,
      supersededById: a.supersededById,
      replacementReason: a.replacementReason,
      uploadedBy: a.uploadedBy.name,
      uploadedAt: a.uploadedAt,
    })),
    // E. Workflow history, as a narrative
    workflow: timeline.map((entry) => ({ ...entry, sentence: narrate(entry) })),
    // Comments & discussion message history
    comments: (commentRows?.rows || []).map((c) => ({
      id: c.comment_id,
      body: c.body,
      author: c.author_name,
      stage: c.stage_name ?? (c.stage_code ? (STAGE_NAMES[c.stage_code] ?? c.stage_code) : null),
      visibility: c.visibility,
      createdAt: c.created_at,
    })),
    // Final institutional decision
    decision: {
      isDecided,
      status: detail.status,
      decidedAt: detail.closedAt || (isDecided ? lastAction?.at : null),
      authority: lastAction ? `${lastAction.by}${lastAction.stage ? ` (${lastAction.stage.name})` : ''}` : (detail.stage?.name ?? 'Review Authority'),
      sanctionedAmount: Number(detail.sanctionedAmount || 0),
      requestedAmount: Number(detail.tentativeTotalCost || 0),
      remarks: lastAction?.comments || lastAction?.rejectionReason || (isDecided ? 'Final decision recorded in institutional approval register.' : 'Under active workflow review.'),
    },
    // F. Resubmission history — empty unless it was actually resubmitted
    resubmissions,
    // G. Audit trail
    audit: auditRows.rows.map((r) => ({
      at: r.created_at,
      actor: r.actor_name,
      action: r.action,
      previousStatus: r.before_json?.status ?? null,
      newStatus: r.after_json?.status ?? null,
    })),
    // Audit summary totals
    auditSummary: {
      reportId: detail.requestNumber,
      generatedAt: new Date().toISOString(),
      updatedAt: detail.updatedAt || detail.closedAt || detail.submittedAt || detail.createdAt,
      totalEvents: timeline.length,
      totalMessages: (commentRows?.rows || []).length + timeline.filter((t) => t.comments || t.rejectionReason).length,
      totalDocuments: detail.attachments.length,
      reportVersion: `v${detail.versionNumber || 1}.0`,
    },
    // Institutional certification text
    certification: 'This report is a system-generated institutional record containing the information, communications, actions and status history available in the system at the time of report generation.',
    // H. The route this request actually took
    route: routeTaken(timeline, detail.stage?.code ?? null),
  };
}

const escape = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const date = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

const table = (headers, rows) => `
  <table>
    <thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;

/**
 * The report as a printable page. Printing it from the browser produces the
 * PDF the college files; the same page opened in Word gives an editable copy.
 * No rendering service and no headless browser to keep running.
 */
export function renderReportHtml(report, { sections = SECTIONS, title = 'Procurement Approval Report' } = {}) {
  const r = report.request;
  const show = (name) => sections.includes(name);

  const parts = [];

  if (show('request')) {
    parts.push(`<section><h2>A. Request information</h2>${table(
      ['Field', 'Value'],
      [
        ['Request number', escape(r.requestNumber)],
        ['Title', escape(r.title)],
        ['Raised by', escape(r.raisedBy)],
        ['Department', escape(r.department ?? '—')],
        ['Course', escape(r.course ?? '—')],
        ['Financial year', escape(r.financialYear)],
        ['Budget head', escape(r.budgetHead)],
        ['Submitted', date(r.submittedAt)],
        ['Decided', date(r.closedAt)],
        ['Current status', escape(r.status.replace(/_/g, ' '))],
        ['Version', escape(r.versionNumber)],
        ['Justification', escape(r.justification ?? '—')],
      ].map(([k, v]) => [`<strong>${k}</strong>`, v]),
    )}</section>`);
  }

  if (show('items')) {
    parts.push(`<section><h2>B. Item details</h2>${table(
      ['Item', 'Budget item', 'Qty requested', 'Qty approved', 'Qty unapproved', 'Unit cost', 'Requested', 'Approved', 'Unapproved'],
      report.items.map((i) => [
        escape(i.name), escape(i.budgetItem),
        quantity(i.requestedQuantity), quantity(i.approvedQuantity), quantity(i.unapprovedQuantity),
        money(i.unitCost), money(i.requestedAmount), money(i.approvedAmount), money(i.unapprovedAmount),
      ]),
    )}
    <p class="totals">Requested ${money(r.requestedAmount)} · Sanctioned ${money(r.sanctionedAmount)} · Unapproved ${money(r.unapprovedAmount)}</p>
    </section>`);
  }

  if (show('budget')) {
    parts.push(`<section><h2>C. Budget information</h2>${report.budget
      ? table(['Figure', 'Amount'], [
        ['Annual provision', money(report.budget.allocatedAmount)],
        ['Already sanctioned', money(report.budget.utilizedAmount)],
        ['Committed, awaiting decision', money(report.budget.committedAmount)],
        ['This request', money(r.requestedAmount)],
        ['Remaining if all pending is approved', money(report.budget.remainingAmount)],
      ].map(([k, v]) => [`<strong>${k}</strong>`, v]))
      : '<p class="empty">No annual provision has been recorded for this department and year.</p>'}
    </section>`);
  }

  if (show('documents')) {
    parts.push(`<section><h2>D. Supporting documents</h2>${report.documents.length
      ? table(['Document', 'Version', 'Request version', 'Uploaded by', 'Uploaded', 'Status'],
        report.documents.map((d) => [
          escape(d.fileName), escape(d.versionNumber), escape(d.requestVersionNumber),
          escape(d.uploadedBy), date(d.uploadedAt),
          d.supersededById ? `Replaced${d.replacementReason ? `: ${escape(d.replacementReason)}` : ''}` : 'Current',
        ]))
      : '<p class="empty">No documents were attached.</p>'}
    </section>`);
  }

  if (show('workflow')) {
    parts.push(`<section><h2>E. Workflow history</h2>
      <ol class="narrative">${report.workflow
    .map((w) => `<li><span class="when">${date(w.at)}</span> ${escape(w.sentence)}</li>`).join('')}</ol>
    </section>`);
  }

  if (show('resubmissions') && report.resubmissions.length) {
    parts.push(`<section><h2>F. Resubmission history</h2>${table(
      ['Version', 'Correction asked for', 'Asked by', 'Resubmitted by', 'Resubmitted', 'Amount before', 'Amount after'],
      report.resubmissions.map((s) => [
        escape(s.versionNumber), escape(s.correctionReason ?? '—'), escape(s.correctionRequestedBy ?? '—'),
        escape(s.submittedBy), date(s.submittedAt), money(s.previousTotal), money(s.newTotal),
      ]),
    )}</section>`);
  }

  if (show('audit') && report.audit.length) {
    parts.push(`<section><h2>G. Audit trail</h2>${table(
      ['When', 'User', 'Action', 'Previous status', 'New status'],
      report.audit.map((a) => [
        dateTime(a.at), escape(a.actor ?? '—'), escape(a.action),
        escape((a.previousStatus ?? '—').replace(/_/g, ' ')), escape((a.newStatus ?? '—').replace(/_/g, ' ')),
      ]),
    )}</section>`);
  }

  if (show('route')) {
    parts.push(`<section><h2>H. Route taken</h2>
      <div class="route">${report.route
    .map((s) => `<span class="stage${s.current ? ' current' : ''}">${escape(s.name)}</span>`)
    .join('<span class="arrow">&rarr;</span>')}</div>
      <p class="note">Only the stages this request actually passed through are shown.</p>
    </section>`);
  }

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${escape(r.requestNumber)} — ${escape(title)}</title>
<style>
  @page { size: A4; margin: 18mm 14mm; }
  /* The report is a document, not a screen: it stays on white however the
     reader's browser or operating system is themed. */
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; background: #fff; color: #1a1a1a;
         font-size: 11pt; line-height: 1.45; margin: 0; }
  @media screen { body { max-width: 900px; margin: 0 auto; padding: 24px 20px 40px; } }
  header { border-bottom: 2px solid #1a1a1a; padding-bottom: 10px; margin-bottom: 18px; }
  header .college { font-size: 17pt; font-weight: bold; letter-spacing: .3px; }
  header .title { font-size: 12pt; margin-top: 2px; }
  header .meta { font-size: 9pt; color: #444; margin-top: 6px; display: flex; flex-wrap: wrap; gap: 14px; }
  h2 { font-size: 11.5pt; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #bbb; }
  section { break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  td { overflow-wrap: anywhere; }
  th, td { border: 1px solid #c8c8c8; padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: #f0f0f0; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .4px; }
  td:nth-child(n+3) { text-align: right; }
  section:first-of-type td:nth-child(n+2), .narrative td { text-align: left; }
  .totals { font-size: 10pt; font-weight: bold; margin-top: 6px; text-align: right; }
  .narrative { font-size: 10pt; padding-left: 18px; }
  .narrative li { margin-bottom: 4px; }
  .narrative .when { color: #555; font-size: 9pt; margin-right: 4px; }
  .route { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
  .stage { border: 1px solid #1a1a1a; padding: 5px 11px; font-size: 9.5pt; }
  .stage.current { background: #1a1a1a; color: #fff; }
  .arrow { font-size: 12pt; }
  .empty, .note { font-size: 9.5pt; color: #555; font-style: italic; }
  footer { margin-top: 22px; border-top: 1px solid #bbb; padding-top: 8px; font-size: 8.5pt; color: #555; display: flex; justify-content: space-between; }
  @media print { .noprint { display: none; } }
</style></head>
<body>
<header>
  <div style="font-size: 9pt; font-weight: bold; letter-spacing: 0.5px; color: #333;">SHIKSHANA PRASARAKA MANDALI'S</div>
  <div class="college">SIR PARASHURAMBHAU COLLEGE</div>
  <div style="font-size: 10pt; font-weight: bold; font-style: italic; color: #555;">(Empowered Autonomous) — S. P. College</div>
  <div style="font-size: 8.5pt; color: #666; margin-top: 2px;">Tilak Road, Sadashiv Peth, Pune – 411030, Maharashtra, India</div>
  <div class="title" style="margin-top: 8px;">${escape(title)}</div>
  <div class="meta">
    <span><strong>Request:</strong> ${escape(r.requestNumber)}</span>
    <span><strong>Department:</strong> ${escape(r.department ?? '—')}</span>
    <span><strong>Financial year:</strong> ${escape(r.financialYear)}</span>
    <span><strong>Status:</strong> ${escape(r.status.replace(/_/g, ' '))}</span>
    <span><strong>Printed:</strong> ${date(report.generatedAt)}</span>
  </div>
</header>
${parts.join('\n')}
<footer>
  <span>${escape(r.requestNumber)} · S. P. College Approval Hub</span>
  <span>Generated ${dateTime(report.generatedAt)}</span>
</footer>
</body></html>`;
}
