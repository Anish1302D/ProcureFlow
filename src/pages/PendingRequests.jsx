import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { money } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DataState } from '../components/ui/States';

/** "Pending > 3 days" — the attention panel's destination (design doc §16). */
export const PendingRequests = () => {
  const { openRecord } = useApp();
  const state = useApi('/api/reports/pending?minDays=3');
  const rows = state.data ?? [];

  return (
    <div className="space-y-5">
      <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600" />
        <div>
          <h2 className="text-xl font-extrabold text-gray-900">Pending for more than 3 days</h2>
          <p className="text-xs text-gray-600 mt-0.5">Longest-waiting first.</p>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <DataState state={state} isEmpty={rows.length === 0} empty={{ title: 'Nothing has been waiting that long' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3">Request</th><th className="py-3 px-3">Raised by</th>
                  <th className="py-3 px-3 text-right">Amount</th><th className="py-3 px-3">Status</th>
                  <th className="py-3 px-3 text-right">Waiting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => openRecord('request', r.id)} className="hover:bg-amber-50/50 cursor-pointer">
                    <td className="py-3 px-3"><p className="font-mono font-bold text-indigo-600">{r.requestNumber}</p><p className="font-semibold text-gray-800">{r.title}</p></td>
                    <td className="py-3 px-3 text-gray-700">{r.raisedBy.name}</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums">{money(r.tentativeTotalCost)}</td>
                    <td className="py-3 px-3"><StatusBadge status={r.status} /></td>
                    <td className="py-3 px-3 text-right font-bold text-amber-700 tabular-nums">{r.daysPending} days</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DataState>
      </div>
    </div>
  );
};
