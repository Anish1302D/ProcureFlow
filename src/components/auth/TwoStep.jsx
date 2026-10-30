import React, { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  QrCode,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';

const inputCls =
  'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
const buttonCls =
  'w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors shadow-sm';

function useExpiredChallenge(onCancel) {
  return (err) => {
    if (err.code === 'CHALLENGE_EXPIRED') {
      onCancel(err.message);
      return true;
    }
    return false;
  };
}

/** The second sign-in step: a code from the authenticator app, or a recovery code. */
export const TwoStepVerify = ({ challenge, onCancel }) => {
  const { signInWithSession } = useApp();
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const expired = useExpiredChallenge(onCancel);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const cleanValue = useRecovery ? value.trim() : value.replace(/\s+/g, '');
      const body = useRecovery
        ? { challenge, recoveryCode: cleanValue }
        : { challenge, code: cleanValue };
      const res = await api('/api/auth/mfa/verify', { method: 'POST', body });
      signInWithSession(res.token, res.user);
      if (res.recoveryCodesLeft !== undefined && res.recoveryCodesLeft <= 3) {
        window.alert(
          `You have ${res.recoveryCodesLeft} recovery codes left. Create new ones from your Profile page.`
        );
      }
    } catch (err) {
      if (!expired(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleInputChange = (e) => {
    const raw = e.target.value;
    if (useRecovery) {
      setValue(raw.toUpperCase());
    } else {
      const digits = raw.replace(/\D/g, '').slice(0, 6);
      setValue(digits);
    }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-start gap-3 bg-indigo-50/60 border border-indigo-100 rounded-xl p-3.5">
        <Smartphone className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
        <p className="text-xs text-indigo-900 leading-relaxed font-medium">
          {useRecovery
            ? 'Type one of the 10-character recovery codes you saved when you set up 2-step verification. Each code can only be used once.'
            : 'Open Google Authenticator, Microsoft Authenticator, or your authenticator app and enter the current 6-digit code.'}
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="verify-code" className="block text-xs font-semibold text-gray-700">
          {useRecovery ? 'Emergency recovery code:' : '6-digit authentication code:'}
        </label>
        <input
          id="verify-code"
          aria-label={useRecovery ? 'Recovery code' : 'Authentication code'}
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={useRecovery ? 20 : 6}
          className={`${inputCls} text-center tracking-[0.3em] font-mono text-xl font-bold`}
          placeholder={useRecovery ? 'XXXXX-XXXXX' : '000000'}
          value={value}
          onChange={handleInputChange}
          disabled={busy}
        />
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-start gap-2">
          <span className="shrink-0 font-bold">!</span>
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !value.trim() || (!useRecovery && value.length !== 6)}
        className={buttonCls}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
        Verify and sign in
      </button>

      <div className="flex items-center justify-between text-xs pt-1">
        <button
          type="button"
          onClick={() => {
            setUseRecovery((v) => !v);
            setValue('');
            setError('');
          }}
          className="font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
        >
          {useRecovery ? 'Use authenticator app code' : 'Lost your phone? Use a recovery code'}
        </button>
        <button
          type="button"
          onClick={() => onCancel()}
          className="text-gray-500 hover:text-gray-800 cursor-pointer"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

/** First sign-in of someone who must use 2-step verification: set it up. */
export const TwoStepEnrol = ({ challenge, onCancel }) => {
  const { signInWithSession } = useApp();
  const [setup, setSetup] = useState(null);
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [tab, setTab] = useState('qr'); // 'qr' | 'key'
  const [code, setCode] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [saved, setSaved] = useState(false);
  const expired = useExpiredChallenge(onCancel);

  const startSetup = () => {
    setLoadingSetup(true);
    setError('');
    api('/api/auth/mfa/setup/start', { method: 'POST', body: { challenge } })
      .then((res) => {
        setSetup(res);
      })
      .catch((err) => {
        if (!expired(err)) setError(err.message);
      })
      .finally(() => {
        setLoadingSetup(false);
      });
  };

  useEffect(() => {
    startSetup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const cleanCode = code.replace(/\D/g, '');
      const res = await api('/api/auth/mfa/setup/confirm', {
        method: 'POST',
        body: { challenge, code: cleanCode },
      });
      setDone(res);
    } catch (err) {
      if (!expired(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copySecret = () => {
    if (!setup?.secret) return;
    navigator.clipboard.writeText(setup.secret).then(() => {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    });
  };

  const copyAllCodes = () => {
    if (!done?.recoveryCodes) return;
    const text = [
      'Approval hub — 2-step verification recovery codes',
      `Account: ${setup?.account ?? done?.user?.email ?? ''}`,
      `Created: ${new Date().toLocaleString('en-IN')}`,
      '',
      ...done.recoveryCodes,
    ].join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCodes(true);
      setTimeout(() => setCopiedCodes(false), 2000);
    });
  };

  const downloadCodes = () => {
    const text = [
      'Approval hub — 2-step verification recovery codes',
      `Account: ${setup?.account ?? done?.user?.email ?? ''}`,
      `Created: ${new Date().toLocaleString('en-IN')}`,
      '',
      'Each code works once, if you cannot use your authenticator app.',
      'Keep this somewhere safe and private (printed, or in a password manager).',
      '',
      ...done.recoveryCodes,
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'approval-hub-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-100 rounded-xl p-3.5">
          <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-emerald-950">2-step verification is turned on!</p>
            <p className="text-xs text-emerald-800 leading-relaxed">
              Save your recovery codes now. If you lose your phone, each code lets you sign in once.
              They will not be shown again.
            </p>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider block mb-1.5">
            Emergency Recovery Codes (10 single-use codes)
          </label>
          <ol className="grid grid-cols-2 gap-2 font-mono text-xs bg-gray-50 border border-gray-200 rounded-xl p-3 select-all">
            {done.recoveryCodes.map((c) => (
              <li
                key={c}
                className="text-center py-1.5 px-2 bg-white rounded border border-gray-200 font-semibold text-gray-800 shadow-2xs"
              >
                {c}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={downloadCodes}
            className="flex-1 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-gray-500" /> Download .txt
          </button>
          <button
            type="button"
            onClick={copyAllCodes}
            className="flex-1 py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            {copiedCodes ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-emerald-700">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-gray-500" />
                <span>Copy all</span>
              </>
            )}
          </button>
        </div>

        <label className="flex items-start gap-2.5 text-xs text-gray-700 cursor-pointer pt-1">
          <input
            type="checkbox"
            checked={saved}
            onChange={(e) => setSaved(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
          <span className="select-none font-medium">I have saved my recovery codes somewhere safe.</span>
        </label>

        <button
          type="button"
          disabled={!saved}
          onClick={() => signInWithSession(done.token, done.user)}
          className={buttonCls}
        >
          Continue to Dashboard
        </button>
      </div>
    );
  }

  if (loadingSetup) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-8 space-y-3 text-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto" />
        <p className="text-sm font-semibold text-gray-800">Preparing 2-step verification...</p>
        <p className="text-xs text-gray-500">Generating your unique authenticator setup key</p>
      </div>
    );
  }

  if (error && !setup) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 space-y-1">
          <p className="font-bold text-red-800">2-step verification setup failed</p>
          <p>{error}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={startSetup}
            className="flex-1 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer"
          >
            Retry setup
          </button>
          <button
            type="button"
            onClick={() => onCancel()}
            className="flex-1 py-2.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-xs font-semibold text-gray-700 cursor-pointer"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
      <div className="flex items-start gap-3 bg-indigo-50/60 border border-indigo-100 rounded-xl p-3.5">
        <ShieldCheck className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
        <div className="space-y-0.5">
          <p className="text-xs font-bold text-indigo-950">One-Time Security Setup</p>
          <p className="text-xs text-indigo-800/90 leading-relaxed">
            Link an authenticator app (Google Authenticator, Microsoft Authenticator, or Apple Passwords)
            to protect approvals. This is only done once.
          </p>
        </div>
      </div>

      {/* Tabs: QR Code vs Manual Key */}
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => setTab('qr')}
          className={`flex-1 pb-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
            tab === 'qr'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <QrCode className="w-3.5 h-3.5" /> Scan QR Code
        </button>
        <button
          type="button"
          onClick={() => setTab('key')}
          className={`flex-1 pb-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
            tab === 'key'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" /> Manual Setup Key
        </button>
      </div>

      {tab === 'qr' ? (
        <div className="space-y-2.5 text-center py-1">
          {setup?.qrCode ? (
            <div className="inline-block p-2.5 bg-white rounded-xl border border-gray-200 shadow-2xs">
              <img
                src={setup.qrCode}
                alt="Scan 2FA QR code with authenticator app"
                className="w-48 h-48 object-contain mx-auto"
              />
            </div>
          ) : (
            <div className="p-4 bg-gray-50 rounded-xl text-xs text-gray-500 border border-gray-200">
              QR code image could not be loaded. Switch to the Manual Setup Key tab.
            </div>
          )}
          <p className="text-[11px] text-gray-500 leading-normal max-w-xs mx-auto">
            Open your authenticator app, tap <strong className="font-semibold text-gray-700">+</strong>,
            and scan this code to link your account.
          </p>
        </div>
      ) : (
        <div className="space-y-3 py-1">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-2.5">
            <div className="flex justify-between items-center text-xs text-gray-600">
              <span className="font-medium text-gray-500">Account:</span>
              <span className="font-semibold text-gray-800">{setup?.issuer ?? 'SP College'} ({setup?.account})</span>
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 block mb-1">
                Setup Key
              </label>
              <div className="flex items-center gap-2">
                <span className="flex-1 font-mono text-sm tracking-wider bg-white border border-gray-200 rounded-lg px-3 py-2 select-all break-all text-gray-900 font-bold shadow-2xs">
                  {setup?.secret ? setup.secret.match(/.{1,4}/g)?.join(' ') : '—'}
                </span>
                <button
                  type="button"
                  onClick={copySecret}
                  className="px-3 py-2 rounded-lg bg-white border border-gray-200 hover:bg-gray-50 text-xs font-semibold text-gray-700 flex items-center gap-1.5 shrink-0 transition-colors shadow-2xs cursor-pointer"
                >
                  {copiedKey ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-700">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-gray-500" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-gray-500">Account Type: Time-based (TOTP)</p>
          </div>
        </div>
      )}

      {setup?.otpauthUri && (
        <div className="text-center pt-0.5">
          <a
            href={setup.otpauthUri}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
          >
            <span>On this phone? Tap to open Authenticator app</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {/* Code verification input */}
      <div className="space-y-1.5 pt-2 border-t border-gray-100">
        <label htmlFor="enrol-code" className="block text-xs font-semibold text-gray-700">
          Type the 6-digit code your app now shows:
        </label>
        <input
          id="enrol-code"
          aria-label="6-digit authentication code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          autoFocus
          className={`${inputCls} text-center tracking-[0.4em] font-mono text-xl font-bold`}
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          disabled={!setup || busy}
        />
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600 flex items-start gap-2">
          <span className="shrink-0 font-bold">!</span>
          <span>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !setup || code.trim().length !== 6}
        className={buttonCls}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
        Turn on 2-step verification
      </button>

      <button
        type="button"
        onClick={() => onCancel()}
        className="w-full text-xs text-gray-500 hover:text-gray-800 cursor-pointer pt-1"
      >
        Cancel
      </button>
    </form>
  );
};
