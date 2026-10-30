import { LocalAiAssistant } from '../LocalAiAssistant';
import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { api, qs } from '../../api/client';
import { money } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useApi } from '../../hooks/useApi';
import { ACCEPT } from '../ui/Attachments';
import { Modal } from '../ui/Modal';
import { serializeCustomItem } from '../../utils/customItem';

// A plain counter for React keys. crypto.randomUUID() would be neater, but it
// only exists on HTTPS or localhost pages, and an intranet server reached over
// plain HTTP would crash this form on open.
let nextKey = 0;
const blankLine = () => ({ key: ++nextKey, budgetItemId: '', quantity: '', unitCost: '', remarks: '', customItemName: '' });
const blankForm = (departmentId = '') => ({
  title: '', description: '', budgetHeadId: '', financialYearId: '', departmentId, courseId: '', urgency: 'Medium',
  // "Other" free-text overrides
  customBudgetHead: '',
  customDepartment: '',
  customCourse: '',
  customUrgency: '',
});

// Whole paise, so the running total matches the server's exact NUMERIC maths.
const linePaise = (l) => Math.round(Math.round(Number(l.quantity) * 100) * Math.round(Number(l.unitCost) * 100) / 100);

// ---------------------------------------------------------------------------
// Sentinel detection helpers
// ---------------------------------------------------------------------------

/** Returns true when a budget head/item's code is the sentinel "OTHER" row. */
const isOther = (code) => code === 'OTHER';

/** The "Other" head from the loaded list, if present. */
const otherHead = (heads) => heads.find((h) => isOther(h.code));

/** The "Other" item from the loaded catalogue for the selected head. */
const otherItem = (catalogue) => catalogue.find((i) => isOther(i.code));

// ---------------------------------------------------------------------------
// Modal component
// ---------------------------------------------------------------------------

export const NewRequestModal = () => {
  const { user, modals, closeModal, showToast, refresh, openRecord } = useApp();
  const open = modals.newRequest;
  // A requester the admin has placed in a department (an HOD) raises requests
  // for that department only; the server rejects any other.
  const ownDept = user && !user.roles.includes('ADMIN') && user.departmentId != null
    ? String(user.departmentId) : '';
  const [form, setForm] = useState(() => blankForm(ownDept));
  const [lines, setLines] = useState(() => [blankLine()]);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(null); // 'draft' | 'submit' | null
  const [attempted, setAttempted] = useState(null); // which button was last pressed

  const heads = useApi(open ? '/api/budget-heads' : null);
  const years = useApi(open ? '/api/financial-years' : null);
  const departments = useApi(open && !ownDept ? '/api/departments' : null);
  const courses = useApi(open && form.departmentId && form.departmentId !== 'OTHER' ? `/api/courses${qs({ departmentId: form.departmentId })}` : null);
  const stages = useApi(open ? '/api/workflow/stages' : null);
  const catalogue = useApi(open && form.budgetHeadId && form.budgetHeadId !== 'OTHER' ? `/api/budget-heads/${form.budgetHeadId}/items` : null);

  const deptIdForBudget = form.departmentId && form.departmentId !== 'OTHER'
    ? form.departmentId
    : (ownDept || null);
  const headIdForBudget = form.budgetHeadId && form.budgetHeadId !== 'OTHER'
    ? form.budgetHeadId
    : null;
  const fyIdForBudget = form.financialYearId || null;

  const budgetContextUrl = open && deptIdForBudget
    ? `/api/budget-context${qs({
        departmentId: deptIdForBudget,
        financialYearId: fyIdForBudget,
        budgetHeadId: headIdForBudget,
      })}`
    : null;

  const budgetContext = useApi(budgetContextUrl);

  // Default the financial year to the active one.
  useEffect(() => {
    const active = years.data?.find((y) => y.isActive);
    if (active && !form.financialYearId) setForm((f) => ({ ...f, financialYearId: String(active.id) }));
  }, [years.data, form.financialYearId]);

  // The modal can mount before sign-in finishes, so pin the department once known.
  useEffect(() => {
    if (ownDept) setForm((f) => (f.departmentId === ownDept ? f : { ...f, departmentId: ownDept, courseId: '' }));
  }, [ownDept]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const changeHead = (budgetHeadId) => {
    // Items belong to a head; lines chosen under another head no longer apply.
    set({ budgetHeadId, customBudgetHead: '' });
    setLines((ls) => ls.map((l) => ({ ...l, budgetItemId: '', customItemName: '' })));
  };

  const changeDept = (departmentId) => {
    set({ departmentId, courseId: '', customDepartment: '', customCourse: '' });
  };

  // ---------------------------------------------------------------------------
  // Determine which items are "filled" for total calculation
  // ---------------------------------------------------------------------------
  const filled = lines.filter((l) => l.budgetItemId || l.quantity || l.unitCost);
  const totalPaise = filled.reduce((sum, l) => sum + (Number(l.quantity) > 0 && Number(l.unitCost) > 0 ? linePaise(l) : 0), 0);
  const total = totalPaise / 100;

  const route = useMemo(() => (stages.data ?? []).find(
    (s) => s.entryRange && total >= s.entryRange.min && (s.entryRange.maxExclusive === null || total < s.entryRange.maxExclusive),
  ), [stages.data, total]);

  const catalogueItems = catalogue.data ?? [];

  // Dynamic departmental budget limit calculation
  const budgetValidation = useMemo(() => {
    if (!deptIdForBudget || budgetContext.isLoading || !budgetContext.data) {
      return { isValid: true, excessAmount: 0 };
    }
    const remaining = Number(budgetContext.data.remainingAmount ?? 0);
    const excess = Math.max(0, Math.round((total - remaining) * 100) / 100);
    if (excess > 0) {
      return {
        isValid: false,
        reason: 'BUDGET_EXCEEDED',
        excessAmount: excess,
        remainingAmount: remaining,
        error: `Request exceeds the available departmental budget by ${money(excess)}. Maximum permitted amount: ${money(remaining)}.`,
      };
    }
    return {
      isValid: true,
      excessAmount: 0,
      remainingAmount: remaining,
    };
  }, [deptIdForBudget, budgetContext.isLoading, budgetContext.data, total]);
  const itemById = new Map(catalogueItems.map((i) => [String(i.id), i]));
  const chosen = filled.map((l) => l.budgetItemId).filter(Boolean);

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  const headIsOther = isOther((heads.data ?? []).find((h) => String(h.id) === form.budgetHeadId)?.code ?? '');
  const deptIsOther = form.departmentId === 'OTHER';
  const courseIsOther = form.courseId === 'OTHER';
  const urgencyIsOther = form.urgency === 'OTHER';

  const problems = [];
  if (form.title.trim().length < 3) problems.push('Give the request a title (at least 3 characters).');
  if (!form.budgetHeadId) problems.push('Choose a budget head.');
  if (headIsOther && !form.customBudgetHead.trim()) problems.push('Describe the budget head (the "Other" field is empty).');
  if (deptIsOther && !form.customDepartment.trim()) problems.push('Describe the department (the "Other" field is empty).');
  if (courseIsOther && !form.customCourse.trim()) problems.push('Describe the course (the "Other" field is empty).');
  if (urgencyIsOther && !form.customUrgency.trim()) problems.push('Describe the urgency level (the "Other" field is empty).');

  filled.forEach((l, n) => {
    const item = itemById.get(l.budgetItemId);
    const lineIsOther = isOther(item?.code ?? '');
    const label = lineIsOther ? (l.customItemName.trim() || `Line ${n + 1}`) : (item?.name ?? `Line ${n + 1}`);
    if (!l.budgetItemId) problems.push(`Line ${n + 1}: choose an item.`);
    if (lineIsOther && !l.customItemName.trim()) problems.push(`Line ${n + 1}: describe the item (the "Other" field is empty).`);
    if (!(Number(l.quantity) > 0)) problems.push(`${label}: quantity must be more than 0.`);
    if (l.unitCost === '' || Number(l.unitCost) <= 0) problems.push(`${label}: unit cost must be greater than ₹0.`);
  });
  if (new Set(chosen).size !== chosen.length) problems.push('Each item can appear only once — change the quantity instead.');
  if (!budgetValidation.isValid) problems.push(budgetValidation.error);

  const submitProblems = [
    ...problems,
    ...(filled.length === 0 ? ['Add at least one item to submit.'] : (total <= 0 ? ['Total request amount must be greater than ₹0 to submit.'] : [])),
  ];

  // ---------------------------------------------------------------------------
  // Reset / close
  // ---------------------------------------------------------------------------
  const reset = () => { setForm(blankForm(ownDept));setLines([blankLine()]); setFiles([]); setAttempted(null); };
  const close = () => { closeModal('newRequest'); reset(); };

  // ---------------------------------------------------------------------------
  // Save / submit
  // ---------------------------------------------------------------------------
  const save = async (andSubmit) => {
    setAttempted(andSubmit ? 'submit' : 'draft');
    if (!budgetValidation.isValid) {
      showToast(budgetValidation.error, 'error');
      return;
    }
    if ((andSubmit ? submitProblems : problems).length) return;
    setSaving(andSubmit ? 'submit' : 'draft');

    // Build the extra JSONB payload with any "Other" custom names.
    const urgencyValue = urgencyIsOther ? form.customUrgency.trim() : form.urgency;
    const extra = { urgency: urgencyValue };
    if (headIsOther && form.customBudgetHead.trim()) extra.customBudgetHead = form.customBudgetHead.trim();
    if (deptIsOther && form.customDepartment.trim()) extra.customDepartment = form.customDepartment.trim();
    if (courseIsOther && form.customCourse.trim()) extra.customCourse = form.customCourse.trim();

    // For "Other" item lines: the custom name goes into remarks so it is
    // visible everywhere downstream without a schema change.
    const serialisedItems = filled.map((l) => {
      const item = itemById.get(l.budgetItemId);
      const lineIsOther = isOther(item?.code ?? '');
      const remarks = lineIsOther
        ? serializeCustomItem(l.customItemName, l.remarks)
        : (l.remarks.trim() || undefined);
      return {
        budgetItemId: Number(l.budgetItemId),
        quantity: Number(l.quantity),
        unitCost: Number(l.unitCost),
        ...(remarks ? { remarks } : {}),
      };
    });

    let created;
    try {
      created = await api('/api/requests', {
        method: 'POST',
        body: {
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          budgetHeadId: Number(form.budgetHeadId),
          financialYearId: form.financialYearId ? Number(form.financialYearId) : undefined,
          // When "Other" is selected on dept/course the FK is left null (they're nullable).
          departmentId: (form.departmentId && !deptIsOther) ? Number(form.departmentId) : null,
          courseId: (form.courseId && !courseIsOther) ? Number(form.courseId) : null,
          extra,
          items: serialisedItems,
        },
      });
    } catch (err) {
      showToast(err.message, 'error');
      setSaving(null);
      return;
    }

    // The request exists from here on. A failed upload or submission leaves it
    // as a draft the person can open and finish, rather than losing their work.
    const failedFiles = [];
    for (const file of files) {
      const upload = new FormData();
      upload.append('file', file, file.name);
      try {
        await api(`/api/requests/${created.id}/attachments`, { method: 'POST', form: upload });
      } catch (err) {
        failedFiles.push(`${file.name}: ${err.message}`);
      }
    }

    let message = `Draft ${created.requestNumber} saved`;
    let tone = 'success';
    if (andSubmit) {
      try {
        const submitted = await api(`/api/requests/${created.id}/submit`, { method: 'POST' });
        message = `${created.requestNumber} submitted — now with ${submitted.stage?.name ?? 'the approvers'}`;
      } catch (err) {
        message = `${created.requestNumber} saved as a draft but not submitted: ${err.message}`;
        tone = 'warning';
      }
    }
    if (failedFiles.length) {
      message += `. Not attached — ${failedFiles.join('; ')}`;
      tone = 'warning';
    }

    showToast(message, tone);
    setSaving(null);
    close();
    refresh();
    openRecord('request', created.id);
  };

  // ---------------------------------------------------------------------------
  // Shared classes
  // ---------------------------------------------------------------------------
  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';
  const otherInputCls = `${inputCls} mt-1.5 border-amber-300 focus:border-amber-400 focus:ring-amber-400/20 bg-amber-50/30`;

  const head = (heads.data ?? []).find((h) => String(h.id) === form.budgetHeadId);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (user?.roles?.includes('ADMIN')) return null;

  return (
    <Modal isOpen={open} onClose={close} title="New procurement request" subtitle="List each item separately — approvers can approve some lines and cut others." maxWidth="max-w-4xl">
      <div className="space-y-5">
        {/* Title */}
        <div>
          <label htmlFor="req-title" className={labelCls}>Title *</label>
          <input id="req-title" className={inputCls} placeholder="e.g. Seminar hall audio-visual upgrade"
            value={form.title} onChange={(e) => set({ title: e.target.value })} />
        </div>

        {/* Budget head + Financial year + Urgency */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Budget Head */}
          <div>
            <label htmlFor="req-head" className={labelCls}>Budget head *</label>
            <select id="req-head" className={inputCls} value={form.budgetHeadId} onChange={(e) => changeHead(e.target.value)}>
              <option value="">Choose…</option>
              {(heads.data ?? []).filter((h) => !isOther(h.code)).map((h) => (
                <option key={h.id} value={h.id}>{h.name} — {h.headType.toLowerCase()}</option>
              ))}
              <option value={String(otherHead(heads.data ?? [])?.id ?? 'OTHER')}>Other (specify below)</option>
            </select>
            {headIsOther && (
              <input className={otherInputCls} placeholder="Describe the budget head…"
                value={form.customBudgetHead} onChange={(e) => set({ customBudgetHead: e.target.value })} />
            )}
          </div>

          {/* Financial year */}
          <div>
            <label htmlFor="req-fy" className={labelCls}>Financial year</label>
            <select id="req-fy" className={inputCls} value={form.financialYearId} onChange={(e) => set({ financialYearId: e.target.value })}>
              {(years.data ?? []).map((y) => <option key={y.id} value={y.id}>FY {y.label}{y.isActive ? ' (current)' : ''}</option>)}
            </select>
          </div>

          {/* Urgency */}
          <div>
            <label htmlFor="req-urgency" className={labelCls}>Urgency</label>
            <select id="req-urgency" className={inputCls} value={form.urgency} onChange={(e) => set({ urgency: e.target.value })}>
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
              <option value="OTHER">Other (specify below)</option>
            </select>
            {urgencyIsOther && (
              <input className={otherInputCls} placeholder="e.g. Critical — event in 48 hours"
                value={form.customUrgency} onChange={(e) => set({ customUrgency: e.target.value })} />
            )}
          </div>
        </div>

        {/* Department + Course */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Department */}
          <div>
            <label htmlFor="req-dept" className={labelCls}>Department</label>
            {ownDept ? (
              <>
                <input id="req-dept" className={`${inputCls} bg-gray-50 text-gray-600`} readOnly
                  value={user.departmentName ?? 'Your department'} />
                <p className="mt-1 text-[11px] text-gray-400">Requests are raised for the department you head.</p>
              </>
            ) : (
              <select id="req-dept" className={inputCls} value={form.departmentId} onChange={(e) => changeDept(e.target.value)}>
                <option value="">Not specific to a department</option>
                {(departments.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                <option value="OTHER">Other (specify below)</option>
              </select>
            )}
            {deptIsOther && (
              <input className={otherInputCls} placeholder="e.g. Sports & Physical Education"
                value={form.customDepartment} onChange={(e) => set({ customDepartment: e.target.value })} />
            )}
          </div>

          {/* Course */}
          <div>
            <label htmlFor="req-course" className={labelCls}>Course</label>
            <select id="req-course" className={inputCls} value={form.courseId}
              disabled={!form.departmentId}
              onChange={(e) => set({ courseId: e.target.value, customCourse: '' })}>
              <option value="">
                {!form.departmentId ? 'Select a department first' : 'None (not course-specific)'}
              </option>
              {(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              {form.departmentId && <option value="OTHER">Other (specify below)</option>}
            </select>
            {courseIsOther && (
              <input className={otherInputCls} placeholder="e.g. B.Sc. Environmental Science"
                value={form.customCourse} onChange={(e) => set({ customCourse: e.target.value })} />
            )}
          </div>
        </div>

        {/* Departmental Budget Status Card */}
        {deptIdForBudget && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Departmental Budget Availability
              </span>
              {budgetContext.data?.financialYearCode && (
                <span className="text-xs font-medium text-slate-500">
                  FY {budgetContext.data.financialYearCode}
                </span>
              )}
            </div>
            {budgetContext.data ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
                <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Annual Provision</div>
                  <div className="text-sm font-bold text-slate-900 tabular-nums">
                    {money(budgetContext.data.allocatedAmount)}
                  </div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Utilized</div>
                  <div className="text-sm font-bold text-emerald-700 tabular-nums">
                    {money(budgetContext.data.utilizedAmount)}
                  </div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Committed (In-flight)</div>
                  <div className="text-sm font-bold text-amber-700 tabular-nums">
                    {money(budgetContext.data.committedAmount)}
                  </div>
                </div>
                <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-sm">
                  <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Remaining Balance</div>
                  <div className={`text-sm font-bold tabular-nums ${budgetContext.data.remainingAmount > 0 ? 'text-indigo-700' : 'text-rose-600'}`}>
                    {money(budgetContext.data.remainingAmount)}
                  </div>
                </div>
              </div>
            ) : budgetContext.isLoading ? (
              <div className="text-xs text-slate-500 italic py-1">Loading budget availability…</div>
            ) : (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                No approved budget provision has been declared for this department for the selected financial year.
              </div>
            )}
          </div>
        )}

        {/* Line items */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={labelCls.replace('mb-1.5', '')}>Items *</span>
            {head && !headIsOther && <span className="text-[11px] text-gray-400">Items under {head.name}</span>}
          </div>
          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 bg-white">
            {lines.map((l, n) => {
              const item = itemById.get(l.budgetItemId);
              const lineIsOther = isOther(item?.code ?? '');
              return (
                <div key={l.key} className="p-3 grid grid-cols-12 gap-2 items-end">
                  <label className="col-span-12 md:col-span-5 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Item {n + 1}
                    <select className={`${inputCls} mt-1`} value={l.budgetItemId}
                      disabled={!form.budgetHeadId}
                      onChange={(e) => setLine(l.key, { budgetItemId: e.target.value, customItemName: '' })}>
                      <option value="">{form.budgetHeadId ? 'Choose…' : 'Choose a budget head first'}</option>
                      {catalogueItems.filter((i) => !isOther(i.code)).map((i) => (
                        <option key={i.id} value={i.id} disabled={chosen.includes(String(i.id)) && l.budgetItemId !== String(i.id)}>
                          {i.name} ({i.itemType.toLowerCase()})
                        </option>
                      ))}
                      {/* "Other" option — rendered last */}
                      {otherItem(catalogueItems) && (
                        <option value={String(otherItem(catalogueItems).id)}>Other (specify below)</option>
                      )}
                    </select>
                    {/* Custom item name input revealed when "Other" selected */}
                    {lineIsOther && (
                      <input className={`${otherInputCls} text-xs`} placeholder="What item do you need?"
                        value={l.customItemName} onChange={(e) => setLine(l.key, { customItemName: e.target.value })} />
                    )}
                  </label>

                  <label className="col-span-4 md:col-span-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Qty{item && !lineIsOther && item.unit ? ` (${item.unit})` : ''}
                    <input type="number" min="0.01" step="0.01" className={`${inputCls} mt-1`} value={l.quantity}
                      onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                  </label>

                  <label className="col-span-4 md:col-span-2 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Unit cost ₹
                    <input type="number" min="0.01" step="0.01" className={`${inputCls} mt-1`} value={l.unitCost}
                      onChange={(e) => setLine(l.key, { unitCost: e.target.value })} />
                  </label>

                  <div className="col-span-3 md:col-span-2 text-right text-sm font-bold text-gray-900 tabular-nums pb-2">
                    {Number(l.quantity) > 0 && l.unitCost !== '' ? money(linePaise(l) / 100) : '—'}
                  </div>

                  <div className="col-span-1 text-right pb-1.5">
                    {lines.length > 1 && (
                      <button onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove item ${n + 1}`}
                        className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>

                  {/* Remarks — hidden label for "Other" lines since custom name is above */}
                  {!lineIsOther && (
                    <input className={`${inputCls} col-span-12 text-xs py-1.5`} placeholder="Specification or note for this item (optional)"
                      value={l.remarks} onChange={(e) => setLine(l.key, { remarks: e.target.value })} />
                  )}
                  {lineIsOther && (
                    <input className={`${inputCls} col-span-12 text-xs py-1.5`} placeholder="Additional specification or note (optional)"
                      value={l.remarks} onChange={(e) => setLine(l.key, { remarks: e.target.value })} />
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button onClick={() => setLines((ls) => [...ls, blankLine()])} disabled={!form.budgetHeadId}
              className="text-xs font-semibold text-indigo-600 flex items-center gap-1 hover:underline disabled:opacity-40">
              <Plus className="w-3.5 h-3.5" /> Add another item
            </button>
            <div className="text-right">
              <span className="text-xs text-gray-500">Estimated total </span>
              <span className="text-lg font-extrabold text-gray-900 tabular-nums">{money(total)}</span>
            </div>
          </div>
          {total > 0 && route && (
            <p className="text-[11px] text-gray-600 flex items-center gap-1.5 justify-end">
              <ArrowRight className="w-3.5 h-3.5 text-indigo-500" />
              At this amount the request goes first to <strong className="text-gray-900">{route.name}</strong>.
            </p>
          )}

          {/* Dynamic Budget Overrun Warning Banner */}
          {!budgetValidation.isValid && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold">{budgetValidation.error}</p>
                {budgetValidation.reason === 'BUDGET_EXCEEDED' && (
                  <p className="text-[11px] text-rose-600">
                    Reduce quantities or estimated unit costs so the total request does not exceed the remaining balance of {money(budgetValidation.remainingAmount)}.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Justification */}
        <div>
          <label htmlFor="req-desc" className={labelCls}>Justification</label>
          <textarea id="req-desc" rows={3} className={inputCls} placeholder="Why these items are needed, and anything approvers should know."
            value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>

        {/* Attachments */}
        <div>
          <span className={labelCls}>Quotations and supporting documents</span>
          <div className="flex flex-wrap items-center gap-2">
            {files.map((f, idx) => (
              <span key={`${f.name}-${f.size}-${idx}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-xs text-indigo-800 font-medium">
                <Paperclip className="w-3 h-3 text-indigo-600 shrink-0" /> {f.name}
                <span className="text-[10px] text-gray-500 font-normal">({(f.size / 1024).toFixed(0)} KB)</span>
                <button type="button" onClick={() => setFiles((fs) => fs.filter((_, i) => i !== idx))} aria-label={`Remove ${f.name}`} className="text-gray-400 hover:text-red-600 ml-1">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 cursor-pointer hover:underline">
              <Paperclip className="w-3.5 h-3.5" /> Add file
              <input type="file" multiple accept={ACCEPT} className="hidden"
                onChange={(e) => {
                  const chosen = Array.from(e.target.files || []);
                  if (chosen.length > 0) {
                    setFiles((fs) => [...fs, ...chosen]);
                  }
                  e.target.value = '';
                }} />
            </label>
            <span className="text-[11px] text-gray-400">PDF, image, Word or Excel · up to 10 MB each</span>
          </div>
        </div>

        {/* ProcureFlow Smart Check (Authoritative Validation & Advisory Local AI) */}
        <LocalAiAssistant
          request={{
            title: form.title,
            description: form.description,
            budgetHeadId: form.budgetHeadId,
            urgency: urgencyIsOther ? form.customUrgency : form.urgency,
            items: filled.map((l) => {
              const item = itemById.get(l.budgetItemId);
              const lineIsOther = isOther(item?.code ?? '');
              return {
                budgetItemId: l.budgetItemId,
                name: lineIsOther ? l.customItemName : (item?.name ?? ''),
                customItemName: l.customItemName,
                quantity: l.quantity,
                unitCost: l.unitCost,
                remarks: l.remarks,
              };
            }),
            files,
            totalAmount: total,
          }}
          onApplySuggestion={(field, val) => {
            if (field === 'title') set({ title: val });
            if (field === 'description') set({ description: val });
            if (field === 'itemRemark' && lines.length > 0) {
              setLine(lines[0].key, { remarks: val });
            }
          }}
        />

        {/* Validation errors */}
        {attempted && (attempted === 'submit' ? submitProblems : problems).length > 0 && (
          <ul className="text-xs text-red-600 list-disc pl-5 space-y-0.5">
            {(attempted === 'submit' ? submitProblems : problems).map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-gray-100">
          <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Cancel</button>
          <button type="button" onClick={() => save(false)} disabled={Boolean(saving) || !budgetValidation.isValid}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-gray-200 text-gray-700 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed">
            {saving === 'draft' ? 'Saving…' : 'Save as draft'}
          </button>
          <button type="button" onClick={() => save(true)} disabled={Boolean(saving) || !budgetValidation.isValid}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 disabled:cursor-not-allowed">
            {saving === 'submit' ? 'Submitting…' : 'Submit for approval'}
          </button>
        </div>
      </div>
    </Modal>
  );
};
