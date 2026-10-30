import React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export const Toast = () => {
  const { toast } = useApp();
  if (!toast) return null;

  const styles = {
    success: { icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />, bg: 'bg-emerald-50 border-emerald-200' },
    error: { icon: <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />, bg: 'bg-red-50 border-red-200' },
    info: { icon: <Info className="w-5 h-5 text-indigo-600 shrink-0" />, bg: 'bg-indigo-50 border-indigo-200' },
    warning: { icon: <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />, bg: 'bg-amber-50 border-amber-200' },
  };
  const s = styles[toast.type] || styles.info;

  return (
    <div className="fixed bottom-6 right-6 z-[100] animate-fade-in" role={toast.type === 'error' ? 'alert' : 'status'} aria-live="polite">
      <div className={`rounded-xl px-5 py-3.5 shadow-lg border flex items-center gap-3 max-w-md ${s.bg}`}>
        {s.icon}
        <p className="text-sm font-medium text-gray-800">{toast.message}</p>
      </div>
    </div>
  );
};
