import React, { useState } from 'react';
import { ArrowRight, Loader2, Lock } from 'lucide-react';
import { useApp } from '../context/AppContext';

// Demo accounts from db/seed/03_users_and_approvers.sql.
// Shown on every build so evaluators can try each role.
const DEMO = {
  password: 'ChangeMe#2026',
  accounts: [
    ['Head, Computer Science', 'head.cs@spcollege.edu'],
    ['Activity In-charge', 'incharge@spcollege.edu'],
    ['Purchase Committee', 'pc1@spcollege.edu'],
    ['Principal', 'principal@spcollege.edu'],
    ['CDC (Grant)', 'cdc.grant@spcollege.edu'],
    ['CDC (Non-Grant)', 'cdc.nongrant@spcollege.edu'],
    ['Chairman', 'chairman@spcollege.edu'],
    ['Vice President', 'vp@spcollege.edu'],
    ['Clerk', 'clerk@spcollege.edu'],
    ['Administrator', 'admin@spcollege.edu'],
  ],
};

export const Login = () => {
  const { signIn, showToast } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e, as) => {
    e?.preventDefault();
    const creds = as ?? { email, password };
    setBusy(true);
    setError('');
    try {
      await signIn(creds.email.trim(), creds.password);
    } catch (err) {
      setError(err.status === 401 ? 'That email and password don\'t match an active account.' : err.message);
      if (err.status !== 401) showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-between p-6">
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-extrabold text-base">SP</div>
          <div>
            <h1 className="text-base font-extrabold text-gray-900">S.P. College</h1>
            <p className="text-[10px] text-gray-400 font-semibold tracking-widest uppercase">Approval &amp; Workflow Management</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400"><Lock className="w-3.5 h-3.5" /> Institutional access</div>
      </div>

      <div className="w-full max-w-md mx-auto my-12 space-y-6">
        <div className="text-center space-y-1.5">
          <h2 className="text-2xl font-extrabold text-gray-900">Sign in</h2>
          <p className="text-sm text-gray-500">Use your college email. What you see depends on your role.</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email</label>
            <input id="email" type="email" autoComplete="username" required className={inputCls}
              placeholder="name@spcollege.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
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
          <p className="text-[11px] text-gray-400 text-center">Forgotten your password? Ask the college administrator to reset it.</p>
        </form>

        <div className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 p-4 space-y-2">
            <p className="text-[11px] font-semibold text-amber-800 uppercase tracking-wider">Quick login — click any role to sign in</p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO.accounts.map(([label, address]) => (
                <button key={address} disabled={busy} onClick={() => submit(null, { email: address, password: DEMO.password })}
                  className="px-2.5 py-1 rounded-lg bg-white border border-amber-200 text-[11px] font-semibold text-gray-700 hover:border-amber-400 disabled:opacity-50">
                  {label}
                </button>
              ))}
            </div>
          </div>
      </div>

      <div className="max-w-6xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400 border-t border-gray-200 pt-4">
        <p>© 2026 S.P. College</p>
        <p>Approval Hub</p>
      </div>
    </div>
  );
};
