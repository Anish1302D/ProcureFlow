import React from 'react';
import { CheckCircle2, ClipboardCheck, ShieldAlert } from 'lucide-react';
import { roleLabel } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { StatCard } from '../components/ui/StatCard';
import { RequestTable } from '../components/requests/RequestTable';

/**
 * Home for the Purchase Committee, CDC members, the Chairman and the Vice
 * Chairman: what is waiting at their stage, and what has passed through it.
 */
export const ApproverDashboard = () => {
  const { user, setActivePage } = useApp();
  const dashboard = useApi('/api/dashboard');
  const d = dashboard.data;
  const stages = user.stages.map((s) => s.name).join(' · ');

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-2xl bg-white border border-gray-200">
        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-50 text-violet-700 border border-violet-200 uppercase tracking-widest">{stages}</span>
        <h2 className="text-xl font-extrabold text-gray-900 mt-2">{user.name}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{user.roles.map(roleLabel).join(', ')} · FY {d?.financialYear ?? '…'}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Awaiting my decision" value={d?.awaitingMyDecision ?? '…'} subtext="At your stage now" icon={ClipboardCheck} color="amber" onClick={() => setActivePage('review-queue')} />
        <StatCard title="Decided" value={d ? d.counts.approved + d.counts.partiallyApproved + d.counts.rejected : '…'}
          subtext="Requests you have seen, this year" icon={CheckCircle2} color="emerald" onClick={() => setActivePage('decisions')} />
        <StatCard title="With CDC & Chairman" value={d?.counts.withHigherAuthority ?? '…'} subtext="Of those you can see" icon={ShieldAlert} color="violet" />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
        <h3 className="text-sm font-bold text-gray-900">Waiting for you</h3>
        <RequestTable query={{ awaitingMe: true }} empty={{ title: 'Nothing waiting on you', hint: "You'll get a notification when a request reaches your stage." }} />
      </div>
    </div>
  );
};
