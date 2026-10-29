import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Toast } from '../ui/Toast';
import { RequestDetailModal } from '../modals/RequestDetailModal';
import { IssueDetailModal } from '../modals/IssueDetailModal';
import { NewRequestModal } from '../modals/NewRequestModal';
import { NewIssueModal } from '../modals/NewIssueModal';
import { InventoryModal } from '../modals/InventoryModal';
import { BillModal } from '../modals/BillModal';
import { ExportModal } from '../modals/ExportModal';
import { LoginNotificationsModal } from '../modals/LoginNotificationsModal';
import { CopyrightFooter } from './CopyrightFooter';

export const AppShell = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50 text-gray-900 overflow-hidden">
      <Sidebar isOpen={sidebarOpen} closeSidebar={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-y-auto p-5 md:p-6 lg:p-8 flex flex-col justify-between">
          <div className="space-y-6 flex-1">{children}</div>
          <CopyrightFooter />
        </main>
      </div>
      <RequestDetailModal />
      <IssueDetailModal />
      <NewRequestModal />
      <NewIssueModal />
      <InventoryModal />
      <BillModal />
      <ExportModal />
      <LoginNotificationsModal />
      <Toast />
    </div>
  );
};
