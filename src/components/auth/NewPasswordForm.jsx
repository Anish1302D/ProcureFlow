import React, { useState } from 'react';
import { CheckCircle2, Circle, Eye, EyeOff, Loader2 } from 'lucide-react';

/**
 * New password + confirmation with a live checklist. The rules come from the
 * server (GET /api/auth/password-policy or the link check), which also has the
 * final say: anything it refuses (a common password, one containing your
 * name) is shown under the form.
 */
export const NewPasswordForm = ({ rules, submitLabel, busy, serverProblems = [], onSubmit }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const minLength = rules?.minLength ?? 12;

  const checks = [
    { ok: password.length >= minLength, label: `At least ${minLength} characters` },
    { ok: password.length > 0 && password === confirm, label: 'Both entries match' },
  ];
  const ready = checks.every((c) => c.ok) && !busy;

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (ready) onSubmit(password); }} className="space-y-4">
      <div>
        <label htmlFor="new-password" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">New password</label>
        <div className="relative">
          <input id="new-password" type={show ? 'text' : 'password'} autoComplete="new-password" required
            className={`${inputCls} pr-10`} value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 px-3 text-gray-400 hover:text-gray-700">
            {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Tip: a few unrelated words make a strong password that is easy to remember.
        </p>
      </div>
      <div>
        <label htmlFor="confirm-password" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Type it again</label>
        <input id="confirm-password" type={show ? 'text' : 'password'} autoComplete="new-password" required
          className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>

      <ul className="space-y-1" aria-label="Password requirements">
        {checks.map((c) => (
          <li key={c.label} className={`flex items-center gap-2 text-xs ${c.ok ? 'text-emerald-700' : 'text-gray-500'}`}>
            {c.ok ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />} {c.label}
          </li>
        ))}
        <li className="text-[11px] text-gray-400 pl-6">Not your name, not your email, not a well-known password.</li>
      </ul>

      {serverProblems.length > 0 && (
        <ul role="alert" className="rounded-lg bg-red-50 border border-red-100 p-3 space-y-1 text-xs text-red-700">
          {serverProblems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}

      <button type="submit" disabled={!ready}
        className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} {submitLabel}
      </button>
    </form>
  );
};
