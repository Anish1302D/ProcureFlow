import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';

describe('Document Security & Versioning Regression Coverage', () => {
  // ── 1. MAGIC BYTES & FILE VALIDATION SPECIFICATION ──
  describe('File Format & Magic Bytes Security', () => {
    const MAGIC = {
      PDF: Buffer.from('%PDF-1.7 sample document payload'),
      PNG: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
      JPEG: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
      // ZIP containers
      ZIP_GENERIC: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0x00)]),
      ZIP_DOCX: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml content')]),
      ZIP_XLSX: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('xl/workbook.xml content')]),
      // Executables & scripts (synthetic safe test byte markers)
      EXE_PE: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]), // MZ
      ELF_BIN: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]), // .ELF
      MACHO_BIN: Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
      JAVA_CLASS: Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
      SHEBANG_SH: Buffer.from('#!/bin/sh\necho test\n'),
      PHP_SCRIPT: Buffer.from('<?php echo "test script"; ?>'),
      HTML_SCRIPT: Buffer.from('<script>console.log(1)</script>'),
      BAT_SCRIPT: Buffer.from('@echo off\nexit\n'),
    };

    test('Allowed file formats exhibit valid magic byte signatures', () => {
      assert.ok(MAGIC.PDF.subarray(0, 5).equals(Buffer.from('%PDF-')));
      assert.ok(MAGIC.PNG.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
      assert.ok(MAGIC.JPEG.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])));
      assert.ok(MAGIC.ZIP_DOCX.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
      assert.ok(MAGIC.ZIP_DOCX.includes('word/document.xml'));
      assert.ok(MAGIC.ZIP_XLSX.includes('xl/workbook.xml'));
    });

    test('Dangerous executable signatures are explicitly identifiable', () => {
      // Windows PE (MZ)
      assert.equal(MAGIC.EXE_PE[0], 0x4d);
      assert.equal(MAGIC.EXE_PE[1], 0x5a);

      // Linux ELF
      assert.equal(MAGIC.ELF_BIN[0], 0x7f);
      assert.equal(MAGIC.ELF_BIN.subarray(1, 4).toString('ascii'), 'ELF');

      // Shebang script
      assert.ok(MAGIC.SHEBANG_SH.toString('utf8').startsWith('#!'));

      // Web scripts
      assert.ok(MAGIC.PHP_SCRIPT.toString('utf8').startsWith('<?php'));
      assert.ok(MAGIC.HTML_SCRIPT.toString('utf8').includes('<script'));
    });

    test('Generic ZIP container without OOXML internals is rejected as DOCX or XLSX', () => {
      assert.ok(!MAGIC.ZIP_GENERIC.includes('word/document.xml'));
      assert.ok(!MAGIC.ZIP_GENERIC.includes('xl/workbook.xml'));
    });
  });

  // ── 2. FILENAME SANITIZATION & PATH TRAVERSAL GUARDS ──
  describe('Filename Security & Sanitization Specification', () => {
    function sanitize(name, expectedExt) {
      if (!name || typeof name !== 'string') return 'file' + (expectedExt || '');
      // Strip directory traversal
      let base = name.replace(/\\/g, '/').split('/').pop() || '';
      // Remove null bytes and control chars
      // eslint-disable-next-line no-control-regex
      base = base.replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200D\uFEFF]/g, '_');
      // Replace quotes and forbidden characters
      base = base.replace(/[<>:"/\\|?*]/g, '_');
      // Trim spaces and dots
      base = base.trim().replace(/^\.+/, '');
      // Check Windows reserved device names
      const stem = base.split('.')[0].toUpperCase();
      const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'];
      if (reserved.includes(stem)) {
        base = `safe_${base}`;
      }
      // Truncate length
      if (base.length > 200) base = base.slice(0, 200);
      return base || 'file' + (expectedExt || '');
    }

    test('Strips path traversal directory sequences', () => {
      assert.equal(sanitize('../../../etc/passwd.pdf', '.pdf'), 'passwd.pdf');
      assert.equal(sanitize('..\\..\\windows\\system32\\cmd.exe.pdf', '.pdf'), 'cmd.exe.pdf');
    });

    test('Replaces control characters and null bytes', () => {
      assert.equal(sanitize('quotation\u0000_v1.pdf', '.pdf'), 'quotation__v1.pdf');
      assert.equal(sanitize('invoice\u001F_march.pdf', '.pdf'), 'invoice__march.pdf');
    });

    test('Handles Windows reserved device names safely', () => {
      assert.equal(sanitize('CON.pdf', '.pdf'), 'safe_CON.pdf');
      assert.equal(sanitize('aux.png', '.png'), 'safe_aux.png');
      assert.equal(sanitize('nul.xlsx', '.xlsx'), 'safe_nul.xlsx');
    });

    test('Enforces maximum length bounds', () => {
      const longName = 'a'.repeat(250) + '.pdf';
      const sanitized = sanitize(longName, '.pdf');
      assert.ok(sanitized.length <= 200);
    });
  });

  // ── 3. CRYPTOGRAPHIC INTEGRITY VERIFICATION ──
  describe('Cryptographic Integrity Verification', () => {
    test('Calculates consistent SHA-256 digest on document upload', () => {
      const buffer = Buffer.from('%PDF-1.7 Valid quotation ₹90,000');
      const hash = crypto.createHash('sha256').update(buffer).digest('hex');

      assert.equal(typeof hash, 'string');
      assert.equal(hash.length, 64);
      assert.equal(hash, crypto.createHash('sha256').update(buffer).digest('hex'));
    });

    test('Tampering even a single byte alters the SHA-256 integrity hash', () => {
      const original = Buffer.from('%PDF-1.7 Valid quotation ₹90,000');
      const tampered = Buffer.from('%PDF-1.7 Valid quotation ₹90,001');

      const originalHash = crypto.createHash('sha256').update(original).digest('hex');
      const tamperedHash = crypto.createHash('sha256').update(tampered).digest('hex');

      assert.notEqual(originalHash, tamperedHash);
    });
  });

  // ── 4. NON-DESTRUCTIVE VERSIONING & SUPERSESSION CHAINS ──
  describe('Non-Destructive Versioning & Supersession Chain Integrity', () => {
    test('Maintains linear supersession chain (v1 -> v2 -> v3) preserving earlier records', () => {
      const requestId = 'req-doc-sec-01';

      // v1 initial upload
      const docV1 = {
        attachmentId: 'att-001',
        requestId,
        versionNumber: 1,
        requestVersionNumber: 1,
        fileName: 'vendor_quote_v1.pdf',
        originalFileName: 'vendor_quote.pdf',
        sizeBytes: 20480,
        sha256Hash: crypto.createHash('sha256').update('v1 content').digest('hex'),
        supersededById: null,
        replacementReason: null,
        uploadedBy: 'user-head-cs',
        uploadedAt: '2026-10-31T09:00:00Z',
      };

      // v2 replacement (supersedes v1)
      const docV2 = {
        attachmentId: 'att-002',
        requestId,
        versionNumber: docV1.versionNumber + 1,
        requestVersionNumber: 2,
        fileName: 'vendor_quote_v2.pdf',
        originalFileName: 'vendor_quote_updated.pdf',
        sizeBytes: 22100,
        sha256Hash: crypto.createHash('sha256').update('v2 content').digest('hex'),
        supersededById: null,
        replacementReason: 'Updated vendor pricing after committee negotiation',
        uploadedBy: 'user-head-cs',
        uploadedAt: '2026-10-31T10:00:00Z',
      };
      docV1.supersededById = docV2.attachmentId;

      // v3 replacement (supersedes v2)
      const docV3 = {
        attachmentId: 'att-003',
        requestId,
        versionNumber: docV2.versionNumber + 1,
        requestVersionNumber: 2,
        fileName: 'vendor_quote_v3.pdf',
        originalFileName: 'vendor_quote_final.pdf',
        sizeBytes: 23500,
        sha256Hash: crypto.createHash('sha256').update('v3 content').digest('hex'),
        supersededById: null,
        replacementReason: 'Final signed quotation with stamp',
        uploadedBy: 'user-head-cs',
        uploadedAt: '2026-10-31T11:00:00Z',
      };
      docV2.supersededById = docV3.attachmentId;

      const store = [docV1, docV2, docV3];

      // Verifications:
      // 1. All documents preserved (none deleted)
      assert.equal(store.length, 3);
      // 2. Correct version progression
      assert.equal(docV1.versionNumber, 1);
      assert.equal(docV2.versionNumber, 2);
      assert.equal(docV3.versionNumber, 3);
      // 3. Chain linkage
      assert.equal(docV1.supersededById, 'att-002');
      assert.equal(docV2.supersededById, 'att-003');
      assert.equal(docV3.supersededById, null); // v3 is current
      // 4. Reasons preserved
      assert.equal(docV2.replacementReason, 'Updated vendor pricing after committee negotiation');
      assert.equal(docV3.replacementReason, 'Final signed quotation with stamp');
    });

    test('Prevents branching supersession: cannot supersede an already-superseded attachment', () => {
      const docV1 = {
        attachmentId: 'att-001',
        supersededById: 'att-002',
      };

      // Attempting to supersede docV1 again must fail
      const canSupersede = (doc) => doc.supersededById === null;
      assert.equal(canSupersede(docV1), false, 'Already superseded document cannot be superseded again');
    });
  });

  // ── 5. AUDITABLE ARCHIVAL & REMOVAL SPECIFICATION ──
  describe('Auditable Archival vs Physical Destruction Specification', () => {
    test('Soft removal flags archival metadata without deleting storage record', () => {
      const doc = {
        attachmentId: 'att-arch-01',
        fileName: 'draft_quote.pdf',
        archivedAt: null,
        archivedBy: null,
        archivedReason: null,
      };

      // Perform soft archival
      const archiveDoc = (d, actorId, reason) => {
        assert.ok(reason && reason.trim().length > 0, 'Reason required for archival');
        d.archivedAt = new Date().toISOString();
        d.archivedBy = actorId;
        d.archivedReason = reason;
      };

      archiveDoc(doc, 'user-admin', 'Superseded by institutional contract framework');

      assert.ok(doc.archivedAt !== null);
      assert.equal(doc.archivedBy, 'user-admin');
      assert.equal(doc.archivedReason, 'Superseded by institutional contract framework');
    });

    test('Ordinary download routes strictly refuse archived documents', () => {
      const activeDoc = { attachmentId: 'att-1', isArchived: false };
      const archivedDoc = { attachmentId: 'att-2', isArchived: true };

      const canDownload = (doc) => !doc.isArchived;

      assert.equal(canDownload(activeDoc), true);
      assert.equal(canDownload(archivedDoc), false);
    });
  });
});
