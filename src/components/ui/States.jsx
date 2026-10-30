import React from 'react';
import { AlertCircle, Inbox, Loader2 } from 'lucide-react';

export const Loading = ({ label = 'Loading…' }) => (
  <div className="py-10 flex items-center justify-center gap-2 text-xs text-gray-400">
    <Loader2 className="w-4 h-4 animate-spin" /> {label}
  </div>
);

export const ErrorState = ({ error, onRetry }) => (
  <div className="py-8 px-4 flex flex-col items-center gap-2 text-center">
    <AlertCircle className="w-5 h-5 text-red-500" />
    <p className="text-xs text-gray-600">
      {error?.status === 403 ? 'Your role does not have access to this.' : error?.message ?? 'Something went wrong.'}
    </p>
    {onRetry && error?.status !== 403 && (
      <button onClick={onRetry} className="text-xs font-semibold text-indigo-600 hover:underline">Try again</button>
    )}
  </div>
);

export const Empty = ({ title, hint }) => (
  <div className="py-10 flex flex-col items-center gap-1.5 text-center">
    <Inbox className="w-5 h-5 text-gray-300" />
    <p className="text-xs font-semibold text-gray-600">{title}</p>
    {hint && <p className="text-[11px] text-gray-400 max-w-sm">{hint}</p>}
  </div>
);

/** Renders loading / error / empty, or the children once data is in. */
export const DataState = ({ state, empty, isEmpty, children }) => {
  if (state.loading && !state.data) return <Loading />;
  if (state.error) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (isEmpty) return <Empty {...empty} />;
  return children;
};
