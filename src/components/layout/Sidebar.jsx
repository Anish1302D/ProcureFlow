import React from 'react';
import {
  AlertCircle, BarChart3, BellRing, BookOpen, Box, ClipboardCheck, FileDown, FileText, FolderArchive,
  GraduationCap, History, LayoutDashboard, LogOut, Receipt, Settings, ShieldAlert,
  UserCircle, Users, Wallet,
} from 'lucide-react';
import { initials, roleLabel } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useApi } from '../../hooks/useApi';

// Screens each portal offers. The server enforces access independently; this
// only decides what is worth showing.
export const NAV = {
  principal: [
    { title: 'Approvals', items: [
      { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
      { id: 'review-queue', label: 'Awaiting my decision', icon: ClipboardCheck, badge: 'awaiting' },
      { id: 'requests-all', label: 'All requests', icon: FileText },
      { id: 'escalated-requests', label: 'With CDC & Chairman', icon: ShieldAlert, badge: 'higher' },
      { id: 'non-financial-requests', label: 'Faculty issues', icon: AlertCircle, badge: 'issues' },
    ] },
    { title: 'College', items: [
      { id: 'budget-provisions', label: 'Departmental budgets', icon: Wallet },
      { id: 'inventory', label: 'Inventory', icon: Box },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'exports', label: 'Exports', icon: FileDown },
    ] },
  ],
  approver: [
    { title: 'Review', items: [
      { id: 'approver-dashboard', label: 'Overview', icon: LayoutDashboard },
      { id: 'review-queue', label: 'Awaiting my decision', icon: ClipboardCheck, badge: 'awaiting' },
      { id: 'decisions', label: 'Decided', icon: FolderArchive },
      { id: 'requests-all', label: 'All I can see', icon: FileText },
    ] },
    { title: 'College', items: [
      { id: 'budget-provisions', label: 'Departmental budgets', icon: Wallet },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
    ] },
  ],
  faculty: [
    { title: 'My work', items: [
      { id: 'faculty-dashboard', label: 'Dashboard', icon: GraduationCap },
      { id: 'faculty-requests', label: 'My requests & issues', icon: FileText },
      { id: 'budget-provisions', label: 'Department budget', icon: Wallet },
      { id: 'reports', label: 'Reports', icon: BarChart3 },
    ] },
  ],
  admin: [
    { title: 'Operations', items: [
      { id: 'admin-dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'user-management', label: 'User management', icon: Users },
      { id: 'master-data', label: 'Departments & courses', icon: BookOpen },
      { id: 'settings', label: 'System configuration', icon: Settings },
      { id: 'budget-provisions', label: 'Departmental budgets', icon: Wallet },
      { id: 'requests-all', label: 'All requests', icon: FileText },
      { id: 'non-financial-requests', label: 'Faculty issues', icon: AlertCircle, badge: 'issues' },
      { id: 'inventory', label: 'Inventory', icon: Box },
      { id: 'purchase-bills', label: 'Purchase bills', icon: Receipt },
    ] },
    { title: 'Records', items: [
      { id: 'reports', label: 'Reports', icon: BarChart3 },
      { id: 'exports', label: 'Exports', icon: FileDown },
      { id: 'audit-history', label: 'Audit log', icon: History },
    ] },
  ],
};

const ACCOUNT = { title: 'Account', items: [
  { id: 'notifications', label: 'Notifications', icon: BellRing, badge: 'unread' },
  { id: 'profile', label: 'Profile', icon: UserCircle },
  { id: 'settings', label: 'Approval route', icon: Settings },
] };

/** Every page a portal may open — its menu plus pages reached from within. */
export function pagesFor(portal) {
  const ids = [...(NAV[portal] ?? []), ACCOUNT].flatMap((g) => g.items.map((i) => i.id));
  return new Set([...ids, 'pending']);
}

export const Sidebar = ({ isOpen, closeSidebar }) => {
  const { user, portal, activePage, setActivePage, signOut } = useApp();
  const dashboard = useApi('/api/dashboard');
  const manager = portal === 'principal' || portal === 'admin';
  const issues = useApi(manager ? '/api/issues?status=SUBMITTED,IN_REVIEW,ESCALATED&limit=1' : null);
  const notes = useApi('/api/notifications?unread=true&limit=1');

  const badges = {
    awaiting: dashboard.data?.awaitingMyDecision,
    higher: dashboard.data?.counts.withHigherAuthority,
    issues: issues.data?.total,
    unread: notes.data?.unread,
  };
  const groups = [...(NAV[portal] ?? []), ACCOUNT];

  return (
    <>
      {isOpen && <div onClick={closeSidebar} className="fixed inset-0 bg-gray-900/30 z-40 lg:hidden backdrop-blur-sm" />}

      <aside className={`fixed lg:static top-0 left-0 bottom-0 z-40 w-60 bg-white border-r border-gray-200 flex flex-col transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      }`}>
        <div className="h-14 px-5 flex items-center border-b border-gray-200">
          <div className="h-8 overflow-hidden flex items-center">
            <img src="/ProcureFlow-logo-horizontal.png" alt="ProcureFlow" className="h-28 w-auto max-w-none object-contain -ml-1.5" />
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Main">
          {groups.map((group) => (
            <div key={group.title} className="space-y-0.5">
              <h3 className="px-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{group.title}</h3>
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                const count = item.badge ? badges[item.badge] : 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setActivePage(item.id); if (window.innerWidth < 1024) closeSidebar(); }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                      isActive ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-600' : 'text-gray-400'}`} />
                      {item.label}
                    </span>
                    {count > 0 && (
                      <span className={`min-w-[20px] text-center px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                        isActive ? 'bg-indigo-600 text-white' : item.badge === 'awaiting' ? 'bg-amber-100 text-amber-800' : 'bg-gray-200 text-gray-600'
                      }`}>{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100 space-y-2">
          <div className="px-3 py-2 rounded-lg bg-gray-50 flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-[11px] shrink-0">{initials(user.name)}</div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-700 truncate">{user.name}</p>
              <p className="text-[10px] text-gray-400 truncate">{user.roles.map(roleLabel).join(', ') || 'Staff'}</p>
            </div>
          </div>
          <button onClick={() => signOut('Signed out')} className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-50">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
};
