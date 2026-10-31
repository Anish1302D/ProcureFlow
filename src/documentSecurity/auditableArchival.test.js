import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('Auditable Document Archival & Retention Enforcement', () => {
  class DocumentAuditStore {
    constructor() {
      this.documents = new Map();
      this.auditLogs = [];
    }

    addDocument(doc) {
      this.documents.set(doc.id, {
        ...doc,
        archivedAt: null,
        archivedBy: null,
        archivedByRole: null,
        archivedReason: null,
      });
      return this.documents.get(doc.id);
    }

    archiveDocument(attachmentId, actor, reason) {
      const doc = this.documents.get(attachmentId);
      if (!doc) throw new Error('Attachment not found');
      if (doc.archivedAt) throw new Error('Attachment is already archived');
      if (!reason || reason.trim().length === 0) {
        throw new Error('A reason is required to archive an evidentiary document');
      }

      const timestamp = new Date().toISOString();
      const userRole = actor.roles[0] || 'USER';

      // Soft removal
      doc.archivedAt = timestamp;
      doc.archivedBy = actor.id;
      doc.archivedByRole = userRole;
      doc.archivedReason = reason.trim();

      // Emit audit log
      this.auditLogs.push({
        entityType: 'attachment',
        entityId: attachmentId,
        actorUserId: actor.id,
        action: 'ARCHIVE_ATTACHMENT',
        beforeJson: {
          id: doc.id,
          fileName: doc.fileName,
          versionNumber: doc.versionNumber,
          supersededById: doc.supersededById,
        },
        afterJson: {
          archivedAt: timestamp,
          archivedBy: actor.id,
          archivedByRole: userRole,
          archivedReason: reason.trim(),
        },
      });

      return doc;
    }

    canDownload(attachmentId) {
      const doc = this.documents.get(attachmentId);
      if (!doc) return false;
      if (doc.archivedAt !== null) return false; // Archived files cannot be accessed via ordinary download
      return true;
    }
  }

  test('Archiving document records actor, role, timestamp and mandatory reason', () => {
    const store = new DocumentAuditStore();
    store.addDocument({
      id: 'doc-tender-01',
      fileName: 'tender_specification_v1.pdf',
      versionNumber: 1,
      supersededById: null,
    });

    const actor = { id: 'user-head-cs', roles: ['HEAD'] };
    const archived = store.archiveDocument(
      'doc-tender-01',
      actor,
      'Replaced by institutional framework contract with GEM portal',
    );

    assert.ok(archived.archivedAt !== null);
    assert.equal(archived.archivedBy, 'user-head-cs');
    assert.equal(archived.archivedByRole, 'HEAD');
    assert.equal(
      archived.archivedReason,
      'Replaced by institutional framework contract with GEM portal',
    );
  });

  test('Archiving requires non-empty reason and rejects blank reasons', () => {
    const store = new DocumentAuditStore();
    store.addDocument({ id: 'doc-02', fileName: 'sample.pdf', versionNumber: 1, supersededById: null });

    assert.throws(
      () => store.archiveDocument('doc-02', { id: 'user-01', roles: ['FACULTY'] }, '   '),
      /reason is required/,
    );
  });

  test('Archiving generates an immutable audit log entry for regulatory compliance', () => {
    const store = new DocumentAuditStore();
    store.addDocument({
      id: 'doc-financial-audit',
      fileName: 'sanction_letter_2026.pdf',
      versionNumber: 1,
      supersededById: null,
    });

    store.archiveDocument(
      'doc-financial-audit',
      { id: 'user-admin', roles: ['ADMIN'] },
      'Annual financial audit cycle archival',
    );

    assert.equal(store.auditLogs.length, 1);
    const log = store.auditLogs[0];
    assert.equal(log.entityType, 'attachment');
    assert.equal(log.entityId, 'doc-financial-audit');
    assert.equal(log.action, 'ARCHIVE_ATTACHMENT');
    assert.equal(log.actorUserId, 'user-admin');
    assert.equal(log.afterJson.archivedByRole, 'ADMIN');
  });

  test('Ordinary download routes strictly refuse archived documents', () => {
    const store = new DocumentAuditStore();
    store.addDocument({ id: 'doc-active', fileName: 'active.pdf', versionNumber: 1, supersededById: null });
    store.addDocument({ id: 'doc-old', fileName: 'old.pdf', versionNumber: 1, supersededById: null });

    store.archiveDocument('doc-old', { id: 'user-admin', roles: ['ADMIN'] }, 'Archived per policy');

    assert.equal(store.canDownload('doc-active'), true);
    assert.equal(store.canDownload('doc-old'), false);
  });

  test('Historical version relationships are preserved after archival', () => {
    const store = new DocumentAuditStore();
    store.addDocument({
      id: 'doc-v1',
      fileName: 'quotation_v1.pdf',
      versionNumber: 1,
      supersededById: 'doc-v2',
    });
    store.addDocument({
      id: 'doc-v2',
      fileName: 'quotation_v2.pdf',
      versionNumber: 2,
      supersededById: null,
    });

    // Archiving v2 keeps v1 intact with its supersededById pointer
    store.archiveDocument('doc-v2', { id: 'user-admin', roles: ['ADMIN'] }, 'Archived requisition version');

    assert.equal(store.documents.get('doc-v1').supersededById, 'doc-v2');
    assert.equal(store.documents.get('doc-v2').versionNumber, 2);
    assert.ok(store.documents.get('doc-v2').archivedAt !== null);
  });
});
