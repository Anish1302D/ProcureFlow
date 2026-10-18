import React, { useState } from 'react';
import { KeyRound, Loader2, MailCheck } from 'lucide-react';
import { api } from '../api/client';
import { AuthFrame } from '../components/auth/AuthFrame';

/**
 * Asking for a reset link. The reply is the same whether or not the address
 * has an account, so this page never reveals who is registered.
 */
export const ForgotPassword = ({ onDone }) => {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('/api/auth/forgot-password', { method: 'POST', body: { email: email.trim() } });
      setSent(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

  return (
    <AuthFrame badge="Password help" icon={sent ? MailCheck : KeyRound} title="Forgot your password?"
      subtitle={sent ? undefined : 'Enter the email address you sign in with. We will email you a link to choose a new password.'}>
      {sent ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <p role="status" className="text-sm text-gray-700 leading-relaxed">{sent}</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            The link works once and only for a limited time. If nothing arrives, check the address you typed and try again.
          </p>
          <button type="button" onClick={onDone}
            className="w-full py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-semibold">
            Back to sign in
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <div>
            <label htmlFor="forgot-email" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Email</label>
            <input id="forgot-email" type="email" autoComplete="username" required className={inputCls}
              placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={busy}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Email me a reset link
          </button>
          <button type="button" onClick={onDone} className="w-full text-xs text-gray-500 hover:text-gray-800">
            Back to sign in
          </button>
        </form>
      )}
    </AuthFrame>
  );
};
