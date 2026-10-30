import React from 'react';

export const StatCard = ({ title, value, subtext, icon: Icon, color = 'indigo', onClick }) => {
  const colorMap = {
    indigo: { bg: 'bg-indigo-50', icon: 'text-indigo-600', ring: 'ring-indigo-100' },
    emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', ring: 'ring-emerald-100' },
    amber: { bg: 'bg-amber-50', icon: 'text-amber-600', ring: 'ring-amber-100' },
    rose: { bg: 'bg-red-50', icon: 'text-red-600', ring: 'ring-red-100' },
    sky: { bg: 'bg-sky-50', icon: 'text-sky-600', ring: 'ring-sky-100' },
    violet: { bg: 'bg-violet-50', icon: 'text-violet-600', ring: 'ring-violet-100' },
  };
  const c = colorMap[color] || colorMap.indigo;
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      className={`glass-card rounded-2xl p-5 text-left w-full transition-all duration-200 hover:shadow-md ${onClick ? 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">{title}</p>
          <h3 className="text-2xl font-bold text-gray-900 tabular-nums">{value}</h3>
          {subtext && <p className="text-xs text-gray-400">{subtext}</p>}
        </div>
        {Icon && (
          <div className={`p-3 rounded-xl ${c.bg} ring-1 ${c.ring}`}>
            <Icon className={`w-5 h-5 ${c.icon}`} />
          </div>
        )}
      </div>
    </Tag>
  );
};
