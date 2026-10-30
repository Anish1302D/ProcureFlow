import React, { useState } from 'react';
import { History, ShieldCheck } from 'lucide-react';
import { qs } from '../api/client';
import { dateTime } from '../api/format';
import { useApi } from '../hooks/useApi';
import { DataState } from '../components/ui/States';

const TYPES = { '': 'Everything', request: 'Requests', user: 'Sign-ins' };

const tone = (action) =>
  action.includes('REJECT') || action.includes('FAILED') ? 'bg-red-50 text-red-700'
    : action.includes('ESCALATE') ? 'bg-violet-50 text-violet-700'
      : action.includes('APPROVE') ? 'bg-emerald-50 text-emerald-700'
        : 'bg-gray-100 text-gray-600';

/** The append-only audit log. Administrators only — the database enforces it. */
export const AuditHistory = () => {
  const [type, setType] = useState('');
  const [limit, setLimit] = useState(50);
  const state = useApi(`/api/audit${qs({ entityType: type, limit })}`);
  const rows = state.data?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 flex items-center gap-2"><History className="w-5 h-5 text-indigo-500" /> Audit log</h2>
          <p className="text-xs text-gray-500 mt-1">Every decision and sign-in, as recorded. Entries are never edited or deleted.</p>
        </div>
        <span className="px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 self-start"><ShieldCheck className="w-3.5 h-3.5" /> Append-only</span>
      </div>
      <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {Object.entries(TYPES).map(([k, label]) => (
          <button key={k} onClick={() => { setType(k); setLimit(50); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${type === k ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200' : 'text-gray-500'}`}>{label}</button>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <DataState state={state} isEmpty={rows.length === 0} empty={{ title: 'No entries' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-3">When</th><th className="py-3 px-3">Who</th><th className="py-3 px-3">Action</th><th className="py-3 px-3">Record</th><th className="py-3 px-3">Change</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3 px-3 text-gray-400 whitespace-nowrap">{dateTime(r.at)}</td>
                    <td className="py-3 px-3 font-semibold text-gray-800">{r.actor?.name ?? <span className="text-gray-400 font-normal">—</span>}</td>
                    <td className="py-3 px-3"><span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tone(r.action)}`}>{r.action}</span></td>
                    <td className="py-3 px-3 text-gray-500 font-mono text-[11px] max-w-[14rem] truncate" title={r.entityId}>{r.entityType} {r.entityId}</td>
                    <td className="py-3 px-3 text-gray-500">
                      {r.before?.status && r.after?.status ? `${r.before.status} → ${r.after.status}` : r.after?.ip ? `from ${r.after.ip}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between pt-3 text-[11px] text-gray-400">
            <span>Showing {rows.length} of {state.data?.total ?? 0}</span>
            {rows.length < (state.data?.total ?? 0) && <button onClick={() => setLimit((l) => l + 50)} className="font-semibold text-indigo-600 hover:underline">Show more</button>}
          </div>
        </DataState>
      </div>
    </div>
  );
};
