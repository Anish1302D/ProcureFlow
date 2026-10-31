/**
 * Document & Attachment Utilities for ProcureFlow.
 * Handles client-side validation, size formatting, and version supersession chain assembly.
 */

export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx';
export const ALLOWED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx'];
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Validates a file on the client before network upload.
 * Enforces non-empty files, 10MB limits, and approved extensions.
 */
export function validateUploadFile(file) {
  if (!file) return 'No file selected';
  if (file.size === 0) return 'The selected file is empty (0 bytes)';
  if (file.size > MAX_ATTACHMENT_BYTES) return 'File exceeds the 10 MB upload limit';
  const name = (file.name || '').toLowerCase();
  const validExt = ALLOWED_EXTS.some((ext) => name.endsWith(ext));
  if (!validExt) return 'Only PDF, PNG, JPEG, Word (.docx) and Excel (.xlsx) files are accepted';
  return null;
}

/**
 * Reconstructs the non-destructive supersession chain for attachments.
 * Earlier versions are placed into the `earlier` array of the current live document.
 */
export function withHistory(files = []) {
  const list = files || [];
  const replacedBy = new Map();
  for (const f of list) {
    if (f.supersededById) replacedBy.set(f.supersededById, f);
  }
  const roots = list.filter((f) => !f.supersededById);
  return roots.map((root) => {
    const earlier = [];
    let cur = root;
    while (replacedBy.has(cur.id)) {
      cur = replacedBy.get(cur.id);
      earlier.push(cur);
    }
    return { ...root, earlier };
  });
}

