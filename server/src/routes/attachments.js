import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { withUser } from '../db.js';
import { HttpError, conflict, forbidden, notFound } from '../errors.js';
import {
  ACCEPTED_TYPES, USE_DRIVE, absolutePath, calculateSha256, cleanFileName,
  detectType, removeFile, saveFile, streamFromDrive,
} from '../storage.js';
import { param } from '../validate.js';

export const attachmentsRouter = Router();

// Held in memory only long enough to check the type; files are capped at
// MAX_UPLOAD_MB, so this is bounded.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 },
}).single('file');

const CLOSED_REQUEST = ['CLOSED', 'CARRIED_FORWARD'];
const CLOSED_ISSUE = ['RESOLVED', 'CLOSED'];

const attachmentRow = (r) => ({
  id: r.attachment_id,
  requestId: r.request_id,
  issueId: r.issue_id,
  budgetProvisionId: r.budget_provision_id ?? null,
  fileName: r.file_name,
  originalFileName: r.original_file_name ?? r.file_name,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  sha256: r.sha256_hash ?? null,
  versionNumber: r.version_number ?? 1,
  supersededById: r.superseded_by_id ?? null,
  requestVersionNumber: r.request_version_number ?? 1,
  replacementReason: r.replacement_reason ?? null,
  archivedAt: r.archived_at ?? null,
  archivedReason: r.archived_reason ?? null,
  uploadedBy: { id: r.uploaded_by, name: r.uploaded_by_name },
  uploadedAt: r.uploaded_at,
});

function acceptedFile(req) {
  if (!req.file) {
    throw new HttpError(400, 'Attach a file in the "file" field');
  }
  if (!req.file.buffer || req.file.buffer.length === 0) {
    throw new HttpError(400, 'Uploaded file is empty (0 bytes)');
  }
  if (req.file.size > config.maxUploadBytes || req.file.buffer.length > config.maxUploadBytes) {
    throw new HttpError(413, `File exceeds the maximum allowed size of ${config.maxUploadMb} MB`);
  }
  const type = detectType(req.file.buffer, req.file.mimetype, req.file.originalname);
  if (!type) {
    throw new HttpError(415, 'Only PDF, PNG, JPEG, Word (.docx) and Excel (.xlsx) files are accepted', {
      details: { accepted: ACCEPTED_TYPES },
    });
  }
  return type;
}

/**
 * Checks permission, writes the file, then records it — in that order, so a
 * refused upload never touches the disk. If recording fails after the write,
 * the file is removed, so nothing is left orphaned.
 */
async function store(req, parent, authorise) {
  const type = acceptedFile(req);
  let savedFile;
  try {
    return await withUser(req.user.id, async (db) => {
      const authResult = await authorise(db);
      savedFile = await saveFile(req.file.buffer, type.ext);
      const reqVersion = authResult?.currentVersionNumber ?? 1;
      const sha256 = calculateSha256(req.file.buffer);
      const originalName = req.file.originalname || 'file';
      const cleanName = cleanFileName(originalName);

      const { rows } = await db.query(
        `INSERT INTO attachments (request_id, issue_id, budget_provision_id, file_name, original_file_name,
                                  mime_type, size_bytes, sha256_hash, storage_path, storage_backend, uploaded_by, request_version_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING attachment_id`,
        [parent.requestId ?? null, parent.issueId ?? null, parent.budgetProvisionId ?? null,
          cleanName, originalName,
          type.mime, req.file.size, sha256, savedFile.storagePath, savedFile.backend, req.user.id, reqVersion],
      );
      return (await db.query(
        `SELECT a.*, u.full_name AS uploaded_by_name FROM attachments a
           JOIN users u ON u.user_id = a.uploaded_by WHERE a.attachment_id = $1`,
        [rows[0].attachment_id],
      )).rows[0];
    });
  } catch (err) {
    if (savedFile?.storagePath) await removeFile(savedFile.storagePath, savedFile.backend);
    throw err;
  }
}

attachmentsRouter.get('/requests/:id/attachments', async (req, res) => {
  const requestId = param(req, 'id');
  const includeArchived = req.query.includeArchived === 'true' && req.user.roles.includes('ADMIN');

  const rows = await withUser(req.user.id, async (db) => {
    const { rows: reqRows } = await db.query(
      'SELECT request_id FROM requests WHERE request_id = $1',
      [requestId],
    );
    if (!reqRows[0]) throw notFound('Request not found');

    const query = includeArchived
      ? `SELECT a.*, u.full_name AS uploaded_by_name
           FROM attachments a JOIN users u ON u.user_id = a.uploaded_by
          WHERE a.request_id = $1 ORDER BY a.version_number ASC, a.uploaded_at ASC`
      : `SELECT a.*, u.full_name AS uploaded_by_name
           FROM attachments a JOIN users u ON u.user_id = a.uploaded_by
          WHERE a.request_id = $1
            AND (a.archived_at IS NULL OR NOT EXISTS (
                   SELECT 1 FROM information_schema.columns WHERE table_name = 'attachments' AND column_name = 'archived_at'
                 ))
          ORDER BY a.version_number ASC, a.uploaded_at ASC`;

    return (await db.query(query, [requestId])).rows;
  });
  res.json(rows.map(attachmentRow));
});

attachmentsRouter.post('/requests/:id/attachments', upload, async (req, res) => {
  const requestId = param(req, 'id');
  const row = await store(req, { requestId }, async (db) => {
    const { rows } = await db.query(
      `SELECT r.raised_by, r.current_status, r.current_version_number,
              EXISTS (SELECT 1 FROM stage_approvers sa
                       WHERE sa.stage_id = r.current_stage_id AND sa.user_id = $2) AS staffed_here
         FROM requests r WHERE r.request_id = $1`,
      [requestId, req.user.id],
    );
    const r = rows[0];
    if (!r) throw notFound('Request not found');
    if (CLOSED_REQUEST.includes(r.current_status)) throw conflict('This request is closed');
    if (r.raised_by !== req.user.id && !r.staffed_here && !req.user.roles.includes('ADMIN')) {
      throw forbidden('Only the requester or an approver at the current stage can attach files');
    }
    return { currentVersionNumber: r.current_version_number || 1 };
  });
  res.status(201).json(attachmentRow(row));
});

attachmentsRouter.post('/attachments/:id/supersede', upload, async (req, res) => {
  const oldAttachmentId = param(req, 'id');
  const replacementReason = req.body?.reason || null;
  const type = acceptedFile(req);

  let savedFile;
  try {
    const row = await withUser(req.user.id, async (db) => {
      // Pre-authorization check and lock old attachment row before saving file to storage
      const { rows: oldRows } = await db.query(
        `SELECT a.*, r.current_status, r.current_stage_id, r.raised_by,
                EXISTS (SELECT 1 FROM stage_approvers sa
                         WHERE sa.stage_id = r.current_stage_id AND sa.user_id = $2) AS staffed_here
           FROM attachments a
           LEFT JOIN requests r ON r.request_id = a.request_id
          WHERE a.attachment_id = $1
            FOR UPDATE OF a`,
        [oldAttachmentId, req.user.id],
      );
      const oldDoc = oldRows[0];
      if (!oldDoc) throw notFound('Attachment not found');
      if (oldDoc.superseded_by_id) {
        throw conflict('This document has already been superseded');
      }
      if (oldDoc.archived_at) {
        throw conflict('This document is archived and cannot be superseded');
      }
      if (oldDoc.request_id) {
        if (CLOSED_REQUEST.includes(oldDoc.current_status)) {
          throw conflict('Request is closed; its documents cannot be replaced');
        }
        if (oldDoc.raised_by !== req.user.id && !oldDoc.staffed_here && !req.user.roles.includes('ADMIN')) {
          throw forbidden('Only the requester or an approver at the current stage can replace files');
        }
      }

      savedFile = await saveFile(req.file.buffer, type.ext);
      const sha256 = calculateSha256(req.file.buffer);
      const originalName = req.file.originalname || 'file';
      const cleanName = cleanFileName(originalName);

      const { rows } = await db.query(
        'SELECT fn_supersede_attachment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) AS new_id',
        [
          oldAttachmentId, cleanName, type.mime,
          req.file.size, savedFile.storagePath, savedFile.backend,
          req.user.id, replacementReason, originalName, sha256,
        ],
      );
      const newId = rows[0].new_id;
      return (await db.query(
        `SELECT a.*, u.full_name AS uploaded_by_name FROM attachments a
           JOIN users u ON u.user_id = a.uploaded_by WHERE a.attachment_id = $1`,
        [newId],
      )).rows[0];
    });
    res.status(201).json(attachmentRow(row));
  } catch (err) {
    if (savedFile?.storagePath) await removeFile(savedFile.storagePath, savedFile.backend);
    throw err;
  }
});

// Auditable soft-removal / archival mechanism
attachmentsRouter.post('/attachments/:id/archive', async (req, res) => {
  const attachmentId = param(req, 'id');
  const reason = (req.body?.reason || '').trim();
  if (!reason) {
    throw new HttpError(400, 'A reason is required to archive an evidentiary document');
  }
  const userRole = req.user.roles[0] || 'USER';

  const updated = await withUser(req.user.id, async (db) => {
    const { rows } = await db.query(
      `SELECT a.*, r.current_status, r.current_stage_id, r.raised_by,
              EXISTS (SELECT 1 FROM stage_approvers sa
                       WHERE sa.stage_id = r.current_stage_id AND sa.user_id = $2) AS staffed_here
         FROM attachments a
         LEFT JOIN requests r ON r.request_id = a.request_id
        WHERE a.attachment_id = $1
          FOR UPDATE OF a`,
      [attachmentId, req.user.id],
    );
    const a = rows[0];
    if (!a) throw notFound('Attachment not found');
    if (a.archived_at) throw conflict('Attachment has already been archived');

    const isAdmin = req.user.roles.includes('ADMIN');
    const isRaiser = a.raised_by === req.user.id;
    const isUploader = a.uploaded_by === req.user.id;
    const isStaffed = a.staffed_here;
    if (!isAdmin && !isRaiser && !isUploader && !isStaffed) {
      throw forbidden('You do not have permission to archive this document');
    }

    await db.query(
      `UPDATE attachments
          SET archived_at = NOW(),
              archived_by = $2,
              archived_by_role = $3,
              archived_reason = $4
        WHERE attachment_id = $1`,
      [attachmentId, req.user.id, userRole, reason],
    );

    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
       VALUES ('attachment', $1, $2, 'ARCHIVE_ATTACHMENT',
               jsonb_build_object('attachment_id', $1::text, 'file_name', $3::text, 'version_number', $4::int),
               jsonb_build_object('archived_at', NOW(), 'archived_by', $2::text, 'archived_by_role', $5::text, 'archived_reason', $6::text))`,
      [attachmentId, req.user.id, a.file_name, a.version_number, userRole, reason],
    );

    return (await db.query(
      `SELECT a.*, u.full_name AS uploaded_by_name FROM attachments a
         JOIN users u ON u.user_id = a.uploaded_by WHERE a.attachment_id = $1`,
      [attachmentId],
    )).rows[0];
  });

  res.status(200).json(attachmentRow(updated));
});

// The sanction letter behind a department's annual provision. Only the head of
// that department (or an administrator) may attach one; the RLS insert policy
// says the same, and is what stops a head reaching into another department.
attachmentsRouter.post('/budget-provisions/:id/attachments', upload, async (req, res) => {
  const budgetProvisionId = param(req, 'id');
  const row = await store(req, { budgetProvisionId }, async (db) => {
    const { rows } = await db.query(
      `SELECT bp.department_id = (SELECT department_id FROM users WHERE user_id = $2) AS own_department
         FROM budget_provisions bp WHERE bp.budget_provision_id = $1`,
      [budgetProvisionId, req.user.id],
    );
    if (!rows[0]) throw notFound('Budget provision not found');
    const isAdmin = req.user.roles.includes('ADMIN');
    if (!isAdmin && !(req.user.roles.includes('HEAD') && rows[0].own_department)) {
      throw forbidden('Only the head of this department can attach its budget documents');
    }
  });
  res.status(201).json(attachmentRow(row));
});

attachmentsRouter.post('/issues/:id/attachments', upload, async (req, res) => {
  const issueId = param(req, 'id');
  const row = await store(req, { issueId }, async (db) => {
    const { rows } = await db.query('SELECT status FROM issues WHERE issue_id = $1', [issueId]);
    if (!rows[0]) throw notFound('Issue not found');
    if (CLOSED_ISSUE.includes(rows[0].status)) throw conflict('This issue is closed');
  });
  res.status(201).json(attachmentRow(row));
});

// Downloads go through the API, never a static folder: the visibility check
// below is the only thing standing between a URL and the file.
attachmentsRouter.get('/attachments/:id', async (req, res) => {
  const attachmentId = param(req, 'id');
  const row = await withUser(req.user.id, async (db) =>
    (await db.query(
      `SELECT file_name, mime_type, storage_path, storage_backend,
              (CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attachments' AND column_name = 'archived_at')
                    THEN archived_at ELSE NULL END) AS archived_at
         FROM attachments WHERE attachment_id = $1`,
      [attachmentId],
    )).rows[0]);
  if (!row || row.archived_at) throw notFound('Attachment not found');

  const isDrive = row.storage_backend === 'drive' || (USE_DRIVE && !row.storage_path.includes('/'));
  if (isDrive) {
    // Stream from Google Drive through the API server so the download stays
    // authenticated — the Drive file is private to the service account.
    try {
      await streamFromDrive(row.storage_path, res, row.file_name, row.mime_type);
    } catch (err) {
      if (!res.headersSent) {
        const code = (err.code === 404 || err.status === 404) ? 410 : 500;
        res.status(code).json({ error: { code: 'FILE_UNAVAILABLE', message: 'The stored file is missing' } });
      }
    }
  } else {
    // Local disk — use Express's built-in streaming download.
    res.type(row.mime_type);
    res.download(absolutePath(row.storage_path), row.file_name, (err) => {
      if (err && !res.headersSent) {
        res.status(err.code === 'ENOENT' ? 410 : 500)
          .json({ error: { code: 'FILE_UNAVAILABLE', message: 'The stored file is missing' } });
      }
    });
  }
});

// Removing evidence from a decided request would weaken the record, so files
// can only be removed while their request is still a draft, or their issue
// still open. Historical document versions cannot be hard deleted.
attachmentsRouter.delete('/attachments/:id', async (req, res) => {
  const attachmentId = param(req, 'id');
  const fileInfo = await withUser(req.user.id, async (db) => {
    const { rows } = await db.query(
      `SELECT a.storage_path, a.storage_backend, a.uploaded_by, a.budget_provision_id, a.action_id,
              a.version_number, a.superseded_by_id, a.file_name, a.request_id,
              r.current_status AS request_status, i.status AS issue_status
         FROM attachments a
         LEFT JOIN requests r ON r.request_id = a.request_id
         LEFT JOIN issues   i ON i.issue_id   = a.issue_id
        WHERE a.attachment_id = $1`,
      [attachmentId],
    );
    const a = rows[0];
    if (!a) throw notFound('Attachment not found');
    if (a.uploaded_by !== req.user.id && !req.user.roles.includes('ADMIN')) {
      throw forbidden('Only the person who uploaded a file can remove it');
    }
    if ((a.request_status && a.request_status !== 'DRAFT') || CLOSED_ISSUE.includes(a.issue_status)) {
      throw conflict('Files on a submitted request or a closed issue are part of the record');
    }
    if (a.action_id) {
      throw conflict('Approval action evidence documents are part of the permanent audit record and cannot be deleted');
    }
    if (a.budget_provision_id) {
      throw conflict('Sanction documents on a budget provision are part of the official financial record and cannot be deleted');
    }
    if (a.version_number > 1 || a.superseded_by_id !== null) {
      throw conflict('Historical document versions cannot be permanently deleted; archive instead');
    }

    // Record audit entry for deletion
    await db.query(
      `INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
       VALUES ('attachment', $1, $2, 'DELETE_DRAFT_ATTACHMENT',
               jsonb_build_object('attachment_id', $1::text, 'file_name', $3::text, 'request_id', $4::text),
               jsonb_build_object('deleted_at', NOW(), 'deleted_by', $2::text))`,
      [attachmentId, req.user.id, a.file_name, a.request_id],
    );

    await db.query('DELETE FROM attachments WHERE attachment_id = $1', [attachmentId]);
    return { storagePath: a.storage_path, backend: a.storage_backend };
  });
  await removeFile(fileInfo.storagePath, fileInfo.backend);
  res.status(204).end();
});
