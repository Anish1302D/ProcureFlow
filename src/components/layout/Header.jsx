import React, { useEffect, useRef, useState } from 'react';
import { Bell, Download, Menu, Plus } from 'lucide-react';
import { api } from '../../api/client';
import { timeAgo } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useApi } from '../../hooks/useApi';

/** Opens what a notification is about and marks it read. */
export function useOpenNotification() {
  const { openRecord, refresh } = useApp();
  return async (n) => {
    if (!n.read) {
      try { await api(`/api/notifications/${n.id}/read`, { method: 'POST' }); } catch { /* not worth interrupting for */ }
      refresh();
    }
    if (n.request) openRecord('request', n.request.id);
    else if (n.issue) openRecord('issue', n.issue.id);
  };
}

const PAGE_TITLES = {
  dashboard: 'Overview', 'review-queue': 'Awaiting my decision', 'requests-all': 'All requests',
  'escalated-requests': 'With CDC & Chairman', 'non-financial-requests': 'Faculty issues',
  'approver-dashboard': 'Overview', decisions: 'Decided requests', 'faculty-dashboard': 'Dashboard',
  'faculty-requests': 'My requests & issues', 'admin-dashboard': 'Dashboard', inventory: 'Inventory',
  'purchase-bills': 'Purchase bills', exports: 'Exports', reports: 'Reports', 'audit-history': 'Audit log',
  notifications: 'Notifications', profile: 'Profile', settings: 'Approval route', pending: 'Pending over 3 days',
};

export const Header = ({ toggleSidebar }) => {
  const { user, portal, activePage, setActivePage, openModal } = useApp();
  const [open, setOpen] = useState(false);
  const panel = useRef(null);
  const notes = useApi('/api/notifications?limit=8');
  const openNotification = useOpenNotification();
  const unread = notes.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (panel.current && !panel.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 h-14 bg-white border-b border-gray-200 px-4 md:px-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={toggleSidebar} aria-label="Open menu" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 lg:hidden">
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-bold text-gray-900 truncate">{PAGE_TITLES[activePage] ?? 'ProcureFlow'}</h1>
      </div>

      <div className="flex items-center gap-2">
        {user.can?.raiseRequests && !user.roles?.includes('ADMIN') && (
          <button onClick={() => openModal('newRequest')} className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New request
          </button>
        )}
        <button onClick={() => openModal('newIssue')} className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold items-center gap-1.5 hidden sm:flex">
          <Plus className="w-3.5 h-3.5" /> Log issue
        </button>
        {portal !== 'faculty' && (
          <button onClick={() => openModal('export')} className="px-3 py-1.5 rounded-lg bg-white hover:bg-gray-50 text-gray-700 text-xs font-semibold items-center gap-1.5 border border-gray-200 hidden md:flex">
            <Download className="w-3.5 h-3.5 text-gray-500" /> Export
          </button>
        )}

        <div className="relative" ref={panel}>
          <button onClick={() => setOpen(!open)} aria-label={`Notifications, ${unread} unread`} aria-expanded={open}
            className="relative p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-gray-200 shadow-xl p-3 z-50 animate-fade-in">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-gray-100">
                <span className="text-xs font-bold text-gray-900 uppercase tracking-wider">Notifications</span>
                <span className="text-[10px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">{unread} unread</span>
              </div>
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {(notes.data?.items ?? []).length === 0 && <p className="text-xs text-gray-400 py-4 text-center">Nothing yet.</p>}
                {(notes.data?.items ?? []).map((n) => (
                  <button key={n.id} onClick={() => { setOpen(false); openNotification(n); }}
                    className={`w-full text-left p-2.5 rounded-lg text-xs transition-colors ${n.read ? 'bg-white hover:bg-gray-50' : 'bg-indigo-50/60 hover:bg-indigo-50'}`}>
                    <p className={`font-semibold ${n.read ? 'text-gray-500' : 'text-gray-800'}`}>{n.subject}</p>
                    {n.body && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{n.body}</p>}
                    <span className="text-[9px] text-gray-400 mt-1 block">{timeAgo(n.createdAt)}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => { setOpen(false); setActivePage('notifications'); }}
                className="w-full text-center text-xs text-indigo-600 font-semibold mt-2 pt-2 border-t border-gray-100 block hover:underline">
                View all notifications
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
