import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/procureflow_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || 'test-signing-secret-for-security';

const { cleanFileName, calculateSha256, isDangerousPayload, detectType } = await import('../../server/src/storage.js');
const { validateUploadFile, withHistory } = await import('../utils/attachmentUtils.js');

describe('Final Document Security & Versioning Regression Suite', () => {
  // End-to-end simulation of document security, authorization, versioning and archival:
  // v1 upload -> PC Review -> Superseded with v2 -> Concurrency Collision Handled ->
  // Resubmitted with v3 -> Outdated doc archived -> Audit logged -> IDOR blocked ->
  // Request approved (closed) -> Further mutations strictly forbidden

  test('Simulates complete document lifecycle with strict security, non-destructive versioning, and auditable archival', () => {
    const requestId = 'req-e2e-doc-001';
    const requestNumber = 'REQ-2026-0500';
    assert.equal(requestNumber, 'REQ-2026-0500');
    const departmentId = 10; // Computer Science Department
    const requester = { id: 'usr-cs-01', name: 'Dr. Alan Turing', role: 'HEAD', departmentId };
    const attacker = { id: 'usr-mech-99', name: 'Dr. Cross Dept', role: 'FACULTY', departmentId: 20 };
    const pcMember = { id: 'usr-pc-02', name: 'Prof. Scrutiny', role: 'PURCHASE_COMMITTEE', departmentId: 10 };
    const principal = { id: 'usr-principal', name: 'Principal Office', role: 'PRINCIPAL', departmentId: null };

    // In-memory document storage and audit log mock simulating PostgreSQL tables
    const attachments = new Map();
    const auditLogs = [];

    // Helper: simulate database row insertion
    function insertAttachment({ id, fileName, originalFileName, buffer, uploader, versionNumber = 1, requestVersionNumber = 1, reason = null }) {
      // 1. Content validation
      assert.ok(!isDangerousPayload(buffer, fileName), `Payload for ${fileName} must not be dangerous`);
      const detected = detectType(buffer, fileName);
      assert.ok(detected, `Detected MIME type must be valid for ${fileName}`);

      // 2. Filename sanitization
      const sanitizedName = cleanFileName(fileName);
      assert.ok(!sanitizedName.includes('/') && !sanitizedName.includes('\\'));

      // 3. Cryptographic hash
      const sha256 = calculateSha256(buffer);

      const row = {
        id,
        requestId,
        departmentId,
        fileName: sanitizedName,
        originalFileName,
        fileType: detected.type,
        sizeBytes: buffer.length,
        sha256,
        versionNumber,
        requestVersionNumber,
        supersededById: null,
        replacementReason: reason,
        uploadedById: uploader.id,
        uploaderName: uploader.name,
        uploaderRole: uploader.role,
        uploadedAt: new Date().toISOString(),
        archivedAt: null,
        archivedBy: null,
        archivedReason: null,
      };

      attachments.set(id, row);
      return row;
    }

    // ── STEP 1: Initial Upload (v1) on Draft Requisition ──
    const quoteV1Buffer = Buffer.from('%PDF-1.7 Quotation from Vendor Alpha for 50 Workstations ₹25,00,000');
    const docV1 = insertAttachment({
      id: 'att-v1-001',
      fileName: 'vendor_alpha_quote.pdf',
      originalFileName: 'vendor_alpha_quote.pdf',
      buffer: quoteV1Buffer,
      uploader: requester,
      versionNumber: 1,
      requestVersionNumber: 1,
    });

    assert.equal(docV1.versionNumber, 1);
    assert.equal(docV1.requestVersionNumber, 1);
    assert.equal(docV1.supersededById, null);
    assert.equal(docV1.sha256.length, 64);

    // ── STEP 2: Block Malicious Upload Attempts on the Same Request ──
    const maliciousExeBuffer = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // MZ PE
    assert.ok(isDangerousPayload(maliciousExeBuffer, 'invoice.pdf'));

    const emptyFile = { name: 'blank.pdf', size: 0 };
    assert.match(validateUploadFile(emptyFile), /empty \(0 bytes\)/);

    const oversizedFile = { name: 'huge.pdf', size: 15 * 1024 * 1024 };
    assert.match(validateUploadFile(oversizedFile), /exceeds the 10 MB/);

    const traversalName = '../../../../etc/passwd.pdf';
    assert.equal(cleanFileName(traversalName), 'passwd.pdf');

    // ── STEP 3: Purchase Committee Scrutiny & Document Replacement (v1 -> v2) ──
    // PC requests renegotiated discount. Requester uploads quotation v2.
    const quoteV2Buffer = Buffer.from('%PDF-1.7 Revised Quotation from Vendor Alpha with 8% Education Discount ₹23,00,000');

    function supersedeAttachment({ oldId, newId, fileName, originalFileName, buffer, uploader, reason, requestVersionNumber }) {
      const oldDoc = attachments.get(oldId);
      assert.ok(oldDoc, 'Old attachment must exist');

      // Concurrency and linear chain check (fn_supersede_attachment SP019)
      if (oldDoc.supersededById !== null) {
        const err = new Error('Cannot supersede an already superseded attachment');
        err.code = 'SP019';
        throw err;
      }

      // Create new document version
      const newDoc = insertAttachment({
        id: newId,
        fileName,
        originalFileName,
        buffer,
        uploader,
        versionNumber: oldDoc.versionNumber + 1,
        requestVersionNumber,
        reason,
      });

      // Update old document non-destructively
      oldDoc.supersededById = newDoc.id;
      return newDoc;
    }

    const docV2 = supersedeAttachment({
      oldId: 'att-v1-001',
      newId: 'att-v2-002',
      fileName: 'vendor_alpha_quote_v2.pdf',
      originalFileName: 'vendor_alpha_quote_revised.pdf',
      buffer: quoteV2Buffer,
      uploader: requester,
      reason: 'Applied 8% educational discount per PC scrutiny feedback',
      requestVersionNumber: 2,
    });

    assert.equal(docV2.versionNumber, 2);
    assert.equal(docV2.requestVersionNumber, 2);
    assert.equal(docV1.supersededById, 'att-v2-002');
    assert.notEqual(docV1.sha256, docV2.sha256);

    // ── STEP 4: Concurrency Collision Protection ──
    // A concurrent request attempting to supersede docV1 again MUST fail with SP019
    assert.throws(
      () => supersedeAttachment({
        oldId: 'att-v1-001',
        newId: 'att-v2-collision',
        fileName: 'vendor_collision.pdf',
        originalFileName: 'vendor_collision.pdf',
        buffer: quoteV2Buffer,
        uploader: requester,
        reason: 'Concurrent race attempt',
        requestVersionNumber: 2,
      }),
      (err) => err.code === 'SP019' && /already superseded/.test(err.message),
    );

    // ── STEP 5: Second Resubmission & Version Progression (v2 -> v3) ──
    const quoteV3Buffer = Buffer.from('%PDF-1.7 Final Quotation from Vendor Alpha with 3-year warranty included ₹23,00,000');
    const docV3 = supersedeAttachment({
      oldId: 'att-v2-002',
      newId: 'att-v3-003',
      fileName: 'vendor_alpha_quote_v3.pdf',
      originalFileName: 'vendor_alpha_quote_final.pdf',
      buffer: quoteV3Buffer,
      uploader: requester,
      reason: 'Included mandatory 3-year comprehensive onsite warranty',
      requestVersionNumber: 2,
    });

    assert.equal(docV3.versionNumber, 3);
    assert.equal(docV2.supersededById, 'att-v3-003');
    assert.equal(docV3.supersededById, null); // v3 is live current

    // ── STEP 6: Frontend withHistory Chain Reconstruction ──
    const clientFileList = Array.from(attachments.values()).map((row) => ({
      id: row.id,
      fileName: row.fileName,
      versionNumber: row.versionNumber,
      requestVersionNumber: row.requestVersionNumber,
      sha256: row.sha256,
      supersededById: row.supersededById,
      replacementReason: row.replacementReason,
      uploadedBy: { id: row.uploadedById, name: row.uploaderName, role: row.uploaderRole },
      uploadedAt: row.uploadedAt,
    }));

    const reconstructed = withHistory(clientFileList);
    assert.equal(reconstructed.length, 1);
    const liveDoc = reconstructed[0];
    assert.equal(liveDoc.id, 'att-v3-003');
    assert.equal(liveDoc.versionNumber, 3);
    assert.equal(liveDoc.earlier.length, 2);
    // Reverse chronological history order: v2, then v1
    assert.equal(liveDoc.earlier[0].id, 'att-v2-002');
    assert.equal(liveDoc.earlier[0].versionNumber, 2);
    assert.equal(liveDoc.earlier[1].id, 'att-v1-001');
    assert.equal(liveDoc.earlier[1].versionNumber, 1);

    // ── STEP 7: Auditable Archival of Superseded Version ──
    function archiveAttachment({ docId, actor, reason }) {
      assert.ok(reason && reason.trim().length > 0, 'Reason mandatory for archival');
      const doc = attachments.get(docId);
      assert.ok(doc, 'Attachment must exist');

      doc.archivedAt = new Date().toISOString();
      doc.archivedBy = actor.id;
      doc.archivedReason = reason.trim();

      auditLogs.push({
        action: 'ATTACHMENT_ARCHIVED',
        targetId: docId,
        actorId: actor.id,
        actorRole: actor.role,
        reason: reason.trim(),
        timestamp: doc.archivedAt,
      });
      return doc;
    }

    archiveAttachment({
      docId: 'att-v2-002',
      actor: requester,
      reason: 'Intermediate draft quote superseded by v3 with finalized warranty terms',
    });

    assert.ok(docV2.archivedAt !== null);
    assert.equal(docV2.archivedBy, requester.id);
    assert.equal(auditLogs.length, 1);
    assert.equal(auditLogs[0].action, 'ATTACHMENT_ARCHIVED');
    assert.equal(auditLogs[0].targetId, 'att-v2-002');

    // ── STEP 8: Access Authorization & IDOR Defense ──
    function authorizeDownload(user, doc) {
      if (!user || !doc) return 404;
      // Archived files strictly refuse ordinary download
      if (doc.archivedAt !== null) return 404;

      // Approvers and Admins can access
      if (['ADMIN', 'PURCHASE_COMMITTEE', 'PRINCIPAL', 'CDC'].includes(user.role)) {
        return 200;
      }

      // Department isolation: Requesters can only access their department's documents
      if (user.departmentId === doc.departmentId) {
        return 200;
      }

      // Cross-department access: return 404 to avoid leaking existence
      return 404;
    }

    // Requester can download current active v3
    assert.equal(authorizeDownload(requester, docV3), 200);

    // PC and Principal can download current active v3
    assert.equal(authorizeDownload(pcMember, docV3), 200);
    assert.equal(authorizeDownload(principal, docV3), 200);

    // Archived v2 download is REFUSED (404) even for authorized requester
    assert.equal(authorizeDownload(requester, docV2), 404);

    // Attacker from Dept 20 is REFUSED with 404 on all documents
    assert.equal(authorizeDownload(attacker, docV3), 404);
    assert.equal(authorizeDownload(attacker, docV1), 404);

    // ── STEP 9: Hard Deletion Blocked for Historical Documents ──
    function attemptDelete(doc) {
      if (doc.versionNumber > 1 || doc.supersededById !== null) {
        const err = new Error('Cannot delete historical or superseded attachments');
        err.status = 409;
        throw err;
      }
      attachments.delete(doc.id);
      return true;
    }

    // Historical documents v1 and v2 cannot be hard-deleted
    assert.throws(() => attemptDelete(docV1), (err) => err.status === 409);
    assert.throws(() => attemptDelete(docV2), (err) => err.status === 409);

    // ── STEP 10: Cryptographic Storage Tamper Detection ──
    const originalV3Hash = docV3.sha256;
    const modifiedBytes = Buffer.from(quoteV3Buffer);
    modifiedBytes[modifiedBytes.length - 1] = 0x00; // Tamper with 1 byte
    const modifiedHash = calculateSha256(modifiedBytes);

    assert.notEqual(originalV3Hash, modifiedHash, 'Hash mismatch must flag storage tampering');

    // ── STEP 11: Final Terminal Request State (APPROVED) ──
    // Once requisition is APPROVED, further superseding is blocked
    const approvedRequest = { id: requestId, status: 'APPROVED' };
    function checkRequestMutable(req) {
      if (['APPROVED', 'REJECTED'].includes(req.status)) {
        const err = new Error('Cannot modify documents on a closed request');
        err.code = 'SP003';
        throw err;
      }
      return true;
    }

    assert.throws(() => checkRequestMutable(approvedRequest), (err) => err.code === 'SP003');
  });
});
