import {
  AlertCircle, BarChart3, BellRing, BookOpen, Box, ClipboardCheck, FileDown, FileText, FolderArchive,
  GraduationCap, History, LayoutDashboard, Receipt, Settings, ShieldAlert,
  UserCircle, Users, Wallet,
} from 'lucide-react';

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

export const ACCOUNT = { title: 'Account', items: [
  { id: 'notifications', label: 'Notifications', icon: BellRing, badge: 'unread' },
  { id: 'profile', label: 'Profile', icon: UserCircle },
  { id: 'settings', label: 'Approval route', icon: Settings },
] };

/** Returns the account navigation items for the given portal.
 * Admin portal already includes System Configuration under Operations,
 * so the duplicate Approval Route tab is omitted from Account for admin.
 */
export function accountNavFor(portal) {
  if (portal === 'admin') {
    return {
      title: 'Account',
      items: ACCOUNT.items.filter((item) => item.id !== 'settings'),
    };
  }
  return ACCOUNT;
}

/** Every page a portal may open — its menu plus pages reached from within. */
export function pagesFor(portal) {
  const accountNav = accountNavFor(portal);
  const ids = [...(NAV[portal] ?? []), accountNav].flatMap((g) => g.items.map((i) => i.id));
  return new Set([...ids, 'pending']);
}
