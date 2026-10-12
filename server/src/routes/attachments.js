import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { withUser } from '../db.js';
import { HttpError, conflict, forbidden, notFound } from '../errors.js';
import {
  ACCEPTED_TYPES, USE_DRIVE, absolutePath, cleanFileName,
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
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  versionNumber: r.version_number ?? 1,
  supersededById: r.superseded_by_id ?? null,
  requestVersionNumber: r.request_version_number ?? 1,
  replacementReason: r.replacement_reason ?? null,
  uploadedBy: { id: r.uploaded_by, name: r.uploaded_by_name },
  uploadedAt: r.uploaded_at,
});

function acceptedFile(req) {
  if (!req.file) {
    throw new HttpError(400, 'Attach a file in the "file" field');
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
      await authorise(db);
      savedFile = await saveFile(req.file.buffer, type.ext);
      const { rows } = await db.query(
        `INSERT INTO attachments (request_id, issue_id, budget_provision_id, file_name, mime_type, size_bytes,
                                  storage_path, storage_backend, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING attachment_id`,
        [parent.requestId ?? null, parent.issueId ?? null, parent.budgetProvisionId ?? null,
          cleanFileName(req.file.originalname),
          type.mime, req.file.size, savedFile.storagePath, savedFile.backend, req.user.id],
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
  const rows = await withUser(req.user.id, async (db) =>
    (await db.query(
      `SELECT a.*, u.full_name AS uploaded_by_name
         FROM attachments a JOIN users u ON u.user_id = a.uploaded_by
        WHERE a.request_id = $1 ORDER BY a.version_number ASC, a.uploaded_at ASC`,
      [requestId],
    )).rows);
  res.json(rows.map(attachmentRow));
});

attachmentsRouter.post('/requests/:id/attachments', upload, async (req, res) => {
  const requestId = param(req, 'id');
  const row = await store(req, { requestId }, async (db) => {
    const { rows } = await db.query(
      `SELECT r.raised_by, r.current_status,
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
      savedFile = await saveFile(req.file.buffer, type.ext);
      const { rows } = await db.query(
        'SELECT fn_supersede_attachment($1, $2, $3, $4, $5, $6, $7, $8) AS new_id',
        [
          oldAttachmentId, cleanFileName(req.file.originalname), type.mime,
          req.file.size, savedFile.storagePath, savedFile.backend,
          req.user.id, replacementReason,
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
      'SELECT file_name, mime_type, storage_path, storage_backend FROM attachments WHERE attachment_id = $1',
      [attachmentId],
    )).rows[0]);
  if (!row) throw notFound('Attachment not found');

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
// still open.
attachmentsRouter.delete('/attachments/:id', async (req, res) => {
  const attachmentId = param(req, 'id');
  const fileInfo = await withUser(req.user.id, async (db) => {
    const { rows } = await db.query(
      `SELECT a.storage_path, a.storage_backend, a.uploaded_by, r.current_status AS request_status, i.status AS issue_status
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
    await db.query('DELETE FROM attachments WHERE attachment_id = $1', [attachmentId]);
    return { storagePath: a.storage_path, backend: a.storage_backend };
  });
  await removeFile(fileInfo.storagePath, fileInfo.backend);
  res.status(204).end();
});
