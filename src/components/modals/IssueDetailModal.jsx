import React, { useState } from 'react';
import { api } from '../../api/client';
import { dateTime } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useApi, useAction } from '../../hooks/useApi';
import { Attachments } from '../ui/Attachments';
import { Modal } from '../ui/Modal';
import { ErrorState, Loading } from '../ui/States';
import { StatusBadge } from '../ui/StatusBadge';

const MOVE_LABEL = {
  IN_REVIEW: 'Start review', RESOLVED: 'Mark resolved', CLOSED: 'Close',
};
const EVENT_LABEL = {
  CREATED: 'Logged', ASSIGNED: 'Assigned', UNASSIGNED: 'Unassigned', ESCALATED: 'Escalated',
  IN_REVIEW: 'Moved to review', RESOLVED: 'Resolved', CLOSED: 'Closed', COMMENT: 'Commented', SUBMITTED: 'Reopened',
};

export const IssueDetailModal = () => {
  const { openRecordState, closeRecord, user } = useApp();
  const id = openRecordState?.kind === 'issue' ? openRecordState.id : null;
  const state = useApi(id ? `/api/issues/${id}` : null);
  const issue = state.data;
  const perms = issue?.permissions;
  const { run, busy } = useAction();
  const [note, setNote] = useState('');

  const patch = async (body, done) => {
    const { ok } = await run(() => api(`/api/issues/${id}`, { method: 'PATCH', body: { ...body, note: note.trim() || undefined } }), done);
    if (ok) setNote('');
  };
  const comment = async () => {
    const { ok } = await run(() => api(`/api/issues/${id}/events`, { method: 'POST', body: { note: note.trim() } }), 'Note added');
    if (ok) setNote('');
  };

  return (
    <Modal isOpen={Boolean(id)} onClose={closeRecord} title={issue ? `${issue.issueNumber} — ${issue.title}` : 'Issue'}
      subtitle={issue ? `Logged by ${issue.raisedBy.name} · ${dateTime(issue.createdAt)}` : undefined} maxWidth="max-w-3xl">
      {state.loading && !issue && <Loading />}
      {state.error && <ErrorState error={state.error.status === 404 ? { message: 'This issue doesn\'t exist, or you don\'t have access to it.' } : state.error} />}
      {issue && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <StatusBadge status={issue.status} kind="issue" />
          </div>

          <p className="p-3.5 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{issue.description}</p>

          {perms.canComment && (
            <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (optional with an action below)"
                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20" />
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={comment} disabled={busy || !note.trim()} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 disabled:opacity-50">Add note</button>
                {perms.statusesAllowed.map((s) => (
                  <button key={s} onClick={() => patch({ status: s }, `Issue ${MOVE_LABEL[s]?.toLowerCase() ?? s}`)} disabled={busy}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50 ${s === 'RESOLVED' ? 'bg-emerald-600 hover:bg-emerald-700' : s === 'CLOSED' ? 'bg-gray-700 hover:bg-gray-800' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                    {s === 'IN_REVIEW' && issue.status === 'RESOLVED' ? 'Reopen' : MOVE_LABEL[s] ?? s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <section className="space-y-2">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Documents</h4>
            <Attachments files={issue.attachments}
              uploadPath={perms.canComment && !['RESOLVED', 'CLOSED'].includes(issue.status) ? `/api/issues/${issue.id}/attachments` : null}
              canDelete={(f) => !['RESOLVED', 'CLOSED'].includes(issue.status) && (f.uploadedBy.id === user.id || user.roles.includes('ADMIN'))} />
          </section>

          <section className="space-y-2">
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">History</h4>
            <ol className="space-y-2">
              {issue.events.map((e) => (
                <li key={e.id} className="p-3 rounded-lg bg-white border border-gray-200 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-gray-800">{EVENT_LABEL[e.action] ?? e.action} <span className="font-normal text-gray-500">by {e.by.name}</span></span>
                    <span className="text-[11px] text-gray-400">{dateTime(e.at)}</span>
                  </div>
                  {e.note && <p className="text-gray-600 mt-1 whitespace-pre-wrap">{e.note}</p>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  );
};
