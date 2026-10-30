import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { config } from '../config.js';
import { configService } from '../configService.js';
import { pool, queryAll, withUser } from '../db.js';
import { buildRequestStatusEmail } from '../emailTemplates.js';
import { HttpError, conflict, forbidden, notFound, unprocessable } from '../errors.js';
import { sendMail } from '../mailer.js';
import { REQUESTER_ROLES } from '../roles.js';
import { getDepartmentBudgetStatus, assertDepartmentBudgetAvailable, calculateItemsTotal, roundMoney } from '../budgetService.js';
import { seal, verifySeal } from '../signing.js';
import { removeFile } from '../storage.js';
import {
  amount, approvedQuantity, flag, id, intId, pagination, param, positiveAmount, quantity,
} from '../validate.js';

export const requestsRouter = Router();

const STATUSES = [
  'DRAFT', 'SUBMITTED', 'UNDER_PURCHASE_COMMITTEE_REVIEW', 'UNDER_PRINCIPAL_REVIEW',
  'UNDER_CDC_REVIEW', 'UNDER_FINAL_AUTHORITY_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED',
  'REJECTED', 'ESCALATED', 'FULFILMENT_PENDING', 'FULFILLED', 'CLOSED', 'CARRIED_FORWARD',
];
const NOT_CARRYABLE = ['REJECTED', 'CLOSED', 'FULFILLED', 'CARRIED_FORWARD'];
const ATTACH_CLOSED = ['CLOSED', 'CARRIED_FORWARD'];
const isUnderReview = (status) => status.startsWith('UNDER_');

// The bands the Principal's authority turns on (authoritative configuration):
// up to principal_max the Principal decides, above it the decision belongs to CDC
// or — past cdc_max — to the Chairman and Vice Chairman.

// Where a requester may still change the request: a draft nobody has seen, or
// one an approver has sent back for correction.
const EDITABLE_STATUSES = ['DRAFT', 'AWAITING_RESUBMISSION'];

/**
 * What an approver staffed at `stageCode` may do with a request of this size.
 * Mirrors fn_record_action's stage restrictions so the UI never offers a
 * button the database will refuse. The database remains the authority.
 */
export async function actionsAt(stageCode, _isFinalStage, amount) {
  const stages = await configService.getRoutingStages();
  const { principalMax, cdcMax } = await configService.getThresholds();

  if (stageCode === stages.entryStage) {
    // Review and verification only — never final approval or financial decision.
    return ['ESCALATE', 'RETURN', 'REJECT'];
  }
  if (stageCode === stages.principalStage) {
    return amount <= principalMax
      ? ['APPROVE', 'PARTIAL_APPROVE', 'REJECT', 'RETURN']
      : ['ESCALATE', 'REJECT', 'RETURN'];
  }
  if (stageCode === stages.intermediateStage) {
    return amount <= cdcMax
      ? ['APPROVE', 'PARTIAL_APPROVE', 'REJECT']
      : ['ESCALATE', 'REJECT'];
  }

  if (stageCode === stages.finalAuthorityStage) {
    // Chairman and Vice Chairman decide requests above cdcMax
    return ['APPROVE', 'PARTIAL_APPROVE', 'REJECT'];
  }
  return [];
}

// ---------------------------------------------------------------------------
// Email notifications (fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Resolves the principal user (or falls back to the configured email).
 * @returns {{ email: string, name: string }}
 */
async function resolvePrincipal() {
  let email = config.principalEmail;
  let name = 'Principal';
  try {
    const stages = await configService.getRoutingStages();
    const { rows } = await pool.query(
      `SELECT u.full_name, u.email FROM users u
         LEFT JOIN user_roles ur ON ur.user_id = u.user_id
         LEFT JOIN roles r ON r.role_id = ur.role_id
         LEFT JOIN stage_approvers sa ON sa.user_id = u.user_id
         LEFT JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
        WHERE (r.code = 'PRINCIPAL' OR ws.code::text = $1) AND u.is_active
        ORDER BY sa.stage_id NULLS LAST
        LIMIT 1`,
      [stages.principalStage],
    );
    if (rows.length > 0) {
      name = rows[0].full_name;
      email = rows[0].email || config.principalEmail;
    }
  } catch (err) {
    console.error('[requests] Failed to resolve principal:', err.message);
  }
  return { email, name };
}

/**
 * Resolve the approvers staffed at a particular workflow stage.
 * Supports multiple CDC members with classification attribution.
 * @returns {Array<{ email: string, name: string }>}
 */
async function resolveCdcApprovers(requestId) {
  try {
    const stages = await configService.getRoutingStages();
    const { rows: fundingRows } = await pool.query(
      `SELECT app_request_funding_type($1) AS funding_type`,
      [requestId],
    );
    const fundingType = fundingRows[0]?.funding_type || 'GRANT';
    const { rows } = await pool.query(
      `SELECT u.full_name, u.email FROM stage_approvers sa
         JOIN users u ON u.user_id = sa.user_id
         JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
         JOIN roles r ON r.role_id = sa.role_id
        WHERE ws.code = $1 AND u.is_active
          AND app_cdc_on_route($2, r.code, sa.member_classification)`,
      [stages.intermediateStage, requestId],
    );
    return rows.map((r) => ({ email: r.email, name: r.full_name, fundingType }));
  } catch { return []; }
}

async function resolveFinalApprovers() {
  try {
    const stages = await configService.getRoutingStages();
    const { rows } = await pool.query(
      `SELECT u.full_name, u.email FROM stage_approvers sa
         JOIN users u ON u.user_id = sa.user_id
         JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
        WHERE ws.code = $1 AND u.is_active`,
      [stages.finalAuthorityStage],
    );
    return rows.map((r) => ({ email: r.email, name: r.full_name }));
  } catch { return []; }
}

/**
 * Fire-and-forget: sends a request notification email.
 * Errors are logged but never propagated — a mail failure must never
 * affect the API response.
 */
function notifyRequestAsync({ request, actorId, action, comments, rejectionReason }) {
  (async () => {
    try {
      // Resolve actor (requester / approver)
      const { rows: actorRows } = await pool.query(
        'SELECT full_name, email FROM users WHERE user_id = $1', [actorId],
      );
      const actor = actorRows[0];
      if (!actor) return;

      // Resolve the requester (person who raised the request)
      const requesterId = request.raisedBy?.id || request.raised_by || (
        request.id ? (await pool.query('SELECT raised_by FROM requests WHERE request_id = $1', [request.id])).then((r) => r.rows[0]?.raised_by) : null
      );
      let requester = null;
      if (requesterId) {
        const { rows: requesterRows } = await pool.query(
          'SELECT user_id, full_name, email FROM users WHERE user_id = $1', [requesterId],
        );
        requester = requesterRows[0] || null;
      }

      const principal = await resolvePrincipal();
      const now = new Date();

      if (action === 'SUBMITTED') {
        // 1. Notify the requester that submission succeeded (independent try/catch)
        if (requester?.email) {
          try {
            const requesterEmailData = buildRequestStatusEmail({
              request: { ...request, requesterEmail: requester.email },
              recipientEmail: requester.email,
              recipientName: requester.full_name,
              notificationType: 'REQUEST SUBMITTED',
              emailAction: 'Request Submitted Successfully',
              eventDescription:
                `Your financial request "${request.title}" has been submitted and is now awaiting review.`,
              decision: 'PENDING REVIEW',
              approverName: null,
              approverRole: null,
              decisionDate: null,
              actionRequired: 'No action required at this time. You will be notified when a decision is recorded.',
              ctaText: 'View Request',
              workflowStage: request.stage?.name || 'Submitted',
              nextStage: request.stage?.name || 'Review',
              pendingSince: now,
              pendingDays: 0,
            });
            await sendMail(requesterEmailData);
          } catch (err) {
            console.error('[requests] Failed to send submission email to requester:', err.message);
          }
        }

        // 2. Notify stage approvers (Purchase Committee approvers or Principal)
        try {
          const approversToNotify = [];
          const stages = await configService.getRoutingStages();
          if (request.stage?.code === 'PURCHASE_COMMITTEE' || request.stage?.code === stages.entryStage) {
            const { rows: pcRows } = await pool.query(
              `SELECT u.full_name, u.email FROM stage_approvers sa
                 JOIN users u ON u.user_id = sa.user_id
                 JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
                WHERE ws.code::text = $1 AND u.is_active`,
              [stages.entryStage],
            );
            for (const pc of pcRows) approversToNotify.push({ name: pc.full_name, email: pc.email });
          }
          if (
            principal?.email &&
            principal.email.toLowerCase() !== requester?.email?.toLowerCase() &&
            !approversToNotify.some((a) => a.email.toLowerCase() === principal.email.toLowerCase())
          ) {
            approversToNotify.push({ name: principal.name, email: principal.email });
          }

          for (const approver of approversToNotify) {
            try {
              const emailData = buildRequestStatusEmail({
                request: { ...request, requesterEmail: requester?.email },
                recipientEmail: approver.email,
                recipientName: approver.name,
                notificationType: 'NEW REQUEST',
                emailAction: 'New Financial Request Submitted',
                eventDescription:
                  `A new financial request "${request.title}" has been submitted by ${actor.full_name} ` +
                  `and is now awaiting your review.`,
                decision: 'PENDING REVIEW',
                approverName: null,
                approverRole: null,
                decisionDate: null,
                actionRequired: approver.email.toLowerCase() === principal?.email?.toLowerCase() && request.stage?.code === 'PURCHASE_COMMITTEE'
                  ? 'A new request has been submitted for college review. You will also be prompted to record your decision when it reaches your stage.'
                  : 'Please review this request and take the appropriate action.',
                ctaText: 'Review Request',
                workflowStage: request.stage?.name || 'Submitted',
                nextStage: request.stage?.name || 'Review',
                pendingSince: now,
                pendingDays: 0,
              });
              await sendMail(emailData);
            } catch (approverErr) {
              console.error(`[requests] Failed to notify approver ${approver.email}:`, approverErr.message);
            }
          }
        } catch (err) {
          console.error('[requests] Failed to resolve stage approvers for submission:', err.message);
        }
      } else if (action === 'RESUBMIT') {
        // 1. Notify the requester that resubmission succeeded
        if (requester?.email) {
          try {
            const requesterResubmitEmail = buildRequestStatusEmail({
              request: { ...request, requesterEmail: requester.email },
              recipientEmail: requester.email,
              recipientName: requester.full_name,
              notificationType: 'RESUBMITTED',
              emailAction: 'Request Resubmitted Successfully',
              eventDescription: `Your financial request "${request.title}" has been resubmitted and is now awaiting review.`,
              decision: 'RESUBMITTED',
              approverName: actor.full_name,
              approverRole: 'Requester',
              decisionDate: now,
              actionRequired: 'No action required at this time.',
              ctaText: 'View Request',
              workflowStage: request.stage?.name || request.status,
              nextStage: request.stage?.name || request.status,
              pendingSince: now,
              pendingDays: 0,
            });
            await sendMail(requesterResubmitEmail);
          } catch (err) {
            console.error('[requests] Failed to send resubmission email to requester:', err.message);
          }
        }

        // 2. Notify Principal / Stage Approvers of resubmission
        if (principal?.email) {
          try {
            const resubmitEmailData = buildRequestStatusEmail({
              request: { ...request, requesterEmail: requester?.email },
              recipientEmail: principal.email,
              recipientName: principal.name,
              notificationType: 'RESUBMITTED',
              emailAction: 'Request Resubmitted by Requester',
              eventDescription: `Financial request "${request.title}" has been resubmitted by ${actor.full_name} and is now awaiting review.`,
              decision: 'PENDING REVIEW',
              approverName: actor.full_name,
              approverRole: 'Requester',
              decisionDate: now,
              actionRequired: 'Please review the updated request.',
              ctaText: 'Review Request',
              workflowStage: request.stage?.name || request.status,
              nextStage: request.stage?.name || request.status,
              pendingSince: now,
              pendingDays: 0,
            });
            await sendMail(resubmitEmailData);
          } catch (err) {
            console.error('[requests] Failed to send resubmission email to approver:', err.message);
          }
        }
      } else if (['APPROVE', 'PARTIAL_APPROVE', 'REJECT', 'ESCALATE', 'FORWARD', 'RETURN'].includes(action)) {
        const typeMap = {
          APPROVE: 'APPROVAL',
          PARTIAL_APPROVE: 'PARTIAL APPROVAL',
          REJECT: 'REJECTION',
          ESCALATE: 'ESCALATION',
          FORWARD: 'ESCALATION',
          RETURN: 'CORRECTION REQUESTED',
        };
        const actionMap = {
          APPROVE: 'Request Fully Approved',
          PARTIAL_APPROVE: 'Request Partially Approved',
          REJECT: 'Request Rejected',
          ESCALATE: 'Request Escalated to Next Stage',
          FORWARD: 'Request Forwarded to Next Stage',
          RETURN: 'Request Sent Back for Correction',
        };
        const descriptionMap = {
          APPROVE: `Your financial request "${request.title}" has been fully approved by ${actor.full_name}.`,
          PARTIAL_APPROVE: `Your financial request "${request.title}" has been partially approved by ${actor.full_name}.`,
          REJECT: `Your financial request "${request.title}" has been rejected by ${actor.full_name}.`,
          ESCALATE: `Your financial request "${request.title}" has been escalated to the next review stage by ${actor.full_name}.`,
          FORWARD: `Your financial request "${request.title}" has been forwarded to the next review stage by ${actor.full_name}.`,
          RETURN: `Your financial request "${request.title}" has been returned for correction by ${actor.full_name}.`,
        };

        // 1. Notify Principal if request was forwarded to Principal review (e.g. from Purchase Committee)
        if (request.status === 'UNDER_PRINCIPAL_REVIEW' && principal?.email && actor.email?.toLowerCase() !== principal.email.toLowerCase()) {
          try {
            const principalReviewEmail = buildRequestStatusEmail({
              request: { ...request, requesterEmail: requester?.email },
              recipientEmail: principal.email,
              recipientName: principal.name,
              notificationType: 'PRINCIPAL REVIEW REQUIRED',
              emailAction: 'Request Awaiting Principal Approval',
              eventDescription: `Financial request "${request.title}" was verified and forwarded by ${actor.full_name} and is now awaiting your review.`,
              decision: 'PENDING REVIEW',
              approverName: actor.full_name,
              approverRole: 'Purchase Committee',
              decisionDate: now,
              actionRequired: 'Please review this request and record your decision.',
              ctaText: 'Review Request',
              workflowStage: 'Principal Review',
              nextStage: 'Principal Review',
              pendingSince: now,
              pendingDays: 0,
            });
            await sendMail(principalReviewEmail);
          } catch (err) {
            console.error('[requests] Failed to send review email to principal:', err.message);
          }
        }

        // 2. Notify matching CDC member on entering CDC stage
        if (request.status === 'UNDER_CDC_REVIEW') {
          try {
            const cdcApprovers = await resolveCdcApprovers(request.id);
            for (const cdcMember of cdcApprovers) {
              try {
                const emailData = buildRequestStatusEmail({
                  request: { ...request, requesterEmail: requester?.email },
                  recipientEmail: cdcMember.email,
                  recipientName: cdcMember.name,
                  notificationType: 'CDC REVIEW REQUIRED',
                  emailAction: 'Request Awaiting CDC Approval',
                  eventDescription: `Financial request "${request.title}" requires CDC review (${cdcMember.fundingType === 'NON_GRANT' ? 'Non-Grant' : 'Grant'}).`,
                  decision: 'PENDING REVIEW',
                  approverName: actor.full_name,
                  approverRole: 'Principal',
                  decisionDate: now,
                  actionRequired: 'Please review and record your CDC decision.',
                  ctaText: 'Review Request',
                  workflowStage: 'CDC Review',
                  nextStage: 'CDC Review',
                  pendingSince: now,
                  pendingDays: 0,
                });
                await sendMail(emailData);
              } catch (e) {
                console.error(`[requests] Failed to notify CDC member ${cdcMember.email}:`, e.message);
              }
            }
          } catch (err) {
            console.error('[requests] Failed to resolve CDC approvers:', err.message);
          }
        }

        // 3. Notify BOTH Chairman and Vice Chairman on entering Final Authority stage
        if (request.status === 'UNDER_FINAL_AUTHORITY_REVIEW') {
          try {
            const finalApprovers = await resolveFinalApprovers();
            for (const finalMember of finalApprovers) {
              try {
                const emailData = buildRequestStatusEmail({
                  request: { ...request, requesterEmail: requester?.email },
                  recipientEmail: finalMember.email,
                  recipientName: finalMember.name,
                  notificationType: 'FINAL AUTHORITY REVIEW REQUIRED',
                  emailAction: 'Request Awaiting Final Approval',
                  eventDescription: `Financial request "${request.title}" requires joint Chairman/Vice Chairman review.`,
                  decision: 'PENDING REVIEW',
                  approverName: actor.full_name,
                  approverRole: 'Approver',
                  decisionDate: now,
                  actionRequired: 'Please review and record your final authority decision.',
                  ctaText: 'Review Request',
                  workflowStage: 'Final Authority Review',
                  nextStage: 'Final Authority Review',
                  pendingSince: now,
                  pendingDays: 0,
                });
                await sendMail(emailData);
              } catch (e) {
                console.error(`[requests] Failed to notify final authority ${finalMember.email}:`, e.message);
              }
            }
          } catch (err) {
            console.error('[requests] Failed to resolve final approvers:', err.message);
          }
        }

        // 4. Notify the requester (member/HOD) at the email configured in User Management
        const recipientEmail = requester?.email || principal.email;
        const recipientName = requester?.full_name || requester?.name || principal.name;

        if (recipientEmail) {
          try {
            let desc = descriptionMap[action] || `Request status updated.`;
            if (action === 'ESCALATE' || action === 'FORWARD') {
              if (request.status === 'UNDER_PRINCIPAL_REVIEW') {
                desc = `Your financial request "${request.title}" has been verified by the Purchase Committee and forwarded to the Principal for review.`;
              } else if (request.status === 'UNDER_CDC_REVIEW') {
                desc = `Your financial request "${request.title}" has been reviewed by the Principal and forwarded to the CDC for review.`;
              } else if (request.status === 'UNDER_FINAL_AUTHORITY_REVIEW') {
                desc = `Your financial request "${request.title}" has been forwarded to the Chairman & Vice Chairman for final approval.`;
              }
            }

            const emailData = buildRequestStatusEmail({
              request: { ...request, requesterEmail: requester?.email },
              recipientEmail,
              recipientName,
              notificationType: typeMap[action] || 'NOTIFICATION',
              emailAction: actionMap[action] || 'Request Updated',
              eventDescription: desc,
              decision: typeMap[action] || 'UPDATED',
              approverName: actor.full_name,
              approverRole: request.stage?.name || 'Approver',
              decisionDate: now,
              approvalRemarks: comments || null,
              rejectionReason: rejectionReason || null,
              actionRequired: action === 'RETURN' ? 'Please revise the request and resubmit.' : 'No action required.',
              ctaText: 'View Request',
              workflowStage: request.stage?.name || request.status,
              nextStage: request.status,
              pendingSince: request.submittedAt || request.createdAt,
              pendingDays: Math.floor((now - new Date(request.submittedAt || request.createdAt)) / 86400000),
            });

            await sendMail(emailData);
          } catch (err) {
            console.error('[requests] Failed to send status email to requester:', err.message);
          }
        }

        // 5. Keep Principal informed if Principal was neither the actor nor the requester and stage is not already principal review
        if (
          principal?.email &&
          principal.email.toLowerCase() !== recipientEmail?.toLowerCase() &&
          principal.email.toLowerCase() !== actor.email?.toLowerCase() &&
          request.status !== 'UNDER_PRINCIPAL_REVIEW'
        ) {
          try {
            const principalEmailData = buildRequestStatusEmail({
              request: { ...request, requesterEmail: requester?.email },
              recipientEmail: principal.email,
              recipientName: principal.name,
              notificationType: typeMap[action] || 'NOTIFICATION',
              emailAction: actionMap[action] || 'Request Updated',
              eventDescription: `Financial request "${request.title}" was ${actionMap[action]?.toLowerCase() || 'updated'} by ${actor.full_name}.`,
              decision: typeMap[action] || 'UPDATED',
              approverName: actor.full_name,
              approverRole: request.stage?.name || 'Approver',
              decisionDate: now,
              approvalRemarks: comments || null,
              rejectionReason: rejectionReason || null,
              actionRequired: 'No action required.',
              ctaText: 'View Request',
              workflowStage: request.stage?.name || request.status,
              nextStage: request.status,
              pendingSince: request.submittedAt || request.createdAt,
              pendingDays: Math.floor((now - new Date(request.submittedAt || request.createdAt)) / 86400000),
            });
            await sendMail(principalEmailData);
          } catch (err) {
            console.error('[requests] Failed to send update copy to principal:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('[requests] Failed to send request notification email:', err.message);
    }
  })();
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const summaryRow = (r) => ({
  id: r.request_id,
  requestNumber: r.request_number,
  title: r.title,
  status: r.current_status,
  stage: r.stage_code ? { code: r.stage_code, name: r.stage_name } : null,
  budgetHead: { id: r.budget_head_id, name: r.budget_head_name, headType: r.head_type },
  financialYear: r.financial_year,
  department: r.department_id ? { id: r.department_id, name: r.department_name } : null,
  fundingType: r.funding_type,
  raisedBy: { id: r.raised_by, name: r.raised_by_name },
  tentativeTotalCost: r.tentative_total_cost,
  sanctionedAmount: r.sanctioned_amount,
  itemCount: r.item_count,
  daysOpen: r.days_open,
  createdAt: r.created_at,
  submittedAt: r.submitted_at,
  updatedAt: r.updated_at,
});

const itemRow = (r) => ({
  id: r.request_item_id,
  budgetItem: { id: r.budget_item_id, code: r.code, name: r.name, unit: r.unit },
  itemType: r.item_type_snapshot,
  requestedQuantity: r.requested_quantity,
  unitCost: r.estimated_unit_cost,
  estimatedTotal: r.estimated_total,
  approvedQuantity: r.approved_quantity,
  approvedAmount: r.approved_amount,
  // Never overwritten, so the shortfall is always recoverable.
  unapprovedQuantity: Math.round((r.requested_quantity - r.approved_quantity) * 100) / 100,
  status: r.item_status,
  remarks: r.remarks,
});

const attachmentRow = (r) => ({
  id: r.attachment_id,
  fileName: r.file_name,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  // A replaced document is kept, not deleted: supersededById points at what
  // replaced it, so the detail view can show the whole chain.
  versionNumber: r.version_number ?? 1,
  supersededById: r.superseded_by_id ?? null,
  requestVersionNumber: r.request_version_number ?? 1,
  replacementReason: r.replacement_reason ?? null,
  uploadedBy: { id: r.uploaded_by, name: r.uploaded_by_name },
  uploadedAt: r.uploaded_at,
});

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

// Stages two people decide together, and the two roles that must each record a
// decision before the request moves on (docs/plan/decisions.md). Order matters
// only for display; either may act first.
const JOINT_STAGE_ROLES = {};

/**
 * Who has and has not yet decided at a two-person stage, so the UI can show
 * "CDC Grant Member approved, CDC Non-Grant Member pending" rather than one
 * anonymous "CDC" step. Empty for every other stage.
 */
async function loadJointApprovals(db, requestId, stageCode, stageId) {
  const roleCodes = JOINT_STAGE_ROLES[stageCode];
  if (!roleCodes) return [];
  const { rows } = await db.query(
    `SELECT ro.code AS role_code, ro.name AS role_name,
            act.performed_by, act.action, act.created_at, u.full_name AS performed_by_name,
            u.email AS performed_by_email, u.employee_id AS performed_by_employee_id
       FROM roles ro
       LEFT JOIN LATERAL (
         SELECT aa.performed_by, aa.action, aa.created_at
           FROM approval_actions aa
          WHERE aa.request_id = $1 AND aa.stage_id = $2
            AND (aa.role_id = ro.role_id OR (aa.role_id IS NULL AND EXISTS (
                  SELECT 1 FROM stage_approvers sa
                   WHERE sa.user_id = aa.performed_by AND sa.stage_id = aa.stage_id AND sa.role_id = ro.role_id
                )))
            AND aa.action IN ('APPROVE', 'PARTIAL_APPROVE', 'ESCALATE')
          ORDER BY aa.created_at DESC
          LIMIT 1
       ) act ON TRUE
       LEFT JOIN users u ON u.user_id = act.performed_by
      WHERE ro.code = ANY($3::text[])
      ORDER BY array_position($3::text[], ro.code::text)`,
    [requestId, stageId, roleCodes],
  );
  return rows.map((row) => ({
    roleCode: row.role_code,
    roleName: row.role_name,
    decided: row.performed_by !== null,
    action: row.action,
    by: row.performed_by ? {
      id: row.performed_by,
      name: row.performed_by_name,
      email: row.performed_by_email,
      employeeId: row.performed_by_employee_id,
    } : null,
    at: row.created_at,
  }));
}

/** Full request as the caller may see it, or null when RLS hides it. */
export async function loadDetail(db, requestId, user) {
  const { rows } = await db.query(
    `SELECT r.*, u.full_name AS raised_by_name,
            bh.code AS budget_head_code, bh.name AS budget_head_name, bh.head_type,
            fy.label AS financial_year, d.name AS department_name, d.funding_type AS department_funding_type,
            c.name AS course_name, c.funding_type AS course_funding_type,
            app_request_funding_type(r.request_id) AS request_funding_type,
            ws.code AS stage_code, ws.name AS stage_name, ws.is_final AS stage_is_final,
            src.request_number AS carried_from_number, cfy.label AS carried_from_fy,
            EXISTS (SELECT 1 FROM stage_approvers sa
                     JOIN roles ro ON ro.role_id = sa.role_id
                    WHERE sa.stage_id = r.current_stage_id AND sa.user_id = $2
                      AND (ws.code <> 'CDC'
                           OR app_cdc_on_route(r.request_id, ro.code, sa.member_classification))) AS staffed_here
       FROM requests r
       JOIN users u            ON u.user_id = r.raised_by
       JOIN budget_heads bh    ON bh.budget_head_id = r.budget_head_id
       JOIN financial_years fy ON fy.financial_year_id = r.financial_year_id
       LEFT JOIN departments d ON d.department_id = r.department_id
       LEFT JOIN courses c     ON c.course_id = r.course_id
       LEFT JOIN workflow_stages ws  ON ws.stage_id = r.current_stage_id
       LEFT JOIN requests src        ON src.request_id = r.carried_forward_from_request_id
       LEFT JOIN financial_years cfy ON cfy.financial_year_id = r.carried_forward_from_fy_id
      WHERE r.request_id = $1`,
    [requestId, user.id],
  );
  const r = rows[0];
  if (!r) return null;

  const [items, attachments, corrections] = await queryAll(db, [
    [`SELECT ri.*, bi.code, bi.name, bi.unit
        FROM request_items ri JOIN budget_items bi ON bi.budget_item_id = ri.budget_item_id
       WHERE ri.request_id = $1 ORDER BY bi.name, ri.request_item_id`, [requestId]],
    [`SELECT a.*, u.full_name AS uploaded_by_name
        FROM attachments a JOIN users u ON u.user_id = a.uploaded_by
       WHERE a.request_id = $1 ORDER BY a.version_number, a.uploaded_at`, [requestId]],
    [`SELECT cr.*, u.full_name AS requested_by_name, ws.name AS stage_name
        FROM correction_requests cr
        JOIN users u ON u.user_id = cr.requested_by
        LEFT JOIN workflow_stages ws ON ws.stage_id = cr.requested_at_stage_id
       WHERE cr.request_id = $1 ORDER BY cr.created_at DESC`, [requestId]],
  ]);

  const isOwner = r.raised_by === user.id;
  const isAdmin = user.roles.includes('ADMIN');
  const canEdit = EDITABLE_STATUSES.includes(r.current_status) && (isOwner || isAdmin);
  const canAct = r.staffed_here && isUnderReview(r.current_status);
  const jointApprovals = await loadJointApprovals(db, requestId, r.stage_code, r.current_stage_id);

  return {
    id: r.request_id,
    requestNumber: r.request_number,
    title: r.title,
    description: r.description,
    status: r.current_status,
    stage: r.stage_code
      ? { id: r.current_stage_id, code: r.stage_code, name: r.stage_name, isFinal: r.stage_is_final }
      : null,
    budgetHead: { id: r.budget_head_id, code: r.budget_head_code, name: r.budget_head_name, headType: r.head_type },
    financialYear: { id: r.financial_year_id, label: r.financial_year },
    department: r.department_id ? { id: r.department_id, name: r.department_name, fundingType: r.department_funding_type } : null,
    course: r.course_id ? { id: r.course_id, name: r.course_name, fundingType: r.course_funding_type } : null,
    fundingType: r.request_funding_type,
    raisedBy: { id: r.raised_by, name: r.raised_by_name },
    tentativeTotalCost: r.tentative_total_cost,
    sanctionedAmount: r.sanctioned_amount,
    extra: r.extra,
    carriedForwardFrom: r.carried_forward_from_request_id
      ? { requestId: r.carried_forward_from_request_id, requestNumber: r.carried_from_number,
          financialYear: r.carried_from_fy }
      : null,
    items: items.rows.map(itemRow),
    attachments: attachments.rows.map(attachmentRow),
    jointApprovals,
    versionNumber: r.current_version_number,
    // Newest first, so [0] is the correction the requester is answering while
    // the request is AWAITING_RESUBMISSION.
    corrections: corrections.rows.map((c) => ({
      id: c.correction_id,
      reason: c.reason,
      requestedBy: { id: c.requested_by, name: c.requested_by_name },
      stageName: c.stage_name,
      previousStatus: c.previous_status,
      createdAt: c.created_at,
      resolvedAt: c.resolved_at,
      resolvedByVersion: c.resolved_by_version,
    })),
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
    closedAt: r.closed_at,
    // What the UI may offer. Every one is enforced again when attempted.
    permissions: {
      canEdit,
      canSubmit: canEdit && r.current_status === 'DRAFT' && items.rowCount > 0,
      canResubmit: isOwner && r.current_status === 'AWAITING_RESUBMISSION' && items.rowCount > 0,
      canAct,
      actions: canAct ? await actionsAt(r.stage_code, r.stage_is_final, Number(r.tentative_total_cost)) : [],
      canAttach: !ATTACH_CLOSED.includes(r.current_status) && (isOwner || isAdmin || r.staffed_here),
      canCarryForward: (isOwner || isAdmin) && !NOT_CARRYABLE.includes(r.current_status),
    },
  };
}

async function requireDetail(db, requestId, user) {
  const detail = await loadDetail(db, requestId, user);
  if (!detail) throw notFound('Request not found');
  return detail;
}

/**
 * A request the caller may change, locked for the rest of the transaction.
 * Drafts always qualify; a request sent back for correction does too, because
 * correcting it is the whole point of the resubmission flow. Callers that only
 * ever make sense on an unsubmitted draft (deleting one) pass `['DRAFT']`.
 */
async function lockEditableRequest(db, requestId, user, statuses = EDITABLE_STATUSES) {
  const { rows } = await db.query(
    'SELECT request_id, raised_by, current_status, budget_head_id, department_id, financial_year_id FROM requests WHERE request_id = $1',
    [requestId],
  );
  const r = rows[0];
  if (!r) throw notFound('Request not found');
  if (r.raised_by !== user.id && !user.roles.includes('ADMIN')) {
    throw forbidden('Only the person who raised this request can change it');
  }
  if (user.roles.includes('HEAD') && user.departmentId != null && r.department_id != null && r.department_id !== user.departmentId) {
    throw forbidden('You can only modify requests for your own department');
  }
  if (!statuses.includes(r.current_status)) {
    throw conflict(statuses.length === 1
      ? 'Only draft requests can be deleted; this one has been submitted'
      : 'This request can only be changed while it is a draft or has been sent back for correction');
  }
  await db.query('SELECT 1 FROM requests WHERE request_id = $1 FOR UPDATE', [requestId]);
  return r;
}

// ---------------------------------------------------------------------------
// Items: validation and totals
// ---------------------------------------------------------------------------

const itemInput = z.object({
  budgetItemId: intId,
  quantity,
  unitCost: positiveAmount,
  remarks: z.string().trim().max(1000).optional(),
});

/** Items must belong to the request's budget head, once each. */
async function checkItems(db, budgetHeadId, budgetItemIds, alreadyOnRequest = []) {
  const all = [...alreadyOnRequest, ...budgetItemIds];
  if (new Set(all).size !== all.length) {
    throw unprocessable('Each budget item may appear only once on a request');
  }
  if (!budgetItemIds.length) return;
  const { rows } = await db.query(
    `SELECT budget_item_id FROM budget_items
      WHERE budget_item_id = ANY($1::int[]) AND budget_head_id = $2 AND is_active`,
    [budgetItemIds, budgetHeadId],
  );
  if (rows.length !== budgetItemIds.length) {
    const found = new Set(rows.map((row) => row.budget_item_id));
    throw unprocessable('Items must belong to the request\'s budget head', {
      budgetItemIds: budgetItemIds.filter((itemId) => !found.has(itemId)),
    });
  }
}

async function insertItems(db, requestId, items) {
  if (!items.length) return;
  // The line total is computed in SQL: NUMERIC multiplication is exact,
  // JavaScript's floating point is not.
  await db.query(
    `INSERT INTO request_items (request_id, budget_item_id, item_type_snapshot,
                                requested_quantity, estimated_unit_cost, estimated_total, remarks)
     SELECT $1, bi.budget_item_id, bi.item_type, x.qty, x.cost, round(x.qty * x.cost, 2), x.remarks
       FROM unnest($2::int[], $3::numeric[], $4::numeric[], $5::text[]) AS x(item_id, qty, cost, remarks)
       JOIN budget_items bi ON bi.budget_item_id = x.item_id`,
    [
      requestId,
      items.map((i) => i.budgetItemId),
      items.map((i) => i.quantity),
      items.map((i) => i.unitCost),
      items.map((i) => i.remarks ?? null),
    ],
  );
}

/** The request total is always the sum of its lines, never typed in. */
function recalcTotal(db, requestId) {
  return db.query(
    `UPDATE requests
        SET tentative_total_cost = COALESCE(
              (SELECT SUM(estimated_total) FROM request_items WHERE request_id = $1), 0)
      WHERE request_id = $1`,
    [requestId],
  );
}

async function checkPlacement(db, { departmentId, courseId }) {
  if (courseId == null) return;
  const { rows } = await db.query('SELECT department_id FROM courses WHERE course_id = $1', [courseId]);
  if (!rows[0]) throw unprocessable('Course not found');
  if (departmentId != null && rows[0].department_id !== departmentId) {
    throw unprocessable('That course belongs to a different department');
  }
}

// ---------------------------------------------------------------------------
// Routes: list, create, read, update, delete
// ---------------------------------------------------------------------------

const listQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((s) => s.trim().toUpperCase()) : null))
    .pipe(z.array(z.enum(STATUSES)).nullable()),
  financialYearId: intId.optional(),
  stage: z.enum(['PURCHASE_COMMITTEE', 'PRINCIPAL', 'CDC', 'FINAL_AUTHORITY']).optional(),
  mine: flag,
  awaitingMe: flag,
  q: z.string().trim().max(100).optional(),
  ...pagination,
});

requestsRouter.get('/', async (req, res) => {
  const f = listQuery.parse(req.query);
  // Wildcards in the search text are matched literally.
  const q = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

  const rows = await withUser(req.user.id, async (db) => (await db.query(
    `SELECT r.request_id, r.request_number, r.title, r.current_status,
            r.tentative_total_cost, r.sanctioned_amount, r.created_at, r.submitted_at, r.updated_at,
            r.raised_by, u.full_name AS raised_by_name,
            r.budget_head_id, bh.name AS budget_head_name, bh.head_type,
            fy.label AS financial_year, ws.code AS stage_code, ws.name AS stage_name,
            d.department_id, d.name AS department_name,
            app_request_funding_type(r.request_id) AS funding_type,
            (SELECT count(*) FROM request_items ri WHERE ri.request_id = r.request_id)::int AS item_count,
            EXTRACT(DAY FROM NOW() - COALESCE(r.submitted_at, r.created_at))::int AS days_open,
            count(*) OVER () AS total_count
       FROM requests r
       JOIN users u            ON u.user_id = r.raised_by
       JOIN budget_heads bh    ON bh.budget_head_id = r.budget_head_id
       JOIN financial_years fy ON fy.financial_year_id = r.financial_year_id
       LEFT JOIN departments d ON d.department_id = r.department_id
       LEFT JOIN workflow_stages ws ON ws.stage_id = r.current_stage_id
      WHERE ($1::request_status[] IS NULL OR r.current_status = ANY($1))
        AND ($2::int  IS NULL OR r.financial_year_id = $2)
        AND ($3::text IS NULL OR ws.code::text = $3)
        AND (NOT $4 OR r.raised_by = $6)
        AND (NOT $5 OR (left(r.current_status::text, 6) = 'UNDER_' AND EXISTS (
               SELECT 1 FROM stage_approvers sa
                JOIN roles ro ON ro.role_id = sa.role_id
                WHERE sa.stage_id = r.current_stage_id AND sa.user_id = $6
                  AND (ws.code <> 'CDC'
                       OR app_cdc_on_route(r.request_id, ro.code, sa.member_classification)))))
        AND ($7::text IS NULL OR r.title ILIKE $7 OR r.request_number ILIKE $7)
      ORDER BY r.updated_at DESC, r.request_id
      LIMIT $8 OFFSET $9`,
    [f.status, f.financialYearId ?? null, f.stage ?? null, f.mine ?? false,
      f.awaitingMe ?? false, req.user.id, q, f.limit, f.offset],
  )).rows);

  res.json({
    items: rows.map(summaryRow),
    total: rows[0]?.total_count ?? 0,
    limit: f.limit,
    offset: f.offset,
  });
});

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(5000).optional(),
  budgetHeadId: intId,
  financialYearId: intId.optional(),
  departmentId: intId.nullable().optional(),
  courseId: intId.nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  items: z.array(itemInput).max(50).default([]),
});

requestsRouter.post('/', requireRole(...REQUESTER_ROLES), async (req, res) => {
  if (req.user.roles.includes('ADMIN')) {
    throw forbidden('Administrators cannot create procurement requests');
  }
  const body = createSchema.parse(req.body);

  if (req.user.roles.includes('HEAD')) {
    if (!req.user.departmentId) {
      throw forbidden('Department Head must be assigned to a department to raise requests');
    }
    if (body.departmentId != null && body.departmentId !== req.user.departmentId) {
      throw forbidden('You can only raise requests for your own department');
    }
    body.departmentId = req.user.departmentId;
  } else {
    if (body.departmentId != null && req.user.departmentId != null && body.departmentId !== req.user.departmentId) {
      throw forbidden('You can only raise requests for your own department');
    }
    // Automatically set or default to the requester's assigned department
    if (body.departmentId == null && req.user.departmentId != null) {
      body.departmentId = req.user.departmentId;
    }
  }

  const detail = await withUser(req.user.id, async (db) => {
    const head = await db.query(
      'SELECT 1 FROM budget_heads WHERE budget_head_id = $1 AND is_active', [body.budgetHeadId]);
    if (!head.rowCount) throw unprocessable('Budget head not found');
    await checkItems(db, body.budgetHeadId, body.items.map((i) => i.budgetItemId));
    await checkPlacement(db, body);

    let budgetStatus = null;
    if (body.departmentId != null) {
      budgetStatus = await getDepartmentBudgetStatus(db, {
        departmentId: body.departmentId,
        financialYearId: body.financialYearId,
        budgetHeadId: body.budgetHeadId,
        forUpdate: true,
      });

      // Trusted server-side calculation from item quantities and unit costs
      const serverCalculatedTotal = calculateItemsTotal(body.items);
      assertDepartmentBudgetAvailable(budgetStatus, serverCalculatedTotal);
    }

    const { rows } = await db.query(
      `INSERT INTO requests (raised_by, financial_year_id, budget_head_id, department_id, course_id,
                             title, description, extra, tentative_total_cost)
       VALUES ($1,
               COALESCE($2, (SELECT financial_year_id FROM financial_years WHERE is_active)),
               $3, $4, $5, $6, $7, $8, 0)
       RETURNING request_id`,
      [req.user.id, body.financialYearId ?? null, body.budgetHeadId, body.departmentId ?? null,
        body.courseId ?? null, body.title, body.description ?? null, body.extra ?? {}],
    );
    const requestId = rows[0].request_id;
    await insertItems(db, requestId, body.items);
    await recalcTotal(db, requestId);
    return requireDetail(db, requestId, req.user);
  });

  res.status(201).location(`/api/requests/${detail.id}`).json(detail);
});

requestsRouter.get('/:id', async (req, res) => {
  const requestId = param(req, 'id');
  res.json(await withUser(req.user.id, (db) => requireDetail(db, requestId, req.user)));
});

const updateSchema = createSchema.omit({ items: true }).partial();

requestsRouter.patch('/:id', async (req, res) => {
  const requestId = param(req, 'id');
  const body = updateSchema.parse(req.body);

  const isAdmin = req.user.roles.includes('ADMIN');
  if (!isAdmin && body.departmentId !== undefined) {
    if (req.user.departmentId != null && body.departmentId !== req.user.departmentId) {
      throw forbidden('You cannot assign a request to a different department');
    }
  }
  if (req.user.roles.includes('HEAD') && body.departmentId !== undefined && body.departmentId !== req.user.departmentId) {
    throw forbidden('Department Head cannot reassign request to a different department');
  }

  const detail = await withUser(req.user.id, async (db) => {
    const current = await lockEditableRequest(db, requestId, req.user);

    if (body.budgetHeadId !== undefined && body.budgetHeadId !== current.budget_head_id) {
      const { rows } = await db.query(
        'SELECT budget_item_id FROM request_items WHERE request_id = $1', [requestId]);
      await checkItems(db, body.budgetHeadId, rows.map((r) => r.budget_item_id));
    }
    // A course alone is checked against the department the request already has.
    await checkPlacement(db, {
      departmentId: body.departmentId !== undefined ? body.departmentId : current.department_id,
      courseId: body.courseId,
    });

    const columns = {
      title: 'title', description: 'description', budgetHeadId: 'budget_head_id',
      financialYearId: 'financial_year_id', departmentId: 'department_id',
      courseId: 'course_id', extra: 'extra',
    };
    const sets = [];
    const values = [];
    for (const [key, column] of Object.entries(columns)) {
      if (body[key] !== undefined) {
        values.push(body[key]);
        sets.push(`${column} = $${values.length}`);
      }
    }
    if (sets.length) {
      values.push(requestId);
      await db.query(`UPDATE requests SET ${sets.join(', ')} WHERE request_id = $${values.length}`, values);
    }

    const effectiveDeptId = body.departmentId !== undefined ? body.departmentId : current.department_id;
    const effectiveFyId = body.financialYearId !== undefined ? body.financialYearId : current.financial_year_id;
    const effectiveHeadId = body.budgetHeadId !== undefined ? body.budgetHeadId : current.budget_head_id;

    if (effectiveDeptId != null) {
      const { rows: totRows } = await db.query(
        'SELECT COALESCE(tentative_total_cost, 0)::numeric AS total FROM requests WHERE request_id = $1',
        [requestId],
      );
      const currentTotal = Number(totRows[0]?.total ?? 0);
      const budgetStatus = await getDepartmentBudgetStatus(db, {
        departmentId: effectiveDeptId,
        financialYearId: effectiveFyId,
        budgetHeadId: effectiveHeadId,
        forUpdate: true,
      });
      assertDepartmentBudgetAvailable(budgetStatus, currentTotal);
    }

    return requireDetail(db, requestId, req.user);
  });

  res.json(detail);
});

requestsRouter.delete('/:id', async (req, res) => {
  const requestId = param(req, 'id');
  const files = await withUser(req.user.id, async (db) => {
    await lockEditableRequest(db, requestId, req.user, ['DRAFT']);
    const { rows } = await db.query(
      'SELECT storage_path FROM attachments WHERE request_id = $1', [requestId]);
    await db.query('DELETE FROM requests WHERE request_id = $1', [requestId]);
    return rows.map((r) => r.storage_path);
  });
  // Files go only after the delete has committed; a rollback must not leave
  // rows pointing at files that no longer exist.
  await Promise.all(files.map(removeFile));
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Routes: line items on a draft
// ---------------------------------------------------------------------------

requestsRouter.post('/:id/items', async (req, res) => {
  const requestId = param(req, 'id');
  const item = itemInput.parse(req.body);

  const detail = await withUser(req.user.id, async (db) => {
    const current = await lockEditableRequest(db, requestId, req.user);
    const { rows } = await db.query(
      'SELECT budget_item_id FROM request_items WHERE request_id = $1', [requestId]);
    await checkItems(db, current.budget_head_id, [item.budgetItemId], rows.map((r) => r.budget_item_id));
    await insertItems(db, requestId, [item]);
    await recalcTotal(db, requestId);

    if (current.department_id != null) {
      const { rows: totRows } = await db.query(
        'SELECT COALESCE(tentative_total_cost, 0)::numeric AS total FROM requests WHERE request_id = $1',
        [requestId],
      );
      const newTotal = Number(totRows[0]?.total ?? 0);
      const budgetStatus = await getDepartmentBudgetStatus(db, {
        departmentId: current.department_id,
        financialYearId: current.financial_year_id,
        budgetHeadId: current.budget_head_id,
        forUpdate: true,
      });
      assertDepartmentBudgetAvailable(budgetStatus, newTotal);
    }

    return requireDetail(db, requestId, req.user);
  });

  res.status(201).json(detail);
});

const itemUpdate = z
  .object({ quantity: quantity.optional(), unitCost: positiveAmount.optional(),
            remarks: z.string().trim().max(1000).nullable().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

requestsRouter.patch('/:id/items/:itemId', async (req, res) => {
  const requestId = param(req, 'id');
  const itemId = param(req, 'itemId');
  const body = itemUpdate.parse(req.body);

  const detail = await withUser(req.user.id, async (db) => {
    await lockEditableRequest(db, requestId, req.user);
    const { rowCount } = await db.query(
      `UPDATE request_items
          SET requested_quantity  = COALESCE($3, requested_quantity),
              estimated_unit_cost = COALESCE($4, estimated_unit_cost),
              estimated_total     = round(COALESCE($3, requested_quantity)
                                          * COALESCE($4, estimated_unit_cost), 2),
              remarks = CASE WHEN $5 THEN $6 ELSE remarks END
        WHERE request_item_id = $2 AND request_id = $1`,
      [requestId, itemId, body.quantity ?? null, body.unitCost ?? null,
        body.remarks !== undefined, body.remarks ?? null],
    );
    if (!rowCount) throw notFound('Item not found on this request');
    await recalcTotal(db, requestId);

    if (current.department_id != null) {
      const { rows: totRows } = await db.query(
        'SELECT COALESCE(tentative_total_cost, 0)::numeric AS total FROM requests WHERE request_id = $1',
        [requestId],
      );
      const newTotal = Number(totRows[0]?.total ?? 0);
      const budgetStatus = await getDepartmentBudgetStatus(db, {
        departmentId: current.department_id,
        financialYearId: current.financial_year_id,
        budgetHeadId: current.budget_head_id,
        forUpdate: true,
      });
      assertDepartmentBudgetAvailable(budgetStatus, newTotal);
    }

    return requireDetail(db, requestId, req.user);
  });

  res.json(detail);
});

requestsRouter.delete('/:id/items/:itemId', async (req, res) => {
  const requestId = param(req, 'id');
  const itemId = param(req, 'itemId');

  const detail = await withUser(req.user.id, async (db) => {
    await lockEditableRequest(db, requestId, req.user);
    const { rowCount } = await db.query(
      'DELETE FROM request_items WHERE request_item_id = $2 AND request_id = $1', [requestId, itemId]);
    if (!rowCount) throw notFound('Item not found on this request');
    await recalcTotal(db, requestId);
    return requireDetail(db, requestId, req.user);
  });

  res.json(detail);
});

// ---------------------------------------------------------------------------
// Routes: workflow
// ---------------------------------------------------------------------------

requestsRouter.post('/:id/submit', async (req, res) => {
  const requestId = param(req, 'id');

  const detail = await withUser(req.user.id, async (db) => {
    const current = await lockEditableRequest(db, requestId, req.user, ['DRAFT']);
    const { rows } = await db.query(
      'SELECT count(*)::int AS n, COALESCE(SUM(estimated_total), 0)::numeric AS total FROM request_items WHERE request_id = $1', [requestId]);
    if (rows[0].n === 0) throw unprocessable('Add at least one item before submitting');
    const total = Number(rows[0].total);
    if (total <= 0) throw unprocessable('Request total must be greater than ₹0 before submitting');
    await recalcTotal(db, requestId);

    if (current.department_id != null) {
      const budgetStatus = await getDepartmentBudgetStatus(db, {
        departmentId: current.department_id,
        financialYearId: current.financial_year_id,
        budgetHeadId: current.budget_head_id,
        forUpdate: true,
      });
      assertDepartmentBudgetAvailable(budgetStatus, total);
    }

    await db.query('SELECT fn_submit_request($1)', [requestId]);
    return requireDetail(db, requestId, req.user);
  });

  // ── Send email notification (fire-and-forget) ──
  notifyRequestAsync({ request: detail, actorId: req.user.id, action: 'SUBMITTED' });

  res.json(detail);
});

const note = z.string().trim().max(2000).optional()
  .transform((value) => value || null);

const decisionInput = z.object({
  requestItemId: id,
  approvedQuantity,
  approvedAmount: amount.optional(),
  remarks: z.string().trim().max(1000).optional(),
});

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('APPROVE'), comments: note }),
  z.object({ action: z.literal('PARTIAL_APPROVE'), comments: note,
             itemDecisions: z.array(decisionInput).min(1).max(50) }),
  z.object({ action: z.literal('REJECT'), comments: note,
             rejectionReason: z.string().trim().min(3).max(2000) }),
  z.object({ action: z.literal('ESCALATE'), comments: note }),
  z.object({ action: z.literal('FORWARD'), comments: note }),
  // A return has to say what needs correcting — it is the only thing the
  // requester is shown when the request comes back to them.
  z.object({ action: z.literal('RETURN'),
             comments: z.string().trim().min(3).max(2000) }),
]);

/**
 * The per-item figures a decision will record. Built in SQL so that a
 * defaulted approved amount (quantity x unit cost) is exact.
 */
async function buildDecisions(db, requestId, body) {
  const { rows: items } = await db.query(
    `SELECT request_item_id, requested_quantity, estimated_unit_cost, estimated_total
       FROM request_items WHERE request_id = $1`,
    [requestId],
  );

  if (body.action === 'APPROVE') {
    return items.map((i) => ({
      requestItemId: i.request_item_id,
      approvedQuantity: i.requested_quantity,
      approvedAmount: i.estimated_total,
      remarks: null,
    }));
  }
  if (body.action !== 'PARTIAL_APPROVE') return [];

  const decisions = body.itemDecisions.map((d) => ({ ...d, requestItemId: d.requestItemId.toLowerCase() }));
  const byId = new Map(items.map((i) => [i.request_item_id, i]));

  const unknown = decisions.filter((d) => !byId.has(d.requestItemId)).map((d) => d.requestItemId);
  if (unknown.length) {
    throw unprocessable('The decision refers to items that are not on this request', { requestItemIds: unknown });
  }
  if (new Set(decisions.map((d) => d.requestItemId)).size !== decisions.length) {
    throw unprocessable('Each item may be decided only once');
  }
  // Every line must be decided. Leaving some untouched would leave them
  // pending under a decision that reads as final.
  const missing = items.filter((i) => !decisions.some((d) => d.requestItemId === i.request_item_id));
  if (missing.length) {
    throw unprocessable('A partial approval must decide every item on the request', {
      requestItemIds: missing.map((i) => i.request_item_id),
    });
  }

  for (const d of decisions) {
    const item = byId.get(d.requestItemId);
    if (d.approvedQuantity > item.requested_quantity) {
      throw unprocessable('Approved quantity cannot exceed the requested quantity', { requestItemId: d.requestItemId });
    }
    if (d.approvedAmount !== undefined && d.approvedAmount > item.estimated_total) {
      throw unprocessable('Approved amount cannot exceed the requested amount', { requestItemId: d.requestItemId });
    }
    if (d.approvedQuantity === 0 && d.approvedAmount) {
      throw unprocessable('An item approved at zero quantity cannot carry an amount', { requestItemId: d.requestItemId });
    }
  }

  const { rows } = await db.query(
    `SELECT ri.request_item_id,
            x.qty AS approved_quantity,
            COALESCE(x.amt, round(x.qty * ri.estimated_unit_cost, 2)) AS approved_amount,
            x.remarks
       FROM unnest($2::uuid[], $3::numeric[], $4::numeric[], $5::text[]) AS x(item_id, qty, amt, remarks)
       JOIN request_items ri ON ri.request_item_id = x.item_id AND ri.request_id = $1`,
    [
      requestId,
      decisions.map((d) => d.requestItemId),
      decisions.map((d) => d.approvedQuantity),
      decisions.map((d) => d.approvedAmount ?? null),
      decisions.map((d) => d.remarks || null),
    ],
  );
  return rows.map((r) => ({
    requestItemId: r.request_item_id,
    approvedQuantity: r.approved_quantity,
    approvedAmount: r.approved_amount,
    remarks: r.remarks,
  }));
}

requestsRouter.post('/:id/actions', async (req, res) => {
  const requestId = param(req, 'id');
  const body = actionSchema.parse(req.body);

  const dbAction = body.action === 'FORWARD' ? 'ESCALATE' : body.action;

  const result = await withUser(req.user.id, async (db) => {
    const stages = await configService.getRoutingStages();
    const { rows: stageRows } = await db.query(
      `SELECT r.current_stage_id, ws.code AS stage_code, r.tentative_total_cost,
              EXISTS (SELECT 1 FROM stage_approvers sa
                       JOIN roles ro ON ro.role_id = sa.role_id
                      WHERE sa.stage_id = r.current_stage_id AND sa.user_id = $2
                        AND (
                          (SELECT code FROM workflow_stages ws2 WHERE ws2.stage_id = sa.stage_id) <> $3
                          OR app_cdc_on_route(r.request_id, ro.code, sa.member_classification)
                        )) AS staffed_here
         FROM requests r
         LEFT JOIN workflow_stages ws ON ws.stage_id = r.current_stage_id
        WHERE r.request_id = $1`,
      [requestId, req.user.id, stages.intermediateStage],
    );
    if (!stageRows[0]) throw notFound('Request not found');
    const stageCode = stageRows[0].stage_code;
    const amount = Number(stageRows[0].tentative_total_cost);

    // Explicit server-side staffed-stage authorization check.
    if (!stageRows[0].staffed_here) {
      throw new HttpError(403, 'You are not authorised to act on this request at its current stage', { code: 'SP004' });
    }

    if (stageCode === stages.entryStage && ['APPROVE', 'PARTIAL_APPROVE'].includes(dbAction)) {
      throw unprocessable('Purchase Committee performs validity review only and cannot approve requests');
    }
    if (stageCode === stages.principalStage) {
      const { principalMax } = await configService.getThresholds();
      if (['APPROVE', 'PARTIAL_APPROVE'].includes(dbAction) && amount > principalMax) {
        throw unprocessable(
          `Requests above ₹${principalMax.toLocaleString('en-IN')} are decided by CDC or the Chairman and Vice Chairman; forward it instead`);
      }
      if (dbAction === 'ESCALATE' && amount <= principalMax) {
        throw unprocessable(
          `Requests up to ₹${principalMax.toLocaleString('en-IN')} must be decided by the Principal and cannot be escalated`);
      }
    }
    if (stageCode === stages.intermediateStage) {
      const { cdcMax } = await configService.getThresholds();
      if (['APPROVE', 'PARTIAL_APPROVE', 'REJECT'].includes(dbAction) && amount > cdcMax) {
        throw unprocessable(
          `Requests above ₹${cdcMax.toLocaleString('en-IN')} must be decided by Chairman and Vice Chairman`);
      }
      if (dbAction === 'ESCALATE') {
        throw unprocessable('CDC holds the decision at this amount; it cannot pass the request further up');
      }
    }
    if (dbAction === 'RETURN' && ![stages.entryStage, stages.principalStage].includes(stageCode)) {
      throw unprocessable('Only the Purchase Committee and the Principal can return a request for correction');
    }

    const decisions = await buildDecisions(db, requestId, body);
    const rejectionReason = dbAction === 'REJECT' ? (body.rejectionReason || null) : null;
    const signature = seal({
      requestId, action: dbAction, actorId: req.user.id,
      decisions, comments: body.comments, rejectionReason,
    });

    const { rows } = await db.query(
      'SELECT fn_record_action($1, $2, $3, $4, $5, $6, $7) AS action_id',
      [
        requestId, req.user.id, dbAction,
        decisions.length
          ? JSON.stringify(decisions.map((d) => ({
            request_item_id: d.requestItemId,
            approved_quantity: d.approvedQuantity,
            approved_amount: d.approvedAmount,
            remarks: d.remarks,
          })))
          : null,
        body.comments, rejectionReason, signature,
      ],
    );
    return { actionId: rows[0].action_id, request: await requireDetail(db, requestId, req.user) };
  });

  // ── Send email notification (fire-and-forget) ──
  notifyRequestAsync({
    request: result.request,
    actorId: req.user.id,
    action: dbAction,
    comments: body.comments,
    rejectionReason: dbAction === 'REJECT' ? body.rejectionReason : null,
  });

  res.status(201).json(result);
});

requestsRouter.post('/:id/resubmit', async (req, res) => {
  const requestId = param(req, 'id');
  const body = z.object({ comments: note }).parse(req.body || {});

  // fn_resubmit_request refuses anyone but the requester, and refuses a
  // request that was not returned for correction.
  const detail = await withUser(req.user.id, async (db) => {
    const signature = seal({
      requestId, action: 'RESUBMIT', actorId: req.user.id, decisions: [], comments: body.comments,
    });
    const { rows } = await db.query(
      'SELECT fn_resubmit_request($1, $2, $3, $4) AS new_version',
      [requestId, req.user.id, body.comments || null, signature],
    );
    if (!rows[0]) throw notFound('Request not found or resubmission failed');
    return requireDetail(db, requestId, req.user);
  });

  notifyRequestAsync({ request: detail, actorId: req.user.id, action: 'RESUBMIT', comments: body.comments });

  res.json(detail);
});

requestsRouter.get('/:id/budget-context', async (req, res) => {
  const requestId = param(req, 'id');

  // No role list: the request lookup below runs under the caller's RLS, so
  // anyone who cannot see the request gets a 404 before any budget figure is
  // read, and the figures returned are only for that request's own department.
  const ctx = await withUser(req.user.id, async (db) => {
    const { rows: reqRows } = await db.query(
      'SELECT department_id, financial_year_id, budget_head_id FROM requests WHERE request_id = $1',
      [requestId],
    );
    if (!reqRows[0]) throw notFound('Request not found');
    const r = reqRows[0];
    if (!r.department_id) return null;
    const { rows } = await db.query(
      'SELECT * FROM fn_get_department_budget_context($1, $2, $3)',
      [r.department_id, r.financial_year_id, r.budget_head_id],
    );
    const b = rows[0];
    if (!b) return null;
    return {
      budgetProvisionId: b.budget_provision_id,
      allocatedAmount: Number(b.allocated_amount),
      utilizedAmount: Number(b.utilized_amount),
      committedAmount: Number(b.committed_amount),
      remainingAmount: Number(b.remaining_amount),
      availableAmount: Number(b.available_amount),
    };
  });

  res.json(ctx);
});

requestsRouter.get('/:id/timeline', async (req, res) => {
  const requestId = param(req, 'id');

  const rows = await withUser(req.user.id, async (db) => {
    const visible = await db.query('SELECT 1 FROM requests WHERE request_id = $1', [requestId]);
    if (!visible.rowCount) throw notFound('Request not found');
    return (await db.query(
      `SELECT t.*, a.performed_by, ds.signed_hash, ds.signed_at,
              COALESCE((SELECT json_agg(json_build_object(
                          'requestItemId', aai.request_item_id,
                          'approvedQuantity', aai.approved_quantity,
                          'approvedAmount', aai.approved_amount,
                          'decision', aai.item_decision))
                          FROM approval_action_items aai WHERE aai.action_id = t.action_id), '[]') AS decisions
         FROM v_request_timeline t
         JOIN approval_actions a ON a.action_id = t.action_id
         LEFT JOIN digital_signatures ds ON ds.signature_id = t.signature_id
        WHERE t.request_id = $1
        ORDER BY t.created_at, t.action_id`,
      [requestId],
    )).rows;
  });

  res.json(rows.map((r) => {
    let sealStatus = 'UNSEALED';
    if (r.signed_hash) {
      sealStatus = verifySeal(r.signed_hash, {
        requestId, action: r.action, actorId: r.performed_by,
        decisions: r.decisions, comments: r.comments, rejectionReason: r.rejection_reason,
      }) ? 'VERIFIED' : 'MISMATCH';
    }
    return {
      id: r.action_id,
      at: r.created_at,
      action: r.action,
      stage: r.stage_code ? { code: r.stage_code, name: r.stage_name } : null,
      by: {
        id: r.performed_by,
        name: r.performed_by_name,
        email: r.performed_by_email,
        employeeId: r.performed_by_employee_id,
      },
      role: r.role_id ? {
        id: r.role_id,
        code: r.role_code,
        name: r.role_name,
      } : null,
      previousStatus: r.previous_status,
      newStatus: r.new_status,
      amountRequested: r.amount_requested_snapshot,
      amountApproved: r.amount_approved,
      rejectionReason: r.rejection_reason,
      comments: r.comments,
      itemDecisions: r.decisions,
      // VERIFIED: the recorded decision is exactly what the API sealed.
      // MISMATCH: it has been altered since. UNSEALED: e.g. a submission.
      seal: sealStatus,
    };
  }));
});

requestsRouter.post('/:id/carry-forward', async (req, res) => {
  const requestId = param(req, 'id');
  const { financialYearId } = z.object({ financialYearId: intId }).parse(req.body);

  const detail = await withUser(req.user.id, async (db) => {
    const { rows } = await db.query('SELECT raised_by FROM requests WHERE request_id = $1', [requestId]);
    if (!rows[0]) throw notFound('Request not found');
    if (rows[0].raised_by !== req.user.id && !req.user.roles.includes('ADMIN')) {
      throw forbidden('Only the person who raised this request can carry it forward');
    }
    const created = await db.query(
      'SELECT fn_carry_forward_request($1, $2, $3) AS request_id',
      [requestId, financialYearId, req.user.id],
    );
    return requireDetail(db, created.rows[0].request_id, req.user);
  });

  res.status(201).location(`/api/requests/${detail.id}`).json(detail);
});
