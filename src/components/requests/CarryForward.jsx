import React, { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useApi, useAction } from '../../hooks/useApi';

/**
 * Moves an unfinished request into a later financial year. The original keeps
 * its full history and is marked carried forward; the new one links back to it.
 */
export const CarryForward = ({ request }) => {
  const { openRecord } = useApp();
  const { run, busy } = useAction();
  const years = useApi('/api/financial-years');
  const [target, setTarget] = useState('');

  const current = years.data?.find((y) => y.id === request.financialYear.id);
  const later = (years.data ?? []).filter((y) => current && y.startDate > current.startDate);
  if (later.length === 0) return null; // nothing to carry into yet

  const go = async () => {
    const { ok, result } = await run(
      () => api(`/api/requests/${request.id}/carry-forward`, { method: 'POST', body: { financialYearId: Number(target) } }),
      'Carried forward',
    );
    if (ok) openRecord('request', result.id);
  };

  return (
    <div className="p-3 rounded-lg border border-gray-200 bg-white flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-2 text-gray-600">
        <CalendarClock className="w-4 h-4 text-gray-400" />
        Not finished this year? Carry it forward, keeping its history.
      </span>
      <span className="flex items-center gap-2">
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Financial year to carry into"
          className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs">
          <option value="">Choose year…</option>
          {later.map((y) => <option key={y.id} value={y.id}>FY {y.label}</option>)}
        </select>
        <button onClick={go} disabled={!target || busy}
          className="px-3 py-1 rounded-lg bg-gray-800 text-white font-semibold disabled:opacity-50">Carry forward</button>
      </span>
    </div>
  );
};
