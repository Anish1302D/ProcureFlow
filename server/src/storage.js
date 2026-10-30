import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { config } from './config.js';

// ---------------------------------------------------------------------------
// Type detection — unchanged from original. Based on file magic bytes so
// the browser's declared MIME type or extension cannot be spoofed.
// ---------------------------------------------------------------------------

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const TYPES = {
  'application/pdf': { ext: '.pdf', magic: Buffer.from('%PDF-') },
  'image/png':  { ext: '.png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  'image/jpeg': { ext: '.jpg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
  [DOCX_MIME]: { ext: '.docx', magic: ZIP },
  [XLSX_MIME]: { ext: '.xlsx', magic: ZIP },
};

export const ACCEPTED_TYPES = Object.keys(TYPES);

/**
 * Inspects a ZIP container buffer to find distinguishing OOXML paths.
 * DOCX contains 'word/document.xml', XLSX contains 'xl/workbook.xml'.
 */
export function inspectZipContainer(buffer) {
  if (!buffer || buffer.length < 4 || !buffer.subarray(0, 4).equals(ZIP)) {
    return null;
  }
  let foundWord = false;
  let foundXl = false;

  // Scan Central Directory entries (signature 0x50 0x4b 0x01 0x02)
  for (let i = 0; i <= buffer.length - 46; i++) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x01 &&
      buffer[i + 3] === 0x02
    ) {
      const fileNameLen = buffer.readUInt16LE(i + 28);
      if (i + 46 + fileNameLen <= buffer.length) {
        const name = buffer.toString('utf8', i + 46, i + 46 + fileNameLen);
        if (name === 'word/document.xml' || name.startsWith('word/')) foundWord = true;
        if (name === 'xl/workbook.xml' || name.startsWith('xl/')) foundXl = true;
      }
    }
  }

  // Scan Local File Headers (signature 0x50 0x4b 0x03 0x04) if CD entries inconclusive
  if (!foundWord && !foundXl) {
    for (let i = 0; i <= buffer.length - 30; i++) {
      if (
        buffer[i] === 0x50 &&
        buffer[i + 1] === 0x4b &&
        buffer[i + 2] === 0x03 &&
        buffer[i + 3] === 0x04
      ) {
        const fileNameLen = buffer.readUInt16LE(i + 26);
        if (i + 30 + fileNameLen <= buffer.length) {
          const name = buffer.toString('utf8', i + 30, i + 30 + fileNameLen);
          if (name === 'word/document.xml' || name.startsWith('word/')) foundWord = true;
          if (name === 'xl/workbook.xml' || name.startsWith('xl/')) foundXl = true;
        }
      }
    }
  }

  // Raw string search fallback
  if (!foundWord && !foundXl) {
    if (buffer.includes('word/document.xml')) foundWord = true;
    if (buffer.includes('xl/workbook.xml')) foundXl = true;
  }

  if (foundWord && !foundXl) return 'docx';
  if (foundXl && !foundWord) return 'xlsx';
  return null;
}

/**
 * Returns the accepted type that matches the bytes, or null.
 *
 * Secondary sniff: if the declared MIME type is ambiguous or generic
 * (e.g. application/octet-stream), inspect ZIP containers or magic bytes.
 */
export function detectType(buffer, declaredMime, _fileName) {
  if (!buffer || buffer.length === 0) return null;

  // ZIP container handling (DOCX and XLSX share ZIP magic bytes)
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(ZIP)) {
    const zipType = inspectZipContainer(buffer);
    if (zipType === 'docx') return { mime: DOCX_MIME, ext: '.docx' };
    if (zipType === 'xlsx') return { mime: XLSX_MIME, ext: '.xlsx' };
    return null;
  }

  // Fast path — declared non-ZIP MIME matches signature.
  const declared = TYPES[declaredMime];
  if (declared && !declared.magic.equals(ZIP)) {
    const head = buffer.subarray(0, declared.magic.length);
    if (head.equals(declared.magic)) return { mime: declaredMime, ext: declared.ext };
  }

  // Slow path — sniff non-ZIP magic bytes.
  for (const [mime, type] of Object.entries(TYPES)) {
    if (type.magic.equals(ZIP)) continue;
    const head = buffer.subarray(0, type.magic.length);
    if (head.equals(type.magic)) return { mime, ext: type.ext };
  }

  return null;
}

/**
 * A display name safe to store and echo back in a download header: path
 * components stripped, control characters, quotes and slashes replaced.
 */
export function cleanFileName(name) {
  const base = path
    .basename(String(name ?? 'file'))
    .replace(/[\p{Cc}"\\/]/gu, '_');
  return base.slice(0, 200) || 'file';
}

// ---------------------------------------------------------------------------
// Storage backend — Google Drive when credentials are present, local disk
// otherwise (local development without a service account).
// ---------------------------------------------------------------------------

const USE_DRIVE = Boolean(config.gDriveCredentials && config.gDriveFolderId);

// ---------------------------------------------------------------------------
// Google Drive backend
// ---------------------------------------------------------------------------

function makeDriveClient() {
  let credentials;
  try {
    credentials = JSON.parse(
      Buffer.from(config.gDriveCredentials, 'base64').toString('utf8'),
    );
  } catch {
    throw new Error(
      'GDRIVE_CREDENTIALS is not valid base64-encoded JSON. ' +
      'See docs/GOOGLE_DRIVE_SETUP.md for how to generate it.',
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

// Lazily initialised — only created when the first file is uploaded so startup
// does not fail if the credentials are temporarily unavailable.
let _drive = null;
function drive() {
  if (!_drive) _drive = makeDriveClient();
  return _drive;
}

/**
 * Uploads the buffer to Google Drive inside the configured folder.
 * Returns the Drive file ID, which is stored as `storage_path` in the DB.
 */
async function driveUpload(buffer, ext) {
  const name = `${crypto.randomUUID()}${ext}`;
  const res = await drive().files.create({
    requestBody: {
      name,
      parents: [config.gDriveFolderId],
    },
    media: {
      mimeType: 'application/octet-stream',
      body: Readable.from(buffer),
    },
    fields: 'id',
  });
  return res.data.id; // stored as storage_path
}

/**
 * Streams the Drive file directly into an Express response.
 * Called by the download route in attachments.js.
 */
export async function streamFromDrive(fileId, expressRes, fileName, mimeType) {
  const res = await drive().files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' },
  );
  expressRes.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  expressRes.setHeader('Content-Type', mimeType);
  await new Promise((resolve, reject) => {
    res.data.pipe(expressRes);
    res.data.on('end', resolve);
    res.data.on('error', reject);
  });
}

async function driveDelete(fileId) {
  try {
    await drive().files.delete({ fileId });
  } catch (err) {
    // 404 means it was already deleted — not an error for us.
    if (err.code !== 404 && err.status !== 404) {
      console.error(`[storage] Drive delete failed for ${fileId}:`, err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Local disk backend (unchanged from original — used in local development)
// ---------------------------------------------------------------------------

function resolveInside(storagePath) {
  const full = path.resolve(config.uploadDir, storagePath);
  if (!full.startsWith(config.uploadDir + path.sep)) {
    throw new Error(`storage path escapes the upload directory: ${storagePath}`);
  }
  return full;
}

async function diskUpload(buffer, ext) {
  const now = new Date();
  const dir = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const storagePath = `${dir}/${crypto.randomUUID()}${ext}`;
  const full = resolveInside(storagePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer, { flag: 'wx' });
  return storagePath;
}

// ---------------------------------------------------------------------------
// Public API — same shape as before so no other file needs changing except
// the download route (which now calls streamFromDrive when Drive is active).
// ---------------------------------------------------------------------------

/** Writes the bytes to the configured backend; returns storage_path and storage_backend. */
export async function saveFile(buffer, ext) {
  const backend = USE_DRIVE ? 'drive' : 'local';
  const storagePath = USE_DRIVE ? await driveUpload(buffer, ext) : await diskUpload(buffer, ext);
  return { storagePath, backend };
}

/**
 * Returns the absolute filesystem path for local storage paths.
 */
export function absolutePath(storagePath) {
  return resolveInside(storagePath);
}

/** Best-effort removal supporting both drive and local backends with path fallback. */
export async function removeFile(storagePath, backend) {
  const isDrive = backend ? backend === 'drive' : (USE_DRIVE && !storagePath.includes('/'));
  if (isDrive) {
    await driveDelete(storagePath);
  } else {
    try {
      await fs.unlink(resolveInside(storagePath));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error(`[storage] could not remove ${storagePath}:`, err.message);
      }
    }
  }
}

/** True when the Google Drive backend is active. Checked by the download route. */
export { USE_DRIVE };
