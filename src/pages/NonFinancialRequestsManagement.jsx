import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { qs } from '../api/client';
import { timeAgo } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DataState } from '../components/ui/States';

const FILTERS = {
  open: { label: 'Open', status: 'SUBMITTED,IN_REVIEW' },
  RESOLVED: { label: 'Resolved', status: 'RESOLVED' },
  CLOSED: { label: 'Closed', status: 'CLOSED' },
  all: { label: 'All', status: undefined },
};

/** Faculty issues: maintenance, facilities, anything that isn't a purchase. */
export const NonFinancialRequestsManagement = () => {
  const { openRecord, openModal } = useApp();
  const [filter, setFilter] = useState('open');
  const state = useApi(`/api/issues${qs({ status: FILTERS[filter].status, limit: 100 })}`);
  const issues = state.data?.items ?? [];
  const tabCls = (id) => `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${filter === id ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900">Faculty issues</h2>
          <p className="text-xs text-gray-500">Open an issue to review it, assign someone, or resolve it.</p>
        </div>
        <button onClick={() => openModal('newIssue')} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 self-start">
          <Plus className="w-4 h-4" /> Log issue
        </button>
      </div>

      <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {Object.entries(FILTERS).map(([id, f]) => <button key={id} onClick={() => setFilter(id)} className={tabCls(id)}>{f.label}</button>)}
      </div>

      <DataState state={state} isEmpty={issues.length === 0} empty={{ title: filter === 'open' ? 'No open issues' : 'Nothing here' }}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {issues.map((i) => (
            <button key={i.id} onClick={() => openRecord('issue', i.id)}
              className="text-left bg-white rounded-2xl p-5 border border-gray-200 flex flex-col justify-between hover:shadow-md hover:border-gray-300 transition-all">
              <div>
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <span className="text-[11px] font-mono font-bold text-indigo-600">{i.issueNumber}</span>
                  <StatusBadge status={i.status} kind="issue" />
                </div>
                <h3 className="text-sm font-bold text-gray-900 line-clamp-2">{i.title}</h3>
                <p className="text-xs text-gray-500 mt-2 line-clamp-3">{i.description}</p>
              </div>
              <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-400">
                <span className="text-gray-600">{i.raisedBy.name}</span>
                <span>{timeAgo(i.updatedAt)}</span>
              </div>
            </button>
          ))}
        </div>
      </DataState>
    </div>
  );
};
