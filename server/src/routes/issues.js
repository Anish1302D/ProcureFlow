import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { pool, queryAll, withUser } from '../db.js';
import { buildIssueCreatedEmail } from '../emailTemplates.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { sendMail } from '../mailer.js';
import { ISSUE_MANAGER_ROLES, hasAnyRole } from '../roles.js';
import { flag, pagination, param } from '../validate.js';

// Non-financial issues: deliberately lightweight (requirements §3.2) — free
// text, no mandatory categories, a short status trail.
export const issuesRouter = Router();

const STATUSES = ['SUBMITTED', 'IN_REVIEW', 'RESOLVED', 'CLOSED'];

// Where an issue may go next. RESOLVED can reopen to IN_REVIEW; CLOSED is final.
const NEXT = {
  SUBMITTED: ['IN_REVIEW', 'RESOLVED', 'CLOSED'],
  IN_REVIEW: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_REVIEW', 'CLOSED'],
  CLOSED: [],
};

const SELECT_ISSUE = `
  SELECT i.*, rb.full_name AS raised_by_name, count(*) OVER () AS total_count
    FROM issues i
    JOIN users rb ON rb.user_id = i.raised_by`;

const person = (userId, name) => (userId ? { id: userId, name } : null);

const issueRow = (r) => ({
  id: r.issue_id,
  issueNumber: r.issue_number,
  title: r.title,
  description: r.description,
  status: r.status,
  raisedBy: person(r.raised_by, r.raised_by_name),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  resolvedAt: r.resolved_at,
});

function permissions(issue, user) {
  const isPrincipal = hasAnyRole(user, ISSUE_MANAGER_ROLES);
  const raiser = issue.raised_by === user.id;
  const next = NEXT[issue.status] ?? [];
  const allowed = new Set();
  if (isPrincipal) next.forEach((s) => allowed.add(s));
  if (raiser && issue.status === 'RESOLVED') allowed.add('CLOSED');
  return {
    canComment: issue.status !== 'CLOSED',
    statusesAllowed: [...allowed],
  };
}

async function loadIssue(db, issueId) {
  const { rows } = await db.query(`${SELECT_ISSUE} WHERE i.issue_id = $1`, [issueId]);
  return rows[0] ?? null;
}

async function detail(db, issueId, user) {
  const issue = await loadIssue(db, issueId);
  if (!issue) throw notFound('Issue not found');
  const [events, attachments] = await queryAll(db, [
    [`SELECT e.*, u.full_name AS actor_name FROM issue_events e
        JOIN users u ON u.user_id = e.actor_user_id
       WHERE e.issue_id = $1 ORDER BY e.created_at, e.event_id`, [issueId]],
    [`SELECT a.attachment_id, a.file_name, a.mime_type, a.size_bytes, a.uploaded_at,
             a.uploaded_by, u.full_name AS uploaded_by_name
        FROM attachments a JOIN users u ON u.user_id = a.uploaded_by
       WHERE a.issue_id = $1 ORDER BY a.uploaded_at`, [issueId]],
  ]);
  return {
    ...issueRow(issue),
    events: events.rows.map((e) => ({
      id: e.event_id,
      action: e.action,
      note: e.note,
      by: { id: e.actor_user_id, name: e.actor_name },
      at: e.created_at,
    })),
    attachments: attachments.rows.map((a) => ({
      id: a.attachment_id,
      fileName: a.file_name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      uploadedBy: { id: a.uploaded_by, name: a.uploaded_by_name },
      uploadedAt: a.uploaded_at,
    })),
    permissions: permissions(issue, user),
  };
}

// clock_timestamp(), not the column's NOW() default: NOW() is fixed for the
// whole transaction, so two events recorded in one update (assigned, then
// moved to review) would tie, and the history would list them in random order.
const addEvent = (db, issueId, userId, action, note = null) =>
  db.query(
    `INSERT INTO issue_events (issue_id, actor_user_id, action, note, created_at)
     VALUES ($1, $2, $3, $4, clock_timestamp())`,
    [issueId, userId, action, note],
  );

const listQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((value) => (value ? value.split(',').map((s) => s.trim().toUpperCase()) : null))
    .pipe(z.array(z.enum(STATUSES)).nullable()),
  mine: flag,
  ...pagination,
});

issuesRouter.get('/', async (req, res) => {
  const f = listQuery.parse(req.query);
  const rows = await withUser(req.user.id, async (db) => (await db.query(
    `${SELECT_ISSUE}
      WHERE ($1::issue_status[] IS NULL OR i.status = ANY($1))
        AND (NOT $2 OR i.raised_by = $3)
      ORDER BY i.updated_at DESC, i.issue_id
      LIMIT $4 OFFSET $5`,
    [f.status, f.mine ?? false, req.user.id, f.limit, f.offset],
  )).rows);
  res.json({ items: rows.map(issueRow), total: rows[0]?.total_count ?? 0, limit: f.limit, offset: f.offset });
});

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(5000),
});

// Non-admin campus members may raise an issue; administrators monitor and manage.
issuesRouter.post('/', async (req, res) => {
  if (req.user.roles.includes('ADMIN')) {
    throw forbidden('Administrators cannot create or log issues');
  }
  const body = createSchema.parse(req.body);
  const result = await withUser(req.user.id, async (db) => {
    const { rows } = await db.query(
      'INSERT INTO issues (raised_by, title, description) VALUES ($1, $2, $3) RETURNING issue_id',
      [req.user.id, body.title, body.description],
    );
    await addEvent(db, rows[0].issue_id, req.user.id, 'CREATED');
    return detail(db, rows[0].issue_id, req.user);
  });

  // ── Send email notification to the Principal (fire-and-forget) ──
  // Lookup is outside the transaction — a mail failure must never roll back
  // the issue itself.
  (async () => {
    try {
      const { rows: raiserRows } = await pool.query(
        'SELECT full_name, email FROM users WHERE user_id = $1',
        [req.user.id],
      );
      const raiser = raiserRows[0];
      if (!raiser) {
        console.warn('[issues] Could not find raiser user', req.user.id, '— skipping email');
        return;
      }

      // Resolve the principal: check config first, then look up from user_roles
      let principalEmail = config.principalEmail;
      let principalName = 'Principal';

      try {
        const { rows: principalRows } = await pool.query(
          `SELECT u.full_name, u.email FROM users u
             LEFT JOIN user_roles ur ON ur.user_id = u.user_id
             LEFT JOIN roles r ON r.role_id = ur.role_id
             LEFT JOIN stage_approvers sa ON sa.user_id = u.user_id
             LEFT JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
            WHERE (r.code = 'PRINCIPAL' OR ws.code::text = 'PRINCIPAL') AND u.is_active
            ORDER BY sa.stage_id NULLS LAST
            LIMIT 1`,
        );
        if (principalRows.length > 0) {
          principalName = principalRows[0].full_name;
          principalEmail = principalRows[0].email || config.principalEmail;
        }
      } catch (dbErr) {
        console.warn('[issues] Principal lookup failed, using config fallback:', dbErr.message);
      }

      const emailData = buildIssueCreatedEmail({
        issue: result,
        raiser: { fullName: raiser.full_name, email: raiser.email },
        principalEmail,
        principalName,
      });

      await sendMail(emailData);
    } catch (err) {
      console.error('[issues] Failed to send issue-created email:', err.message);
    }
  })();

  res.status(201).location(`/api/issues/${result.id}`).json(result);
});

issuesRouter.get('/:id', async (req, res) => {
  const issueId = param(req, 'id');
  res.json(await withUser(req.user.id, (db) => detail(db, issueId, req.user)));
});

const updateSchema = z.object({
  status: z.enum(STATUSES),
  note: z.string().trim().max(2000).optional(),
});

issuesRouter.patch('/:id', async (req, res) => {
  const issueId = param(req, 'id');
  const body = updateSchema.parse(req.body);

  const result = await withUser(req.user.id, async (db) => {
    const issue = await loadIssue(db, issueId);
    if (!issue) throw notFound('Issue not found');
    await db.query('SELECT 1 FROM issues WHERE issue_id = $1 FOR UPDATE', [issueId]);

    if (issue.status === 'CLOSED') throw conflict('This issue is closed');

    const perms = permissions(issue, req.user);
    const { status } = body;

    if (status !== issue.status) {
      if (!(NEXT[issue.status] ?? []).includes(status)) {
        throw conflict(`An issue cannot move from ${issue.status} to ${status}`);
      }
      if (!perms.statusesAllowed.includes(status)) {
        throw forbidden('You cannot set this issue to that status');
      }
    }

    await db.query(
      `UPDATE issues
          SET status      = $2::issue_status,
              resolved_at = CASE WHEN $2::issue_status = 'RESOLVED'  THEN NOW()
                                 WHEN $2::issue_status = 'IN_REVIEW' THEN NULL
                                 ELSE resolved_at END
        WHERE issue_id = $1`,
      [issueId, status],
    );

    if (status !== issue.status) {
      await addEvent(db, issueId, req.user.id, status, body.note);
    }
    return detail(db, issueId, req.user);
  });

  res.json(result);
});

issuesRouter.post('/:id/events', async (req, res) => {
  const issueId = param(req, 'id');
  const { note } = z.object({ note: z.string().trim().min(1).max(2000) }).parse(req.body);
  const result = await withUser(req.user.id, async (db) => {
    const issue = await loadIssue(db, issueId);
    if (!issue) throw notFound('Issue not found');
    if (issue.status === 'CLOSED') throw conflict('This issue is closed');
    await addEvent(db, issueId, req.user.id, 'COMMENT', note);
    return detail(db, issueId, req.user);
  });
  res.status(201).json(result);
});
