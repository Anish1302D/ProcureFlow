import React, { useState } from 'react';
import { Wallet } from 'lucide-react';
import { api } from '../api/client';
import { money } from '../api/format';
import { Attachments } from '../components/ui/Attachments';
import { ErrorState, Loading } from '../components/ui/States';
import { useApp } from '../context/AppContext';
import { useApi, useAction } from '../hooks/useApi';

const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
const labelCls = 'block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1';

/** One department's year: what was provided, spent, committed, and left. */
const ProvisionCard = ({ provision }) => {
  const over = provision.remainingAmount < 0;
  return (
    <div className="p-4 rounded-xl bg-white border border-gray-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">{provision.department.name}</h3>
        <span className="text-[11px] text-gray-400">
          FY {provision.financialYear.label}
          {provision.budgetHead ? ` · ${provision.budgetHead.name}` : ' · all budget heads'}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Provision', provision.allocatedAmount, 'text-gray-900'],
          ['Sanctioned', provision.utilizedAmount, 'text-gray-900'],
          ['Committed', provision.committedAmount, 'text-gray-900'],
          ['Remaining', provision.remainingAmount, over ? 'text-red-700' : 'text-emerald-700'],
        ].map(([label, value, tone]) => (
          <div key={label}>
            <dt className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</dt>
            <dd className={`text-base font-bold tabular-nums ${tone}`}>{money(value)}</dd>
          </div>
        ))}
      </dl>
      {provision.remarks && <p className="text-xs text-gray-600 mt-3">{provision.remarks}</p>}
      <div className="mt-3">
        <Attachments
          files={provision.attachments ?? []}
          uploadPath={provision.canEdit ? `/api/budget-provisions/${provision.id}/attachments` : null}
        />
      </div>
    </div>
  );
};

/**
 * Departmental budget provisions for the year. A head declares their own
 * department's; everyone reviewing requests can read them, because a decision
 * is taken against the provision.
 */
export const BudgetProvisions = () => {
  const { user, showToast } = useApp();
  const { run, busy } = useAction();
  const provisions = useApi('/api/budget-provisions');
  const departments = useApi('/api/departments');
  const years = useApi('/api/financial-years');
  const heads = useApi('/api/budget-heads');

  const isHead = user.roles.includes('HEAD') || user.roles.includes('ADMIN');
  const [form, setForm] = useState({ departmentId: '', financialYearId: '', budgetHeadId: '', allocatedAmount: '', remarks: '' });

  const save = async () => {
    if (!form.departmentId || !form.financialYearId) return showToast('Choose a department and year', 'error');
    if (form.allocatedAmount === '' || Number(form.allocatedAmount) < 0) return showToast('Enter the amount provided', 'error');
    const { ok } = await run(() => api('/api/budget-provisions', {
      method: 'POST',
      body: {
        departmentId: Number(form.departmentId),
        financialYearId: Number(form.financialYearId),
        budgetHeadId: form.budgetHeadId ? Number(form.budgetHeadId) : undefined,
        allocatedAmount: Number(form.allocatedAmount),
        remarks: form.remarks.trim() || undefined,
      },
    }), 'Budget provision recorded');
    if (ok) setForm({ departmentId: '', financialYearId: '', budgetHeadId: '', allocatedAmount: '', remarks: '' });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
          <Wallet className="w-5 h-5 text-indigo-600" /> Departmental budgets
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">
          What each department was given for the year, and what is left of it. Sanctioned and
          committed figures come from the requests themselves, so they are never out of date.
        </p>
      </div>

      {isHead && (
        <div className="p-4 rounded-xl bg-indigo-50/50 border border-indigo-200 space-y-3">
          <h2 className="text-xs font-bold text-gray-900">Record a provision</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Department *</label>
              <select className={inputCls} value={form.departmentId}
                onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                <option value="">Choose…</option>
                {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Financial year *</label>
              <select className={inputCls} value={form.financialYearId}
                onChange={(e) => setForm((f) => ({ ...f, financialYearId: e.target.value }))}>
                <option value="">Choose…</option>
                {(years.data ?? []).map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Budget head</label>
              <select className={inputCls} value={form.budgetHeadId}
                onChange={(e) => setForm((f) => ({ ...f, budgetHeadId: e.target.value }))}>
                <option value="">All heads together</option>
                {(heads.data ?? []).map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Amount provided ₹ *</label>
              <input type="number" min="0" step="0.01" className={inputCls} value={form.allocatedAmount}
                onChange={(e) => setForm((f) => ({ ...f, allocatedAmount: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={inputCls} placeholder="e.g. as sanctioned in the governing body meeting of 12 April"
              value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} />
          </div>
          <div className="flex justify-end">
            <button onClick={save} disabled={busy}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50">
              {busy ? 'Saving…' : 'Save provision'}
            </button>
          </div>
          <p className="text-[10px] text-gray-500">
            Recording a provision again for the same department, year and head replaces the amount.
            Attach the sanction letter to the provision once it is saved.
          </p>
        </div>
      )}

      {provisions.loading && !provisions.data && <Loading />}
      {provisions.error && <ErrorState error={provisions.error} />}
      {provisions.data?.length === 0 && (
        <p className="text-xs text-gray-400">No budget provisions recorded yet.</p>
      )}
      <div className="space-y-3">
        {(provisions.data ?? []).map((p) => <ProvisionCard key={p.id} provision={p} />)}
      </div>
    </div>
  );
};
