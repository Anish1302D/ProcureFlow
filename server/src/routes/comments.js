import { Router } from 'express';
import { z } from 'zod';
import { withUser } from '../db.js';
import { notFound, unprocessable } from '../errors.js';
import { id, param } from '../validate.js';

// Mounted at /api/requests/:id/comments. Which comments each person sees —
// ALL, UP_CHAIN, STAGE_ONLY — is decided entirely by the database policy;
// this route never filters by visibility itself.
export const commentsRouter = Router({ mergeParams: true });

const commentRow = (r) => ({
  id: r.comment_id,
  parentId: r.parent_comment_id,
  body: r.body,
  visibility: r.visibility,
  author: { id: r.author_user_id, name: r.author_name },
  stage: r.stage_code ? { code: r.stage_code, name: r.stage_name } : null,
  createdAt: r.created_at,
});

const SELECT_COMMENTS = `
  SELECT c.*, u.full_name AS author_name, ws.code AS stage_code, ws.name AS stage_name
    FROM comments c
    JOIN users u ON u.user_id = c.author_user_id
    LEFT JOIN workflow_stages ws ON ws.stage_id = c.stage_id`;

async function requireVisible(db, requestId) {
  const { rowCount } = await db.query('SELECT 1 FROM requests WHERE request_id = $1', [requestId]);
  if (!rowCount) throw notFound('Request not found');
}

commentsRouter.get('/', async (req, res) => {
  const requestId = param(req, 'id');
  const rows = await withUser(req.user.id, async (db) => {
    await requireVisible(db, requestId);
    return (await db.query(`${SELECT_COMMENTS} WHERE c.request_id = $1 ORDER BY c.created_at, c.comment_id`,
      [requestId])).rows;
  });
  res.json(rows.map(commentRow));
});

const commentSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  visibility: z.enum(['ALL', 'UP_CHAIN', 'STAGE_ONLY']).default('ALL'),
  parentId: id.optional(),
});

commentsRouter.post('/', async (req, res) => {
  const requestId = param(req, 'id');
  const body = commentSchema.parse(req.body);

  const row = await withUser(req.user.id, async (db) => {
    await requireVisible(db, requestId);

    // The stage a comment speaks for: the highest stage the author is staffed
    // at among those this request is at or has passed through, falling back
    // to any stage they staff. Requesters have none.
    const { rows: stageRows } = await db.query(
      `SELECT sa.stage_id
         FROM stage_approvers sa
         JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
         JOIN requests r ON r.request_id = $2
        WHERE sa.user_id = $1
        ORDER BY (sa.stage_id = r.current_stage_id
                  OR EXISTS (SELECT 1 FROM approval_actions aa
                              WHERE aa.request_id = r.request_id AND aa.stage_id = sa.stage_id)) DESC,
                 ws.sequence_no DESC
        LIMIT 1`,
      [req.user.id, requestId],
    );
    const stageId = stageRows[0]?.stage_id ?? null;

    if (body.visibility !== 'ALL' && stageId === null) {
      throw unprocessable('Only approvers can post restricted comments');
    }

    if (body.parentId) {
      const parent = await db.query(
        'SELECT 1 FROM comments WHERE comment_id = $1 AND request_id = $2', [body.parentId, requestId]);
      if (!parent.rowCount) throw unprocessable('The comment being replied to is not on this request');
    }

    const { rows } = await db.query(
      `INSERT INTO comments (request_id, author_user_id, stage_id, parent_comment_id, body, visibility)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING comment_id`,
      [requestId, req.user.id, stageId, body.parentId ?? null, body.body, body.visibility],
    );
    return (await db.query(`${SELECT_COMMENTS} WHERE c.comment_id = $1`, [rows[0].comment_id])).rows[0];
  });

  res.status(201).json(commentRow(row));
});
