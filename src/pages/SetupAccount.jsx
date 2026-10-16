import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, CheckCircle2, KeyRound, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';

export const SetupAccount = () => {
  const { signInWithSession, showToast } = useApp();
  const [token, setToken] = useState('');
  const [verifying, setVerifying] = useState(true);
  const [userInfo, setUserInfo] = useState(null);
  const [verifyError, setVerifyError] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawToken = params.get('token') || '';
    setToken(rawToken);

    // Remove token from visible address bar immediately after capturing to prevent
    // leakage via browser history, shoulder-surfing, or Referrer headers.
    if (window.location.search && window.history?.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (!rawToken) {
      setVerifying(false);
      setVerifyError('Missing invitation token. Please check the activation link provided by your administrator.');
      return;
    }

    let active = true;
    api(`/api/auth/verify-setup-token?token=${encodeURIComponent(rawToken)}`)
      .then((data) => {
        if (active) {
          setUserInfo(data);
          setVerifying(false);
        }
      })
      .catch((err) => {
        if (active) {
          setVerifyError(err.message || 'The activation link is invalid, expired, or has already been used.');
          setVerifying(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');

    if (password.length < 8) {
      setSubmitError('Password must be at least 8 characters long');
      return;
    }

    if (password !== confirmPassword) {
      setSubmitError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api('/api/auth/setup-account', {
        method: 'POST',
        body: {
          token,
          password,
        },
      });

      showToast('Account activated successfully! Welcome to ProcureFlow.', 'success');
      // Clean up URL parameter
      window.history.replaceState({}, document.title, window.location.pathname.replace(/\/setup-account.*/, '/'));
      signInWithSession(res.token, res.user);
    } catch (err) {
      setSubmitError(err.message || 'Failed to activate account. Please contact your administrator.');
      showToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnToLogin = () => {
    window.history.replaceState({}, document.title, '/');
    window.location.href = '/';
  };

  const inputCls =
    'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-between p-6">
      {/* Top Header */}
      <div className="max-w-6xl w-full mx-auto flex items-center justify-between">
        <div className="flex flex-col justify-center">
          <div className="h-9 overflow-hidden flex items-center">
            <img src="/ProcureFlow-logo-horizontal.png" alt="ProcureFlow" className="h-32 w-auto max-w-none object-contain -ml-2" />
          </div>
          <p className="text-[10px] text-gray-400 font-semibold tracking-widest uppercase pl-0.5">
            Approval &amp; Workflow Management
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Lock className="w-3.5 h-3.5" /> Secure Account Activation
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full max-w-md mx-auto my-12 space-y-6">
        <div className="text-center space-y-1.5">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 mb-2">
            <KeyRound className="w-6 h-6" />
          </div>
          <h2 className="text-2xl font-extrabold text-gray-900">Set Up Your Account</h2>
          <p className="text-sm text-gray-500">
            Create a secure institutional password to activate your portal access.
          </p>
        </div>

        {verifying ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center space-y-3">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" />
            <p className="text-sm font-semibold text-gray-700">Verifying activation link…</p>
            <p className="text-xs text-gray-400">Validating single-use cryptographic token.</p>
          </div>
        ) : verifyError ? (
          <div className="bg-white rounded-2xl border border-red-200 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-bold text-red-900">Activation Link Invalid</h3>
                <p className="text-xs text-red-700 mt-1 leading-relaxed">{verifyError}</p>
              </div>
            </div>
            <div className="pt-2 border-t border-red-100">
              <p className="text-xs text-gray-500 mb-4">
                Invitation links are single-use and expire after 24 hours. Please request a new activation link from your college administrator.
              </p>
              <button
                type="button"
                onClick={handleReturnToLogin}
                className="w-full py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold"
              >
                Go to Sign In
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
            {/* User Greeting */}
            <div className="rounded-xl bg-gray-50 border border-gray-200 p-3.5 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Invited Member
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3" /> Verified Link
                </span>
              </div>
              <p className="text-sm font-bold text-gray-900">{userInfo?.fullName}</p>
              <p className="text-xs text-gray-500">{userInfo?.email}</p>
            </div>

            <div>
              <label
                htmlFor="new-password"
                className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5"
              >
                Create Password *
              </label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                className={inputCls}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-[11px] text-gray-400 mt-1">Must be at least 8 characters long.</p>
            </div>

            <div>
              <label
                htmlFor="confirm-password"
                className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5"
              >
                Confirm Password *
              </label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                className={inputCls}
                placeholder="Re-enter password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {submitError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4" />
              )}{' '}
              Activate Account &amp; Sign In
            </button>

            <div className="pt-2 text-center">
              <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Passwords are encrypted using industry-standard bcrypt hashing
              </span>
            </div>
          </form>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-6xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400 border-t border-gray-200 pt-4">
        <p>© 2026 S.P. College</p>
        <p>ProcureFlow</p>
      </div>
    </div>
  );
};
