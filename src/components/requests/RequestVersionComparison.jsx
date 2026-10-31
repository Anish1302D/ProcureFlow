import React, { useState } from 'react';
import { ArrowRight, Check, Plus, Minus, FileText, ArrowLeftRight, AlertCircle } from 'lucide-react';
import { money } from '../../api/format';
import { diffVersions } from '../../utils/versionDiff';

export const RequestVersionComparison = ({ versions, initialBaseNumber, initialTargetNumber }) => {
  const [baseNum, setBaseNum] = useState(initialBaseNumber || versions?.[0]?.versionNumber || 1);
  const [targetNum, setTargetNum] = useState(initialTargetNumber || versions?.[versions?.length - 1]?.versionNumber || 1);

  if (!versions || versions.length < 2) {
    return (
      <div className="p-4 rounded-lg bg-gray-50 border border-gray-100 text-xs text-gray-500 text-center">
        At least two versions are required to display version comparison.
      </div>
    );
  }

  const baseVer = versions.find((v) => v.versionNumber === Number(baseNum));
  const targetVer = versions.find((v) => v.versionNumber === Number(targetNum));

  const diff = diffVersions(baseVer, targetVer);

  if (!diff) return null;

  return (
    <div className="space-y-4 rounded-xl border border-indigo-100 bg-white p-4 shadow-sm">
      {/* Version Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-700">
          <ArrowLeftRight className="w-4 h-4 text-indigo-600" />
          <span>Compare Versions:</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <select
            value={baseNum}
            onChange={(e) => setBaseNum(Number(e.target.value))}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 font-medium text-gray-800 text-xs focus:ring-1 focus:ring-indigo-500"
          >
            {versions.map((v) => (
              <option key={v.versionNumber} value={v.versionNumber}>
                v{v.versionNumber} {v.isCurrent ? '(Current)' : ''}
              </option>
            ))}
          </select>

          <ArrowRight className="w-3.5 h-3.5 text-gray-400" />

          <select
            value={targetNum}
            onChange={(e) => setTargetNum(Number(e.target.value))}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-gray-50 font-medium text-gray-800 text-xs focus:ring-1 focus:ring-indigo-500"
          >
            {versions.map((v) => (
              <option key={v.versionNumber} value={v.versionNumber}>
                v{v.versionNumber} {v.isCurrent ? '(Current)' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Comparison Summary Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
          <span className="text-[10px] text-gray-400 block mb-0.5">Base Total (v{diff.baseVersionNumber})</span>
          <span className="font-bold text-gray-800">{money(diff.header.oldTotalCost)}</span>
        </div>
        <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
          <span className="text-[10px] text-gray-400 block mb-0.5">Revised Total (v{diff.targetVersionNumber})</span>
          <span className="font-bold text-gray-800">{money(diff.header.newTotalCost)}</span>
        </div>
        <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
          <span className="text-[10px] text-gray-400 block mb-0.5">Net Cost Change</span>
          <span
            className={`font-bold flex items-center gap-1 ${
              diff.header.costDiff < 0
                ? 'text-emerald-700'
                : diff.header.costDiff > 0
                ? 'text-amber-700'
                : 'text-gray-700'
            }`}
          >
            {diff.header.costDiff > 0 ? `+${money(diff.header.costDiff)}` : diff.header.costDiff < 0 ? `-${money(Math.abs(diff.header.costDiff))}` : '₹0.00'}
          </span>
        </div>
        <div className="p-2.5 rounded-lg bg-gray-50 border border-gray-100">
          <span className="text-[10px] text-gray-400 block mb-0.5">Item Revisions</span>
          <span className="font-medium text-gray-700">
            {diff.summary.itemsModifiedCount} modified, {diff.summary.itemsAddedCount} added, {diff.summary.itemsRemovedCount} removed
          </span>
        </div>
      </div>

      {/* Metadata Differences (if title, description, or budget head changed) */}
      {(diff.header.titleChanged || diff.header.descriptionChanged || diff.header.budgetHeadChanged) && (
        <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200 text-xs space-y-2">
          <h6 className="font-bold text-amber-900 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            Field Differences:
          </h6>
          {diff.header.titleChanged && (
            <div className="pl-5 text-gray-700">
              <span className="font-semibold text-gray-900">Title: </span>
              <span className="line-through text-rose-600 mr-2">{diff.header.oldTitle}</span>
              <ArrowRight className="w-3 h-3 inline text-gray-400 mr-2" />
              <span className="text-emerald-700 font-medium">{diff.header.newTitle}</span>
            </div>
          )}
          {diff.header.budgetHeadChanged && (
            <div className="pl-5 text-gray-700">
              <span className="font-semibold text-gray-900">Budget Head: </span>
              <span className="line-through text-rose-600 mr-2">{diff.header.oldBudgetHead}</span>
              <ArrowRight className="w-3 h-3 inline text-gray-400 mr-2" />
              <span className="text-emerald-700 font-medium">{diff.header.newBudgetHead}</span>
            </div>
          )}
          {diff.header.descriptionChanged && (
            <div className="pl-5 text-gray-700 space-y-1">
              <span className="font-semibold text-gray-900">Description / Justification updated.</span>
            </div>
          )}
        </div>
      )}

      {/* Items Diff Table */}
      <div className="space-y-1.5">
        <h6 className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
          Line Item Differences ({diff.items.length})
        </h6>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-xs">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Item Name</th>
                <th className="px-3 py-2 text-right font-medium">Quantity</th>
                <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {diff.items.map((item) => {
                const isAdded = item.status === 'ADDED';
                const isRemoved = item.status === 'REMOVED';
                const isModified = item.status === 'MODIFIED';

                let rowBg = 'bg-white';
                if (isAdded) rowBg = 'bg-emerald-50/40';
                else if (isRemoved) rowBg = 'bg-rose-50/40';
                else if (isModified) rowBg = 'bg-amber-50/30';

                return (
                  <tr key={item.key} className={rowBg}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {isAdded && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1 w-max">
                          <Plus className="w-3 h-3" /> ADDED
                        </span>
                      )}
                      {isRemoved && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 flex items-center gap-1 w-max">
                          <Minus className="w-3 h-3" /> REMOVED
                        </span>
                      )}
                      {isModified && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 flex items-center gap-1 w-max">
                          MODIFIED
                        </span>
                      )}
                      {!isAdded && !isRemoved && !isModified && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 flex items-center gap-1 w-max">
                          <Check className="w-3 h-3 text-gray-400" /> UNCHANGED
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`font-medium ${isRemoved ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                        {item.name}
                      </span>
                      {item.code && <span className="text-gray-400 text-[10px] ml-1.5">({item.code})</span>}
                      {item.remarksChanged && (
                        <p className="text-[10px] text-amber-700 italic mt-0.5">
                          Remarks: "{item.oldRemarks || '—'}" → "{item.newRemarks}"
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {isModified && item.qtyDiff !== 0 ? (
                        <span>
                          <span className="text-gray-400 line-through mr-1">{item.oldQty}</span>
                          <ArrowRight className="w-3 h-3 inline text-gray-400 mr-1" />
                          <span className="font-bold text-gray-900">{item.newQty}</span>
                          <span className={`text-[10px] ml-1.5 ${item.qtyDiff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            ({item.qtyDiff > 0 ? `+${item.qtyDiff}` : item.qtyDiff})
                          </span>
                        </span>
                      ) : (
                        <span>{item.newQty || item.oldQty} {item.unit}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {isModified && item.costDiff !== 0 ? (
                        <span>
                          <span className="text-gray-400 line-through mr-1">{money(item.oldUnitCost)}</span>
                          <ArrowRight className="w-3 h-3 inline text-gray-400 mr-1" />
                          <span className="font-bold text-gray-900">{money(item.newUnitCost)}</span>
                        </span>
                      ) : (
                        <span>{money(item.newUnitCost || item.oldUnitCost)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                      {isModified && item.totalDiff !== 0 ? (
                        <span>
                          <span className="text-gray-400 line-through mr-1">{money(item.oldTotal)}</span>
                          <ArrowRight className="w-3 h-3 inline text-gray-400 mr-1" />
                          <span className="font-bold text-gray-900">{money(item.newTotal)}</span>
                          <span className={`text-[10px] ml-1.5 block ${item.totalDiff > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                            {item.totalDiff > 0 ? `+${money(item.totalDiff)}` : `-${money(Math.abs(item.totalDiff))}`}
                          </span>
                        </span>
                      ) : (
                        <span className="font-semibold text-gray-800">{money(item.newTotal || item.oldTotal)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Documents Diff */}
      {(diff.documents.added.length > 0 || diff.documents.removed.length > 0) && (
        <div className="space-y-1.5 pt-2 border-t border-gray-100">
          <h6 className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
            Document Changes
          </h6>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {diff.documents.added.map((doc) => (
              <div key={doc.id || doc.fileName} className="p-2 rounded bg-emerald-50 border border-emerald-200 flex items-center justify-between">
                <div className="flex items-center gap-2 overflow-hidden">
                  <Plus className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <FileText className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span className="truncate font-medium text-emerald-900">{doc.fileName}</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-200 text-emerald-800">
                  NEW
                </span>
              </div>
            ))}
            {diff.documents.removed.map((doc) => (
              <div key={doc.id || doc.fileName} className="p-2 rounded bg-rose-50 border border-rose-200 flex items-center justify-between">
                <div className="flex items-center gap-2 overflow-hidden">
                  <Minus className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                  <FileText className="w-4 h-4 text-rose-400 shrink-0" />
                  <span className="truncate line-through font-medium text-rose-900">{doc.fileName}</span>
                </div>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-200 text-rose-800">
                  SUPERSEDED
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
