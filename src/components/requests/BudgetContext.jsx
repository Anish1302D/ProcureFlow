import React from 'react';
import { Wallet } from 'lucide-react';
import { money } from '../../api/format';
import { useApi } from '../../hooks/useApi';

/**
 * The department's budget position while a request is being reviewed, so a
 * decision is taken against the year's provision rather than in the dark.
 *
 * Every figure is computed from the requests themselves — utilised is what has
 * been sanctioned, committed is what is still in flight (this request
 * included) — so nothing here can drift out of step with the approvals.
 */
export const BudgetContext = ({ request }) => {
  const { data, error } = useApi(`/api/requests/${request.id}/budget-context`);
  if (error || !data) return null;

  const figures = [
    ['Annual provision', data.allocatedAmount, 'text-gray-900'],
    ['Already sanctioned', data.utilizedAmount, 'text-gray-900'],
    ['Committed, awaiting decision', data.committedAmount, 'text-gray-900'],
    ['This request', request.tentativeTotalCost, 'text-indigo-700'],
    ['Left if everything pending is approved', data.remainingAmount,
      data.remainingAmount < 0 ? 'text-red-700' : 'text-emerald-700'],
  ];

  return (
    <div className="p-4 rounded-xl bg-white border border-gray-200">
      <h4 className="text-xs font-bold text-gray-900 flex items-center gap-1.5">
        <Wallet className="w-3.5 h-3.5 text-indigo-500" />
        {request.department?.name ?? 'Department'} budget · FY {request.financialYear.label}
      </h4>
      <dl className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3">
        {figures.map(([label, value, tone]) => (
          <div key={label}>
            <dt className="text-[10px] text-gray-400 uppercase tracking-wider leading-tight">{label}</dt>
            <dd className={`text-sm font-bold tabular-nums mt-0.5 ${tone}`}>{money(value)}</dd>
          </div>
        ))}
      </dl>
      {data.remainingAmount < 0 && (
        <p className="text-[11px] text-red-700 mt-2 font-semibold">
          Approving everything pending would exceed the year's provision.
        </p>
      )}
    </div>
  );
};
