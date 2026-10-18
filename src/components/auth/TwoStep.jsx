import React, { useEffect, useState } from 'react';
import { Download, KeyRound, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';

const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';
const buttonCls = 'w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50';

function useExpiredChallenge(onCancel) {
  return (err) => {
    if (err.code === 'CHALLENGE_EXPIRED') { onCancel(err.message); return true; }
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
      const body = useRecovery ? { challenge, recoveryCode: value } : { challenge, code: value };
      const res = await api('/api/auth/mfa/verify', { method: 'POST', body });
      signInWithSession(res.token, res.user);
      if (res.recoveryCodesLeft !== undefined && res.recoveryCodesLeft <= 3) {
        window.alert(`You have ${res.recoveryCodesLeft} recovery codes left. Create new ones from your Profile page.`);
      }
    } catch (err) {
      if (!expired(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Smartphone className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
        <p className="text-sm text-gray-700 leading-relaxed">
          {useRecovery
            ? 'Type one of the recovery codes you saved when you set up 2-step verification. Each code works once.'
            : 'Open your authenticator app and type the 6-digit code it shows for the approval hub.'}
        </p>
      </div>
      <input
        aria-label={useRecovery ? 'Recovery code' : 'Authentication code'}
        inputMode={useRecovery ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus required
        className={`${inputCls} text-center tracking-[0.3em] font-mono text-lg`}
        placeholder={useRecovery ? 'XXXXX-XXXXX' : '123456'} value={value}
        onChange={(e) => setValue(e.target.value)} />
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={busy || !value.trim()} className={buttonCls}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Verify and sign in
      </button>
      <div className="flex items-center justify-between text-[11px]">
        <button type="button" onClick={() => { setUseRecovery((v) => !v); setValue(''); setError(''); }}
          className="font-semibold text-indigo-600 hover:text-indigo-800">
          {useRecovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}
        </button>
        <button type="button" onClick={() => onCancel()} className="text-gray-500 hover:text-gray-800">Cancel</button>
      </div>
    </form>
  );
};

/** First sign-in of someone who must use 2-step verification: set it up. */
export const TwoStepEnrol = ({ challenge, onCancel }) => {
  const { signInWithSession } = useApp();
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [saved, setSaved] = useState(false);
  const expired = useExpiredChallenge(onCancel);

  useEffect(() => {
    let active = true;
    api('/api/auth/mfa/setup/start', { method: 'POST', body: { challenge } })
      .then((res) => { if (active) setSetup(res); })
      .catch((err) => { if (active && !expired(err)) setError(err.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      setDone(await api('/api/auth/mfa/setup/confirm', { method: 'POST', body: { challenge, code } }));
    } catch (err) {
      if (!expired(err)) setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadCodes = () => {
    const text = [
      'Approval hub — 2-step verification recovery codes',
      `Account: ${setup?.account ?? ''}`,
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
      <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-gray-900">2-step verification is on</p>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              Save these recovery codes now. If you lose your phone, each one lets you sign in once.
              They will not be shown again.
            </p>
          </div>
        </div>
        <ol className="grid grid-cols-2 gap-2 font-mono text-sm bg-gray-50 border border-gray-200 rounded-xl p-3">
          {done.recoveryCodes.map((c) => <li key={c} className="text-center">{c}</li>)}
        </ol>
        <button type="button" onClick={downloadCodes}
          className="w-full py-2 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-sm font-semibold flex items-center justify-center gap-2">
          <Download className="w-4 h-4" /> Download as a text file
        </button>
        <label className="flex items-start gap-2 text-xs text-gray-700">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-0.5" />
          I have saved my recovery codes somewhere safe.
        </label>
        <button type="button" disabled={!saved} onClick={() => signInWithSession(done.token, done.user)} className={buttonCls}>
          Continue
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={confirm} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
      <div className="flex items-start gap-3">
        <KeyRound className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
        <p className="text-sm text-gray-700 leading-relaxed">
          Your account protects the college's approvals, so it needs a second step at sign-in: a code from an
          authenticator app on your phone. This is a one-time setup.
        </p>
      </div>
      <ol className="list-decimal pl-5 space-y-2 text-xs text-gray-700 leading-relaxed">
        <li>Install <span className="font-semibold">Google Authenticator</span> or <span className="font-semibold">Microsoft Authenticator</span> on your phone.</li>
        <li>In the app, choose <span className="font-semibold">Add account</span> → <span className="font-semibold">Enter a setup key</span>.</li>
        <li>
          Account name: <span className="font-semibold">{setup?.issuer ?? 'Approval hub'}</span>. Key:
          <span className="block mt-1 font-mono text-sm tracking-wider bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 select-all break-all">
            {setup ? setup.secret.match(/.{1,4}/g).join(' ') : '…'}
          </span>
          Choose <span className="font-semibold">Time based</span> if asked.
        </li>
        <li>Type the 6-digit code the app now shows:</li>
      </ol>
      <input aria-label="Authentication code" inputMode="numeric" autoComplete="one-time-code" required
        className={`${inputCls} text-center tracking-[0.3em] font-mono text-lg`} placeholder="123456"
        value={code} onChange={(e) => setCode(e.target.value)} disabled={!setup} />
      {setup?.otpauthUri && (
        <p className="text-[11px] text-gray-500">
          On this phone? <a href={setup.otpauthUri} className="font-semibold text-indigo-600">Open in the authenticator app</a>.
        </p>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <button type="submit" disabled={busy || !setup || !code.trim()} className={buttonCls}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Turn on 2-step verification
      </button>
      <button type="button" onClick={() => onCancel()} className="w-full text-xs text-gray-500 hover:text-gray-800">Cancel</button>
    </form>
  );
};
