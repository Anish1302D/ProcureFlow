import React from 'react';
import { Bell, BellOff, ChevronRight } from 'lucide-react';
import { timeAgo } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useApi } from '../../hooks/useApi';
import { useOpenNotification } from '../layout/Header';
import { Modal } from '../ui/Modal';

/**
 * Shown once after login: a welcome screen listing the user's unread
 * notifications so nothing important is missed. If there are none, a
 * friendly "all clear" message is shown briefly.
 */
export const LoginNotificationsModal = () => {
  const { modals, closeModal, user, setActivePage } = useApp();
  const open = modals.loginNotifications;
  const state = useApi(open ? '/api/notifications?unread=true&limit=20' : null);
  const openNotification = useOpenNotification();
  const items = state.data?.items ?? [];
  const unread = state.data?.unread ?? 0;
  const loading = state.loading && !state.data;

  const close = () => closeModal('loginNotifications');

  const handleClick = (n) => {
    close();
    openNotification(n);
  };

  const viewAll = () => {
    close();
    setActivePage('notifications');
  };

  return (
    <Modal isOpen={open} onClose={close} title={`Welcome back, ${user?.name?.replace(/\s*\(.*\)$/, '') ?? ''}`} maxWidth="max-w-lg">
      {loading ? (
        <div className="py-10 flex items-center justify-center gap-2 text-xs text-gray-400">
          <Bell className="w-4 h-4 animate-pulse" /> Checking notifications…
        </div>
      ) : unread === 0 ? (
        <div className="py-10 flex flex-col items-center gap-3 text-center">
          <div className="p-4 rounded-2xl bg-emerald-50 ring-1 ring-emerald-200">
            <BellOff className="w-7 h-7 text-emerald-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">You're all caught up!</p>
            <p className="text-xs text-gray-500 mt-1">No unread notifications. Have a productive day.</p>
          </div>
          <button onClick={close}
            className="mt-2 px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors">
            Continue
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              You have <span className="font-bold text-indigo-600">{unread}</span> unread notification{unread === 1 ? '' : 's'}
            </p>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600 ring-1 ring-red-200">
              {unread} new
            </span>
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {items.map((n) => (
              <button key={n.id} onClick={() => handleClick(n)}
                className="w-full text-left p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-100 hover:bg-indigo-50 hover:border-indigo-200 transition-all group">
                <div className="flex items-start gap-3">
                  <span className="mt-1.5 w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 group-hover:text-indigo-700 transition-colors">{n.subject}</p>
                    {n.body && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
                    <span className="text-[10px] text-gray-400 mt-1 block">{timeAgo(n.createdAt)}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-indigo-500 shrink-0 mt-1 transition-colors" />
                </div>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <button onClick={close}
              className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition-colors">
              Dismiss
            </button>
            <button onClick={viewAll}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center gap-1.5 transition-colors">
              View all notifications <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
