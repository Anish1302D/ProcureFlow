import React from 'react';
import { CheckCircle2, Clock, FileText, Plus } from 'lucide-react';
import { roleLabel, timeAgo } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { StatCard } from '../components/ui/StatCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DataState } from '../components/ui/States';
import { RequestTable } from '../components/requests/RequestTable';

export const FacultyDashboard = () => {
  const { user, openModal, openRecord, setActivePage } = useApp();
  const dashboard = useApi('/api/dashboard');
  const issues = useApi('/api/issues?mine=true&limit=5');
  const c = dashboard.data?.counts;

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 uppercase tracking-widest">
            {user.roles.map(roleLabel).join(', ') || 'Staff'}
          </span>
          <h2 className="text-xl font-extrabold text-gray-900 mt-1">Welcome, {user.name.replace(/\s*\(.*\)$/, '')}</h2>
          <p className="text-xs text-gray-600 mt-0.5">Your requests for FY {dashboard.data?.financialYear ?? '…'} and the issues you've logged.</p>
        </div>
        <div className="flex items-center gap-2">
          {user.can.raiseRequests && (
            <button onClick={() => openModal('newRequest')} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> New request</button>
          )}
          <button onClick={() => openModal('newIssue')} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2"><Plus className="w-4 h-4" /> Log issue</button>
        </div>
      </div>

      {user.can.raiseRequests && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard title="My requests" value={c?.total ?? '…'} subtext="This financial year" icon={FileText} color="indigo" onClick={() => setActivePage('faculty-requests')} />
            <StatCard title="Under review" value={c?.pending ?? '…'} subtext="Waiting on an approver" icon={Clock} color="amber" />
            <StatCard title="Approved" value={c ? c.approved + c.partiallyApproved : '…'} subtext={`${c?.partiallyApproved ?? 0} of them partly`} icon={CheckCircle2} color="emerald" />
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
            <h3 className="text-sm font-bold text-gray-900">My requests</h3>
            <RequestTable query={{ mine: true }} pageSize={5} showRaisedBy={false}
              empty={{ title: "You haven't raised a request yet", hint: 'Use New request to list the items you need; drafts stay private until you submit.' }} />
          </div>
        </>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-900">My issues</h3>
        <DataState state={issues} isEmpty={(issues.data?.items ?? []).length === 0} empty={{ title: 'No issues logged' }}>
          <div className="space-y-2">
            {issues.data?.items.map((i) => (
              <button key={i.id} onClick={() => openRecord('issue', i.id)}
                className="w-full text-left p-3 rounded-xl bg-gray-50 border border-gray-100 hover:bg-white hover:border-gray-200 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="text-xs font-mono font-bold text-indigo-600 mr-2">{i.issueNumber}</span>
                  <span className="text-sm font-semibold text-gray-800">{i.title}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0 text-[11px] text-gray-400">{timeAgo(i.updatedAt)} <StatusBadge status={i.status} kind="issue" /></span>
              </button>
            ))}
          </div>
        </DataState>
      </div>
    </div>
  );
};
