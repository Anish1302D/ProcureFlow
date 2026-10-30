import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { ACTION_LABELS, dateTime, money } from '../../api/format';
import { useApi } from '../../hooks/useApi';
import { DataState } from '../ui/States';
import { StatusBadge } from '../ui/StatusBadge';

const Seal = ({ seal }) => {
  if (seal === 'VERIFIED') {
    return (
      <span title="The recorded decision matches exactly what was sealed when it was made."
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
        <ShieldCheck className="w-3.5 h-3.5" /> Sealed
      </span>
    );
  }
  if (seal === 'MISMATCH') {
    return (
      <span title="This decision has been changed since it was recorded. Report it to the administrator."
        className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
        <ShieldAlert className="w-3.5 h-3.5" /> Altered since recorded
      </span>
    );
  }
  return null;
};

/** Every action on a request, oldest first, as recorded — never edited. */
export const Timeline = ({ requestId }) => {
  const state = useApi(`/api/requests/${requestId}/timeline`);
  const entries = state.data ?? [];

  return (
    <DataState state={state} isEmpty={entries.length === 0} empty={{ title: 'Nothing has happened yet', hint: 'Actions appear here once the request is submitted.' }}>
      <ol className="space-y-2.5 pl-1.5 relative before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start gap-3 relative">
            <span className={`w-3.5 h-3.5 rounded-full border-[3px] border-white ring-1 ring-gray-200 shrink-0 mt-0.5 z-10 ${e.seal === 'MISMATCH' ? 'bg-red-500' : 'bg-indigo-500'}`} />
            <div className="flex-1 p-3 rounded-lg bg-gray-50 border border-gray-100 text-xs space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-gray-800">
                  {ACTION_LABELS[e.action] ?? e.action}
                  <span className="font-normal text-gray-500">
                    {' '}by {e.by?.name ?? 'Unknown'}
                    {e.role ? ` (${e.role.name})` : ''}
                    {e.by?.employeeId ? ` · ID: ${e.by.employeeId}` : ''}
                    {e.stage ? ` · ${e.stage.name}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-[11px] text-gray-400">
                  <Seal seal={e.seal} /> {dateTime(e.at)}
                </span>
              </div>
              {e.newStatus && <StatusBadge status={e.newStatus} />}
              {e.amountApproved !== null && e.amountApproved !== undefined && (
                <p className="text-gray-600">Sanctioned {money(e.amountApproved)} of {money(e.amountRequested)}</p>
              )}
              {e.rejectionReason && <p className="text-red-700">Reason: {e.rejectionReason}</p>}
              {e.comments && <p className="text-gray-500 italic">“{e.comments}”</p>}
            </div>
          </li>
        ))}
      </ol>
    </DataState>
  );
};
