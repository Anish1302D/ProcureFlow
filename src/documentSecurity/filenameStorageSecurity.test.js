import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app_user:devpass@localhost:5433/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || '12345678901234567890123456789012';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || '12345678901234567890123456789012';

const { cleanFileName, absolutePath, saveFile, removeFile } = await import('../../server/src/storage.js');

describe('Filename Security & Storage Handling', () => {
  test('cleanFileName strips directory traversal components', () => {
    assert.equal(cleanFileName('../../../etc/passwd.pdf'), 'passwd.pdf');
    assert.equal(cleanFileName('..\\..\\windows\\system32\\cmd.pdf'), 'cmd.pdf');
    assert.equal(cleanFileName('/var/log/../../sensitive.pdf'), 'sensitive.pdf');
  });

  test('cleanFileName neutralizes null bytes and control characters', () => {
    assert.equal(cleanFileName('quote\u0000.pdf'), 'quote_.pdf');
    assert.equal(cleanFileName('file\u001Fname.pdf'), 'file_name.pdf');
  });

  test('cleanFileName neutralizes Windows reserved device names', () => {
    assert.equal(cleanFileName('CON.pdf'), 'safe_CON.pdf');
    assert.equal(cleanFileName('prn.png'), 'safe_prn.png');
    assert.equal(cleanFileName('aux.docx'), 'safe_aux.docx');
    assert.equal(cleanFileName('NUL.xlsx'), 'safe_NUL.xlsx');
    assert.equal(cleanFileName('com1.pdf'), 'safe_com1.pdf');
    assert.equal(cleanFileName('lpt2.pdf'), 'safe_lpt2.pdf');
  });

  test('cleanFileName bounds maximum length to 200 chars while preserving extension', () => {
    const longName = 'a'.repeat(250) + '.pdf';
    const cleaned = cleanFileName(longName);
    assert.ok(cleaned.length <= 200);
    assert.ok(cleaned.endsWith('.pdf'));
  });

  test('cleanFileName handles empty, null or undefined input gracefully', () => {
    assert.equal(cleanFileName(null), 'file');
    assert.equal(cleanFileName(undefined), 'file');
    assert.equal(cleanFileName(''), 'file');
    assert.equal(cleanFileName('...'), 'file');
  });

  test('absolutePath restricts paths strictly inside uploadDir and rejects directory escapes', () => {
    // Legitimate date-partitioned storage path
    const validRel = '2026/10/d8e3b7b2-1111-4222-a333-555566667777.pdf';
    const abs = absolutePath(validRel);
    assert.ok(path.isAbsolute(abs));

    // Malicious path escaping upload directory
    assert.throws(
      () => absolutePath('../../etc/shadow'),
      /escapes the upload directory/,
      'Escaping paths must be rejected',
    );
    assert.throws(
      () => absolutePath('../../../Windows/System32/drivers/etc/hosts'),
      /escapes the upload directory/,
      'Escaping paths must be rejected',
    );
  });

  test('saveFile and removeFile manage storage lifecycle without leaving orphaned files', async () => {
    const samplePayload = Buffer.from('%PDF-1.4 Lifecycle validation file');
    const { storagePath, backend } = await saveFile(samplePayload, '.pdf');

    assert.ok(storagePath, 'Storage path returned');
    assert.ok(backend, 'Storage backend returned');

    const fullPath = absolutePath(storagePath);
    const fileExistsBefore = await fs.access(fullPath).then(() => true).catch(() => false);
    assert.equal(fileExistsBefore, true, 'Saved file must exist on storage');

    // Clean up
    await removeFile(storagePath, backend);
    const fileExistsAfter = await fs.access(fullPath).then(() => true).catch(() => false);
    assert.equal(fileExistsAfter, false, 'Removed file must no longer exist');
  });
});
