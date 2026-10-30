import React, { useEffect, useState } from 'react';
import { Download, Eye, EyeOff, KeyRound, Loader2, Mail, ShieldCheck, Smartphone, Workflow } from 'lucide-react';
import { api } from '../api/client';
import { initials, roleLabel } from '../api/format';
import { useApp } from '../context/AppContext';

const ROLE_COLORS = {
  ADMIN: 'bg-violet-100 text-violet-700 border-violet-200',
  PRINCIPAL: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  PURCHASE_COMMITTEE: 'bg-blue-100 text-blue-700 border-blue-200',
  HEAD: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ACTIVITY_INCHARGE: 'bg-teal-100 text-teal-700 border-teal-200',
  CDC_MEMBER: 'bg-amber-100 text-amber-700 border-amber-200',
  CDC_GRANT_MEMBER: 'bg-orange-100 text-orange-700 border-orange-200',
  CDC_NON_GRANT_MEMBER: 'bg-orange-100 text-orange-700 border-orange-200',
  CHAIRMAN: 'bg-red-100 text-red-700 border-red-200',
  VICE_PRESIDENT: 'bg-pink-100 text-pink-700 border-pink-200',
};

/** Who the system thinks you are — with a self-service password change form. */
export const Profile = () => {
  const { user, showToast, signOut } = useApp();
  const isAdmin = Boolean(user?.roles?.includes('ADMIN'));
  const [minLength, setMinLength] = useState(12);
  const [problems, setProblems] = useState([]);
  useEffect(() => {
    if (!isAdmin) return;
    api('/api/auth/password-policy').then((r) => setMinLength(r.minLength)).catch(() => {});
  }, [isAdmin]);
  const [showPw, setShowPw] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [changing, setChanging] = useState(false);
  const [show, setShow] = useState({ current: false, next: false });

  const changePassword = async () => {
    if (!pw.current) return showToast('Enter your current password', 'error');
    if (pw.next.length < minLength) return showToast(`New password must be at least ${minLength} characters`, 'error');
    if (pw.next !== pw.confirm) return showToast('New passwords do not match', 'error');
    setChanging(true);
    setProblems([]);
    try {
      await api('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword: pw.current, newPassword: pw.next },
      });
      // Every session, this one included, was signed out by the change.
      signOut('Password changed. Sign in with your new password.');
    } catch (err) {
      if (err.code === 'WEAK_PASSWORD') setProblems(err.details ?? [err.message]);
      else showToast(err.message, 'error');
    } finally {
      setChanging(false);
    }
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 pr-10';

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Identity card */}
      <div className="bg-white rounded-2xl p-6 border border-gray-200 flex items-center gap-5">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center text-white text-2xl font-extrabold shadow-lg shrink-0">
          {initials(user.name)}
        </div>
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold text-gray-900 truncate">{user.name}</h2>
          <p className="text-xs text-gray-500 flex items-center gap-1.5 mt-1">
            <Mail className="w-3.5 h-3.5 text-indigo-400" /> {user.email}
          </p>
        </div>
      </div>

      {/* Roles & Stages grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-gray-200 space-y-3">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-500" /> Your roles
          </h3>
          {user.roles.length === 0 ? (
            <p className="text-xs text-gray-400 italic">No role assigned. Ask the administrator if you need access.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {user.roles.map((r) => (
                <span key={r} className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${ROLE_COLORS[r] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                  {roleLabel(r)}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl p-5 border border-gray-200 space-y-3">
          <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <Workflow className="w-4 h-4 text-indigo-500" /> Approval stages you decide at
          </h3>
          {user.stages.length === 0 ? (
            <p className="text-xs text-gray-400 italic">None. You can follow requests you raise, but decisions require a stage assignment.</p>
          ) : (
            <ul className="space-y-1.5">
              {user.stages.map((s) => (
                <li key={s.stageId} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                  {s.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Change password (Admin only) */}
      {isAdmin && (
        <div className="bg-white rounded-2xl border border-gray-200">
          <button
            onClick={() => setShowPw((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-4 text-sm font-bold text-gray-800 hover:bg-gray-50 rounded-2xl transition-colors"
          >
            <span className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-indigo-500" /> Change password</span>
            <span className="text-xs text-gray-400 font-normal">{showPw ? 'Hide' : 'Expand'}</span>
          </button>

          {showPw && (
            <div className="px-5 pb-5 space-y-3 border-t border-gray-100 pt-4">
              {/* Current password */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Current password</label>
                <div className="relative">
                  <input type={show.current ? 'text' : 'password'} className={inputCls}
                    placeholder="Your current password"
                    value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
                  <button type="button" onClick={() => setShow((s) => ({ ...s, current: !s.current }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {show.current ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {/* New password */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">New password (at least {minLength} characters)</label>
                <div className="relative">
                  <input type={show.next ? 'text' : 'password'} className={inputCls}
                    placeholder={`At least ${minLength} characters`}
                    value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
                  <button type="button" onClick={() => setShow((s) => ({ ...s, next: !s.next }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {show.next ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {/* Confirm */}
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Confirm new password</label>
                <input type="password" className={inputCls.replace(' pr-10', '')}
                  placeholder="Repeat the new password"
                  value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
              </div>
              {problems.length > 0 && (
                <ul role="alert" className="rounded-lg bg-red-50 border border-red-100 p-3 space-y-1 text-xs text-red-700">
                  {problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              )}
              <p className="text-[11px] text-gray-500">Changing your password signs you out everywhere, including here.</p>
              <div className="flex justify-end gap-3 pt-1">
                <button onClick={() => { setShowPw(false); setPw({ current: '', next: '', confirm: '' }); setProblems([]); }}
                  className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Cancel</button>
                <button onClick={changePassword} disabled={changing}
                  className="px-5 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 flex items-center gap-2">
                  {changing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Update password
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {user.mfa?.enabled && <TwoStepCard since={user.mfa.enabledAt} />}

      <p className="text-[11px] text-gray-400">Roles and stage assignments are managed by the administrator. Documents you attach live on the request or issue they belong to.</p>
    </div>
  );
};

// 2-step verification: when it was turned on, and a way to replace the
// recovery codes (the old ones stop working). Needs a current code.
function TwoStepCard({ since }) {
  const { showToast } = useApp();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState(null);

  const replace = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api('/api/auth/mfa/recovery-codes', { method: 'POST', body: { code } });
      setCodes(res.recoveryCodes);
      setCode('');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const text = ['Approval hub — 2-step verification recovery codes', `Created: ${new Date().toLocaleString('en-IN')}`, '',
      'Each code works once. Earlier codes no longer work.', '', ...codes].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'approval-hub-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-3">
      <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-indigo-500" /> 2-step verification is on
      </p>
      <p className="text-xs text-gray-500">
        Since {new Date(since).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}.
        Signing in needs a code from your authenticator app.
      </p>
      {codes ? (
        <div className="space-y-3">
          <p className="text-xs text-gray-700">Your new recovery codes. Save them now; they will not be shown again.</p>
          <ol className="grid grid-cols-2 gap-2 font-mono text-sm bg-gray-50 border border-gray-200 rounded-xl p-3">
            {codes.map((c) => <li key={c} className="text-center">{c}</li>)}
          </ol>
          <button type="button" onClick={download}
            className="px-4 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-xs font-semibold flex items-center gap-2">
            <Download className="w-3.5 h-3.5" /> Download as a text file
          </button>
        </div>
      ) : (
        <form onSubmit={replace} className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">
            Code from your app
            <input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)}
              className="block mt-1 w-32 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono tracking-widest" placeholder="123456" />
          </label>
          <button type="submit" disabled={busy || !code.trim()}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-2 disabled:opacity-50">
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create new recovery codes
          </button>
        </form>
      )}
    </div>
  );
}
