import React, { useState } from 'react';
import { Copyright, ShieldCheck, Scale, ChevronDown, ChevronUp, FileText } from 'lucide-react';
import {
  COPYRIGHT_AUTHORS_STRING,
  COPYRIGHT_NOTICE_PARAGRAPHS,
  COPYRIGHT_SHORT,
  COPYRIGHT_YEAR,
} from '../../utils/copyright';

export const CopyrightNotice = ({ onOpenNoticeModal }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <section
      aria-label="ProcureFlow Copyright & Intellectual Property Notice"
      className="w-full max-w-3xl mx-auto mt-8 mb-4 bg-white/90 backdrop-blur-sm rounded-2xl border border-gray-200/90 shadow-sm p-5 sm:p-6 transition-all duration-200"
    >
      {/* Copyright Logo & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-4">
        <div className="flex items-center gap-3">
          {/* Official Copyright Emblem Logo */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-900 via-indigo-700 to-slate-900 flex items-center justify-center text-white shadow-sm ring-2 ring-indigo-500/20 flex-shrink-0">
            <Copyright className="w-5 h-5 text-indigo-100" />
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-gray-900 tracking-tight">
                Copyright © {COPYRIGHT_YEAR} {COPYRIGHT_AUTHORS_STRING}
              </h3>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <ShieldCheck className="w-3 h-3" /> Protected Work
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
              <Scale className="w-3.5 h-3.5 text-indigo-600 inline flex-shrink-0" />
              <span>Statutory literary work under Section 2(o), Copyright Act, 1957 (India)</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
          {onOpenNoticeModal && (
            <button
              type="button"
              onClick={onOpenNoticeModal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 shadow-xs transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Read &amp; Acknowledge</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/70 transition-colors cursor-pointer"
            aria-expanded={expanded}
          >
            <span>{expanded ? 'Collapse Notice' : 'View Full Notice'}</span>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Notice Content */}
      <div className="mt-4 text-xs text-gray-600 leading-relaxed space-y-3">
        {/* Primary summary paragraph always visible */}
        <p className="font-semibold text-gray-800">
          All Rights Reserved.
        </p>

        <p>
          {COPYRIGHT_NOTICE_PARAGRAPHS[1]}
        </p>

        <p>
          {COPYRIGHT_NOTICE_PARAGRAPHS[2]}
        </p>

        {/* Collapsible remaining paragraphs */}
        {expanded ? (
          <div className="space-y-3 pt-1 border-t border-dashed border-gray-200 mt-3 animate-fadeIn">
            {COPYRIGHT_NOTICE_PARAGRAPHS.slice(3).map((para, idx) => (
              <p
                key={idx}
                className={
                  idx === COPYRIGHT_NOTICE_PARAGRAPHS.slice(3).length - 1
                    ? 'font-medium text-amber-900/90 bg-amber-50/70 p-2.5 rounded-lg border border-amber-200/80'
                    : ''
                }
              >
                {para}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-gray-400 italic pt-1">
            Click &ldquo;View Full Notice&rdquo; above to read all reservation of rights, licensing restrictions, and legal disclosures.
          </p>
        )}
      </div>

      {/* Footer verification line */}
      <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400 font-mono">
        <span>{COPYRIGHT_SHORT}</span>
        <span>ProcureFlow · Autonomous Approval Hub</span>
      </div>
    </section>
  );
};
