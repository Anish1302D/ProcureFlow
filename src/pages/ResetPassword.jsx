import React, { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2 } from 'lucide-react';
import { api } from '../api/client';
import { AuthFrame, LinkProblem } from '../components/auth/AuthFrame';
import { NewPasswordForm } from '../components/auth/NewPasswordForm';
import { forgetLinkInAddressBar } from '../publicRoutes';

const LINK_HELP = {
  LINK_EXPIRED: 'Reset links last a short time for your safety. Ask for a new one from the sign-in page.',
  LINK_REVOKED: 'A newer reset link was sent. Use the link in the most recent email.',
  LINK_USED: 'Your password was already changed with this link. Sign in with the new password, or ask for another link.',
};

/** Choosing a new password from an emailed reset link. */
export const ResetPassword = ({ token, onDone }) => {
  const [reset, setReset] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState([]);
  const [done, setDone] = useState(null);

  useEffect(() => {
    forgetLinkInAddressBar();
    let active = true;
    api('/api/auth/reset-password/verify', { method: 'POST', body: { token } })
      .then((data) => { if (active) setReset(data); })
      .catch((err) => { if (active) setProblem(err); });
    return () => { active = false; };
  }, [token]);

  const change = async (password) => {
    setBusy(true);
    setServerProblems([]);
    try {
      const res = await api('/api/auth/reset-password', { method: 'POST', body: { token, password } });
      setDone(res.message);
    } catch (err) {
      if (err.code === 'WEAK_PASSWORD') setServerProblems(err.details ?? [err.message]);
      else setProblem(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame badge="Password help" icon={done ? CheckCircle2 : KeyRound} title={done ? 'Password changed' : 'Choose a new password'}>
      {problem ? (
        <LinkProblem title="This reset link cannot be used" message={problem.message}
          hint={LINK_HELP[problem.code] ?? 'Ask for a new link from the sign-in page.'} onBack={onDone} />
      ) : done ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
          <p role="status" className="text-sm text-gray-700 leading-relaxed">{done}</p>
          <p className="text-xs text-gray-500">For your safety, every device that was signed in has been signed out.</p>
          <button type="button" onClick={onDone}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold">
            Sign in
          </button>
        </div>
      ) : !reset ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" />
          <p className="text-sm font-semibold text-gray-700">Checking your link…</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5">
            <p className="text-sm font-bold text-gray-900">{reset.fullName}</p>
            <p className="text-xs text-gray-500">{reset.email}</p>
          </div>
          <NewPasswordForm rules={reset.passwordRules} submitLabel="Change password"
            busy={busy} serverProblems={serverProblems} onSubmit={change} />
        </div>
      )}
    </AuthFrame>
  );
};
