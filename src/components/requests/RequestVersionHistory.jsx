import React, { useState } from 'react';
import { Clock, GitCommit, History, AlertCircle, FileText, ArrowLeft } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { date, money } from '../../api/format';
import { Loading } from '../ui/States';

export const RequestVersionHistory = ({ requestId, currentVersionNumber }) => {
  const { data: versions, loading, error } = useApi(requestId ? `/api/requests/${requestId}/versions` : null);
  const [selectedVersion, setSelectedVersion] = useState(null);

  if (loading) {
    return <Loading text="Loading version history…" />;
  }

  if (error || !versions || versions.length === 0) {
    return null; // No version history available or unsubmitted draft
  }

  const activeVersion = selectedVersion
    ? versions.find((v) => v.versionNumber === selectedVersion)
    : null;

  return (
    <div className="space-y-4">
      {/* Version timeline list */}
      <div className="flex flex-wrap items-center gap-2">
        {versions.map((ver) => {
          const isSelected = selectedVersion === ver.versionNumber;
          const isCurrent = ver.isCurrent || ver.versionNumber === currentVersionNumber;

          return (
            <button
              key={ver.versionId}
              type="button"
              onClick={() => setSelectedVersion(isSelected ? null : ver.versionNumber)}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-all flex items-center gap-2 ${
                isSelected
                  ? 'bg-indigo-50 border-indigo-400 text-indigo-700 ring-2 ring-indigo-200'
                  : isCurrent
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                  : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
              }`}
            >
              <GitCommit className={`w-3.5 h-3.5 ${isCurrent ? 'text-emerald-600' : 'text-gray-400'}`} />
              <span className="font-semibold">v{ver.versionNumber}</span>
              {isCurrent && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700 uppercase">
                  Current
                </span>
              )}
              <span className="text-gray-500 font-normal">({money(ver.tentativeTotalCost)})</span>
            </button>
          );
        })}
      </div>

      {/* Selected Version Detail Snapshot View */}
      {activeVersion ? (
        <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-indigo-100">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-md bg-indigo-100 text-indigo-700">
                <History className="w-4 h-4" />
              </span>
              <div>
                <h5 className="text-xs font-bold text-gray-900 flex items-center gap-2">
                  Version {activeVersion.versionNumber} Snapshot
                  {activeVersion.isCurrent ? (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                      CURRENT
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-gray-200 text-gray-700">
                      HISTORICAL
                    </span>
                  )}
                </h5>
                <p className="text-[11px] text-gray-500">
                  Submitted on {date(activeVersion.submittedAt)} by {activeVersion.submittedBy?.name || 'Requester'}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setSelectedVersion(null)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to summary
            </button>
          </div>

          {/* Correction reason if resubmitted */}
          {activeVersion.correction && (
            <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 space-y-1">
              <p className="font-semibold flex items-center gap-1.5 text-amber-900">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                Resubmitted in response to correction request:
              </p>
              <p className="pl-5 text-gray-700 italic">"{activeVersion.correction.reason}"</p>
              {activeVersion.correction.requestedBy && (
                <p className="pl-5 text-[10px] text-gray-500">
                  Requested by {activeVersion.correction.requestedBy.name}
                  {activeVersion.correction.stageName ? ` (${activeVersion.correction.stageName})` : ''}
                </p>
              )}
            </div>
          )}

          {/* Snapshot Header Details */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <div className="p-2 rounded bg-white border border-gray-100">
              <span className="text-gray-400 block text-[10px]">Title</span>
              <span className="font-semibold text-gray-800">{activeVersion.title}</span>
            </div>
            <div className="p-2 rounded bg-white border border-gray-100">
              <span className="text-gray-400 block text-[10px]">Budget Head</span>
              <span className="font-semibold text-gray-800">{activeVersion.budgetHead?.name || '—'}</span>
            </div>
            <div className="p-2 rounded bg-white border border-gray-100">
              <span className="text-gray-400 block text-[10px]">Total Cost</span>
              <span className="font-bold text-gray-900">{money(activeVersion.tentativeTotalCost)}</span>
            </div>
          </div>

          {activeVersion.description && (
            <div className="p-2.5 rounded bg-white border border-gray-100 text-xs text-gray-700">
              <span className="text-gray-400 block text-[10px] mb-0.5">Description / Justification</span>
              <p className="whitespace-pre-wrap">{activeVersion.description}</p>
            </div>
          )}

          {/* Snapshot Line Items */}
          <div className="space-y-1.5">
            <h6 className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
              Snapshot Items ({activeVersion.items?.length || 0})
            </h6>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Item Description</th>
                    <th className="px-3 py-2 text-right font-medium">Quantity</th>
                    <th className="px-3 py-2 text-right font-medium">Unit Cost</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-700">
                  {(activeVersion.items || []).map((item, idx) => (
                    <tr key={item.request_item_id || item.requestItemId || idx}>
                      <td className="px-3 py-2">
                        <span className="font-medium text-gray-900">
                          {item.item_name || item.itemName || 'Custom Item'}
                        </span>
                        {(item.item_code || item.itemCode) && (
                          <span className="text-gray-400 text-[10px] ml-1.5">
                            ({item.item_code || item.itemCode})
                          </span>
                        )}
                        {item.remarks && (
                          <p className="text-[10px] text-gray-500 italic mt-0.5">{item.remarks}</p>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {item.requested_quantity ?? item.requestedQuantity} {item.unit || ''}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {money(item.estimated_unit_cost ?? item.estimatedUnitCost)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-semibold text-gray-900">
                        {money(item.estimated_total ?? item.estimatedTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Snapshot Attached Documents */}
          {activeVersion.documents && activeVersion.documents.length > 0 && (
            <div className="space-y-1.5">
              <h6 className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                Snapshot Documents ({activeVersion.documents.length})
              </h6>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activeVersion.documents.map((doc, idx) => (
                  <li
                    key={doc.attachment_id || doc.attachmentId || idx}
                    className="p-2 rounded bg-white border border-gray-200 text-xs flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span className="truncate font-medium text-gray-800" title={doc.file_name || doc.fileName}>
                        {doc.file_name || doc.fileName}
                      </span>
                    </div>
                    {(doc.size_bytes || doc.sizeBytes) && (
                      <span className="text-[10px] text-gray-400 shrink-0 font-mono">
                        {Math.round((doc.size_bytes || doc.sizeBytes) / 1024)} KB
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-between text-xs text-gray-600">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" />
            <span>
              {versions.length === 1
                ? 'Original submission (Version 1). No revisions requested.'
                : `${versions.length} versions recorded. Click any version above to inspect its immutable snapshot.`}
            </span>
          </div>
          {versions.length > 1 && (
            <span className="text-[11px] text-indigo-600 font-medium">Click a version to inspect</span>
          )}
        </div>
      )}
    </div>
  );
};
