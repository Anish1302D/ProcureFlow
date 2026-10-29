import React from 'react';
import { Lock } from 'lucide-react';
import { COPYRIGHT_SHORT } from '../../utils/copyright';

/** The shell shared by sign-in and every page opened from an email link. */
export const AuthFrame = ({ badge = 'Secure access', icon: Icon, title, subtitle, children }) => (
  <div className="min-h-screen bg-gray-50 flex flex-col justify-between p-6">
    <div className="max-w-6xl w-full mx-auto flex items-center justify-between">
      <div className="flex flex-col justify-center">
        <div className="h-9 overflow-hidden flex items-center">
          <img src="/ProcureFlow-logo-horizontal.png" alt="ProcureFlow" className="h-32 w-auto max-w-none object-contain -ml-2" />
        </div>
        <p className="text-[10px] text-gray-400 font-semibold tracking-widest uppercase pl-0.5">Approval &amp; Workflow Management</p>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400"><Lock className="w-3.5 h-3.5" /> {badge}</div>
    </div>

    <main className="w-full max-w-md mx-auto my-12 space-y-6">
      <div className="text-center space-y-1.5">
        {Icon && (
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 mb-2">
            <Icon className="w-6 h-6" />
          </div>
        )}
        <h1 className="text-2xl font-extrabold text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
      </div>
      {children}
    </main>

    <div className="max-w-6xl w-full mx-auto flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400 border-t border-gray-200 pt-4 gap-2">
      <p>{COPYRIGHT_SHORT}</p>
      <p>ProcureFlow · Sir Parashurambhau College</p>
    </div>
  </div>
);

/** A clear, friendly message for a link that cannot be used. */
export const LinkProblem = ({ title, message, hint, onBack }) => (
  <div role="alert" className="bg-white rounded-2xl border border-red-200 p-6 space-y-4">
    <div>
      <h2 className="text-sm font-bold text-red-900">{title}</h2>
      <p className="text-sm text-red-700 mt-1 leading-relaxed">{message}</p>
    </div>
    {hint && <p className="text-xs text-gray-600 leading-relaxed">{hint}</p>}
    <button type="button" onClick={onBack}
      className="w-full py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-semibold">
      Go to sign in
    </button>
  </div>
);
