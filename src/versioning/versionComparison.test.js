import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { diffVersions } from '../utils/versionDiff.js';

describe('Request Version Comparison & Diff Engine', () => {
  const v1 = {
    versionNumber: 1,
    title: 'Computer Lab Setup',
    description: 'Hardware equipment for Lab 4',
    budgetHead: { id: 101, name: 'Hardware & Infrastructure' },
    tentativeTotalCost: 200000,
    items: [
      {
        requestItemId: 'item-1',
        budgetItemId: 201,
        itemName: 'Core i7 PC',
        itemCode: 'IT-01',
        unit: 'Units',
        requestedQuantity: 4,
        estimatedUnitCost: 50000,
        estimatedTotal: 200000,
        remarks: 'Batch 1',
      },
    ],
    documents: [
      { attachmentId: 'att-1', fileName: 'vendor_quotation.pdf', sizeBytes: 15000 },
    ],
  };

  test('Identical version comparison reports zero deltas and UNCHANGED items', () => {
    const diff = diffVersions(v1, v1);

    assert.equal(diff.baseVersionNumber, 1);
    assert.equal(diff.targetVersionNumber, 1);
    assert.equal(diff.header.titleChanged, false);
    assert.equal(diff.header.costDiff, 0);
    assert.equal(diff.summary.itemsModifiedCount, 0);
    assert.equal(diff.summary.itemsAddedCount, 0);
    assert.equal(diff.summary.itemsRemovedCount, 0);
    assert.equal(diff.summary.docsAddedCount, 0);
    assert.equal(diff.items[0].status, 'UNCHANGED');
  });

  test('Correctly computes item quantity reduction and negative cost delta (savings)', () => {
    const v2 = {
      versionNumber: 2,
      title: 'Computer Lab Setup (Scaled Down)',
      description: 'Reduced from 4 to 3 units per committee recommendation',
      budgetHead: { id: 101, name: 'Hardware & Infrastructure' },
      tentativeTotalCost: 150000,
      items: [
        {
          requestItemId: 'item-1',
          budgetItemId: 201,
          itemName: 'Core i7 PC',
          itemCode: 'IT-01',
          unit: 'Units',
          requestedQuantity: 3,
          estimatedUnitCost: 50000,
          estimatedTotal: 150000,
          remarks: 'Reduced quantity per Purchase Committee',
        },
      ],
      documents: v1.documents,
    };

    const diff = diffVersions(v1, v2);

    assert.equal(diff.header.titleChanged, true);
    assert.equal(diff.header.oldTotalCost, 200000);
    assert.equal(diff.header.newTotalCost, 150000);
    assert.equal(diff.header.costDiff, -50000);
    assert.equal(diff.summary.netCostChange, -50000);

    assert.equal(diff.items.length, 1);
    const itemDiff = diff.items[0];
    assert.equal(itemDiff.status, 'MODIFIED');
    assert.equal(itemDiff.oldQty, 4);
    assert.equal(itemDiff.newQty, 3);
    assert.equal(itemDiff.qtyDiff, -1);
    assert.equal(itemDiff.oldTotal, 200000);
    assert.equal(itemDiff.newTotal, 150000);
    assert.equal(itemDiff.totalDiff, -50000);
  });

  test('Detects added and removed items across revisions', () => {
    const v2 = {
      versionNumber: 2,
      title: 'Computer Lab Setup with Accessories',
      description: 'Replaced high-end PC with standard PCs plus networking hub',
      budgetHead: { id: 101, name: 'Hardware & Infrastructure' },
      tentativeTotalCost: 180000,
      items: [
        // item-1 was removed
        {
          requestItemId: 'item-2',
          budgetItemId: 202,
          itemName: 'Standard PC i5',
          itemCode: 'IT-02',
          unit: 'Units',
          requestedQuantity: 4,
          estimatedUnitCost: 40000,
          estimatedTotal: 160000,
        },
        {
          requestItemId: 'item-3',
          budgetItemId: 203,
          itemName: 'Ethernet Switch',
          itemCode: 'NET-01',
          unit: 'Units',
          requestedQuantity: 1,
          estimatedUnitCost: 20000,
          estimatedTotal: 20000,
        },
      ],
      documents: v1.documents,
    };

    const diff = diffVersions(v1, v2);

    assert.equal(diff.summary.itemsRemovedCount, 1);
    assert.equal(diff.summary.itemsAddedCount, 2);

    const removedItem = diff.items.find((i) => i.status === 'REMOVED');
    assert.equal(removedItem.name, 'Core i7 PC');
    assert.equal(removedItem.totalDiff, -200000);

    const addedPCs = diff.items.find((i) => i.code === 'IT-02');
    assert.equal(addedPCs.status, 'ADDED');
    assert.equal(addedPCs.newQty, 4);

    const addedSwitch = diff.items.find((i) => i.code === 'NET-01');
    assert.equal(addedSwitch.status, 'ADDED');
    assert.equal(addedSwitch.newTotal, 20000);
  });

  test('Detects newly attached and superseded documents between versions', () => {
    const v2 = {
      versionNumber: 2,
      title: v1.title,
      description: v1.description,
      budgetHead: v1.budgetHead,
      tentativeTotalCost: v1.tentativeTotalCost,
      items: v1.items,
      documents: [
        { attachmentId: 'att-1', fileName: 'vendor_quotation.pdf', sizeBytes: 15000 },
        { attachmentId: 'att-2', fileName: 'revised_specifications.docx', sizeBytes: 25000 },
      ],
    };

    const diff = diffVersions(v1, v2);

    assert.equal(diff.documents.retained.length, 1);
    assert.equal(diff.documents.retained[0].fileName, 'vendor_quotation.pdf');
    assert.equal(diff.documents.added.length, 1);
    assert.equal(diff.documents.added[0].fileName, 'revised_specifications.docx');
    assert.equal(diff.summary.docsAddedCount, 1);
    assert.equal(diff.summary.docsRemovedCount, 0);
  });
});
