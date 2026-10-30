import React, { useEffect, useState } from 'react';
import { qs } from '../../api/client';
import { money, timeAgo } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useApi } from '../../hooks/useApi';
import { StatusBadge } from '../ui/StatusBadge';
import { DataState } from '../ui/States';

const PAGE = 25;

/** Delays a fast-changing value (typing in a search box) before it's used. */
export function useDebounced(value, ms = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Requests from the API, filtered server-side by `query`
 * (status, stage, mine, awaitingMe, q, financialYearId). Row-Level Security
 * has already narrowed them to what this person may see.
 */
export const RequestTable = ({ query = {}, empty, showRaisedBy = true, pageSize = PAGE }) => {
  const { openRecord } = useApp();
  const [limit, setLimit] = useState(pageSize);
  const path = `/api/requests${qs({ ...query, limit })}`;
  const state = useApi(path);
  const items = state.data?.items ?? [];
  const total = state.data?.total ?? 0;

  // A new filter starts from the first page again.
  const filterKey = JSON.stringify(query);
  useEffect(() => setLimit(pageSize), [filterKey, pageSize]);

  return (
    <DataState state={state} isEmpty={items.length === 0} empty={empty ?? { title: 'No requests here yet' }}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[11px]">
              <th className="py-3 px-3">Request</th>
              <th className="py-3 px-3">Budget head</th>
              {showRaisedBy && <th className="py-3 px-3">Raised by</th>}
              <th className="py-3 px-3 text-right">Requested</th>
              <th className="py-3 px-3 text-right">Sanctioned</th>
              <th className="py-3 px-3">Status</th>
              <th className="py-3 px-3 text-right">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map((r) => (
              <tr
                key={r.id}
                onClick={() => openRecord('request', r.id)}
                className="hover:bg-indigo-50/40 cursor-pointer transition-colors"
              >
                <td className="py-3 px-3 max-w-xs">
                  <div className="flex items-center gap-1.5">
                    <p className="font-mono font-bold text-indigo-600">{r.requestNumber}</p>
                    {r.fundingType && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${
                        r.fundingType === 'NON_GRANT'
                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                          : 'bg-sky-50 text-sky-700 border border-sky-200'
                      }`}>
                        {r.fundingType === 'NON_GRANT' ? 'Non-Grant' : 'Grant'}
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-gray-800 truncate">{r.title}</p>
                </td>
                <td className="py-3 px-3 text-gray-500">
                  {r.budgetHead.name}
                  <span className="block text-[10px] text-gray-400 capitalize">{r.budgetHead.headType.toLowerCase()} · {r.itemCount} item{r.itemCount === 1 ? '' : 's'}</span>
                </td>
                {showRaisedBy && <td className="py-3 px-3 font-medium text-gray-700">{r.raisedBy.name}</td>}
                <td className="py-3 px-3 text-right font-bold text-gray-900 tabular-nums">{money(r.tentativeTotalCost)}</td>
                <td className="py-3 px-3 text-right tabular-nums text-gray-600">
                  {['APPROVED', 'PARTIALLY_APPROVED'].includes(r.status) ? money(r.sanctionedAmount) : '—'}
                </td>
                <td className="py-3 px-3"><StatusBadge status={r.status} /></td>
                <td className="py-3 px-3 text-right text-gray-400 whitespace-nowrap">{timeAgo(r.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between pt-3 text-[11px] text-gray-400">
        <span>Showing {items.length} of {total}</span>
        {items.length < total && (
          <button onClick={() => setLimit((l) => l + pageSize)} className="font-semibold text-indigo-600 hover:underline">
            Show more
          </button>
        )}
      </div>
    </DataState>
  );
};
