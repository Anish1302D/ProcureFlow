import React, { useState } from 'react';
import { Box, Plus, Search } from 'lucide-react';
import { qs } from '../api/client';
import { date, quantity } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DataState } from '../components/ui/States';
import { useDebounced } from '../components/requests/RequestTable';

export const InventoryManagement = () => {
  const { user, openModal } = useApp();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const state = useApi(`/api/inventory${qs({ q, limit: 100 })}`);
  const items = state.data?.items ?? [];
  const canEdit = user.roles.includes('ADMIN');

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 flex items-center gap-2"><Box className="w-5 h-5 text-indigo-500" /> Inventory</h2>
          <p className="text-xs text-gray-500 mt-1">What the college holds, where it is, and its condition.{canEdit ? '' : ' Only the administrator can change these records.'}</p>
        </div>
        {canEdit && (
          <button onClick={() => openModal('inventory')} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 self-start"><Plus className="w-4 h-4" /> Add item</button>
        )}
      </div>
      <label className="bg-white rounded-xl p-3 flex items-center gap-2 border border-gray-200">
        <Search className="w-4 h-4 text-gray-400" />
        <input type="search" aria-label="Search inventory" placeholder="Search by item or location" value={search} onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
      </label>
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <DataState state={state} isEmpty={items.length === 0} empty={{ title: q ? `Nothing matches “${q}”` : 'No inventory recorded yet' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-3">Item</th><th className="py-3 px-3 text-right">Quantity</th><th className="py-3 px-3">Condition</th>
                <th className="py-3 px-3">Location</th><th className="py-3 px-3">Department</th><th className="py-3 px-3">Acquired</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-3 px-3"><p className="font-semibold text-gray-800">{i.name}</p>{i.notes && <p className="text-[10px] text-gray-400 truncate max-w-xs">{i.notes}</p>}</td>
                    <td className="py-3 px-3 text-right font-bold tabular-nums">{quantity(i.quantity)} {i.unit ?? ''}</td>
                    <td className="py-3 px-3">{i.condition ? <StatusBadge status={i.condition} kind="condition" /> : '—'}</td>
                    <td className="py-3 px-3 text-gray-600">{i.location ?? '—'}</td>
                    <td className="py-3 px-3 text-gray-600">{i.department?.name ?? 'College-wide'}</td>
                    <td className="py-3 px-3 text-gray-400">{date(i.acquiredOn)}</td>
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
