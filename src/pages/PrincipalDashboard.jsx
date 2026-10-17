import React, { useState } from 'react';
import { AlertCircle, AlertTriangle, ClipboardCheck, IndianRupee, ShieldAlert } from 'lucide-react';
import { DECIDED_STATUSES, REVIEW_STATUSES, lakhs } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { StatCard } from '../components/ui/StatCard';
import { RequestTable } from '../components/requests/RequestTable';

const TABS = {
  all: { label: 'All', query: {} },
  review: { label: 'Under review', query: { status: REVIEW_STATUSES.join(',') } },
  decided: { label: 'Decided', query: { status: DECIDED_STATUSES.join(',') } },
};

export const PrincipalDashboard = () => {
  const { user, setActivePage } = useApp();
  const [tab, setTab] = useState('all');
  const dashboard = useApi('/api/dashboard');
  const spend = useApi('/api/reports/by-budget-head');
  const issues = useApi('/api/issues?status=SUBMITTED,IN_REVIEW&limit=1');

  const d = dashboard.data;
  const sanctioned = (spend.data?.rows ?? []).reduce((sum, r) => sum + r.sanctioned, 0);
  const stale = d?.attention.pendingOverThreeDays ?? 0;
  const tabCls = (id) => `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === id ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`;

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-white border border-gray-200">
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-600 border border-indigo-200 uppercase tracking-widest">
          FY {d?.financialYear ?? '…'}
        </span>
        <h2 className="text-xl font-extrabold text-gray-900 mt-2">Good day, {user.name.replace(/\s*\(.*\)$/, '')}</h2>
        <p className="text-xs text-gray-500 mt-0.5">Every submitted request in the college, and the ones waiting on you.</p>
      </div>

      {stale > 0 && (
        <button onClick={() => setActivePage('pending')}
          className="w-full text-left p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-3 hover:bg-amber-100 transition-colors">
          <span className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span className="text-sm text-amber-900"><strong>{stale} request{stale === 1 ? ' has' : 's have'}</strong> been pending for more than 3 days.</span>
          </span>
          <span className="text-xs font-semibold text-amber-800">Review them →</span>
        </button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Awaiting my decision" value={d?.awaitingMyDecision ?? '…'} subtext="At the Principal stage" icon={ClipboardCheck} color="amber" onClick={() => setActivePage('review-queue')} />
        <StatCard title="With CDC & Chairman" value={d?.counts.withHigherAuthority ?? '…'} subtext="₹5 lakh and above, or escalated" icon={ShieldAlert} color="violet" onClick={() => setActivePage('escalated-requests')} />
        <StatCard title="Open faculty issues" value={issues.data?.total ?? '…'} subtext="Non-financial" icon={AlertCircle} color="sky" onClick={() => setActivePage('non-financial-requests')} />
        <StatCard title="Sanctioned this year" value={spend.data ? lakhs(sanctioned) : '…'} subtext={`${d?.counts.approved ?? 0} approved · ${d?.counts.partiallyApproved ?? 0} partly`} icon={IndianRupee} color="emerald" onClick={() => setActivePage('reports')} />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Requests</h3>
            <p className="text-xs text-gray-400">Open a request to see its items, history and comments.</p>
          </div>
          <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl">
            {Object.entries(TABS).map(([id, t]) => <button key={id} onClick={() => setTab(id)} className={tabCls(id)}>{t.label}</button>)}
          </div>
        </div>
        <RequestTable query={TABS[tab].query} empty={{ title: 'No requests in this view' }} />
      </div>
    </div>
  );
};
