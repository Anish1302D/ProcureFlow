import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { expectStatus, pdf, startApi } from './helpers.js';

let t;
const tok = {};
let requestId;

before(async () => {
  t = await startApi();
  tok.head = await t.login('head.cs@spcollege.edu');
  tok.incharge = await t.login('incharge@spcollege.edu');
  tok.principal = await t.login('principal@spcollege.edu');
  const heads = expectStatus(await t.api('GET', '/api/budget-heads', { token: tok.head }), 200);
  const lab = heads.find((h) => h.code === 'LAB').id;
  const items = expectStatus(await t.api('GET', `/api/budget-heads/${lab}/items`, { token: tok.head }), 200);
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.head,
    body: { title: 'Glassware renewal', budgetHeadId: lab,
            items: [{ budgetItemId: items[0].id, quantity: 20, unitCost: 450 }] },
  }), 201);
  requestId = draft.id;
});
after(() => t?.close());

let attachmentId;
let uploaded;

test('the requester attaches a quotation to a draft', async () => {
  const file = pdf('Vendor Quote (final).pdf', 2048);
  uploaded = file.bytes;
  const res = expectStatus(await t.api('POST', `/api/requests/${requestId}/attachments`,
    { token: tok.head, form: file.form }), 201);
  attachmentId = res.id;
  assert.equal(res.fileName, 'Vendor Quote (final).pdf');
  assert.equal(res.mimeType, 'application/pdf');
  assert.equal(res.sizeBytes, uploaded.length);
});

test('the file is stored under a generated name, never the uploaded one', async () => {
  const { rows } = await t.superuser.query(
    'SELECT storage_path FROM attachments WHERE attachment_id = $1', [attachmentId]);
  assert.match(rows[0].storage_path, /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
  const onDisk = await fs.readFile(path.join(process.env.UPLOAD_DIR, rows[0].storage_path));
  assert.ok(onDisk.equals(uploaded));
});

test('a path in the uploaded name is discarded', async () => {
  const res = expectStatus(await t.api('POST', `/api/requests/${requestId}/attachments`,
    { token: tok.head, form: pdf('../../../etc/passwd.pdf').form }), 201);
  assert.equal(res.fileName, 'passwd.pdf');
  expectStatus(await t.api('DELETE', `/api/attachments/${res.id}`, { token: tok.head }), 204);
});

test('content is checked, not the name or the declared type', async () => {
  const form = new FormData();
  // Windows executable header, labelled as a PDF.
  form.append('file', new Blob([Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])], { type: 'application/pdf' }), 'invoice.pdf');
  expectStatus(await t.api('POST', `/api/requests/${requestId}/attachments`, { token: tok.head, form }), 415);

  const svg = new FormData();
  svg.append('file', new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }), 'logo.svg');
  expectStatus(await t.api('POST', `/api/requests/${requestId}/attachments`, { token: tok.head, form: svg }), 415);

  const spoofedZip = new FormData();
  // ZIP header PK\x03\x04 without OOXML word/ or xl/ structure, declared as DOCX.
  const zipBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0x00)]);
  spoofedZip.append('file', new Blob([zipBytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'spoofed.docx');
  expectStatus(await t.api('POST', `/api/requests/${requestId}/attachments`, { token: tok.head, form: spoofedZip }), 415);
});

test('oversized files are refused and leave nothing behind', async () => {
  const before = (await fs.readdir(process.env.UPLOAD_DIR, { recursive: true })).length;
  const res = await t.api('POST', `/api/requests/${requestId}/attachments`,
    { token: tok.head, form: pdf('huge.pdf', 1.2 * 1024 * 1024).form });
  expectStatus(res, 413);
  const after = (await fs.readdir(process.env.UPLOAD_DIR, { recursive: true })).length;
  assert.equal(after, before);
});

test('a refused upload never reaches the disk', async () => {
  const before = (await fs.readdir(process.env.UPLOAD_DIR, { recursive: true })).length;
  // The In-charge cannot see this draft at all.
  expectStatus(await t.api('POST', `/api/requests/${requestId}/attachments`,
    { token: tok.incharge, form: pdf().form }), 404);
  const after = (await fs.readdir(process.env.UPLOAD_DIR, { recursive: true })).length;
  assert.equal(after, before);
});

test('downloads go through the visibility check', async () => {
  // Draft: only its author.
  expectStatus(await t.api('GET', `/api/attachments/${attachmentId}`, { token: tok.principal }), 404);
  expectStatus(await t.api('POST', `/api/requests/${requestId}/submit`, { token: tok.head }), 200);

  // Submitted: the Principal can now read it; the In-charge still cannot.
  const res = await t.api('GET', `/api/attachments/${attachmentId}`, { token: tok.principal });
  expectStatus(res, 200);
  assert.ok(res.buffer.equals(uploaded), 'bytes round-trip unchanged');
  assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  expectStatus(await t.api('GET', `/api/attachments/${attachmentId}`, { token: tok.incharge }), 404);
});

test('files on a submitted request are part of the record', async () => {
  const res = expectStatus(await t.api('DELETE', `/api/attachments/${attachmentId}`, { token: tok.head }), 409);
  assert.match(res.error.message, /part of the record/);
});

test('a missing stored file is reported, not crashed on', async () => {
  const { rows } = await t.superuser.query(
    'SELECT storage_path FROM attachments WHERE attachment_id = $1', [attachmentId]);
  await fs.rm(path.join(process.env.UPLOAD_DIR, rows[0].storage_path));
  expectStatus(await t.api('GET', `/api/attachments/${attachmentId}`, { token: tok.head }), 410);
});

test('behavioral: attachment with storage_backend="local" downloads and deletes from local disk even when USE_DRIVE is true', async () => {
  const headUser = (await t.superuser.query("SELECT user_id FROM users WHERE email = 'head.cs@spcollege.edu'")).rows[0].user_id;
  const relPath = `2026/09/${crypto.randomUUID()}.pdf`;
  const fullPath = path.join(process.env.UPLOAD_DIR || 'uploads', relPath);
  const fileBytes = Buffer.from('%PDF-1.4 Legacy local disk attachment content');

  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, fileBytes);

  // Insert a draft request to attach to
  const heads = expectStatus(await t.api('GET', '/api/budget-heads', { token: tok.head }), 200);
  const lab = heads.find((h) => h.code === 'LAB').id;
  const items = expectStatus(await t.api('GET', `/api/budget-heads/${lab}/items`, { token: tok.head }), 200);
  const draftReq = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.head,
    body: { title: 'Temp draft for backend test', budgetHeadId: lab,
            items: [{ budgetItemId: items[0].id, quantity: 1, unitCost: 100 }] },
  }), 201);

  // Insert attachment row with storage_backend = 'local'
  const { rows } = await t.superuser.query(
    `INSERT INTO attachments (request_id, file_name, mime_type, size_bytes, storage_path, storage_backend, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, 'local', $6) RETURNING attachment_id`,
    [draftReq.id, 'legacy_quote.pdf', 'application/pdf', fileBytes.length, relPath, headUser],
  );
  const testAttachmentId = rows[0].attachment_id;

  // Download via GET /api/attachments/:id — must serve local bytes
  const downloadRes = await t.api('GET', `/api/attachments/${testAttachmentId}`, { token: tok.head });
  expectStatus(downloadRes, 200);
  assert.ok(downloadRes.buffer.equals(fileBytes), 'Local file bytes served correctly');

  // Delete via DELETE /api/attachments/:id — must remove local file from disk
  expectStatus(await t.api('DELETE', `/api/attachments/${testAttachmentId}`, { token: tok.head }), 204);
  const fileStillOnDisk = await fs.access(fullPath).then(() => true).catch(() => false);
  assert.equal(fileStillOnDisk, false, 'Local file must be removed from disk upon deletion');
});

