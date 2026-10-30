import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { AppProvider, HOME, useApp } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
import { canAccessPage, pagesFor } from './components/layout/Sidebar';

import { Login } from './pages/Login';
import { PrincipalDashboard } from './pages/PrincipalDashboard';
import { FinancialRequestsManagement } from './pages/FinancialRequestsManagement';
import { ReviewQueue } from './pages/ReviewQueue';
import { EscalatedRequestsManagement } from './pages/EscalatedRequestsManagement';
import { NonFinancialRequestsManagement } from './pages/NonFinancialRequestsManagement';
import { ApproverDashboard } from './pages/ApproverDashboard';
import { DecisionsArchive } from './pages/DecisionsArchive';
import { PendingRequests } from './pages/PendingRequests';
import { AuditHistory } from './pages/AuditHistory';
import { FacultyDashboard } from './pages/FacultyDashboard';
import { FacultyMyRequests } from './pages/FacultyMyRequests';
import { Profile } from './pages/Profile';
import { AdminClerkDashboard } from './pages/AdminClerkDashboard';
import { InventoryManagement } from './pages/InventoryManagement';
import { PurchaseBills } from './pages/PurchaseBills';
import { DataExports } from './pages/DataExports';
import { ReportsAnalytics } from './pages/ReportsAnalytics';
import { MasterDataManagement } from './pages/MasterDataManagement';
import { BudgetProvisions } from './pages/BudgetProvisions';
import { NotificationsCenter } from './pages/NotificationsCenter';
import { SettingsPreferences } from './pages/SettingsPreferences';
import { UserManagement } from './pages/UserManagement';

import { SetupAccount } from './pages/SetupAccount';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { ConfirmEmail } from './pages/ConfirmEmail';
import { forgetLinkInAddressBar, readPublicRoute } from './publicRoutes';

// Pages opened from email links; shown whether or not someone is signed in.
const PUBLIC_PAGES = {
  'accept-invite': SetupAccount,
  'forgot-password': ForgotPassword,
  'reset-password': ResetPassword,
  'confirm-email': ConfirmEmail,
};

const PAGES = {
  dashboard: PrincipalDashboard,
  'requests-all': FinancialRequestsManagement,
  'review-queue': ReviewQueue,
  'escalated-requests': EscalatedRequestsManagement,
  'non-financial-requests': NonFinancialRequestsManagement,
  'approver-dashboard': ApproverDashboard,
  decisions: DecisionsArchive,
  pending: PendingRequests,
  'audit-history': AuditHistory,
  'faculty-dashboard': FacultyDashboard,
  'faculty-requests': FacultyMyRequests,
  profile: Profile,
  'admin-dashboard': AdminClerkDashboard,
  'user-management': UserManagement,
  'master-data': MasterDataManagement,
  'budget-provisions': BudgetProvisions,
  inventory: InventoryManagement,
  'purchase-bills': PurchaseBills,
  exports: DataExports,
  reports: ReportsAnalytics,
  notifications: NotificationsCenter,
  settings: SettingsPreferences,
};

const PageRenderer = () => {
  const { user, portal, booting, activePage } = useApp();

  // Read once: the page removes the token from the address bar straight away,
  // so re-reading on every render would lose the link mid-way.
  const [publicRoute, setPublicRoute] = useState(readPublicRoute);
  useEffect(() => {
    const onHash = () => { const route = readPublicRoute(); if (route) setPublicRoute(route); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const leavePublicPage = useCallback(() => { forgetLinkInAddressBar(); setPublicRoute(null); }, []);

  const PublicPage = publicRoute && PUBLIC_PAGES[publicRoute.page];
  if (PublicPage) return <PublicPage token={publicRoute.token} onDone={leavePublicPage} />;

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400 gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Restoring your session…
      </div>
    );
  }

  if (!user) return <Login />;

  // A page outside this portal (an old link, an edited URL) falls back to the
  // portal's home. The API would refuse its data anyway.
  const page = canAccessPage(portal, activePage) ? activePage : HOME[portal];
  const Page = PAGES[page] ?? PAGES[HOME[portal]];
  return <AppShell><Page /></AppShell>;
};


export default function App() {
  return (
    <AppProvider>
      <PageRenderer />
    </AppProvider>
  );
}
