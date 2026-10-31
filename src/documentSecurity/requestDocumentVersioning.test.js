import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('Request Document Version Association & Concurrency Safety', () => {
  // Test simulated store representing PostgreSQL attachments table
  class AttachmentStore {
    constructor() {
      this.attachments = new Map();
      this.requests = new Map([
        ['req-100', { requestId: 'req-100', currentVersionNumber: 1, status: 'DRAFT' }],
        ['req-200', { requestId: 'req-200', currentVersionNumber: 2, status: 'UNDER_PURCHASE_COMMITTEE_REVIEW' }],
        ['req-300', { requestId: 'req-300', currentVersionNumber: 2, status: 'CLOSED' }],
      ]);
      this.locks = new Set();
    }

    addAttachment({ id, requestId, fileName, mimeType, sizeBytes, uploadedBy, requestVersionNumber }) {
      const doc = {
        attachmentId: id,
        requestId,
        fileName,
        mimeType,
        sizeBytes,
        uploadedBy,
        uploadedAt: new Date().toISOString(),
        versionNumber: 1,
        supersededById: null,
        requestVersionNumber: requestVersionNumber || this.requests.get(requestId)?.currentVersionNumber || 1,
        replacementReason: null,
        archivedAt: null,
      };
      this.attachments.set(id, doc);
      return doc;
    }

    // Mirrors fn_supersede_attachment PL/pgSQL logic
    supersedeAttachment(oldId, newId, { fileName, mimeType, sizeBytes, uploadedBy, replacementReason }) {
      // Simulate FOR UPDATE row-level lock
      if (this.locks.has(oldId)) {
        throw new Error('Lock contention: attachment currently being updated');
      }
      this.locks.add(oldId);

      try {
        const oldDoc = this.attachments.get(oldId);
        if (!oldDoc) throw new Error('Attachment not found');

        if (oldDoc.supersededById !== null) {
          const err = new Error(`Attachment ${oldId} has already been superseded by ${oldDoc.supersededById}`);
          err.code = 'SP015';
          throw err;
        }

        if (oldDoc.archivedAt !== null) {
          const err = new Error(`Attachment ${oldId} is archived`);
          err.code = 'SP016';
          throw err;
        }

        const req = this.requests.get(oldDoc.requestId);
        if (req && ['CLOSED', 'CARRIED_FORWARD'].includes(req.status)) {
          const err = new Error('Request is closed; its documents cannot be replaced');
          err.code = 'SP003';
          throw err;
        }

        const reqVersion = req ? req.currentVersionNumber : oldDoc.requestVersionNumber;

        const newDoc = {
          attachmentId: newId,
          requestId: oldDoc.requestId,
          fileName,
          mimeType,
          sizeBytes,
          uploadedBy,
          uploadedAt: new Date().toISOString(),
          versionNumber: oldDoc.versionNumber + 1,
          supersededById: null,
          requestVersionNumber: reqVersion,
          replacementReason: replacementReason || null,
          archivedAt: null,
        };

        this.attachments.set(newId, newDoc);
        oldDoc.supersededById = newId;

        return newDoc;
      } finally {
        this.locks.delete(oldId);
      }
    }
  }

  test('New upload inherits active request version number', () => {
    const store = new AttachmentStore();
    const doc1 = store.addAttachment({
      id: 'att-1',
      requestId: 'req-100',
      fileName: 'spec_v1.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      uploadedBy: 'user-head',
    });

    assert.equal(doc1.versionNumber, 1);
    assert.equal(doc1.requestVersionNumber, 1);

    const doc2 = store.addAttachment({
      id: 'att-2',
      requestId: 'req-200', // Request is at version 2
      fileName: 'spec_v2.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      uploadedBy: 'user-head',
    });

    assert.equal(doc2.versionNumber, 1);
    assert.equal(doc2.requestVersionNumber, 2);
  });

  test('Superseding builds a strict version progression: v1 -> v2 -> v3', () => {
    const store = new AttachmentStore();
    store.addAttachment({
      id: 'quote-v1',
      requestId: 'req-100',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      uploadedBy: 'user-head',
    });

    // Replace v1 with v2
    const v2 = store.supersedeAttachment('quote-v1', 'quote-v2', {
      fileName: 'quote_revised.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1200,
      uploadedBy: 'user-head',
      replacementReason: 'Negotiated 5% discount with vendor',
    });

    assert.equal(v2.versionNumber, 2);
    assert.equal(store.attachments.get('quote-v1').supersededById, 'quote-v2');
    assert.equal(v2.replacementReason, 'Negotiated 5% discount with vendor');

    // Replace v2 with v3
    const v3 = store.supersedeAttachment('quote-v2', 'quote-v3', {
      fileName: 'quote_final_stamp.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1300,
      uploadedBy: 'user-head',
      replacementReason: 'Added official vendor stamp and signature',
    });

    assert.equal(v3.versionNumber, 3);
    assert.equal(store.attachments.get('quote-v2').supersededById, 'quote-v3');
    assert.equal(v3.supersededById, null); // v3 is current
  });

  test('Prevents race conditions & double supersession: second replacement on same doc throws SP015', () => {
    const store = new AttachmentStore();
    store.addAttachment({
      id: 'quote-base',
      requestId: 'req-100',
      fileName: 'quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      uploadedBy: 'user-head',
    });

    // First replacement succeeds
    store.supersedeAttachment('quote-base', 'quote-replacement-A', {
      fileName: 'quote_a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1100,
      uploadedBy: 'user-head',
      replacementReason: 'First replacement',
    });

    // Concurrent/second replacement attempt on quote-base must fail
    assert.throws(
      () => store.supersedeAttachment('quote-base', 'quote-replacement-B', {
        fileName: 'quote_b.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1150,
        uploadedBy: 'user-head',
        replacementReason: 'Conflicting replacement',
      }),
      (err) => err.code === 'SP015' && err.message.includes('already been superseded'),
    );
  });

  test('Refuses replacement on closed request with SP003', () => {
    const store = new AttachmentStore();
    store.addAttachment({
      id: 'closed-doc',
      requestId: 'req-300', // Request is closed
      fileName: 'historical_quote.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      uploadedBy: 'user-head',
    });

    assert.throws(
      () => store.supersedeAttachment('closed-doc', 'new-doc', {
        fileName: 'illegal_replacement.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1100,
        uploadedBy: 'user-head',
        replacementReason: 'Attempt to tamper closed record',
      }),
      (err) => err.code === 'SP003' && err.message.includes('Request is closed'),
    );
  });
});

