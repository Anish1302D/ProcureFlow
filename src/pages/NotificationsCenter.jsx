import React from 'react';
import { BellRing, CheckCheck } from 'lucide-react';
import { api } from '../api/client';
import { dateTime } from '../api/format';
import { useApi, useAction } from '../hooks/useApi';
import { useOpenNotification } from '../components/layout/Header';
import { DataState } from '../components/ui/States';

export const NotificationsCenter = () => {
  const state = useApi('/api/notifications?limit=100');
  const { run, busy } = useAction();
  const openNotification = useOpenNotification();
  const items = state.data?.items ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-gray-900 flex items-center gap-2"><BellRing className="w-5 h-5 text-indigo-500" /> Notifications</h2>
          <p className="text-xs text-gray-500 mt-1">Requests reaching you, decisions on yours, and issue updates.</p>
        </div>
        {(state.data?.unread ?? 0) > 0 && (
          <button onClick={() => run(() => api('/api/notifications/read-all', { method: 'POST' }), 'All marked as read')} disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 flex items-center gap-1.5 self-start">
            <CheckCheck className="w-3.5 h-3.5" /> Mark all read
          </button>
        )}
      </div>
      <DataState state={state} isEmpty={items.length === 0} empty={{ title: 'No notifications yet' }}>
        <div className="space-y-2">
          {items.map((n) => (
            <button key={n.id} onClick={() => openNotification(n)}
              className={`w-full text-left p-4 rounded-xl border transition-all flex items-start gap-3 ${n.read ? 'bg-white border-gray-100' : 'bg-indigo-50/60 border-indigo-200'}`}>
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read ? 'bg-transparent' : 'bg-indigo-500'}`} aria-hidden="true" />
              <span className="flex-1 min-w-0">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`text-sm font-bold ${n.read ? 'text-gray-600' : 'text-gray-900'}`}>{n.subject}</span>
                  <span className="text-[11px] text-gray-400">{dateTime(n.createdAt)}</span>
                </span>
                {n.body && <span className="block text-xs text-gray-500 mt-0.5">{n.body}</span>}
              </span>
            </button>
          ))}
        </div>
      </DataState>
    </div>
  );
};
