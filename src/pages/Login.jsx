import React, { useEffect, useState } from 'react';
import { ArrowRight, Loader2, Lock, UserPlus } from 'lucide-react';
import { api } from '../api/client';
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
  const { signIn, signInWithSession, showToast } = useApp();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [canRegister, setCanRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    api('/api/auth/registration-status')
      .then((res) => {
        if (active && res && typeof res.enabled === 'boolean') {
          setCanRegister(res.enabled);
        }
      })
      .catch(() => {
        if (active) setCanRegister(false);
      });
    return () => { active = false; };
  }, []);

  const submit = async (e, as) => {
    e?.preventDefault();
    setBusy(true);
    setError('');

    if (mode === 'register') {
      try {
        const res = await api('/api/auth/register', {
          method: 'POST',
          body: {
            email: email.trim(),
            fullName: fullName.trim(),
            password,
          },
        });
        showToast('Registration successful! Welcome to the portal.', 'success');
        signInWithSession(res.token, res.user);
      } catch (err) {
        setError(err.message || 'Registration failed');
        showToast(err.message, 'error');
      } finally {
        setBusy(false);
      }
      return;
    }

    const creds = as ?? { email, password };
    try {
      await signIn(creds.email.trim(), creds.password);
    } catch (err) {
      setError(err.status === 401 ? "That email and password don't match an active account." : err.message);
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
          <h2 className="text-2xl font-extrabold text-gray-900">
            {mode === 'register' ? 'Register Account' : 'Sign in'}
          </h2>
          <p className="text-sm text-gray-500">
            {mode === 'register'
              ? 'Institutional self-registration for authorized faculty and activity in-charges.'
              : 'Use your college email. What you see depends on your role.'}
          </p>
        </div>

        {canRegister && (
          <div className="flex bg-gray-200/80 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${
                mode === 'login' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                mode === 'register' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 text-indigo-600" /> Register
            </button>
          </div>
        )}

        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          {mode === 'register' && (
            <div>
              <label htmlFor="fullName" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Full Name</label>
              <input id="fullName" type="text" required className={inputCls}
                placeholder="Dr. / Prof. Full Name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
          )}
          <div>
            <label htmlFor="email" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email</label>
            <input id="email" type="email" autoComplete="username" required className={inputCls}
              placeholder="name@spcollege.edu" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Password</label>
            <input id="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required className={inputCls}
              placeholder={mode === 'register' ? 'Min 8 characters' : ''}
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {mode === 'register' && (
            <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 p-3 text-xs text-indigo-900 space-y-1">
              <p className="font-semibold">Institutional Requester Access</p>
              <p className="text-[11px] text-indigo-700 leading-relaxed">
                Self-registered accounts receive standard requester access. Department head, committee authority, and administrative roles are assigned solely by administrators.
              </p>
            </div>
          )}
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : mode === 'register' ? (
              <UserPlus className="w-4 h-4" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}{' '}
            {mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
          {mode === 'login' ? (
            <p className="text-[11px] text-gray-400 text-center">Forgotten your password? Ask the college administrator to reset it.</p>
          ) : (
            <p className="text-[11px] text-gray-400 text-center">By registering, you confirm your institutional affiliation with S.P. College.</p>
          )}
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
        <p>Approval Hub</p>
      </div>
    </div>
  );
};
