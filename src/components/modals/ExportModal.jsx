import React, { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { download, qs } from '../../api/client';
import { DECIDED_STATUSES, REVIEW_STATUSES } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useApi } from '../../hooks/useApi';
import { Modal } from '../ui/Modal';

const SCOPES = {
  all: { label: 'All requests', status: undefined },
  review: { label: 'Still under review', status: REVIEW_STATUSES.join(',') },
  decided: { label: 'Decided', status: DECIDED_STATUSES.join(',') },
};

/** A CSV of requests, limited to what the person may see. Opens in Excel. */
export const ExportModal = () => {
  const { modals, closeModal, showToast } = useApp();
  const open = modals.export;
  const years = useApi(open ? '/api/financial-years' : null);
  const [year, setYear] = useState('');
  const [scope, setScope] = useState('all');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await download(`/api/exports/requests.csv${qs({ financialYearId: year, status: SCOPES[scope].status })}`, 'requests.csv');
      showToast('Export downloaded', 'success');
      closeModal('export');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

  return (
    <Modal isOpen={open} onClose={() => closeModal('export')} title="Export requests">
      <div className="space-y-5">
        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 flex items-center gap-3">
          <FileSpreadsheet className="w-6 h-6 text-emerald-600 shrink-0" />
          <p className="text-xs text-gray-700">
            A CSV spreadsheet that opens directly in Excel, with request numbers, titles, budget heads, requested and sanctioned
            amounts, and dates. It includes only the requests your role can see.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="exp-fy" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Financial year</label>
            <select id="exp-fy" className={inputCls} value={year} onChange={(e) => setYear(e.target.value)}>
              <option value="">All years</option>
              {(years.data ?? []).map((y) => <option key={y.id} value={y.id}>FY {y.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="exp-scope" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Requests</label>
            <select id="exp-scope" className={inputCls} value={scope} onChange={(e) => setScope(e.target.value)}>
              {Object.entries(SCOPES).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
          <button type="button" onClick={() => closeModal('export')} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Cancel</button>
          <button type="button" onClick={run} disabled={busy} className="px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2 disabled:opacity-50">
            <Download className="w-4 h-4" /> {busy ? 'Preparing…' : 'Download CSV'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
