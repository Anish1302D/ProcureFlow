import React, { useEffect, useRef, useState } from 'react';
import { Copyright, ShieldCheck, Scale, X, ArrowDownCircle, CheckCircle2 } from 'lucide-react';
import {
  COPYRIGHT_AUTHORS_STRING,
  COPYRIGHT_NOTICE_PARAGRAPHS,
  COPYRIGHT_YEAR,
} from '../../utils/copyright';

/**
 * CopyrightNoticeModal
 *
 * Displays the complete proprietary software notice and statutory copyright terms.
 * Requires the user to scroll to the bottom of the notice before enabling the
 * acknowledgement button, which in turn unlocks the compulsory login checkbox.
 */
export const CopyrightNoticeModal = ({ isOpen, onClose, onAcknowledge, isAlreadyAcknowledged = false }) => {
  const contentRef = useRef(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(isAlreadyAcknowledged);

  useEffect(() => {
    if (isOpen) {
      if (isAlreadyAcknowledged) {
        setHasScrolledToBottom(true);
      } else {
        setHasScrolledToBottom(false);
        // Check if viewport is large enough that content fits without scrolling
        const checkFit = () => {
          if (contentRef.current) {
            const { scrollHeight, clientHeight } = contentRef.current;
            if (scrollHeight <= clientHeight + 35) {
              setHasScrolledToBottom(true);
            }
          }
        };
        const timer = setTimeout(checkFit, 150);
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, isAlreadyAcknowledged]);

  if (!isOpen) return null;

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollTop + clientHeight >= scrollHeight - 35) {
      setHasScrolledToBottom(true);
    }
  };

  const handleConfirm = () => {
    if (onAcknowledge) onAcknowledge();
    if (onClose) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="copyright-modal-heading"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn"
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-gray-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-100 pb-3 gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-950 via-indigo-800 to-slate-900 flex items-center justify-center text-white shadow-xs flex-shrink-0">
              <Copyright className="w-5 h-5 text-indigo-100" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 id="copyright-modal-heading" className="text-sm font-bold text-gray-900">
                  Copyright &amp; Proprietary Software Notice
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <ShieldCheck className="w-3 h-3" /> Section 2(o) Protected
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">
                Copyright © {COPYRIGHT_YEAR} {COPYRIGHT_AUTHORS_STRING}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scroll Instruction Callout */}
        <div className="mt-3 px-3.5 py-2 rounded-lg bg-indigo-50/70 border border-indigo-100 text-[11px] text-indigo-800 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-medium">
            <Scale className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
            Please read through the entire notice below to enable the login agreement checkbox.
          </span>
          {hasScrolledToBottom ? (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 text-[11px] flex-shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" /> Read Complete
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-indigo-600 text-[11px] animate-pulse flex-shrink-0">
              <ArrowDownCircle className="w-3.5 h-3.5" /> Scroll to read
            </span>
          )}
        </div>

        {/* Scrollable Document Text */}
        <div
          ref={contentRef}
          onScroll={handleScroll}
          tabIndex={0}
          role="region"
          aria-label="Legal notice text"
          className="overflow-y-auto my-3 pr-2 text-xs text-gray-600 leading-relaxed space-y-3 border border-gray-100 rounded-xl p-4 bg-gray-50/50 max-h-[50vh] focus:outline-none focus:ring-1 focus:ring-indigo-500/30"
        >
          <div className="border-b border-gray-200 pb-2 mb-2">
            <p className="font-bold text-gray-900 text-sm">
              Copyright © {COPYRIGHT_YEAR} {COPYRIGHT_AUTHORS_STRING}
            </p>
            <p className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider mt-0.5">
              All Rights Reserved.
            </p>
          </div>

          {COPYRIGHT_NOTICE_PARAGRAPHS.map((para, idx) => (
            <p
              key={idx}
              className={
                idx === COPYRIGHT_NOTICE_PARAGRAPHS.length - 1
                  ? 'font-medium text-amber-950 bg-amber-50/80 p-3 rounded-lg border border-amber-200/80 text-[11px]'
                  : ''
              }
            >
              {para}
            </p>
          ))}

          <div className="pt-2 text-center text-[10px] text-gray-400 border-t border-gray-200">
            — End of Proprietary Document —
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-gray-100 pt-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-[11px] text-gray-500">
            {hasScrolledToBottom ? (
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Full notice reviewed. You may now acknowledge below.
              </span>
            ) : (
              <span className="text-gray-400 italic">
                Scroll through to the end of the text to unlock agreement.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-semibold text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!hasScrolledToBottom}
              onClick={handleConfirm}
              className="px-4 py-2 text-xs font-semibold rounded-lg text-white transition-all shadow-xs flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-700 disabled:hover:bg-indigo-600"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>I Have Read the Notice &amp; Agree</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
