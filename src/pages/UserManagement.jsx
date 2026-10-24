import React, { useState } from 'react';
import {
  Calendar, Check, ChevronDown, Clock, Edit2, History, Loader2, MailX, Send,
  Plus, Search, ShieldCheck, Trash2, UserCheck, Users, UserX, X,
} from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { useApi, useAction } from '../hooks/useApi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROLE_COLORS = {
  ADMIN: 'bg-violet-100 text-violet-800 border-violet-200',
  PRINCIPAL: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  PURCHASE_COMMITTEE: 'bg-blue-100 text-blue-800 border-blue-200',
  HEAD: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ACTIVITY_INCHARGE: 'bg-teal-100 text-teal-800 border-teal-200',
  CDC_MEMBER: 'bg-amber-100 text-amber-800 border-amber-200',
  CDC_GRANT_MEMBER: 'bg-orange-100 text-orange-800 border-orange-200',
  CDC_NON_GRANT_MEMBER: 'bg-orange-100 text-orange-800 border-orange-200',
  CHAIRMAN: 'bg-red-100 text-red-800 border-red-200',
  VICE_PRESIDENT: 'bg-pink-100 text-pink-800 border-pink-200',
};

const rolePill = (role) => (
  <span
    key={role.code || role.id}
    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
      ROLE_COLORS[role.code] ?? 'bg-gray-100 text-gray-700 border-gray-200'
    }`}
  >
    {role.name}
  </span>
);

// ---------------------------------------------------------------------------
// Modal — add / edit a user
// ---------------------------------------------------------------------------

const BLANK_USER = {
  email: '',
  fullName: '',
  employeeId: '',
  departmentId: null,
  roleIds: [],
  isActive: true,
};

function UserModal({ user, roles, departments = [], onClose, onSaved }) {
  const isEdit = Boolean(user);
  const { showToast } = useApp();
  const [form, setForm] = useState(
    isEdit
      ? {
          email: user.email,
          fullName: user.name,
          employeeId: user.employeeId ?? '',
          departmentId: user.departmentId ?? null,
          roleIds: user.roles.map((r) => r.id),
          isActive: user.isActive,
        }
      : BLANK_USER,
  );
  const [saving, setSaving] = useState(false);
  const [showRoles, setShowRoles] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const toggleRole = (id) =>
    set({
      roleIds: form.roleIds.includes(id)
        ? form.roleIds.filter((r) => r !== id)
        : [...form.roleIds, id],
    });

  const save = async () => {
    if (!form.email.trim()) return showToast('Email is required', 'error');
    if (!form.fullName.trim()) return showToast('Full name is required', 'error');
    if (!form.roleIds.length) return showToast('Assign at least one role', 'error');

    setSaving(true);
    try {
      const body = {
        email: form.email.trim().toLowerCase(),
        fullName: form.fullName.trim(),
        employeeId: form.employeeId.trim() || null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        roleIds: form.roleIds,
      };

      if (isEdit) {
        body.isActive = form.isActive;
        const res = await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body });
        // An email change is confirmed by the new address; say so.
        showToast(res.message ?? `${form.fullName} updated`, 'success');
        onSaved();
      } else {
        const res = await api('/api/admin/users', { method: 'POST', body });
        showToast(`${form.fullName} invited`, 'success');
        onSaved(res);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';

  const selectedRoleNames = roles
    .filter((r) => form.roleIds.includes(r.id))
    .map((r) => r.name)
    .join(', ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">
              {isEdit ? 'Edit user' : 'Invite new user'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {isEdit
                ? 'Passwords are set only by the person themselves.'
                : 'We email them a one-time link to set their own password.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* Full name */}
          <div>
            <label className={labelCls}>Full name *</label>
            <input
              className={inputCls}
              placeholder="e.g. Dr. A. Deshpande"
              value={form.fullName}
              onChange={(e) => set({ fullName: e.target.value })}
            />
          </div>

          {/* Email */}
          <div>
            <label className={labelCls}>Official Institutional Email *</label>
            <input
              type="email"
              className={inputCls}
              placeholder="head.cs@spcollege.edu"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </div>

          {/* Employee / Member Identifier */}
          <div>
            <label className={labelCls}>Employee / Member Identifier (ID)</label>
            <input
              className={inputCls}
              placeholder="e.g. EMP-PRIN-001 or EMP-CS-001"
              value={form.employeeId}
              onChange={(e) => set({ employeeId: e.target.value })}
            />
          </div>

          {/* Who sets the password: never the administrator. */}
          {isEdit ? (
            <div className="rounded-xl bg-gray-50 border border-gray-100 p-3.5">
              <p className="text-[11px] text-gray-600 leading-relaxed">
                Administrators cannot see or set passwords. If this person has forgotten theirs,
                they can use <span className="font-semibold">Forgot password?</span> on the sign-in page.
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 p-3.5 space-y-1">
              <p className="text-xs font-semibold text-indigo-950 flex items-center gap-1.5">
                <Send className="w-4 h-4 text-indigo-600" /> Invitation by email
              </p>
              <p className="text-[11px] text-indigo-800 leading-relaxed">
                An invitation goes to the email address above, naming the role you choose. Opening it proves the
                address is theirs, and they set their own password. You will never see the link or the password.
              </p>
            </div>
          )}

          {/* Department picker */}
          <div>
            <label className={labelCls}>Department (required for a Head of Department)</label>
            <select
              className={inputCls}
              value={form.departmentId ?? ''}
              onChange={(e) => set({ departmentId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">No Department Assigned</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code} — {d.fundingType})
                </option>
              ))}
            </select>
          </div>

          {/* Role picker */}
          <div className="relative">
            <label className={labelCls}>Roles * (select all that apply)</label>
            <button
              type="button"
              onClick={() => setShowRoles((v) => !v)}
              className={`${inputCls} flex items-center justify-between text-left`}
            >
              <span className={form.roleIds.length ? 'text-gray-900' : 'text-gray-400'}>
                {form.roleIds.length ? selectedRoleNames : 'Choose roles…'}
              </span>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showRoles ? 'rotate-180' : ''}`} />
            </button>
            {showRoles && (
              <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                {roles.map((role) => {
                  const checked = form.roleIds.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRole(role.id)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 text-sm"
                    >
                      <span
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          checked
                            ? 'bg-indigo-600 border-indigo-600'
                            : 'border-gray-300'
                        }`}
                      >
                        {checked && <Check className="w-2.5 h-2.5 text-white" />}
                      </span>
                      <div>
                        <p className="font-medium text-gray-800 text-xs">{role.name}</p>
                        {role.description && (
                          <p className="text-[10px] text-gray-400">{role.description}</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Active status (edit only) */}
          {isEdit && (
            <div className="flex items-center gap-3 select-none">
              <button
                type="button"
                role="switch"
                aria-checked={form.isActive}
                aria-label={`Active status for ${form.fullName || 'user'}`}
                onClick={() => set({ isActive: !form.isActive })}
                className={`relative inline-flex w-10 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:ring-offset-2 ${
                  form.isActive ? 'bg-indigo-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    form.isActive ? 'translate-x-5' : ''
                  }`}
                />
              </button>
              <span className="text-sm text-gray-700 font-medium">
                Account {form.isActive ? 'active' : 'deactivated'}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create user'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal — Appoint / Role Transition
// ---------------------------------------------------------------------------

function AppointmentModal({ users = [], roles = [], departments = [], onClose, onSaved }) {
  const { showToast } = useApp();
  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [memberClassification, setMemberClassification] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [appointmentOrderNo, setAppointmentOrderNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [autoTransition, setAutoTransition] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedRole = roles.find((r) => r.id === Number(roleId));
  const isCdcRole = selectedRole && ['CDC_MEMBER', 'CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER'].includes(selectedRole.code);
  const isSingleHolder = selectedRole && ['PRINCIPAL', 'CHAIRMAN', 'VICE_PRESIDENT'].includes(selectedRole.code);

  const save = async () => {
    if (!userId) return showToast('Please select a user', 'error');
    if (!roleId) return showToast('Please select a role', 'error');
    if (!startDate) return showToast('Start date is required', 'error');

    setSaving(true);
    try {
      await api('/api/admin/appointments', {
        method: 'POST',
        body: {
          userId,
          roleId: Number(roleId),
          departmentId: departmentId ? Number(departmentId) : null,
          memberClassification: memberClassification || null,
          startDate,
          endDate: endDate || null,
          isActive: true,
          appointmentOrderNo: appointmentOrderNo.trim() || null,
          remarks: remarks.trim() || null,
          autoTransitionPrevious: autoTransition,
        },
      });
      showToast('Institutional appointment recorded successfully', 'success');
      onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Appoint Member / Role Transition</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Record new appointment tenure without overwriting historical incumbents.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {/* User selector */}
          <div>
            <label className={labelCls}>Member / User *</label>
            <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">Select institutional member…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email}){u.employeeId ? ` — ID: ${u.employeeId}` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Role selector */}
          <div>
            <label className={labelCls}>Role to Appoint *</label>
            <select className={inputCls} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Select role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.code})
                </option>
              ))}
            </select>
          </div>

          {/* CDC Member Classification */}
          {isCdcRole && (
            <div>
              <label className={labelCls}>CDC Member Classification *</label>
              <select
                className={inputCls}
                value={memberClassification}
                onChange={(e) => setMemberClassification(e.target.value)}
              >
                <option value="">Select classification…</option>
                <option value="TEACHING">Teaching Member (Max 3)</option>
                <option value="NON_TEACHING">Non-Teaching Member (Max 1)</option>
              </select>
            </div>
          )}

          {/* Department */}
          <div>
            <label className={labelCls}>Department (if applicable)</label>
            <select
              className={inputCls}
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <option value="">None / Institution-wide</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Tenure Start Date *</label>
              <input
                type="date"
                className={inputCls}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Tenure End Date (optional)</label>
              <input
                type="date"
                className={inputCls}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {/* Order No */}
          <div>
            <label className={labelCls}>Appointment Order / Gazette No.</label>
            <input
              className={inputCls}
              placeholder="e.g. SP/GOV/2026/04"
              value={appointmentOrderNo}
              onChange={(e) => setAppointmentOrderNo(e.target.value)}
            />
          </div>

          {/* Remarks */}
          <div>
            <label className={labelCls}>Remarks / Notes</label>
            <input
              className={inputCls}
              placeholder="e.g. Principal appointed per GC resolution 12"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>

          {/* Single holder auto-transition notice */}
          {isSingleHolder && (
            <label className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-50 border border-amber-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoTransition}
                onChange={(e) => setAutoTransition(e.target.checked)}
                className="mt-0.5 rounded border-amber-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-xs text-amber-900 leading-snug">
                <strong>Auto-transition previous active incumbent:</strong> Marks previous active tenure for this role as completed without deleting historical decisions.
              </span>
            </label>
          )}
        </div>

        <div className="px-6 pb-5 flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Confirm Appointment
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal — Edit Appointment Tenure
// ---------------------------------------------------------------------------

function EditAppointmentModal({ appointment, onClose, onSaved }) {
  const { showToast } = useApp();
  const [startDate, setStartDate] = useState(appointment.startDate?.split('T')[0] ?? '');
  const [endDate, setEndDate] = useState(appointment.endDate?.split('T')[0] ?? '');
  const [isActive, setIsActive] = useState(appointment.isActive);
  const [memberClassification, setMemberClassification] = useState(appointment.memberClassification ?? '');
  const [appointmentOrderNo, setAppointmentOrderNo] = useState(appointment.appointmentOrderNo ?? '');
  const [remarks, setRemarks] = useState(appointment.remarks ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/admin/appointments/${appointment.appointmentId}`, {
        method: 'PATCH',
        body: {
          startDate: startDate || undefined,
          endDate: endDate || null,
          isActive,
          memberClassification: memberClassification || null,
          appointmentOrderNo: appointmentOrderNo.trim() || null,
          remarks: remarks.trim() || null,
        },
      });
      showToast('Tenure record updated', 'success');
      onSaved();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
  const labelCls = 'block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-bold text-gray-900">Edit Tenure Record</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {appointment.user.name} · {appointment.role.name}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start Date</label>
              <input type="date" className={inputCls} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>End Date</label>
              <input type="date" className={inputCls} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div>
            <label className={labelCls}>Active Status</label>
            <div className="flex items-center gap-3 select-none">
              <button
                type="button"
                role="switch"
                aria-checked={isActive}
                onClick={() => setIsActive(!isActive)}
                className={`relative inline-flex w-10 h-5 rounded-full transition-colors ${
                  isActive ? 'bg-indigo-600' : 'bg-gray-300'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                  isActive ? 'translate-x-5' : ''
                }`} />
              </button>
              <span className="text-xs text-gray-700 font-medium">
                {isActive ? 'Current Incumbent (Active)' : 'Former Incumbent (Inactive)'}
              </span>
            </div>
          </div>

          {['CDC_MEMBER', 'CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER'].includes(appointment.role.code) && (
            <div>
              <label className={labelCls}>CDC Member Classification</label>
              <select
                className={inputCls}
                value={memberClassification}
                onChange={(e) => setMemberClassification(e.target.value)}
              >
                <option value="">None / Unspecified</option>
                <option value="TEACHING">Teaching Member</option>
                <option value="NON_TEACHING">Non-Teaching Member</option>
              </select>
            </div>
          )}

          <div>
            <label className={labelCls}>Appointment Order / Reference</label>
            <input className={inputCls} value={appointmentOrderNo} onChange={(e) => setAppointmentOrderNo(e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Remarks</label>
            <input className={inputCls} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        <div className="px-6 pb-5 flex items-center justify-end gap-3 border-t border-gray-100 pt-4">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Account status
// ---------------------------------------------------------------------------

// States in which the person has not set up their account yet.
const PENDING = ['INVITED', 'INVITE_EXPIRED', 'INVITE_CANCELLED', 'NOT_INVITED'];

const STATUS_STYLE = {
  ACTIVE: ['Active', 'bg-emerald-50 text-emerald-700 border-emerald-200', UserCheck],
  INVITED: ['Invited', 'bg-indigo-50 text-indigo-700 border-indigo-200', Send],
  INVITE_EXPIRED: ['Invitation expired', 'bg-amber-50 text-amber-800 border-amber-200', Clock],
  INVITE_CANCELLED: ['Invitation cancelled', 'bg-gray-100 text-gray-600 border-gray-200', MailX],
  NOT_INVITED: ['Not invited', 'bg-gray-100 text-gray-600 border-gray-200', MailX],
  DEACTIVATED: ['Deactivated', 'bg-red-50 text-red-600 border-red-200', UserX],
};

function AccountStatus({ account }) {
  const [label, cls, Icon] = STATUS_STYLE[account?.status] ?? STATUS_STYLE.NOT_INVITED;
  const until = account?.status === 'INVITED' && account.inviteExpiresAt
    ? new Date(account.inviteExpiresAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${cls}`}
      title={until ? `The link works until ${new Date(account.inviteExpiresAt).toLocaleString('en-IN')}` : undefined}>
      <Icon className="w-3 h-3" /> {label}{until ? ` · until ${until}` : ''}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export const UserManagement = () => {
  const { refresh, showToast } = useApp();
  const { run } = useAction();
  const users = useApi('/api/admin/users');
  const roles = useApi('/api/admin/roles');
  const departments = useApi('/api/admin/departments');
  const appointments = useApi('/api/admin/appointments');

  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'tenure'
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL'); // 'ALL' | 'ACTIVE' | 'FORMER'
  const [modal, setModal] = useState(null); // null | 'create' | <user object>
  const [appointmentModal, setAppointmentModal] = useState(false);
  const [editAppointment, setEditAppointment] = useState(null);
  const closeModal = (createdRes) => {
    setModal(null);
    users.reload();
    refresh();
    if (createdRes?.invitation) {
      showToast(createdRes.message, createdRes.invitation.delivery === 'SENT' ? 'success' : 'error');
    }
  };

  const closeAppointmentModal = () => {
    setAppointmentModal(false);
    setEditAppointment(null);
    appointments.reload();
    users.reload();
  };

  const handleResendInvite = async (user) => {
    try {
      const res = await api(`/api/admin/users/${user.id}/invite`, { method: 'POST' });
      showToast(res.message, res.invitation.delivery === 'SENT' ? 'success' : 'error');
      users.reload();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const handleCancelInvite = async (user) => {
    if (!window.confirm(`Cancel the invitation to ${user.email}? The link in their email will stop working.`)) return;
    await run(
      () => api(`/api/admin/users/${user.id}/invite`, { method: 'DELETE' }),
      `Invitation to ${user.name} cancelled`,
    );
    users.reload();
  };

  const handleDeactivate = async (user) => {
    if (!window.confirm(`Deactivate ${user.name}? They will be signed out immediately.`)) return;
    await run(
      () => api(`/api/admin/users/${user.id}`, { method: 'DELETE' }),
      `${user.name} deactivated`,
    );
  };

  const handleReactivate = async (user) => {
    await run(
      () => api(`/api/admin/users/${user.id}/reactivate`, { method: 'POST' }),
      `${user.name} reactivated`,
    );
  };

  const userList = (users.data ?? []).filter((u) => {
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.employeeId && u.employeeId.toLowerCase().includes(q)) ||
      (u.departmentName && u.departmentName.toLowerCase().includes(q)) ||
      (u.departmentCode && u.departmentCode.toLowerCase().includes(q)) ||
      u.roles.some((r) => r.name.toLowerCase().includes(q))
    );
  });

  const appointmentList = (appointments.data ?? []).filter((a) => {
    if (roleFilter && a.role.code !== roleFilter) return false;
    if (statusFilter === 'ACTIVE' && !a.isActive) return false;
    if (statusFilter === 'FORMER' && a.isActive) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.user.name.toLowerCase().includes(q) ||
      a.user.email.toLowerCase().includes(q) ||
      (a.user.employeeId && a.user.employeeId.toLowerCase().includes(q)) ||
      a.role.name.toLowerCase().includes(q) ||
      (a.remarks && a.remarks.toLowerCase().includes(q)) ||
      (a.appointmentOrderNo && a.appointmentOrderNo.toLowerCase().includes(q))
    );
  });

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="p-5 rounded-2xl bg-violet-50 border border-violet-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-violet-100 text-violet-700 border border-violet-200 uppercase tracking-widest flex items-center gap-1.5 w-fit">
              <ShieldCheck className="w-3 h-3" /> Admin only
            </span>
            <h2 className="text-xl font-extrabold text-gray-900 mt-1">Institutional User &amp; Member Management</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Persistent user identities, historical role tenure tracking, multi-member committees, and stage appointments.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {activeTab === 'users' ? (
              <button
                onClick={() => setModal('create')}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Add User
              </button>
            ) : (
              <button
                onClick={() => setAppointmentModal(true)}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Appoint / Transition
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'users'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <Users className="w-4 h-4" /> User Directory ({users.data?.length ?? 0})
          </button>
          <button
            onClick={() => setActiveTab('tenure')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              activeTab === 'tenure'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
            }`}
          >
            <History className="w-4 h-4" /> Role Tenure &amp; Incumbents History ({appointments.data?.length ?? 0})
          </button>
        </div>

        {/* Search & Filters */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              placeholder={
                activeTab === 'users'
                  ? 'Search by name, email, employee ID, department, or role…'
                  : 'Search incumbents, order number, remarks…'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {activeTab === 'tenure' && (
            <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-700 focus:outline-none focus:border-indigo-400"
              >
                <option value="">All Institutional Roles</option>
                <option value="PRINCIPAL">Principal</option>
                <option value="CHAIRMAN">Chairman</option>
                <option value="VICE_PRESIDENT">Vice Chairman</option>
                <option value="CDC_GRANT_MEMBER">CDC Grant Member</option>
                <option value="CDC_NON_GRANT_MEMBER">CDC Non-Grant Member</option>
                <option value="CDC_MEMBER">CDC Member</option>
                <option value="PURCHASE_COMMITTEE">Purchase Committee</option>
                <option value="HEAD">Head of Department</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-700 focus:outline-none focus:border-indigo-400"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Current Incumbents</option>
                <option value="FORMER">Former Incumbents</option>
              </select>
            </div>
          )}
        </div>

        {/* Tab 1: User Directory Table */}
        {activeTab === 'users' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {users.loading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading users…
              </div>
            ) : users.error ? (
              <p className="text-center py-12 text-sm text-red-500">{users.error.message}</p>
            ) : userList.length === 0 ? (
              <p className="text-center py-12 text-sm text-gray-400">
                {search ? 'No users match your search.' : 'No users yet.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Member / Email</th>
                      <th className="py-3 px-4">Identifier (ID)</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Roles</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4 text-center">Added</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {userList.map((user) => (
                      <tr
                        key={user.id}
                        className={`transition-colors ${user.isActive ? 'hover:bg-gray-50/60' : 'bg-gray-50/50 opacity-70'}`}
                      >
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold text-[11px] shrink-0">
                              {user.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-800 text-[13px]">{user.name}</p>
                              <p className="text-gray-400 text-[11px]">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          {user.employeeId ? (
                            <span className="font-mono text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded border border-gray-200 font-semibold">
                              {user.employeeId}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic text-[11px]">Unassigned</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {user.departmentName ? (
                            <div>
                              <span className="font-semibold text-gray-800 text-xs">{user.departmentName}</span>
                              <span className="ml-1 text-[10px] text-gray-400">({user.departmentCode})</span>
                            </div>
                          ) : (
                            <span className="text-gray-400 italic text-[11px]">None</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1">
                            {user.roles.length ? user.roles.map(rolePill) : (
                              <span className="text-gray-400 italic text-[11px]">No roles</span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <AccountStatus account={user.account} />
                        </td>
                        <td className="py-3.5 px-4 text-center text-gray-400 text-[11px]">
                          {new Date(user.createdAt).toLocaleDateString('en-IN', {
                            day: '2-digit', month: 'short', year: 'numeric',
                          })}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {PENDING.includes(user.account?.status) && (
                              <button
                                onClick={() => handleResendInvite(user)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                                title="Resend invitation (a new link; the old one stops working)"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {user.account?.status === 'INVITED' && (
                              <button
                                onClick={() => handleCancelInvite(user)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                title="Cancel invitation"
                              >
                                <MailX className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => setModal(user)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                              title="Edit user"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {PENDING.includes(user.account?.status) ? null : user.isActive ? (
                              <button
                                onClick={() => handleDeactivate(user)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                                title="Deactivate account"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleReactivate(user)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                                title="Reactivate account"
                              >
                                <UserCheck className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="px-4 py-3 border-t border-gray-100 text-[11px] text-gray-400">
                  {userList.length} user{userList.length !== 1 ? 's' : ''}
                  {search && ` matching "${search}"`}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Role Tenure & Incumbents History Table */}
        {activeTab === 'tenure' && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {appointments.loading ? (
              <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading tenure history…
              </div>
            ) : appointments.error ? (
              <p className="text-center py-12 text-sm text-red-500">{appointments.error.message}</p>
            ) : appointmentList.length === 0 ? (
              <p className="text-center py-12 text-sm text-gray-400">
                No appointment or tenure records found.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Incumbent</th>
                      <th className="py-3 px-4">Classification / Dept</th>
                      <th className="py-3 px-4">Tenure Period</th>
                      <th className="py-3 px-4 text-center">Status</th>
                      <th className="py-3 px-4">Order / Remarks</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {appointmentList.map((item) => (
                      <tr
                        key={item.appointmentId}
                        className={`transition-colors ${item.isActive ? 'hover:bg-gray-50/60' : 'bg-gray-50/40 opacity-75'}`}
                      >
                        <td className="py-3.5 px-4 font-semibold text-gray-900">
                          {rolePill(item.role)}
                        </td>
                        <td className="py-3.5 px-4">
                          <div>
                            <p className="font-semibold text-gray-800 text-[13px]">{item.user.name}</p>
                            <p className="text-gray-400 text-[11px] flex items-center gap-1.5">
                              {item.user.email}
                              {item.user.employeeId && (
                                <span className="font-mono text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded border border-gray-200">
                                  {item.user.employeeId}
                                </span>
                              )}
                            </p>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          {item.memberClassification ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                              {item.memberClassification}
                            </span>
                          ) : item.department ? (
                            <span className="text-gray-700 font-medium">
                              {item.department.name} ({item.department.code})
                            </span>
                          ) : (
                            <span className="text-gray-400 italic text-[11px]">Institution-wide</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 text-gray-700 font-medium text-[11px]">
                            <Calendar className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <span>
                              {item.startDate ? item.startDate.split('T')[0] : 'N/A'} — {item.endDate ? item.endDate.split('T')[0] : 'Present'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {item.isActive ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                              <Clock className="w-3 h-3" /> Current
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-semibold border border-gray-200">
                              Former
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-gray-600 text-[11px]">
                          {item.appointmentOrderNo && (
                            <p className="font-mono text-[10px] font-semibold text-gray-800">{item.appointmentOrderNo}</p>
                          )}
                          {item.remarks && (
                            <p className="italic text-gray-500">{item.remarks}</p>
                          )}
                          {!item.appointmentOrderNo && !item.remarks && (
                            <span className="text-gray-400 italic text-[11px]">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <button
                            onClick={() => setEditAppointment(item)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title="Edit tenure details"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="px-4 py-3 border-t border-gray-100 text-[11px] text-gray-400">
                  {appointmentList.length} appointment record{appointmentList.length !== 1 ? 's' : ''}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* User Modal */}
      {modal && (
        <UserModal
          user={modal === 'create' ? null : modal}
          roles={roles.data ?? []}
          departments={departments.data ?? []}
          onClose={() => setModal(null)}
          onSaved={closeModal}
        />
      )}

      {/* Appointment Creation Modal */}
      {appointmentModal && (
        <AppointmentModal
          users={users.data ?? []}
          roles={roles.data ?? []}
          departments={departments.data ?? []}
          onClose={() => setAppointmentModal(false)}
          onSaved={closeAppointmentModal}
        />
      )}

      {/* Edit Appointment Modal */}
      {editAppointment && (
        <EditAppointmentModal
          appointment={editAppointment}
          onClose={() => setEditAppointment(null)}
          onSaved={closeAppointmentModal}
        />
      )}

    </>
  );
};
