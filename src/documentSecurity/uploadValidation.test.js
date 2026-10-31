import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app_user:devpass@localhost:5433/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || '12345678901234567890123456789012';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || '12345678901234567890123456789012';

const { detectType, isDangerousPayload, DANGEROUS_EXTENSIONS } = await import('../../server/src/storage.js');

describe('Document Upload Validation Hardening', () => {
  const PDF_BUFFER = Buffer.from('%PDF-1.4 sample valid pdf content');
  const PNG_BUFFER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const JPEG_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const DOCX_BUFFER = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml content')]);
  const XLSX_BUFFER = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml content')]);

  test('Validates legitimate PDF document and matches extension', () => {
    const type = detectType(PDF_BUFFER, 'application/pdf', 'quotation.pdf');
    assert.deepEqual(type, { mime: 'application/pdf', ext: '.pdf' });
  });

  test('Validates legitimate PNG image and matches extension', () => {
    const type = detectType(PNG_BUFFER, 'image/png', 'stamp.png');
    assert.deepEqual(type, { mime: 'image/png', ext: '.png' });
  });

  test('Validates legitimate JPEG image and matches extension', () => {
    const type = detectType(JPEG_BUFFER, 'image/jpeg', 'receipt.jpg');
    assert.deepEqual(type, { mime: 'image/jpeg', ext: '.jpg' });
  });

  test('Validates legitimate DOCX document container', () => {
    const type = detectType(DOCX_BUFFER, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'proposal.docx');
    assert.deepEqual(type, { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' });
  });

  test('Validates legitimate XLSX spreadsheet container', () => {
    const type = detectType(XLSX_BUFFER, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'budget.xlsx');
    assert.deepEqual(type, { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' });
  });

  test('Blocks Windows PE / MZ executable disguised as PDF', () => {
    const peDisguised = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);
    assert.ok(isDangerousPayload(peDisguised));
    const result = detectType(peDisguised, 'application/pdf', 'invoice.pdf');
    assert.equal(result, null);
  });

  test('Blocks Linux ELF binary', () => {
    const elfDisguised = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]);
    assert.ok(isDangerousPayload(elfDisguised));
    const result = detectType(elfDisguised, 'application/pdf', 'statement.pdf');
    assert.equal(result, null);
  });

  test('Blocks Shell scripts with shebang', () => {
    const shScript = Buffer.from('#!/bin/bash\necho Malicious');
    assert.ok(isDangerousPayload(shScript));
    const result = detectType(shScript, 'application/pdf', 'script.pdf');
    assert.equal(result, null);
  });

  test('Blocks PHP and HTML script injection payloads', () => {
    const phpPayload = Buffer.from('<?php phpinfo(); ?>');
    const htmlPayload = Buffer.from('<script>window.location="http://evil.com"</script>');
    assert.ok(isDangerousPayload(phpPayload));
    assert.ok(isDangerousPayload(htmlPayload));
    assert.equal(detectType(phpPayload, 'application/pdf', 'quote.pdf'), null);
    assert.equal(detectType(htmlPayload, 'application/pdf', 'quote.pdf'), null);
  });

  test('Rejects dangerous file extensions even with benign content', () => {
    for (const ext of ['.exe', '.bat', '.cmd', '.sh', '.vbs', '.js', '.py']) {
      assert.ok(DANGEROUS_EXTENSIONS.has(ext));
      const res = detectType(PDF_BUFFER, 'application/pdf', `malicious${ext}`);
      assert.equal(res, null);
    }
  });

  test('Rejects double extension evasion (e.g. quote.pdf.exe)', () => {
    const res = detectType(PDF_BUFFER, 'application/pdf', 'quote.pdf.exe');
    assert.equal(res, null);
  });

  test('Rejects MIME spoofing where declared MIME contradicts detected content', () => {
    // Declared PDF, but content is JPEG
    const spoofed = detectType(JPEG_BUFFER, 'application/pdf', 'photo.pdf');
    assert.equal(spoofed, null);
  });

  test('Rejects generic ZIP container without OOXML structure', () => {
    const genericZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(128, 0x00)]);
    const res = detectType(genericZip, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'data.docx');
    assert.equal(res, null);
  });

  test('Rejects 0-byte (empty) and null buffers', () => {
    assert.equal(detectType(Buffer.alloc(0), 'application/pdf', 'empty.pdf'), null);
    assert.equal(detectType(null, 'application/pdf', 'null.pdf'), null);
  });
});
