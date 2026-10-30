import React from 'react';
import { ClipboardCheck, Clock } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useApi } from '../hooks/useApi';
import { RequestTable } from '../components/requests/RequestTable';

/** Requests sitting at a stage this person is staffed at, waiting for their decision. */
export const ReviewQueue = () => {
  const { user } = useApp();
  const stages = user.stages.map((s) => s.name).join(' and ');
  const awaiting = useApi('/api/dashboard');
  const count = awaiting.data?.awaitingMyDecision;

  return (
    <div className="space-y-5">
      {/* Header banner */}
      <div className="p-5 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 shrink-0">
            <ClipboardCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-gray-900">Awaiting my decision</h2>
            <p className="text-xs text-gray-600 mt-0.5">
              {stages
                ? `Requests now with ${stages}. Open one to record your decision.`
                : 'You are not staffed at any approval stage.'}
            </p>
          </div>
        </div>
        {count !== undefined && count > 0 && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-200/60 border border-amber-300">
            <Clock className="w-4 h-4 text-amber-700" />
            <span className="text-sm font-bold text-amber-900">{count} request{count !== 1 ? 's' : ''} waiting</span>
          </div>
        )}
      </div>

      {/* Request list */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <RequestTable
          query={{ awaitingMe: true }}
          empty={{
            title: 'Nothing waiting on you',
            hint: 'New requests at your stage appear here, and you are notified when they arrive.',
          }}
        />
      </div>
    </div>
  );
};
