import React, { useState } from 'react';
import {
  Check, ChevronDown, Copy, Edit2, KeyRound, Loader2, Plus, Search,
  ShieldCheck, Trash2, UserCheck, UserX, X,
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
    key={role.code}
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

const BLANK = { email: '', fullName: '', password: '', departmentId: null, roleIds: [], isActive: true };

function UserModal({ user, roles, departments = [], onClose, onSaved }) {
  const isEdit = Boolean(user);
  const { showToast } = useApp();
  const [form, setForm] = useState(
    isEdit
      ? {
          email: user.email,
          fullName: user.name,
          password: '',
          departmentId: user.departmentId ?? null,
          roleIds: user.roles.map((r) => r.id),
          isActive: user.isActive,
        }
      : BLANK,
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
    if (isEdit && form.password && form.password.length < 8)
      return showToast('New password must be at least 8 characters', 'error');
    if (!form.roleIds.length) return showToast('Assign at least one role', 'error');

    setSaving(true);
    try {
      const body = {
        email: form.email.trim().toLowerCase(),
        fullName: form.fullName.trim(),
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        roleIds: form.roleIds,
      };

      if (isEdit) {
        body.isActive = form.isActive;
        if (form.password) body.password = form.password;
        await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body });
        showToast(`${form.fullName} updated`, 'success');
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
                ? 'Leave password blank to keep current password.'
                : 'Invited members activate their account via single-use setup link.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
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
            <label className={labelCls}>Email *</label>
            <input
              type="email"
              className={inputCls}
              placeholder="head.cs@spcollege.edu"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
            />
          </div>

          {/* Password (edit only) or Setup link notice (create) */}
          {isEdit ? (
            <div>
              <label className={labelCls}>Password (leave blank to keep current)</label>
              <input
                type="password"
                className={inputCls}
                placeholder="Enter new password to change…"
                value={form.password}
                onChange={(e) => set({ password: e.target.value })}
              />
            </div>
          ) : (
            <div className="rounded-xl bg-indigo-50/70 border border-indigo-100 p-3.5 space-y-1">
              <p className="text-xs font-semibold text-indigo-950 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-indigo-600" /> Secure Setup Link Activation
              </p>
              <p className="text-[11px] text-indigo-800 leading-relaxed">
                A single-use, 24-hour setup link will be generated. The invited institutional member will set their own password on activation.
              </p>
            </div>
          )}


          {/* Department picker */}
          <div>
            <label className={labelCls}>Department (optional)</label>
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
// Modal — Account activation & setup link
// ---------------------------------------------------------------------------

function ActivationLinkModal({ data, onClose }) {
  const [copied, setCopied] = useState(false);
  const fullUrl = `${window.location.origin}${data.setupUrl}`;

  const copy = () => {
    navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-indigo-600">
            <KeyRound className="w-5 h-5" />
            <h2 className="text-base font-bold text-gray-900">Account Activation Link</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            One-time activation link for <span className="font-bold text-gray-900">{data.fullName || data.name}</span> (<span className="text-gray-500">{data.email}</span>):
          </p>
          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-gray-50 border border-gray-200">
            <input
              readOnly
              value={fullUrl}
              className="bg-transparent text-xs text-gray-800 font-mono flex-1 outline-none select-all"
            />
            <button
              onClick={copy}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                copied ? 'bg-emerald-600 text-white' : 'bg-indigo-600 hover:bg-indigo-700 text-white'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-amber-700" />
            Institutional Notice
          </p>
          <p className="text-[11px] text-amber-800 leading-relaxed">
            Outbound email delivery is unconfigured in this environment. Provide this single-use setup link directly to the invited institutional member. The token expires in 24 hours.
          </p>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-xs font-semibold bg-gray-900 hover:bg-gray-800 text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
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
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null); // null | 'create' | <user object>
  const [activationModal, setActivationModal] = useState(null); // null | { ... }

  const closeModal = (createdRes) => {
    setModal(null);
    users.reload();
    refresh();
    if (createdRes?.setupUrl) {
      setActivationModal(createdRes);
    }
  };

  const handleGenerateSetupToken = async (user) => {
    try {
      const res = await api(`/api/admin/users/${user.id}/setup-token`, { method: 'POST' });
      setActivationModal({ ...user, ...res });
      showToast(`New setup link created for ${user.name}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
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

  const list = (users.data ?? []).filter((u) => {
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.departmentName && u.departmentName.toLowerCase().includes(q)) ||
      (u.departmentCode && u.departmentCode.toLowerCase().includes(q)) ||
      u.roles.some((r) => r.name.toLowerCase().includes(q))
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
            <h2 className="text-xl font-extrabold text-gray-900 mt-1">User Management</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Add accounts, set passwords, and assign roles. No SQL access required.
            </p>
          </div>
          <button
            onClick={() => setModal('create')}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-2 shrink-0"
          >
            <Plus className="w-4 h-4" /> Add user
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            placeholder="Search by name, email, department, or role…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {users.loading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading users…
            </div>
          ) : users.error ? (
            <p className="text-center py-12 text-sm text-red-500">{users.error.message}</p>
          ) : list.length === 0 ? (
            <p className="text-center py-12 text-sm text-gray-400">
              {search ? 'No users match your search.' : 'No users yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-gray-400 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Name / Email</th>
                    <th className="py-3 px-4">Department</th>
                    <th className="py-3 px-4">Roles</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">Added</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {list.map((user) => (
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
                        {user.isActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-200">
                            <UserCheck className="w-3 h-3" /> Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-600 text-[10px] font-bold border border-red-200">
                            <UserX className="w-3 h-3" /> Inactive
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-center text-gray-400 text-[11px]">
                        {new Date(user.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit', month: 'short', year: 'numeric',
                        })}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleGenerateSetupToken(user)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title="Generate / view activation link"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setModal(user)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            title="Edit user"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          {user.isActive ? (
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
                {list.length} user{list.length !== 1 ? 's' : ''}
                {search && ` matching "${search}"`}
              </div>
            </div>
          )}
        </div>
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

      {/* Activation Link Modal */}
      {activationModal && (
        <ActivationLinkModal
          data={activationModal}
          onClose={() => setActivationModal(null)}
        />
      )}
    </>

  );
};
