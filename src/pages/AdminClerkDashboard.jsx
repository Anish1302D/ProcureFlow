import React from 'react';
import { AlertCircle, Box, FileText, Plus, Receipt } from 'lucide-react';
import { date, money } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { StatCard } from '../components/ui/StatCard';
import { DataState } from '../components/ui/States';

export const AdminClerkDashboard = () => {
  const { user, setActivePage, openModal } = useApp();
  const dashboard = useApi('/api/dashboard');
  const inventory = useApi('/api/inventory?limit=1');
  const bills = useApi('/api/purchase-bills?limit=6');
  const issues = useApi('/api/issues?status=SUBMITTED,IN_REVIEW&limit=1');

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-violet-50 border border-violet-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700 border border-violet-200 uppercase tracking-widest">Administrator</span>
          <h2 className="text-xl font-extrabold text-gray-900 mt-1">
            Operations{user?.name ? ` · ${user.name.replace(/\s*\(.*\)$/, '')}` : ''}
          </h2>
          <p className="text-xs text-gray-600 mt-0.5">Inventory, purchase bills, exports and the audit log. You can see every request.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => openModal('inventory')} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> Inventory item</button>
          <button onClick={() => openModal('bill')} className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> Purchase bill</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Requests this year" value={dashboard.data?.counts.total ?? '…'} subtext={`${dashboard.data?.counts.pending ?? 0} under review`} icon={FileText} color="indigo" onClick={() => setActivePage('requests-all')} />
        <StatCard title="Open faculty issues" value={issues.data?.total ?? '…'} icon={AlertCircle} color="sky" onClick={() => setActivePage('non-financial-requests')} />
        <StatCard title="Inventory records" value={inventory.data?.total ?? '…'} icon={Box} color="emerald" onClick={() => setActivePage('inventory')} />
        <StatCard title="Purchase bills" value={bills.data?.total ?? '…'} icon={Receipt} color="amber" onClick={() => setActivePage('purchase-bills')} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-900">Recent purchase bills</h3>
        <DataState state={bills} isEmpty={(bills.data?.items ?? []).length === 0} empty={{ title: 'No bills recorded yet' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[11px]"><th className="py-3 px-3">Bill</th><th className="py-3 px-3">Vendor</th><th className="py-3 px-3">Request</th><th className="py-3 px-3">Date</th><th className="py-3 px-3 text-right">Amount</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {bills.data?.items.map((b) => (
                  <tr key={b.id}>
                    <td className="py-3 px-3 font-mono font-bold text-indigo-600">{b.billNumber}</td>
                    <td className="py-3 px-3 text-gray-800">{b.vendorName ?? '—'}</td>
                    <td className="py-3 px-3 font-mono text-gray-500">{b.request?.requestNumber ?? '—'}</td>
                    <td className="py-3 px-3 text-gray-400">{date(b.billDate)}</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums">{money(b.billAmount)}</td>
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
