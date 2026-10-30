import React, { useState } from 'react';
import { api, qs } from '../../api/client';
import { money } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useApi, useAction } from '../../hooks/useApi';
import { Modal } from '../ui/Modal';

const blank = { billNumber: '', vendorName: '', billDate: '', billAmount: '', requestId: '' };

/** Records a vendor bill against an approved request. */
export const BillModal = () => {
  const { modals, closeModal } = useApp();
  const open = modals.bill;
  const approved = useApi(open ? `/api/requests${qs({ status: 'APPROVED,PARTIALLY_APPROVED', limit: 100 })}` : null);
  const { run, busy } = useAction();
  const [form, setForm] = useState(blank);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const close = () => { closeModal('bill'); setForm(blank); };

  const submit = async (e) => {
    e.preventDefault();
    const { ok } = await run(() => api('/api/purchase-bills', {
      method: 'POST',
      body: {
        billNumber: form.billNumber.trim(),
        vendorName: form.vendorName.trim() || undefined,
        billDate: form.billDate || undefined,
        billAmount: Number(form.billAmount),
        requestId: form.requestId || undefined,
      },
    }), `Bill ${form.billNumber.trim()} recorded`);
    if (ok) close();
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const linked = approved.data?.items.find((r) => r.id === form.requestId);

  return (
    <Modal isOpen={open} onClose={close} title="Record a purchase bill">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="bill-req" className={labelCls}>For approved request</label>
          <select id="bill-req" className={inputCls} value={form.requestId} onChange={(e) => set({ requestId: e.target.value })}>
            <option value="">Not linked to a request</option>
            {(approved.data?.items ?? []).map((r) => (
              <option key={r.id} value={r.id}>{r.requestNumber} — {r.title} (sanctioned {money(r.sanctionedAmount)})</option>
            ))}
          </select>
          {linked && Number(form.billAmount) > linked.sanctionedAmount && (
            <p className="text-[11px] text-amber-700 mt-1">This bill is more than the {money(linked.sanctionedAmount)} sanctioned.</p>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="bill-no" className={labelCls}>Bill number *</label>
            <input id="bill-no" required className={inputCls} value={form.billNumber} onChange={(e) => set({ billNumber: e.target.value })} />
          </div>
          <div>
            <label htmlFor="bill-vendor" className={labelCls}>Vendor</label>
            <input id="bill-vendor" className={inputCls} value={form.vendorName} onChange={(e) => set({ vendorName: e.target.value })} />
          </div>
          <div>
            <label htmlFor="bill-date" className={labelCls}>Bill date</label>
            <input id="bill-date" type="date" className={inputCls} value={form.billDate} onChange={(e) => set({ billDate: e.target.value })} />
          </div>
          <div>
            <label htmlFor="bill-amt" className={labelCls}>Amount (₹) *</label>
            <input id="bill-amt" type="number" min="0" step="0.01" required className={inputCls} value={form.billAmount} onChange={(e) => set({ billAmount: e.target.value })} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
          <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Cancel</button>
          <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">Record bill</button>
        </div>
      </form>
    </Modal>
  );
};
