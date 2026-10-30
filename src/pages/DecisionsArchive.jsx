import React from 'react';
import { CheckCircle2, FolderArchive, Scissors, XCircle } from 'lucide-react';
import { DECIDED_STATUSES } from '../api/format';
import { RequestTable } from '../components/requests/RequestTable';

const LEGEND = [
  { icon: CheckCircle2, color: 'text-emerald-600', label: 'Approved' },
  { icon: Scissors, color: 'text-teal-600', label: 'Partially approved' },
  { icon: XCircle, color: 'text-red-500', label: 'Rejected' },
  { icon: FolderArchive, color: 'text-indigo-500', label: 'Carried forward' },
];

/** Decided requests this person can see — each with its sealed history. */
export const DecisionsArchive = () => (
  <div className="space-y-5">
    {/* Header */}
    <div className="p-5 rounded-2xl bg-white border border-gray-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-extrabold text-gray-900 flex items-center gap-2">
          <FolderArchive className="w-5 h-5 text-violet-500" /> Decided requests
        </h2>
        <p className="text-xs text-gray-500 mt-1 max-w-lg">
          Approved, partly approved, rejected and carried-forward requests. Each decision in a request's history shows whether its record is still exactly as sealed.
        </p>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 shrink-0">
        {LEGEND.map(({ icon: Icon, color, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-gray-600">
            <Icon className={`w-3.5 h-3.5 ${color}`} /> {label}
          </span>
        ))}
      </div>
    </div>

    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <RequestTable
        query={{ status: DECIDED_STATUSES.join(',') }}
        empty={{ title: 'No decisions yet', hint: 'Requests you have approved, rejected or partially approved appear here.' }}
      />
    </div>
  </div>
);
