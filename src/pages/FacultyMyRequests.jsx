import React, { useState } from 'react';
import { timeAgo } from '../api/format';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { StatusBadge } from '../components/ui/StatusBadge';
import { DataState } from '../components/ui/States';
import { RequestTable } from '../components/requests/RequestTable';

/** What this person has raised: procurement requests and issues, kept apart as the system keeps them. */
export const FacultyMyRequests = () => {
  const { user, openRecord } = useApp();
  const [tab, setTab] = useState(user.can.raiseRequests ? 'requests' : 'issues');
  const issues = useApi(tab === 'issues' ? '/api/issues?mine=true&limit=100' : null);
  const tabCls = (id) => `px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${tab === id ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:text-gray-700'}`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-gray-900">My requests &amp; issues</h2>
        <p className="text-xs text-gray-500">Open any one to follow its progress.</p>
      </div>
      <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {user.can.raiseRequests && <button onClick={() => setTab('requests')} className={tabCls('requests')}>Procurement requests</button>}
        <button onClick={() => setTab('issues')} className={tabCls('issues')}>Issues</button>
      </div>
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        {tab === 'requests' ? (
          <RequestTable query={{ mine: true }} showRaisedBy={false} empty={{ title: "You haven't raised a request yet" }} />
        ) : (
          <DataState state={issues} isEmpty={(issues.data?.items ?? []).length === 0} empty={{ title: 'No issues logged' }}>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-3">Issue</th><th className="py-3 px-3">Status</th><th className="py-3 px-3 text-right">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {issues.data?.items.map((i) => (
                  <tr key={i.id} onClick={() => openRecord('issue', i.id)} className="hover:bg-indigo-50/40 cursor-pointer">
                    <td className="py-3 px-3"><p className="font-mono font-bold text-indigo-600">{i.issueNumber}</p><p className="font-semibold text-gray-800">{i.title}</p></td>
                    <td className="py-3 px-3"><StatusBadge status={i.status} kind="issue" /></td>
                    <td className="py-3 px-3 text-right text-gray-400">{timeAgo(i.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataState>
        )}
      </div>
    </div>
  );
};
