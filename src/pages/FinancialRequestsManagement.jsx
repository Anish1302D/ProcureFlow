import React, { useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { DECIDED_STATUSES, REVIEW_STATUSES } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { RequestTable, useDebounced } from '../components/requests/RequestTable';

const STATUS_FILTERS = {
  all: { label: 'Any status' },
  review: { label: 'Under review', status: REVIEW_STATUSES.join(',') },
  APPROVED: { label: 'Approved', status: 'APPROVED' },
  PARTIALLY_APPROVED: { label: 'Partially approved', status: 'PARTIALLY_APPROVED' },
  REJECTED: { label: 'Rejected', status: 'REJECTED' },
  CARRIED_FORWARD: { label: 'Carried forward', status: 'CARRIED_FORWARD' },
  decided: { label: 'Any decision', status: DECIDED_STATUSES.join(',') },
  DRAFT: { label: 'Drafts', status: 'DRAFT' },
};

/** Every request this person may see, searchable and filterable on the server. */
export const FinancialRequestsManagement = () => {
  const { user, openModal } = useApp();
  const years = useApi('/api/financial-years');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [year, setYear] = useState('');
  const q = useDebounced(search.trim());

  const inputCls = 'bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900">Requests</h2>
          <p className="text-xs text-gray-500">Everything your role can see, newest activity first.</p>
        </div>
        {user.can.raiseRequests && (
          <button onClick={() => openModal('newRequest')} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold self-start">
            New request
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl p-3 flex flex-wrap items-center gap-3 border border-gray-200">
        <label className="flex items-center gap-2 flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400" />
          <input type="search" aria-label="Search requests" placeholder="Search by title or request number" className={`w-full ${inputCls}`}
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select aria-label="Status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS_FILTERS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
        </label>
        <select aria-label="Financial year" className={inputCls} value={year} onChange={(e) => setYear(e.target.value)}>
          <option value="">All years</option>
          {(years.data ?? []).map((y) => <option key={y.id} value={y.id}>FY {y.label}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <RequestTable
          query={{ q: q || undefined, status: STATUS_FILTERS[status].status, financialYearId: year || undefined }}
          empty={{ title: q ? `Nothing matches “${q}”` : 'No requests match these filters' }}
        />
      </div>
    </div>
  );
};
