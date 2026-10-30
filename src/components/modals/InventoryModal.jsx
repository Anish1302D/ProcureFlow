import React, { useState } from 'react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useApi, useAction } from '../../hooks/useApi';
import { Modal } from '../ui/Modal';

const blank = { name: '', quantity: '1', unit: 'piece', condition: 'NEW', location: '', departmentId: '', acquiredOn: '', notes: '' };

export const InventoryModal = () => {
  const { modals, closeModal } = useApp();
  const open = modals.inventory;
  const departments = useApi(open ? '/api/departments' : null);
  const { run, busy } = useAction();
  const [form, setForm] = useState(blank);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const close = () => { closeModal('inventory'); setForm(blank); };

  const submit = async (e) => {
    e.preventDefault();
    const { ok } = await run(() => api('/api/inventory', {
      method: 'POST',
      body: {
        name: form.name.trim(),
        quantity: Number(form.quantity),
        unit: form.unit.trim() || null,
        condition: form.condition,
        location: form.location.trim() || null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        acquiredOn: form.acquiredOn || null,
        notes: form.notes.trim() || null,
      },
    }), `${form.name.trim()} added to inventory`);
    if (ok) close();
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';

  return (
    <Modal isOpen={open} onClose={close} title="Add to inventory">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="inv-name" className={labelCls}>Item *</label>
          <input id="inv-name" required className={inputCls} placeholder="e.g. Wireless microphone (Shure BLX24)" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="inv-qty" className={labelCls}>Quantity *</label>
            <input id="inv-qty" type="number" min="0" step="0.01" required className={inputCls} value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />
          </div>
          <div>
            <label htmlFor="inv-unit" className={labelCls}>Unit</label>
            <input id="inv-unit" className={inputCls} value={form.unit} onChange={(e) => set({ unit: e.target.value })} />
          </div>
          <div>
            <label htmlFor="inv-cond" className={labelCls}>Condition</label>
            <select id="inv-cond" className={inputCls} value={form.condition} onChange={(e) => set({ condition: e.target.value })}>
              <option value="NEW">New</option><option value="GOOD">Good</option><option value="FAIR">Fair</option>
              <option value="DAMAGED">Damaged</option><option value="DISPOSED">Disposed</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="inv-loc" className={labelCls}>Location</label>
            <input id="inv-loc" className={inputCls} placeholder="e.g. Seminar hall" value={form.location} onChange={(e) => set({ location: e.target.value })} />
          </div>
          <div>
            <label htmlFor="inv-dept" className={labelCls}>Department</label>
            <select id="inv-dept" className={inputCls} value={form.departmentId} onChange={(e) => set({ departmentId: e.target.value })}>
              <option value="">College-wide</option>
              {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="inv-date" className={labelCls}>Acquired on</label>
            <input id="inv-date" type="date" className={inputCls} value={form.acquiredOn} onChange={(e) => set({ acquiredOn: e.target.value })} />
          </div>
        </div>
        <div>
          <label htmlFor="inv-notes" className={labelCls}>Notes</label>
          <textarea id="inv-notes" rows={2} className={inputCls} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </div>
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
          <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Cancel</button>
          <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50">Add item</button>
        </div>
      </form>
    </Modal>
  );
};
