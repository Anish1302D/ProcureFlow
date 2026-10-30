import React from 'react';
import { statusInfo } from '../../api/format';

/** kind: request (default) · item · issue · condition */
export const StatusBadge = ({ status, kind = 'request' }) => {
  const { label, tone } = statusInfo(status, kind);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide whitespace-nowrap ${tone}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70"></span>
      {label}
    </span>
  );
};
