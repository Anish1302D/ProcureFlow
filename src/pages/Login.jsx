import React, { useState } from 'react';
import { ArrowRight, Loader2, Lock } from 'lucide-react';
import { useApp } from '../context/AppContext';

// Development-only demo accounts for local debugging.
// Completely stripped from production builds by Vite dead-code elimination.
const DEV_DEMO = import.meta.env.DEV
  ? {
      accounts: [
        ['Head, CS', 'head.cs@spcollege.edu'],
        ['Head, Chemistry', 'head.chem@spcollege.edu'],
        ['Activity In-charge', 'incharge@spcollege.edu'],
        ['Purchase Committee (1)', 'pc1@spcollege.edu'],
        ['Purchase Committee (2)', 'pc2@spcollege.edu'],
        ['Principal (Current)', 'principal@spcollege.edu'],
        ['CDC Teaching (1)', 'cdc.grant@spcollege.edu'],
        ['CDC Teaching (2)', 'cdc.teach2@spcollege.edu'],
        ['CDC Non-Teaching', 'cdc.nongrant@spcollege.edu'],
        ['Chairman', 'chairman@spcollege.edu'],
        ['Vice Chairman', 'vp@spcollege.edu'],
        ['Clerk', 'clerk@spcollege.edu'],
        ['Administrator', 'admin@spcollege.edu'],
      ],
    }
  : null;

export const Login = () => {
  // Accounts exist only by invitation: there is no sign-up here.
  const { signIn, showToast } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e, as) => {
    e?.preventDefault();
    setBusy(true);
    setError('');

    const creds = as ?? { email, password };
    try {
      await signIn(creds.email.trim(), creds.password);
    } catch (err) {
      setError(err.message);
      if (err.status !== 401) showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-between p-6">
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between">
        <div className="flex flex-col justify-center">
          <div className="h-9 overflow-hidden flex items-center">
            <img src="/ProcureFlow-logo-horizontal.png" alt="ProcureFlow" className="h-32 w-auto max-w-none object-contain -ml-2" />
          </div>
          <p className="text-[10px] text-gray-400 font-semibold tracking-widest uppercase pl-0.5">Approval &amp; Workflow Management</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400"><Lock className="w-3.5 h-3.5" /> Institutional access</div>
      </div>

      <div className="w-full max-w-md mx-auto my-12 space-y-6">
        <div className="text-center space-y-1.5">
          <h2 className="text-2xl font-extrabold text-gray-900">Sign in</h2>
          <p className="text-sm text-gray-500">
            Use the email address your invitation was sent to. What you see depends on your role.
          </p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email</label>
            <input id="email" type="email" autoComplete="username" required className={inputCls}
              placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Password</label>
            <input id="password" type="password" autoComplete="current-password" required className={inputCls}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />} Sign in
          </button>
          <div className="flex items-center justify-between text-[11px]">
            <a href="#/forgot-password" className="font-semibold text-indigo-600 hover:text-indigo-800">Forgot password?</a>
            <span className="text-gray-400">New here? You'll receive an invitation by email.</span>
          </div>
        </form>

        {import.meta.env.DEV && DEV_DEMO && (
          <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-4 space-y-2">
            <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">Dev quick fill — select role to fill email</p>
            <div className="flex flex-wrap gap-1.5">
              {DEV_DEMO.accounts.map(([label, address]) => (
                <button key={address} type="button" disabled={busy} onClick={() => setEmail(address)}
                  className="px-2.5 py-1 rounded-lg bg-white border border-amber-200 text-[11px] font-semibold text-gray-700 hover:border-amber-400 disabled:opacity-50">
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="max-w-6xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400 border-t border-gray-200 pt-4">
        <p>© 2026 S.P. College</p>
        <p>ProcureFlow</p>
      </div>
    </div>
  );
};
