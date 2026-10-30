import React, { useState } from 'react';
import { Lock, MessageSquare } from 'lucide-react';
import { api } from '../../api/client';
import { dateTime } from '../../api/format';
import { useApi, useAction } from '../../hooks/useApi';
import { DataState } from '../ui/States';

const VISIBILITY = {
  ALL: { label: 'Everyone on this request', short: null },
  UP_CHAIN: { label: 'My stage, stages above, and the Principal', short: 'Up the chain' },
  STAGE_ONLY: { label: 'My stage only', short: 'Stage only' },
};

/**
 * Comments on a request. Which ones each person sees is decided by the
 * database, so this list is already filtered — a restricted CDC note never
 * reaches the requester's screen at all.
 */
export const Comments = ({ requestId, canRestrict }) => {
  const state = useApi(`/api/requests/${requestId}/comments`);
  const { run, busy } = useAction();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState('ALL');
  const comments = state.data ?? [];

  const post = async () => {
    const { ok } = await run(
      () => api(`/api/requests/${requestId}/comments`, { method: 'POST', body: { body: body.trim(), visibility } }),
      'Comment posted',
    );
    if (ok) { setBody(''); setVisibility('ALL'); }
  };

  return (
    <div className="space-y-3">
      <DataState state={state} isEmpty={comments.length === 0} empty={{ title: 'No comments yet' }}>
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="p-3 rounded-lg bg-white border border-gray-200 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <span className="font-semibold text-gray-800">
                  {c.author.name}
                  {c.stage && <span className="font-normal text-gray-400"> · {c.stage.name}</span>}
                </span>
                <span className="flex items-center gap-2 text-[10px] text-gray-400">
                  {VISIBILITY[c.visibility]?.short && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 font-semibold">
                      <Lock className="w-3 h-3" /> {VISIBILITY[c.visibility].short}
                    </span>
                  )}
                  {dateTime(c.createdAt)}
                </span>
              </div>
              <p className="text-gray-700 whitespace-pre-wrap">{c.body}</p>
            </li>
          ))}
        </ul>
      </DataState>

      <div className="space-y-2">
        <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…"
          className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {canRestrict ? (
            <label className="flex items-center gap-2 text-[11px] text-gray-500">
              Visible to
              <select value={visibility} onChange={(e) => setVisibility(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-[11px] text-gray-800">
                {Object.entries(VISIBILITY).map(([code, v]) => <option key={code} value={code}>{v.label}</option>)}
              </select>
            </label>
          ) : <span className="text-[11px] text-gray-400">Visible to everyone on this request</span>}
          <button onClick={post} disabled={busy || body.trim().length === 0}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50">
            <MessageSquare className="w-3.5 h-3.5" /> Post comment
          </button>
        </div>
      </div>
    </div>
  );
};
