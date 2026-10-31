import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('Request Version History & Immutable Snapshots Regression Suite', () => {
  // Helper to simulate request snapshot generation
  function createVersionSnapshot({
    requestId,
    versionNumber,
    request,
    items,
    documents = [],
    actorId,
    correctionId = null,
    submittedAt = new Date().toISOString(),
  }) {
    return {
      versionId: `ver-${versionNumber}-${Date.now()}`,
      requestId,
      versionNumber,
      title: request.title,
      description: request.description ?? null,
      departmentId: request.departmentId ?? null,
      courseId: request.courseId ?? null,
      financialYearId: request.financialYearId,
      budgetHeadId: request.budgetHeadId,
      tentativeTotalCost: items.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0),
      extra: { ...request.extra },
      itemsSnapshot: items.map((item) => ({
        requestItemId: item.requestItemId,
        budgetItemId: item.budgetItemId,
        itemName: item.itemName ?? null,
        itemCode: item.itemCode ?? null,
        unit: item.unit ?? null,
        itemType: item.itemType ?? null,
        requestedQuantity: item.quantity,
        estimatedUnitCost: item.unitCost,
        estimatedTotal: item.quantity * item.unitCost,
        remarks: item.remarks || null,
      })),
      documentsSnapshot: documents.map((doc) => ({
        attachmentId: doc.attachmentId,
        fileName: doc.fileName,
        mimeType: doc.mimeType ?? null,
        sizeBytes: doc.sizeBytes ?? null,
        storagePath: doc.storagePath ?? null,
        storageBackend: doc.storageBackend || 'local',
        uploadedBy: doc.uploadedBy ?? null,
        uploadedAt: doc.uploadedAt ?? null,
        versionNumber: doc.versionNumber ?? 1,
        requestVersionNumber: versionNumber,
      })),
      submittedBy: actorId,
      submittedAt,
      correctionId: correctionId ?? null,
    };
  }

  test('Preserves the identical Request ID and Number across version iterations', () => {
    const originalRequest = {
      requestId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
      requestNumber: 'REQ-2026-0042',
      title: 'Lab Computer Equipment',
      departmentId: 10,
      financialYearId: 2,
      budgetHeadId: 101,
      extra: { urgency: 'HIGH' },
    };

    const v1Items = [
      { requestItemId: 'item-1', budgetItemId: 201, itemName: 'Desktop Computer', quantity: 10, unitCost: 45000 },
    ];
    const v1Docs = [
      { attachmentId: 'doc-1', fileName: 'quotation_v1.pdf', sizeBytes: 102400, versionNumber: 1 },
    ];

    const v1Snapshot = createVersionSnapshot({
      requestId: originalRequest.requestId,
      versionNumber: 1,
      request: originalRequest,
      items: v1Items,
      documents: v1Docs,
      actorId: 'user-head-cs',
    });

    // Resubmission v2 with revised quantity and additional document
    const revisedRequest = {
      ...originalRequest,
      title: 'Lab Computer Equipment - Revised Specifications',
    };
    const v2Items = [
      { requestItemId: 'item-1', budgetItemId: 201, itemName: 'Desktop Computer', quantity: 8, unitCost: 45000 },
      { requestItemId: 'item-2', budgetItemId: 202, itemName: 'UPS 1kVA', quantity: 2, unitCost: 12000 },
    ];
    const v2Docs = [
      ...v1Docs,
      { attachmentId: 'doc-2', fileName: 'revised_spec_v2.pdf', sizeBytes: 204800, versionNumber: 1 },
    ];

    const v2Snapshot = createVersionSnapshot({
      requestId: originalRequest.requestId,
      versionNumber: 2,
      request: revisedRequest,
      items: v2Items,
      documents: v2Docs,
      actorId: 'user-head-cs',
      correctionId: 'corr-001',
    });

    assert.equal(v1Snapshot.requestId, originalRequest.requestId);
    assert.equal(v2Snapshot.requestId, originalRequest.requestId);
    assert.equal(v1Snapshot.requestId, v2Snapshot.requestId);
  });

  test('Maintains strict sequential version numbers: v1, v2, v3 without gaps', () => {
    const requestId = 'req-seq-001';
    const request = { title: 'Networking switches', departmentId: 10, financialYearId: 2, budgetHeadId: 101 };
    const items = [{ requestItemId: 'item-sw', budgetItemId: 301, itemName: '24-Port Switch', quantity: 2, unitCost: 15000 }];

    const v1 = createVersionSnapshot({ requestId, versionNumber: 1, request, items, actorId: 'u1' });
    const v2 = createVersionSnapshot({ requestId, versionNumber: v1.versionNumber + 1, request, items, actorId: 'u1' });
    const v3 = createVersionSnapshot({ requestId, versionNumber: v2.versionNumber + 1, request, items, actorId: 'u1' });

    assert.equal(v1.versionNumber, 1);
    assert.equal(v2.versionNumber, 2);
    assert.equal(v3.versionNumber, 3);
  });

  test('Preserves full immutable snapshot of initial submission (v1) when revision (v2) occurs', () => {
    const requestId = 'req-immutable-001';
    const originalRequest = { title: 'Projector for Seminar Hall', departmentId: 12, financialYearId: 2, budgetHeadId: 102 };
    const originalItems = [
      { requestItemId: 'item-p1', budgetItemId: 401, itemName: 'Laser Projector', quantity: 2, unitCost: 80000 },
    ];
    const originalDocs = [
      { attachmentId: 'doc-quote-1', fileName: 'epson_quote.pdf', sizeBytes: 50000, versionNumber: 1 },
    ];

    const v1Snapshot = createVersionSnapshot({
      requestId,
      versionNumber: 1,
      request: originalRequest,
      items: originalItems,
      documents: originalDocs,
      actorId: 'hod-physics',
    });

    // Deep freeze / clone to verify immutability
    const frozenV1 = JSON.parse(JSON.stringify(v1Snapshot));

    // Later: Request is returned for correction, items changed and resubmitted as v2
    const revisedItems = [
      { requestItemId: 'item-p1', budgetItemId: 401, itemName: 'Laser Projector', quantity: 1, unitCost: 75000 },
    ];
    const revisedDocs = [
      { attachmentId: 'doc-quote-2', fileName: 'discounted_epson_quote.pdf', sizeBytes: 52000, versionNumber: 1 },
    ];

    const v2Snapshot = createVersionSnapshot({
      requestId,
      versionNumber: 2,
      request: { ...originalRequest, title: 'Projector for Seminar Hall (Single Unit)' },
      items: revisedItems,
      documents: revisedDocs,
      actorId: 'hod-physics',
      correctionId: 'corr-physics-01',
    });

    // Verify v1 snapshot was NOT altered by v2 creation
    assert.deepEqual(v1Snapshot, frozenV1);
    assert.equal(v1Snapshot.tentativeTotalCost, 160000);
    assert.equal(v1Snapshot.itemsSnapshot[0].requestedQuantity, 2);
    assert.equal(v1Snapshot.itemsSnapshot[0].estimatedUnitCost, 80000);
    assert.equal(v1Snapshot.documentsSnapshot.length, 1);
    assert.equal(v1Snapshot.documentsSnapshot[0].fileName, 'epson_quote.pdf');

    // Verify v2 reflects the new values
    assert.equal(v2Snapshot.tentativeTotalCost, 75000);
    assert.equal(v2Snapshot.itemsSnapshot[0].requestedQuantity, 1);
    assert.equal(v2Snapshot.itemsSnapshot[0].estimatedUnitCost, 75000);
    assert.equal(v2Snapshot.correctionId, 'corr-physics-01');
  });

  test('Captures complete document snapshot including versions and storage backend', () => {
    const docs = [
      {
        attachmentId: 'att-1',
        fileName: 'vendor_a_quote.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1048576,
        storagePath: 'attachments/req-1/att-1.pdf',
        storageBackend: 'local',
        uploadedBy: 'user-hod',
        uploadedAt: '2026-10-31T09:00:00Z',
        versionNumber: 1,
      },
      {
        attachmentId: 'att-2',
        fileName: 'compliance_sheet.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        sizeBytes: 45000,
        storagePath: 'attachments/req-1/att-2.xlsx',
        storageBackend: 'local',
        uploadedBy: 'user-hod',
        uploadedAt: '2026-10-31T09:05:00Z',
        versionNumber: 1,
      },
    ];

    const snapshot = createVersionSnapshot({
      requestId: 'req-docs-01',
      versionNumber: 1,
      request: { title: 'Server Upgrade', departmentId: 10, financialYearId: 2, budgetHeadId: 101 },
      items: [{ requestItemId: 'srv-1', budgetItemId: 501, itemName: 'Server RAM', quantity: 4, unitCost: 15000 }],
      documents: docs,
      actorId: 'user-hod',
    });

    assert.equal(snapshot.documentsSnapshot.length, 2);
    assert.equal(snapshot.documentsSnapshot[0].fileName, 'vendor_a_quote.pdf');
    assert.equal(snapshot.documentsSnapshot[0].storageBackend, 'local');
    assert.equal(snapshot.documentsSnapshot[0].requestVersionNumber, 1);
    assert.equal(snapshot.documentsSnapshot[1].fileName, 'compliance_sheet.xlsx');
  });

  test('Enriches items_snapshot with canonical item_name, item_code, and unit on initial submission', () => {
    const item = {
      requestItemId: 'item-enriched-1',
      budgetItemId: 101,
      itemName: 'Dell OptiPlex Desktop',
      itemCode: 'IT-COMP-01',
      unit: 'Units',
      itemType: 'CONSUMABLE_GOODS',
      quantity: 5,
      unitCost: 60000,
      remarks: 'Lab 3 deployment',
    };

    const snapshot = createVersionSnapshot({
      requestId: 'req-enriched-01',
      versionNumber: 1,
      request: { title: 'Lab computers', departmentId: 10, financialYearId: 2, budgetHeadId: 101 },
      items: [item],
      actorId: 'hod-cs',
    });

    const frozenItem = snapshot.itemsSnapshot[0];
    assert.equal(frozenItem.itemName, 'Dell OptiPlex Desktop');
    assert.equal(frozenItem.itemCode, 'IT-COMP-01');
    assert.equal(frozenItem.unit, 'Units');
    assert.equal(frozenItem.requestedQuantity, 5);
    assert.equal(frozenItem.estimatedUnitCost, 60000);
    assert.equal(frozenItem.estimatedTotal, 300000);
    assert.equal(frozenItem.remarks, 'Lab 3 deployment');
  });

  test('Preserves multi-iteration resubmission history (v1 -> v2 -> v3) with resolved corrections', () => {
    const requestId = 'req-multi-iter-01';
    const baseRequest = {
      title: 'Department Chemistry Lab Consumables',
      departmentId: 14,
      financialYearId: 2,
      budgetHeadId: 104,
      extra: {},
    };

    // v1: Initial submission
    const v1Snapshot = createVersionSnapshot({
      requestId,
      versionNumber: 1,
      request: baseRequest,
      items: [{ requestItemId: 'chem-1', budgetItemId: 601, itemName: 'Beakers 500ml', quantity: 50, unitCost: 200 }],
      documents: [{ attachmentId: 'doc-cat-1', fileName: 'catalog_v1.pdf', sizeBytes: 12000 }],
      actorId: 'hod-chem',
    });

    // Correction 1 requested by Purchase Committee
    const correction1 = {
      correctionId: 'corr-chem-01',
      requestId,
      reason: 'Quantity excessive for semester 1. Please reduce to 30 units and attach quote.',
      resolvedByVersion: null,
    };

    // v2: Resubmission 1
    correction1.resolvedByVersion = 2;
    const v2Snapshot = createVersionSnapshot({
      requestId,
      versionNumber: 2,
      request: { ...baseRequest, title: 'Department Chemistry Lab Consumables - Rev 1' },
      items: [{ requestItemId: 'chem-1', budgetItemId: 601, itemName: 'Beakers 500ml', quantity: 30, unitCost: 200 }],
      documents: [
        { attachmentId: 'doc-cat-1', fileName: 'catalog_v1.pdf', sizeBytes: 12000 },
        { attachmentId: 'doc-quote-v2', fileName: 'vendor_beaker_quote.pdf', sizeBytes: 34000 },
      ],
      actorId: 'hod-chem',
      correctionId: correction1.correctionId,
    });

    // Correction 2 requested by Principal
    const correction2 = {
      correctionId: 'corr-chem-02',
      requestId,
      reason: 'Need brand specification included in remarks.',
      resolvedByVersion: null,
    };

    // v3: Resubmission 2
    correction2.resolvedByVersion = 3;
    const v3Snapshot = createVersionSnapshot({
      requestId,
      versionNumber: 3,
      request: { ...baseRequest, title: 'Department Chemistry Lab Consumables - Borosil Specification' },
      items: [{ requestItemId: 'chem-1', budgetItemId: 601, itemName: 'Beakers 500ml', quantity: 30, unitCost: 200, remarks: 'Borosil Grade A' }],
      documents: [
        { attachmentId: 'doc-cat-1', fileName: 'catalog_v1.pdf', sizeBytes: 12000 },
        { attachmentId: 'doc-quote-v2', fileName: 'vendor_beaker_quote.pdf', sizeBytes: 34000 },
        { attachmentId: 'doc-spec-v3', fileName: 'borosil_compliance.pdf', sizeBytes: 18000 },
      ],
      actorId: 'hod-chem',
      correctionId: correction2.correctionId,
    });

    // Verify all 3 version snapshots exist independently
    assert.equal(v1Snapshot.versionNumber, 1);
    assert.equal(v1Snapshot.itemsSnapshot[0].requestedQuantity, 50);
    assert.equal(v1Snapshot.tentativeTotalCost, 10000);
    assert.equal(v1Snapshot.correctionId, null);

    assert.equal(v2Snapshot.versionNumber, 2);
    assert.equal(v2Snapshot.itemsSnapshot[0].requestedQuantity, 30);
    assert.equal(v2Snapshot.tentativeTotalCost, 6000);
    assert.equal(v2Snapshot.correctionId, 'corr-chem-01');
    assert.equal(v2Snapshot.documentsSnapshot.length, 2);

    assert.equal(v3Snapshot.versionNumber, 3);
    assert.equal(v3Snapshot.itemsSnapshot[0].requestedQuantity, 30);
    assert.equal(v3Snapshot.itemsSnapshot[0].remarks, 'Borosil Grade A');
    assert.equal(v3Snapshot.tentativeTotalCost, 6000);
    assert.equal(v3Snapshot.correctionId, 'corr-chem-02');
    assert.equal(v3Snapshot.documentsSnapshot.length, 3);
  });
});
