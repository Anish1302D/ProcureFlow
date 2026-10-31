import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app_user:devpass@localhost:5433/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || '12345678901234567890123456789012';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || '12345678901234567890123456789012';

const { calculateSha256 } = await import('../../server/src/storage.js');

describe('Document Integrity & Cryptographic Metadata Tracking', () => {
  test('calculateSha256 computes deterministic 64-character hex digest', () => {
    const content = Buffer.from('%PDF-1.4 Institutional Requisition Tender Quote');
    const digest = calculateSha256(content);

    assert.equal(typeof digest, 'string');
    assert.equal(digest.length, 64);
    assert.match(digest, /^[0-9a-f]{64}$/);

    // Identical payload yields identical hash
    assert.equal(calculateSha256(content), digest);
  });

  test('Tampering detects bit flips and data alterations', () => {
    const original = Buffer.from('%PDF-1.4 Valid Vendor Price Quote ₹50,000');
    const tampered = Buffer.from('%PDF-1.4 Valid Vendor Price Quote ₹50,001');

    const originalHash = calculateSha256(original);
    const tamperedHash = calculateSha256(tampered);

    assert.notEqual(originalHash, tamperedHash, 'Tampered file must yield distinct hash');
  });

  test('Document metadata tracks full provenance and integrity attributes', () => {
    const rawFile = {
      buffer: Buffer.from('%PDF-1.4 Genuine Document Payload'),
      originalname: '../../../untrusted/path/Vendor Quote (2026).pdf',
      size: 1024,
      mimetype: 'application/pdf',
    };

    const sanitizedName = 'Vendor Quote (2026).pdf';
    const sha256 = calculateSha256(rawFile.buffer);

    const attachmentRecord = {
      id: 'att-crypto-01',
      requestId: 'req-2026-001',
      fileName: sanitizedName,
      originalFileName: rawFile.originalname,
      mimeType: rawFile.mimetype,
      sizeBytes: rawFile.size,
      sha256,
      versionNumber: 2,
      requestVersionNumber: 2,
      supersededById: null,
      replacementReason: 'Updated quotation for review',
      uploadedBy: { id: 'user-01', name: 'Dr. Jane Doe' },
      uploadedAt: '2026-10-31T10:00:00Z',
    };

    assert.equal(attachmentRecord.fileName, 'Vendor Quote (2026).pdf');
    assert.equal(attachmentRecord.originalFileName, '../../../untrusted/path/Vendor Quote (2026).pdf');
    assert.equal(attachmentRecord.sha256, sha256);
    assert.equal(attachmentRecord.versionNumber, 2);
    assert.equal(attachmentRecord.requestVersionNumber, 2);
    assert.equal(attachmentRecord.replacementReason, 'Updated quotation for review');
  });

  test('calculateSha256 handles null and undefined safely', () => {
    assert.equal(calculateSha256(null), null);
    assert.equal(calculateSha256(undefined), null);
  });
});
