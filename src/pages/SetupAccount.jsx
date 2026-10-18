import React, { useEffect, useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';
import { api } from '../api/client';
import { AuthFrame, LinkProblem } from '../components/auth/AuthFrame';
import { NewPasswordForm } from '../components/auth/NewPasswordForm';
import { useApp } from '../context/AppContext';
import { forgetLinkInAddressBar } from '../publicRoutes';

// What to tell someone whose invitation link cannot be used.
const LINK_HELP = {
  LINK_EXPIRED: 'Ask the college administrator to resend your invitation. The new email will have a fresh link.',
  LINK_REVOKED: 'A newer invitation was sent, or this one was cancelled. Use the link in the most recent email.',
  LINK_USED: 'Your account is already set up. Sign in with your email and password, or use "Forgot password?" on the sign-in page.',
};

/**
 * Accepting an invitation: the invitee proves they own the email address by
 * opening the link, sees the role they are being given, and chooses their own
 * password. Nobody else ever knows it.
 */
export const SetupAccount = ({ token, onDone }) => {
  const { signInWithSession, showToast } = useApp();
  const [invite, setInvite] = useState(null);
  const [problem, setProblem] = useState(null);
  const [busy, setBusy] = useState(false);
  const [serverProblems, setServerProblems] = useState([]);

  useEffect(() => {
    // The token has been read; keep it out of the address bar and history.
    forgetLinkInAddressBar();
    let active = true;
    api('/api/auth/verify-setup-token', { method: 'POST', body: { token } })
      .then((data) => { if (active) setInvite(data); })
      .catch((err) => { if (active) setProblem(err); });
    return () => { active = false; };
  }, [token]);

  const accept = async (password) => {
    setBusy(true);
    setServerProblems([]);
    try {
      const res = await api('/api/auth/setup-account', { method: 'POST', body: { token, password } });
      showToast('Your account is ready. Welcome!', 'success');
      signInWithSession(res.token, res.user);
      onDone?.();
    } catch (err) {
      if (err.code === 'WEAK_PASSWORD') setServerProblems(err.details ?? [err.message]);
      else setProblem(err);
    } finally {
      setBusy(false);
    }
  };

  const backToSignIn = () => { onDone?.(); };

  return (
    <AuthFrame badge="Invitation" icon={MailCheck} title="Accept your invitation"
      subtitle="Choose the password you will use to sign in.">
      {problem ? (
        <LinkProblem title="This invitation link cannot be used" message={problem.message}
          hint={LINK_HELP[problem.code] ?? 'If you think this is a mistake, ask the college administrator to resend your invitation.'}
          onBack={backToSignIn} />
      ) : !invite ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" />
          <p className="text-sm font-semibold text-gray-700">Checking your invitation…</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 space-y-1">
            <p className="text-sm font-bold text-gray-900">{invite.fullName}</p>
            <p className="text-xs text-gray-500">{invite.email}</p>
            {invite.roles?.length > 0 && (
              <p className="text-xs text-gray-700 pt-1">
                Invited as <span className="font-semibold">{invite.roles.join(', ')}</span>
              </p>
            )}
          </div>
          <NewPasswordForm rules={invite.passwordRules} submitLabel="Set password and continue"
            busy={busy} serverProblems={serverProblems} onSubmit={accept} />
          <p className="text-[11px] text-gray-400 text-center">
            Only you will know this password — not even the administrator can see it.
          </p>
        </div>
      )}
    </AuthFrame>
  );
};
