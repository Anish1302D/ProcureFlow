/**
 * Compares two request version snapshots and computes precise differences
 * in metadata, quantities, unit prices, line totals, and documents.
 */

export function diffVersions(baseVersion, targetVersion) {
  if (!baseVersion || !targetVersion) {
    return null;
  }

  // Header / metadata differences
  const headerDiff = {
    titleChanged: baseVersion.title !== targetVersion.title,
    oldTitle: baseVersion.title,
    newTitle: targetVersion.title,
    descriptionChanged: (baseVersion.description || '') !== (targetVersion.description || ''),
    oldDescription: baseVersion.description,
    newDescription: targetVersion.description,
    budgetHeadChanged: baseVersion.budgetHead?.id !== targetVersion.budgetHead?.id,
    oldBudgetHead: baseVersion.budgetHead?.name,
    newBudgetHead: targetVersion.budgetHead?.name,
    oldTotalCost: baseVersion.tentativeTotalCost || 0,
    newTotalCost: targetVersion.tentativeTotalCost || 0,
    costDiff: (targetVersion.tentativeTotalCost || 0) - (baseVersion.tentativeTotalCost || 0),
  };

  // Helper to normalize items
  const normalizeItem = (item) => ({
    id: String(item.request_item_id || item.requestItemId || item.budget_item_id || item.budgetItemId || ''),
    budgetItemId: item.budget_item_id || item.budgetItemId,
    name: item.item_name || item.itemName || 'Custom Item',
    code: item.item_code || item.itemCode || '',
    unit: item.unit || 'Units',
    quantity: Number(item.requested_quantity ?? item.requestedQuantity ?? 0),
    unitCost: Number(item.estimated_unit_cost ?? item.estimatedUnitCost ?? 0),
    total: Number(item.estimated_total ?? item.estimatedTotal ?? 0),
    remarks: item.remarks || '',
  });

  const baseItems = (baseVersion.items || []).map(normalizeItem);
  const targetItems = (targetVersion.items || []).map(normalizeItem);

  const baseItemsByBudgetId = new Map();
  baseItems.forEach((item) => {
    const key = item.budgetItemId ? `b-${item.budgetItemId}` : `i-${item.id}`;
    baseItemsByBudgetId.set(key, item);
  });

  const targetItemsByBudgetId = new Map();
  targetItems.forEach((item) => {
    const key = item.budgetItemId ? `b-${item.budgetItemId}` : `i-${item.id}`;
    targetItemsByBudgetId.set(key, item);
  });

  const allKeys = new Set([...baseItemsByBudgetId.keys(), ...targetItemsByBudgetId.keys()]);
  const itemDiffs = [];

  for (const key of allKeys) {
    const oldItem = baseItemsByBudgetId.get(key);
    const newItem = targetItemsByBudgetId.get(key);

    if (oldItem && !newItem) {
      itemDiffs.push({
        key,
        status: 'REMOVED',
        name: oldItem.name,
        code: oldItem.code,
        unit: oldItem.unit,
        oldQty: oldItem.quantity,
        newQty: 0,
        qtyDiff: -oldItem.quantity,
        oldUnitCost: oldItem.unitCost,
        newUnitCost: 0,
        costDiff: -oldItem.unitCost,
        oldTotal: oldItem.total,
        newTotal: 0,
        totalDiff: -oldItem.total,
        oldRemarks: oldItem.remarks,
        newRemarks: '',
      });
    } else if (!oldItem && newItem) {
      itemDiffs.push({
        key,
        status: 'ADDED',
        name: newItem.name,
        code: newItem.code,
        unit: newItem.unit,
        oldQty: 0,
        newQty: newItem.quantity,
        qtyDiff: newItem.quantity,
        oldUnitCost: 0,
        newUnitCost: newItem.unitCost,
        costDiff: newItem.unitCost,
        oldTotal: 0,
        newTotal: newItem.total,
        totalDiff: newItem.total,
        oldRemarks: '',
        newRemarks: newItem.remarks,
      });
    } else {
      const qtyDiff = newItem.quantity - oldItem.quantity;
      const costDiff = newItem.unitCost - oldItem.unitCost;
      const totalDiff = newItem.total - oldItem.total;
      const remarksChanged = oldItem.remarks !== newItem.remarks;

      const isModified = qtyDiff !== 0 || costDiff !== 0 || totalDiff !== 0 || remarksChanged;

      itemDiffs.push({
        key,
        status: isModified ? 'MODIFIED' : 'UNCHANGED',
        name: newItem.name || oldItem.name,
        code: newItem.code || oldItem.code,
        unit: newItem.unit || oldItem.unit,
        oldQty: oldItem.quantity,
        newQty: newItem.quantity,
        qtyDiff,
        oldUnitCost: oldItem.unitCost,
        newUnitCost: newItem.unitCost,
        costDiff,
        oldTotal: oldItem.total,
        newTotal: newItem.total,
        totalDiff,
        oldRemarks: oldItem.remarks,
        newRemarks: newItem.remarks,
      });
    }
  }

  // Document differences
  const normalizeDoc = (doc) => ({
    id: String(doc.attachment_id || doc.attachmentId || ''),
    fileName: doc.file_name || doc.fileName || 'Attachment',
    sizeBytes: doc.size_bytes || doc.sizeBytes || 0,
  });

  const baseDocs = (baseVersion.documents || []).map(normalizeDoc);
  const targetDocs = (targetVersion.documents || []).map(normalizeDoc);

  const baseDocNames = new Set(baseDocs.map((d) => d.fileName));
  const targetDocNames = new Set(targetDocs.map((d) => d.fileName));

  const addedDocs = targetDocs.filter((d) => !baseDocNames.has(d.fileName));
  const removedDocs = baseDocs.filter((d) => !targetDocNames.has(d.fileName));
  const retainedDocs = targetDocs.filter((d) => baseDocNames.has(d.fileName));

  return {
    baseVersionNumber: baseVersion.versionNumber,
    targetVersionNumber: targetVersion.versionNumber,
    header: headerDiff,
    items: itemDiffs,
    documents: {
      added: addedDocs,
      removed: removedDocs,
      retained: retainedDocs,
    },
    summary: {
      itemsAddedCount: itemDiffs.filter((i) => i.status === 'ADDED').length,
      itemsModifiedCount: itemDiffs.filter((i) => i.status === 'MODIFIED').length,
      itemsRemovedCount: itemDiffs.filter((i) => i.status === 'REMOVED').length,
      docsAddedCount: addedDocs.length,
      docsRemovedCount: removedDocs.length,
      netCostChange: headerDiff.costDiff,
    },
  };
}
