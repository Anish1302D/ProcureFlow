import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MailCheck } from 'lucide-react';
import { api } from '../api/client';
import { AuthFrame, LinkProblem } from '../components/auth/AuthFrame';
import { forgetLinkInAddressBar } from '../publicRoutes';

/** Confirming a new email address from the link sent to it. */
export const ConfirmEmail = ({ token, onDone }) => {
  const [change, setChange] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    forgetLinkInAddressBar();
    let active = true;
    api('/api/auth/confirm-email/verify', { method: 'POST', body: { token } })
      .then((data) => { if (active) setChange(data); })
      .catch((err) => { if (active) setProblem(err); });
    return () => { active = false; };
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await api('/api/auth/confirm-email', { method: 'POST', body: { token } });
      setDone(res.message);
    } catch (err) {
      setProblem(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame badge="Email change" icon={done ? CheckCircle2 : MailCheck} title={done ? 'Email confirmed' : 'Confirm your new email'}>
      {problem ? (
        <LinkProblem title="This confirmation link cannot be used" message={problem.message}
          hint="Ask the college administrator to make the change again; a new link will be emailed." onBack={onDone} />
      ) : done ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <p role="status" className="text-sm text-gray-700">{done}</p>
          <p className="text-xs text-gray-500">For your safety, every device that was signed in has been signed out.</p>
          <button type="button" onClick={onDone}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">Sign in</button>
        </div>
      ) : !change ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            {change.fullName}, your account email will change from <span className="font-semibold">{change.email}</span> to{' '}
            <span className="font-semibold">{change.newEmail}</span>. You will sign in with the new address from now on.
          </p>
          <button type="button" onClick={confirm} disabled={busy}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Confirm new email address
          </button>
          <button type="button" onClick={onDone} className="w-full text-xs text-gray-500 hover:text-gray-800">
            This was not me — leave it unchanged
          </button>
        </div>
      )}
    </AuthFrame>
  );
};
