import React, { useState } from 'react';
import { Copyright, X } from 'lucide-react';
import {
  COPYRIGHT_AUTHORS_STRING,
  COPYRIGHT_NOTICE_PARAGRAPHS,
  COPYRIGHT_YEAR,
} from '../../utils/copyright';

/**
 * CopyrightFooter Component
 *
 * Provides a clean, professional horizontal copyright line across all tabs
 * and pages for all members, matching modern enterprise web application design.
 */
export const CopyrightFooter = () => {
  const [showNoticeModal, setShowNoticeModal] = useState(false);

  return (
    <>
      <footer className="mt-8 pt-4 border-t border-gray-200/90 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-400 gap-2">
        <p className="flex items-center gap-1.5 flex-wrap">
          <span>Copyright © {COPYRIGHT_YEAR} {COPYRIGHT_AUTHORS_STRING}. All Rights Reserved.</span>
          <button
            type="button"
            onClick={() => setShowNoticeModal(true)}
            className="text-indigo-600 hover:text-indigo-800 underline underline-offset-2 ml-1 cursor-pointer font-medium text-[11px]"
          >
            Notice
          </button>
        </p>
        <p>ProcureFlow · Sir Parashurambhau College</p>
      </footer>

      {showNoticeModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="copyright-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
        >
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-gray-200 max-h-[85vh] flex flex-col animate-fadeIn">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-950 via-indigo-800 to-slate-900 flex items-center justify-center text-white shadow-xs">
                  <Copyright className="w-4 h-4 text-indigo-100" />
                </div>
                <div>
                  <h3 id="copyright-modal-title" className="text-sm font-bold text-gray-900">
                    ProcureFlow Proprietary Software Notice
                  </h3>
                  <p className="text-[11px] text-gray-500">
                    Statutory protection under Section 2(o), Copyright Act, 1957 (India)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNoticeModal(false)}
                aria-label="Close dialog"
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto my-4 pr-1 text-xs text-gray-600 leading-relaxed space-y-3">
              <p className="font-semibold text-gray-900 text-sm">
                Copyright © {COPYRIGHT_YEAR} {COPYRIGHT_AUTHORS_STRING}
              </p>
              {COPYRIGHT_NOTICE_PARAGRAPHS.map((p, idx) => (
                <p
                  key={idx}
                  className={
                    idx === COPYRIGHT_NOTICE_PARAGRAPHS.length - 1
                      ? 'font-medium text-amber-900/90 bg-amber-50/70 p-2.5 rounded-lg border border-amber-200/80'
                      : ''
                  }
                >
                  {p}
                </p>
              ))}
            </div>

            <div className="border-t border-gray-100 pt-3 flex items-center justify-between text-[11px] text-gray-400">
              <span>ProcureFlow · Autonomous Approval Hub</span>
              <button
                type="button"
                onClick={() => setShowNoticeModal(false)}
                className="px-4 py-1.5 bg-gray-900 hover:bg-gray-800 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
