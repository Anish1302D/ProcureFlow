import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { RequestTable } from '../components/requests/RequestTable';

/**
 * Requests with the higher authorities: CDC, then the Chairman and Vice
 * Chairman. Requests of ₹5 lakh and more go to CDC directly; others arrive
 * here when a lower stage escalates them.
 */
export const EscalatedRequestsManagement = () => (
  <div className="space-y-5">
    <div className="p-5 rounded-2xl bg-violet-50 border border-violet-200 flex items-center gap-3">
      <div className="p-2.5 rounded-xl bg-violet-100 text-violet-700"><ShieldAlert className="w-5 h-5" /></div>
      <div>
        <h2 className="text-xl font-extrabold text-gray-900">With CDC &amp; Chairman</h2>
        <p className="text-xs text-gray-600 mt-0.5">Requests of ₹5 lakh and above, and anything escalated by a lower stage. You can follow them here; the decision is theirs.</p>
      </div>
    </div>
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <RequestTable query={{ status: 'UNDER_CDC_REVIEW,UNDER_FINAL_AUTHORITY_REVIEW' }}
        empty={{ title: 'Nothing is with the higher authorities right now' }} />
    </div>
  </div>
);
