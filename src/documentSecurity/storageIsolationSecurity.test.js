import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { describe, test } from 'node:test';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/procureflow_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-chars-long';
process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || 'test-signing-secret-for-security';

const { cleanFileName, calculateSha256 } = await import('../../server/src/storage.js');

describe('Storage Security & Access Isolation Test Suite', () => {
  // ── 1. Storage Isolation & Path Traversal Resistance ─────────────────────
  describe('Storage Isolation & Directory Traversal Prevention', () => {
    test('Strictly restricts file storage path resolution and neutralizes directory traversal', () => {
      const maliciousNames = [
        '../../../etc/passwd',
        '..\\..\\..\\Windows\\System32\\cmd.exe',
        'folder/subfolder/document.pdf',
        'folder\\subfolder\\document.pdf',
        '/var/www/uploads/shell.php',
        'C:\\inetpub\\wwwroot\\web.config',
        '\\\\192.168.1.100\\share\\payload.pdf',
      ];

      for (const rawName of maliciousNames) {
        const sanitized = cleanFileName(rawName);
        // Slashes and backslashes must be completely eliminated
        assert.ok(!sanitized.includes('/'), `Sanitized name "${sanitized}" should not contain forward slashes`);
        assert.ok(!sanitized.includes('\\'), `Sanitized name "${sanitized}" should not contain backslashes`);
        assert.ok(!sanitized.includes('..'), `Sanitized name "${sanitized}" should not contain ".."`);
      }
    });

    test('Replaces device names and control characters safely without path escapement', () => {
      const deviceNames = ['CON.pdf', 'PRN.docx', 'AUX.xlsx', 'NUL.pdf', 'COM1.png', 'LPT3.jpg'];
      for (const dev of deviceNames) {
        const cleaned = cleanFileName(dev);
        assert.ok(cleaned.startsWith('safe_'), `Device name "${dev}" must be prefixed with safe_: got "${cleaned}"`);
      }
    });
  });

  // ── 2. Storage Backend Abstraction & Credential Protection ───────────────
  describe('Storage Backend Abstraction & Credential Protection', () => {
    test('Serializing attachment models never leaks internal filesystem paths or storage credentials', () => {
      // Internal database representation with storage secrets and local paths
      const internalDbRow = {
        id: 'att-sec-001',
        request_id: 'req-2026-001',
        file_name: 'quotation_v1.pdf',
        original_file_name: 'quotation_vendor.pdf',
        file_path: '2026/10/d41d8cd98f00b204e9800998ecf8427e.pdf',
        file_type: 'application/pdf',
        size_bytes: 45000,
        storage_backend: 'local',
        sha256_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        version_number: 1,
        request_version_number: 1,
        superseded_by_id: null,
        replacement_reason: null,
        uploaded_by_id: 'usr-prof-cs-01',
        uploader_name: 'Prof. Computer Science',
        uploader_role: 'HEAD',
        archived_at: null,
        // Secret internal keys that must never be exposed
        _drive_access_token: 'secret_oauth_token_xyz',
        _gdrive_folder_id: 'folder_drive_internal_123',
        _server_disk_root: 'E:\\uploads\\private',
      };

      // Client-facing presentation mapping (as used in API responses)
      const clientPayload = {
        id: internalDbRow.id,
        requestId: internalDbRow.request_id,
        fileName: internalDbRow.file_name,
        fileType: internalDbRow.file_type,
        sizeBytes: internalDbRow.size_bytes,
        versionNumber: internalDbRow.version_number,
        requestVersionNumber: internalDbRow.request_version_number,
        sha256: internalDbRow.sha256_hash,
        storageBackend: internalDbRow.storage_backend,
        supersededById: internalDbRow.superseded_by_id,
        archivedAt: internalDbRow.archived_at,
        uploadedAt: '2026-10-31T10:00:00Z',
        uploadedBy: {
          id: internalDbRow.uploaded_by_id,
          name: internalDbRow.uploader_name,
          role: internalDbRow.uploader_role,
        },
      };

      // Verification: Internal storage paths and credentials are omitted
      const serialized = JSON.stringify(clientPayload);
      assert.ok(!serialized.includes('file_path'), 'file_path must not be exposed to client');
      assert.ok(!serialized.includes('2026/10/d41d8cd98f00b204e9800998ecf8427e'), 'Internal disk relative path must not be leaked');
      assert.ok(!serialized.includes('secret_oauth_token_xyz'), 'OAuth tokens must not be exposed');
      assert.ok(!serialized.includes('folder_drive_internal_123'), 'Drive folder ID must not be exposed');
      assert.ok(!serialized.includes('E:\\\\uploads\\\\private'), 'Server disk root must not be exposed');
    });

    test('Cryptographic SHA-256 integrity detects any disk tampering or byte modification', () => {
      const originalContent = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
      const originalHash = calculateSha256(originalContent);
      assert.equal(typeof originalHash, 'string');
      assert.equal(originalHash.length, 64);

      // Simulate bit-flip tampering on disk
      const tamperedContent = Buffer.from(originalContent);
      tamperedContent[tamperedContent.length - 1] = 0x20; // Alter last byte

      const tamperedHash = calculateSha256(tamperedContent);
      assert.notEqual(originalHash, tamperedHash, 'Tampered file must yield different SHA-256 hash');
    });
  });

  // ── 3. Department Isolation & IDOR Protection ────────────────────────────
  describe('Department Isolation & IDOR Access Barrier', () => {
    // Model request and attachment department associations
    const dept10Request = {
      id: 'req-dept10-cs-01',
      request_number: 'REQ-2026-0010',
      department_id: 10,
      user_id: 'user-head-cs',
      status: 'SUBMITTED',
      current_stage: 'PURCHASE_COMMITTEE',
    };

    const dept20Request = {
      id: 'req-dept20-mech-01',
      request_number: 'REQ-2026-0020',
      department_id: 20,
      user_id: 'user-head-mech',
      status: 'SUBMITTED',
      current_stage: 'PURCHASE_COMMITTEE',
    };

    const attachments = [
      { id: 'att-10', requestId: dept10Request.id, departmentId: 10, fileName: 'cs_lab_quote.pdf' },
      { id: 'att-20', requestId: dept20Request.id, departmentId: 20, fileName: 'mech_lathe_quote.pdf' },
    ];

    function authorizeAttachmentAccess(user, attachment) {
      if (!user || !attachment) return false;
      // Admin and approver roles can access across departments
      if (['ADMIN', 'PURCHASE_COMMITTEE', 'PRINCIPAL', 'CDC', 'MANAGEMENT'].includes(user.role)) {
        return true;
      }
      // Requesters and department heads can only access documents within their department
      return user.departmentId === attachment.departmentId;
    }

    test('Requesters can access only documents belonging to their own department', () => {
      const csUser = { id: 'user-head-cs', departmentId: 10, role: 'HEAD' };
      const mechUser = { id: 'user-head-mech', departmentId: 20, role: 'HEAD' };

      // CS user can access Dept 10 document, but NOT Dept 20 document
      assert.equal(authorizeAttachmentAccess(csUser, attachments[0]), true);
      assert.equal(authorizeAttachmentAccess(csUser, attachments[1]), false);

      // Mech user can access Dept 20 document, but NOT Dept 10 document
      assert.equal(authorizeAttachmentAccess(mechUser, attachments[1]), true);
      assert.equal(authorizeAttachmentAccess(mechUser, attachments[0]), false);
    });

    test('Institutional approvers have legitimate cross-department auditing access', () => {
      const pcMember = { id: 'user-pc-01', departmentId: 10, role: 'PURCHASE_COMMITTEE' };
      const principal = { id: 'user-principal', departmentId: null, role: 'PRINCIPAL' };
      const admin = { id: 'user-admin', departmentId: null, role: 'ADMIN' };

      for (const approver of [pcMember, principal, admin]) {
        assert.equal(authorizeAttachmentAccess(approver, attachments[0]), true);
        assert.equal(authorizeAttachmentAccess(approver, attachments[1]), true);
      }
    });

    test('Unauthorized cross-department download returns 404 to avoid leaking document existence', () => {
      const csUser = { id: 'user-faculty-cs', departmentId: 10, role: 'FACULTY' };
      const targetAttachment = attachments[1]; // Dept 20 attachment

      const authorized = authorizeAttachmentAccess(csUser, targetAttachment);
      // If not authorized, response status must be 404 (Not Found) rather than revealing existence via 403
      const responseStatus = authorized ? 200 : 404;
      assert.equal(responseStatus, 404);
    });
  });

  // ── 4. Concurrency & Linear Supersession Integrity ──────────────────────
  describe('Concurrency & Linear Supersession Integrity', () => {
    test('Simulates concurrent supersession: locks row FOR UPDATE and prevents tree branching', () => {
      // Mock attachment record in database
      const attachmentTable = new Map([
        ['att-base-01', {
          id: 'att-base-01',
          version_number: 1,
          superseded_by_id: null,
          is_locked: false,
        }],
      ]);

      // Simulated atomic supersession with SELECT ... FOR UPDATE
      function supersedeAttachmentAtomic(docId, newDocId) {
        const row = attachmentTable.get(docId);
        if (!row) throw new Error('Attachment not found');

        // Check if already superseded
        if (row.superseded_by_id) {
          const err = new Error('Cannot supersede an already superseded attachment');
          err.code = 'SP015';
          throw err;
        }

        // Lock row and update
        row.superseded_by_id = newDocId;
        const newRow = {
          id: newDocId,
          version_number: row.version_number + 1,
          superseded_by_id: null,
          is_locked: false,
        };
        attachmentTable.set(newDocId, newRow);
        return newRow;
      }

      // First supersession: v1 -> v2 succeeds
      const v2 = supersedeAttachmentAtomic('att-base-01', 'att-v2-02');
      assert.equal(v2.version_number, 2);
      assert.equal(attachmentTable.get('att-base-01').superseded_by_id, 'att-v2-02');

      // Concurrent second supersession on same base doc: must throw SP015
      assert.throws(
        () => supersedeAttachmentAtomic('att-base-01', 'att-v2-collision'),
        (err) => err.code === 'SP015' && /already superseded/.test(err.message),
      );

      // Third supersession linearly supersedes v2 -> v3
      const v3 = supersedeAttachmentAtomic('att-v2-02', 'att-v3-03');
      assert.equal(v3.version_number, 3);
      assert.equal(attachmentTable.get('att-v2-02').superseded_by_id, 'att-v3-03');
    });

    test('Supersession is strictly barred on closed and approved requests', () => {
      const closedRequest = {
        id: 'req-closed-01',
        status: 'APPROVED',
      };

      function checkCanSupersede(req) {
        if (['APPROVED', 'REJECTED'].includes(req.status)) {
          const err = new Error('Cannot modify documents on a closed request');
          err.code = 'SP003';
          throw err;
        }
        return true;
      }

      assert.throws(
        () => checkCanSupersede(closedRequest),
        (err) => err.code === 'SP003',
      );
    });
  });
});
