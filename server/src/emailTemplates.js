/**
 * Email templates for the College Procurement & Approval Workflow System.
 *
 * Each builder returns { subject, html } ready for sendMail().
 * All templates follow the master document format: structured sections
 * with procurement details, event description, decision info, action
 * required, and workflow status.
 */

import { config } from './config.js';
import { parseCustomItem } from './customItem.js';

const SYSTEM_NAME = 'College Procurement & Approval Workflow System';
const COLLEGE_NAME = 'S.P. College';
const SUPPORT_EMAIL = 'support@spcollege.edu.in';
const CURRENCY = '₹';

/**
 * Generates the canonical absolute URL to view a request in the frontend.
 * Hash route: #/requests/<id> (parsed by AppContext.jsx).
 */
export function getRequestUrl(requestId, customBaseUrl = null) {
  const base = customBaseUrl !== null ? customBaseUrl : (config.frontendUrl || config.appUrl);
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/#/requests/${requestId}`;
}

/**
 * Generates the canonical absolute URL to view an issue in the frontend.
 * Hash route: #/issues/<id> (parsed by AppContext.jsx).
 */
export function getIssueUrl(issueId, customBaseUrl = null) {
  const base = customBaseUrl !== null ? customBaseUrl : (config.frontendUrl || config.appUrl);
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/#/issues/${issueId}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function formatAmount(amount) {
  if (amount == null) return '—';
  return `${CURRENCY}${Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------------------
// Shared HTML wrapper — keeps all templates visually consistent
// ---------------------------------------------------------------------------

function wrapHtml(bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Notification — ${escapeHtml(SYSTEM_NAME)}</title>
  <style>
    body {
      margin: 0; padding: 0;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background-color: #f4f6f9;
      color: #1e293b;
      line-height: 1.6;
    }
    .container {
      max-width: 680px;
      margin: 24px auto;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #1e40af, #3b82f6);
      color: #ffffff;
      padding: 28px 32px;
    }
    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .header p {
      margin: 6px 0 0;
      font-size: 13px;
      opacity: 0.85;
    }
    .body-content {
      padding: 28px 32px;
    }
    .greeting {
      font-size: 15px;
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 14px;
      font-weight: 700;
      color: #1e40af;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      border-bottom: 2px solid #dbeafe;
      padding-bottom: 6px;
      margin: 28px 0 14px;
    }
    .detail-table {
      width: 100%;
      border-collapse: collapse;
    }
    .detail-table td {
      padding: 6px 0;
      vertical-align: top;
      font-size: 14px;
    }
    .detail-table td:first-child {
      font-weight: 600;
      color: #475569;
      width: 42%;
      padding-right: 12px;
    }
    .detail-table td:last-child {
      color: #1e293b;
    }
    .status-badge {
      display: inline-block;
      padding: 3px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.4px;
    }
    .badge-submitted { background: #dbeafe; color: #1e40af; }
    .badge-approved { background: #dcfce7; color: #166534; }
    .badge-rejected { background: #fee2e2; color: #991b1b; }
    .badge-review { background: #fef3c7; color: #92400e; }
    .badge-default { background: #f1f5f9; color: #475569; }
    .event-box {
      background: #f8fafc;
      border-left: 4px solid #3b82f6;
      padding: 14px 18px;
      margin: 10px 0;
      border-radius: 0 8px 8px 0;
      font-size: 14px;
    }
    .action-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      padding: 18px 22px;
      margin: 14px 0;
      text-align: center;
    }
    .action-box p {
      margin: 0 0 14px;
      font-size: 14px;
      color: #334155;
    }
    .cta-btn {
      display: inline-block;
      padding: 12px 32px;
      background: linear-gradient(135deg, #1e40af, #3b82f6);
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.3px;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin: 8px 0;
    }
    .items-table th {
      background: #f1f5f9;
      text-align: left;
      padding: 8px 10px;
      font-weight: 600;
      color: #475569;
      border-bottom: 2px solid #e2e8f0;
    }
    .items-table td {
      padding: 7px 10px;
      border-bottom: 1px solid #f1f5f9;
    }
    .divider {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 24px 0;
    }
    .footer {
      background: #f8fafc;
      padding: 20px 32px;
      font-size: 12px;
      color: #64748b;
      border-top: 1px solid #e2e8f0;
    }
    .footer a { color: #3b82f6; text-decoration: none; }
    .footer .meta { margin-top: 10px; font-size: 11px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${escapeHtml(SYSTEM_NAME)}</h1>
      <p>${escapeHtml(COLLEGE_NAME)}</p>
    </div>
    <div class="body-content">
      ${bodyContent}
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function statusBadge(status) {
  if (!status) return '';
  const upper = status.toUpperCase().replace(/ /g, '_');
  let cls = 'badge-default';
  if (upper === 'SUBMITTED') cls = 'badge-submitted';
  else if (upper.includes('APPROVED')) cls = 'badge-approved';
  else if (upper === 'REJECTED') cls = 'badge-rejected';
  else if (upper.includes('REVIEW') || upper.includes('UNDER')) cls = 'badge-review';
  return `<span class="status-badge ${cls}">${escapeHtml(status.replace(/_/g, ' '))}</span>`;
}

// ---------------------------------------------------------------------------
// Items table builder
// ---------------------------------------------------------------------------

function buildItemsTable(items, showApproved = false) {
  if (!items || items.length === 0) return '<em>No items</em>';
  let html = `<table class="items-table"><thead><tr>
    <th>Item</th><th>Qty</th><th>Unit Cost</th><th>Total</th>`;
  if (showApproved) html += `<th>Approved Qty</th><th>Approved Amt</th>`;
  html += `<th>Status</th></tr></thead><tbody>`;
  for (const item of items) {
    const { displayName } = parseCustomItem(item.budgetItem || { name: item.name }, item.remarks);
    const itemName = (displayName && displayName !== 'Other (specify)' && displayName !== 'Other (custom item)')
      ? displayName
      : (item.budgetItem?.name || item.name || '—');
    html += `<tr>
      <td>${escapeHtml(itemName)}</td>
      <td>${item.requestedQuantity ?? item.requested_quantity ?? '—'}</td>
      <td>${formatAmount(item.unitCost ?? item.estimated_unit_cost)}</td>
      <td>${formatAmount(item.estimatedTotal ?? item.estimated_total)}</td>`;
    if (showApproved) {
      html += `<td>${item.approvedQuantity ?? item.approved_quantity ?? 0}</td>
               <td>${formatAmount(item.approvedAmount ?? item.approved_amount ?? 0)}</td>`;
    }
    html += `<td>${statusBadge(item.status ?? item.item_status ?? 'PENDING')}</td></tr>`;
  }
  html += '</tbody></table>';
  return html;
}

// ===========================================================================
// ISSUE CREATED → Notify Principal
// ===========================================================================

/**
 * Builds the email for when a new non-financial issue is raised.
 *
 * @param {object}   issue   — the full issue detail (from the API response)
 * @param {object}   raiser  — { fullName, email }
 * @param {string}   principalEmail — recipient
 * @param {string}   principalName  — recipient display name
 * @returns {{ subject: string, html: string, to: string }}
 */
export function buildIssueCreatedEmail({ issue, raiser, principalEmail, principalName }) {
  const now = new Date();
  const issueNumber = issue.issueNumber || issue.issue_number || '—';
  const auditRef = `AUD-${issueNumber}-${Date.now().toString(36).toUpperCase()}`;

  const subject = `[ISSUE RAISED] ${issueNumber} — New Issue Requires Your Attention`;

  const bodyContent = `
    <p class="greeting">Dear ${escapeHtml(principalName || 'Principal')},</p>

    <!-- PROCUREMENT REQUEST section adapted for Issue -->
    <div class="section-title">Issue Details</div>
    <table class="detail-table">
      <tr><td>Issue Number</td><td><strong>${escapeHtml(issueNumber)}</strong></td></tr>
      <tr><td>Title</td><td>${escapeHtml(issue.title)}</td></tr>
      <tr><td>Raised By</td><td>${escapeHtml(raiser.fullName)}</td></tr>
      <tr><td>Raised By Email</td><td>${escapeHtml(raiser.email)}</td></tr>
      <tr><td>Current Status</td><td>${statusBadge('SUBMITTED')}</td></tr>
      <tr><td>Submitted On</td><td>${formatDate(issue.createdAt || issue.created_at)}</td></tr>
    </table>

    <!-- WHAT HAPPENED -->
    <div class="section-title">What Happened</div>
    <div class="event-box">
      A new non-financial issue has been raised by <strong>${escapeHtml(raiser.fullName)}</strong>
      and requires your review. The issue has been logged in the system and is currently awaiting
      assignment and resolution.
    </div>

    <!-- DESCRIPTION -->
    <div class="section-title">Issue Description</div>
    <div class="event-box">
      ${escapeHtml(issue.description)}
    </div>

    <!-- DECISION / APPROVAL DETAILS -->
    <div class="section-title">Decision / Approval Details</div>
    <table class="detail-table">
      <tr><td>Decision</td><td>${statusBadge('PENDING REVIEW')}</td></tr>
      <tr><td>Reviewed By</td><td><em>Awaiting your review</em></td></tr>
      <tr><td>Role</td><td>Principal</td></tr>
      <tr><td>Decision Date</td><td><em>—</em></td></tr>
    </table>

    <p style="font-size: 14px; color: #64748b; margin-top: 8px;">
      <strong>Remarks:</strong> <em>None yet</em><br/>
      <strong>Reason / Issue:</strong> ${escapeHtml(issue.description)}
    </p>

    <!-- ACTION REQUIRED -->
    <div class="section-title">Action Required</div>
    <div class="action-box">
      <p>Please review this issue and assign it to the appropriate person, or take direct action.</p>
      ${(() => {
        const url = getIssueUrl(issue.id || issue.issue_id);
        return url
          ? `<a href="${url}" class="cta-btn">Review Issue ${escapeHtml(issueNumber)}</a>`
          : '';
      })()}
    </div>

    <!-- WORKFLOW INFORMATION -->
    <div class="section-title">Workflow Information</div>
    <table class="detail-table">
      <tr><td>Current Stage</td><td>${statusBadge('SUBMITTED')}</td></tr>
      <tr><td>Next Stage</td><td>Principal Review → Assignment / Escalation</td></tr>
      <tr><td>Pending Since</td><td>${formatDate(now)}</td></tr>
      <tr><td>Pending Duration</td><td>0 days</td></tr>
    </table>

    <hr class="divider" />

    <p style="font-size: 14px; color: #475569;">
      Regards,<br/>
      <strong>${escapeHtml(SYSTEM_NAME)}</strong><br/>
      ${escapeHtml(COLLEGE_NAME)}
    </p>

    <div class="footer">
      <p>
        <em>This is an automated notification from the ${escapeHtml(SYSTEM_NAME)}.</em><br/>
        <em>Please do not reply directly to this email.</em>
      </p>
      <p>For assistance: <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a></p>
      <div class="meta">
        <strong>Issue:</strong> ${escapeHtml(issueNumber)}&nbsp;&nbsp;|&nbsp;&nbsp;
        <strong>Generated:</strong> ${formatDate(now)}&nbsp;&nbsp;|&nbsp;&nbsp;
        <strong>Audit Reference:</strong> ${escapeHtml(auditRef)}
      </div>
    </div>
  `;

  return {
    to: principalEmail,
    subject,
    html: wrapHtml(bodyContent),
  };
}

// ===========================================================================
// REQUEST STATUS CHANGE → Notify relevant parties
// ===========================================================================

/**
 * Builds the email for request status changes (approval, rejection, escalation, etc.)
 *
 * @param {object} opts
 * @returns {{ subject: string, html: string, to: string, cc?: string }}
 */
export function buildRequestStatusEmail({
  request,
  recipientEmail,
  recipientName,
  ccRecipients,
  notificationType,   // e.g. 'APPROVAL', 'REJECTION', 'ESCALATION'
  emailAction,        // e.g. 'Request Approved', 'Awaiting Your Review'
  eventDescription,
  decision,
  approverName,
  approverRole,
  decisionDate,
  approvedItems,
  rejectedItems,
  approvalRemarks,
  rejectionReason,
  actionRequired,
  ctaText,
  ctaUrl,
  workflowStage,
  nextStage,
  pendingSince,
  pendingDays,
}) {
  const now = new Date();
  const reqNum = request.requestNumber || request.request_number || '—';
  const auditRef = `AUD-${reqNum}-${Date.now().toString(36).toUpperCase()}`;

  const subject = `[${notificationType || 'NOTIFICATION'}] ${reqNum} — ${emailAction || 'Status Update'}`;

  const bodyContent = `
    <p class="greeting">Dear ${escapeHtml(recipientName || 'Sir/Madam')},</p>

    <div class="section-title">Procurement Request</div>
    <table class="detail-table">
      <tr><td>Request Number</td><td><strong>${escapeHtml(reqNum)}</strong></td></tr>
      <tr><td>Request Title</td><td>${escapeHtml(request.title)}</td></tr>
      <tr><td>Requester</td><td>${escapeHtml(request.raisedBy?.name || '—')}</td></tr>
      <tr><td>Requester Email</td><td>${escapeHtml(request.requesterEmail || '—')}</td></tr>
      <tr><td>Department</td><td>${escapeHtml(request.department?.name || '—')}</td></tr>
      <tr><td>Course</td><td>${escapeHtml(request.course?.name || '—')}</td></tr>
      <tr><td>Budget Head</td><td>${escapeHtml(request.budgetHead?.name || '—')}</td></tr>
      <tr><td>Financial Year</td><td>${escapeHtml(request.financialYear?.label || request.financialYear || '—')}</td></tr>
      <tr><td>Requested Amount</td><td><strong>${formatAmount(request.tentativeTotalCost)}</strong></td></tr>
      <tr><td>Current Stage</td><td>${statusBadge(request.stage?.name || request.status || '—')}</td></tr>
      <tr><td>Current Status</td><td>${statusBadge(request.status)}</td></tr>
      <tr><td>Submitted On</td><td>${formatDate(request.submittedAt || request.createdAt)}</td></tr>
    </table>

    <div class="section-title">What Happened</div>
    <div class="event-box">
      ${escapeHtml(eventDescription || 'A status change has occurred on this request.')}
    </div>

    <div class="section-title">Decision / Approval Details</div>
    <table class="detail-table">
      <tr><td>Decision</td><td>${statusBadge(decision || '—')}</td></tr>
      <tr><td>Reviewed By</td><td>${escapeHtml(approverName || '—')}</td></tr>
      <tr><td>Role</td><td>${escapeHtml(approverRole || '—')}</td></tr>
      <tr><td>Decision Date</td><td>${formatDate(decisionDate)}</td></tr>
      <tr><td>Requested Amount</td><td>${formatAmount(request.tentativeTotalCost)}</td></tr>
      <tr><td>Approved Amount</td><td>${formatAmount(request.sanctionedAmount)}</td></tr>
      <tr><td>Unapproved Amount</td><td>${formatAmount(
        request.tentativeTotalCost != null && request.sanctionedAmount != null
          ? request.tentativeTotalCost - request.sanctionedAmount
          : null
      )}</td></tr>
    </table>

    ${approvedItems ? `
      <p style="font-size: 14px; font-weight: 600; color: #166534; margin-top: 14px;">Approved Items / Quantities:</p>
      ${typeof approvedItems === 'string' ? `<div class="event-box">${escapeHtml(approvedItems)}</div>` : buildItemsTable(approvedItems, true)}
    ` : ''}

    ${rejectedItems ? `
      <p style="font-size: 14px; font-weight: 600; color: #991b1b; margin-top: 14px;">Unapproved / Rejected Items / Quantities:</p>
      ${typeof rejectedItems === 'string' ? `<div class="event-box">${escapeHtml(rejectedItems)}</div>` : buildItemsTable(rejectedItems, true)}
    ` : ''}

    ${approvalRemarks ? `<p style="font-size: 14px;"><strong>Remarks:</strong> ${escapeHtml(approvalRemarks)}</p>` : ''}
    ${rejectionReason ? `<p style="font-size: 14px;"><strong>Reason / Issue:</strong> ${escapeHtml(rejectionReason)}</p>` : ''}

    <div class="section-title">Action Required</div>
    <div class="action-box">
      <p>${escapeHtml(actionRequired || 'No action required at this time.')}</p>
      ${(() => {
        const reqId = request.id || request.request_id;
        const targetUrl = ctaUrl || (reqId ? getRequestUrl(reqId) : null);
        return ctaText && targetUrl
          ? `<a href="${targetUrl}" class="cta-btn">${escapeHtml(ctaText)}</a>`
          : '';
      })()}
    </div>

    <div class="section-title">Workflow Information</div>
    <table class="detail-table">
      <tr><td>Current Stage</td><td>${statusBadge(workflowStage || request.stage?.name || '—')}</td></tr>
      <tr><td>Next Stage</td><td>${escapeHtml(nextStage || '—')}</td></tr>
      <tr><td>Pending Since</td><td>${formatDate(pendingSince || now)}</td></tr>
      <tr><td>Pending Duration</td><td>${pendingDays ?? 0} days</td></tr>
    </table>

    <hr class="divider" />

    <p style="font-size: 14px; color: #475569;">
      Regards,<br/>
      <strong>${escapeHtml(SYSTEM_NAME)}</strong><br/>
      ${escapeHtml(COLLEGE_NAME)}
    </p>

    <div class="footer">
      <p>
        <em>This is an automated notification from the ${escapeHtml(SYSTEM_NAME)}.</em><br/>
        <em>Please do not reply directly to this email.</em>
      </p>
      <p>For assistance: <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}">${escapeHtml(SUPPORT_EMAIL)}</a></p>
      <div class="meta">
        <strong>Request:</strong> ${escapeHtml(reqNum)}&nbsp;&nbsp;|&nbsp;&nbsp;
        <strong>Generated:</strong> ${formatDate(now)}&nbsp;&nbsp;|&nbsp;&nbsp;
        <strong>Audit Reference:</strong> ${escapeHtml(auditRef)}
      </div>
    </div>
  `;

  return {
    to: recipientEmail,
    cc: ccRecipients || undefined,
    subject,
    html: wrapHtml(bodyContent),
  };
}
