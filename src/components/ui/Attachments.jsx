import React, { useRef, useState } from 'react';
import { Archive, Download, FileText, History, Paperclip, ShieldCheck, Trash2, Upload } from 'lucide-react';
import { api, download } from '../../api/client';
import { dateTime } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useAction } from '../../hooks/useApi';

import {
  ACCEPT,
  ALLOWED_EXTS,
  MAX_ATTACHMENT_BYTES,
  formatFileSize as size,
  validateUploadFile,
  withHistory,
} from '../../utils/attachmentUtils.js';

export { ACCEPT, ALLOWED_EXTS, MAX_ATTACHMENT_BYTES, size, validateUploadFile, withHistory };

/**
 * Files on a request or issue with full versioning, SHA-256 integrity,
 * replacement history and auditable archival.
 */
export const Attachments = ({ files = [], uploadPath, canDelete = () => false, canReplace = false }) => {
  const { showToast } = useApp();
  const { run, busy } = useAction();
  const input = useRef(null);
  const replaceInput = useRef(null);
  const [replacing, setReplacing] = useState(null);
  const [openHistory, setOpenHistory] = useState({});

  const upload = async (file) => {
    const error = validateUploadFile(file);
    if (error) {
      showToast(error, 'error');
      if (input.current) input.current.value = '';
      return;
    }
    const form = new FormData();
    form.append('file', file);
    await run(() => api(uploadPath, { method: 'POST', form }), `Attached ${file.name}`);
    if (input.current) input.current.value = '';
  };

  const replace = async (file) => {
    const error = validateUploadFile(file);
    if (error) {
      showToast(error, 'error');
      if (replaceInput.current) replaceInput.current.value = '';
      setReplacing(null);
      return;
    }

    const reason = window.prompt(
      `Upload replacement for document? Enter reason (e.g. Revised quote with vendor discount):`,
    );
    // Cancelling the prompt cancels replacement, protecting against accidental replacement
    if (reason !== null) {
      const form = new FormData();
      form.append('file', file);
      if (reason.trim()) form.append('reason', reason.trim());
      await run(
        () => api(`/api/attachments/${replacing}/supersede`, { method: 'POST', form }),
        `Replaced with ${file.name}`,
      );
    }
    setReplacing(null);
    if (replaceInput.current) replaceInput.current.value = '';
  };

  const handleRemove = async (f) => {
    const confirmed = window.confirm(`Are you sure you want to remove "${f.fileName}"?`);
    if (!confirmed) return;
    await run(() => api(`/api/attachments/${f.id}`, { method: 'DELETE' }), 'File removed');
  };

  const fetchFile = (f) => download(`/api/attachments/${f.id}`, f.fileName).catch((e) => showToast(e.message, 'error'));

  const current = withHistory(files);

  return (
    <div className="space-y-2">
      {current.length === 0 && <p className="text-xs text-gray-400">No documents attached.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {current.map((f) => (
          <div key={f.id} className="rounded-lg bg-white border border-gray-200 shadow-sm transition-all hover:border-gray-300">
            <div className="p-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs font-semibold text-gray-800 truncate" title={f.originalFileName || f.fileName}>
                      {f.fileName}
                    </p>
                    {f.versionNumber > 1 && (
                      <span className="inline-flex items-center px-1.5 py-0.2 text-[9px] font-bold rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                        v{f.versionNumber}
                      </span>
                    )}
                    {f.sha256 && (
                      <span
                        className="inline-flex items-center gap-0.5 px-1 py-0.2 text-[9px] rounded font-mono bg-gray-100 text-gray-600"
                        title={`SHA-256: ${f.sha256}`}
                      >
                        <ShieldCheck className="w-2.5 h-2.5 text-emerald-600 inline" />
                        {f.sha256.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 truncate mt-0.5">
                    {size(f.sizeBytes)} · {f.uploadedBy?.name} · {dateTime(f.uploadedAt)}
                    {f.requestVersionNumber > 1 ? ` · Req v${f.requestVersionNumber}` : ''}
                  </p>
                  {f.replacementReason && (
                    <p className="text-[10px] text-amber-700 truncate mt-0.5 font-medium" title={f.replacementReason}>
                      Replaced: {f.replacementReason}
                    </p>
                  )}
                  {f.archivedAt && (
                    <p className="text-[10px] text-rose-600 truncate mt-0.5 flex items-center gap-1">
                      <Archive className="w-2.5 h-2.5 inline" /> Archived: {f.archivedReason || 'Archived'}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center shrink-0 gap-0.5">
                {f.earlier.length > 0 && (
                  <button
                    onClick={() => setOpenHistory((h) => ({ ...h, [f.id]: !h[f.id] }))}
                    aria-label={`Earlier versions of ${f.fileName}`}
                    title={`${f.earlier.length} earlier version(s)`}
                    className={`p-1.5 rounded transition-colors ${openHistory[f.id] ? 'bg-indigo-50 text-indigo-600' : 'text-gray-400 hover:text-indigo-600 hover:bg-gray-100'}`}
                  >
                    <History className="w-4 h-4" />
                  </button>
                )}
                {canReplace && !f.archivedAt && (
                  <button
                    onClick={() => {
                      setReplacing(f.id);
                      replaceInput.current?.click();
                    }}
                    aria-label={`Replace ${f.fileName}`}
                    title="Upload a newer version (supersede)"
                    className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-100 transition-colors"
                  >
                    <Upload className="w-4 h-4" />
                  </button>
                )}
                {!f.archivedAt && (
                  <button
                    onClick={() => fetchFile(f)}
                    aria-label={`Download ${f.fileName}`}
                    title="Download document"
                    className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-100 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                )}
                {canDelete(f) && !f.archivedAt && (
                  <button
                    onClick={() => handleRemove(f)}
                    aria-label={`Remove ${f.fileName}`}
                    title="Remove document"
                    className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {openHistory[f.id] && f.earlier.length > 0 && (
              <ol className="border-t border-gray-100 bg-gray-50/80 rounded-b-lg">
                {f.earlier.map((old) => (
                  <li key={old.id} className="px-3 py-2 flex items-center justify-between gap-2 border-b border-gray-100 last:border-0">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold text-gray-500 bg-gray-200/80 px-1 rounded">
                          v{old.versionNumber}
                        </span>
                        <p className="text-[11px] text-gray-700 truncate" title={old.fileName}>
                          {old.fileName}
                        </p>
                        {old.sha256 && (
                          <span
                            className="text-[9px] font-mono text-gray-400"
                            title={`SHA-256: ${old.sha256}`}
                          >
                            ({old.sha256.slice(0, 6)}…)
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 truncate mt-0.5">
                        {size(old.sizeBytes)} · {old.uploadedBy?.name} · {dateTime(old.uploadedAt)}
                        {old.requestVersionNumber > 1 ? ` · Req v${old.requestVersionNumber}` : ''}
                      </p>
                      {old.replacementReason && (
                        <p className="text-[9px] text-amber-700 truncate italic">
                          Superseded: {old.replacementReason}
                        </p>
                      )}
                    </div>
                    {!old.archivedAt && (
                      <button
                        onClick={() => fetchFile(old)}
                        aria-label={`Download v${old.versionNumber} ${old.fileName}`}
                        title="Download historical version"
                        className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-white shrink-0 border border-transparent hover:border-gray-200 shadow-none hover:shadow-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>

      {canReplace && (
        <input
          ref={replaceInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => e.target.files[0] && replace(e.target.files[0])}
        />
      )}

      {uploadPath && (
        <label className={`inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 cursor-pointer hover:underline ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
          <Paperclip className="w-3.5 h-3.5" /> {busy ? 'Uploading…' : 'Attach a document'}
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => e.target.files[0] && upload(e.target.files[0])} />
          <span className="font-normal text-gray-400 no-underline">PDF, image, Word or Excel · up to 10 MB</span>
        </label>
      )}
    </div>
  );
};
