import React from 'react';
import { Download, Plus, Receipt } from 'lucide-react';
import { download } from '../api/client';
import { date, money } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { DataState } from '../components/ui/States';

export const PurchaseBills = () => {
  const { user, openModal, openRecord, showToast } = useApp();
  const state = useApi('/api/purchase-bills?limit=100');
  const bills = state.data?.items ?? [];
  const canEdit = user.roles.includes('ADMIN');

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 flex items-center gap-2"><Receipt className="w-5 h-5 text-indigo-500" /> Purchase bills</h2>
          <p className="text-xs text-gray-500 mt-1">Vendor invoices, each linked to the approved request it pays for.</p>
        </div>
        {canEdit && (
          <button onClick={() => openModal('bill')} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 self-start"><Plus className="w-4 h-4" /> Record bill</button>
        )}
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <DataState state={state} isEmpty={bills.length === 0} empty={{ title: 'No bills recorded yet', hint: 'Bills can be recorded once a request is approved.' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-3">Bill</th><th className="py-3 px-3">Vendor</th><th className="py-3 px-3">For request</th>
                <th className="py-3 px-3">Date</th><th className="py-3 px-3 text-right">Amount</th><th className="py-3 px-3 text-right">File</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {bills.map((b) => (
                  <tr key={b.id}>
                    <td className="py-3 px-3 font-mono font-bold text-indigo-600">{b.billNumber}</td>
                    <td className="py-3 px-3 text-gray-800">{b.vendorName ?? '—'}</td>
                    <td className="py-3 px-3">
                      {b.request
                        ? <button onClick={() => openRecord('request', b.request.id)} className="font-mono text-indigo-600 hover:underline">{b.request.requestNumber}</button>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="py-3 px-3 text-gray-400">{date(b.billDate)}</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums">{money(b.billAmount)}</td>
                    <td className="py-3 px-3 text-right">
                      {b.attachmentId && (
                        <button onClick={() => download(`/api/attachments/${b.attachmentId}`, `${b.billNumber}.pdf`).catch((e) => showToast(e.message, 'error'))}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-indigo-600"><Download className="w-3.5 h-3.5" /> File</button>
                      )}
                    </td>
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
