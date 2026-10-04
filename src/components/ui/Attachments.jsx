import React, { useRef, useState } from 'react';
import { Download, FileText, History, Paperclip, Trash2, Upload } from 'lucide-react';
import { api, download } from '../../api/client';
import { dateTime } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useAction } from '../../hooks/useApi';

export const ACCEPT = '.pdf,.png,.jpg,.jpeg,.docx,.xlsx';

const size = (bytes) =>
  bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Walks the supersede chain backwards from each current file. A replaced
 * document keeps its row and points at its replacement, so the earlier
 * versions are whatever leads to the file on screen.
 */
function withHistory(files = []) {
  const list = files || [];
  const replacedBy = new Map();
  for (const f of list) if (f.supersededById) replacedBy.set(f.supersededById, f);
  return list
    .filter((f) => !f.supersededById)
    .map((f) => {
      const earlier = [];
      for (let prev = replacedBy.get(f.id); prev; prev = replacedBy.get(prev.id)) earlier.push(prev);
      return { ...f, earlier };
    });
}

/**
 * Files on a request or issue. `uploadPath` is where new files go (omit to hide
 * uploading); `canDelete(file)` decides per file; `canReplace` offers a new
 * version of an existing file instead of deleting it. The server enforces all
 * three.
 */
export const Attachments = ({ files = [], uploadPath, canDelete = () => false, canReplace = false }) => {
  const { showToast } = useApp();
  const { run, busy } = useAction();
  const input = useRef(null);
  const replaceInput = useRef(null);
  const [replacing, setReplacing] = useState(null);
  const [openHistory, setOpenHistory] = useState({});

  const upload = async (file) => {
    const form = new FormData();
    form.append('file', file);
    await run(() => api(uploadPath, { method: 'POST', form }), `Attached ${file.name}`);
    if (input.current) input.current.value = '';
  };

  const replace = async (file) => {
    const reason = window.prompt('Why is this document being replaced? (optional)');
    // Cancelling the prompt cancels the replacement, not just the reason.
    if (reason !== null) {
      const form = new FormData();
      form.append('file', file);
      if (reason.trim()) form.append('reason', reason.trim());
      await run(() => api(`/api/attachments/${replacing}/supersede`, { method: 'POST', form }),
        `Replaced with ${file.name}`);
    }
    setReplacing(null);
    if (replaceInput.current) replaceInput.current.value = '';
  };

  const fetchFile = (f) => download(`/api/attachments/${f.id}`, f.fileName).catch((e) => showToast(e.message, 'error'));

  const current = withHistory(files);

  return (
    <div className="space-y-2">
      {current.length === 0 && <p className="text-xs text-gray-400">No documents attached.</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {current.map((f) => (
          <div key={f.id} className="rounded-lg bg-white border border-gray-200">
            <div className="p-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="w-4 h-4 text-indigo-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-gray-800 truncate">
                    {f.fileName}
                    {f.versionNumber > 1 && (
                      <span className="ml-1.5 text-[10px] font-bold text-indigo-600">v{f.versionNumber}</span>
                    )}
                  </p>
                  <p className="text-[10px] text-gray-400 truncate">{size(f.sizeBytes)} · {f.uploadedBy?.name} · {dateTime(f.uploadedAt)}</p>
                  {f.replacementReason && (
                    <p className="text-[10px] text-amber-700 truncate">Replaced because: {f.replacementReason}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center shrink-0">
                {f.earlier.length > 0 && (
                  <button onClick={() => setOpenHistory((h) => ({ ...h, [f.id]: !h[f.id] }))}
                    aria-label={`Earlier versions of ${f.fileName}`} title={`${f.earlier.length} earlier version(s)`}
                    className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-100">
                    <History className="w-4 h-4" />
                  </button>
                )}
                {canReplace && (
                  <button onClick={() => { setReplacing(f.id); replaceInput.current?.click(); }}
                    aria-label={`Replace ${f.fileName}`} title="Upload a newer version"
                    className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-100">
                    <Upload className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => fetchFile(f)} aria-label={`Download ${f.fileName}`} className="p-1.5 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-100">
                  <Download className="w-4 h-4" />
                </button>
                {canDelete(f) && (
                  <button
                    onClick={() => run(() => api(`/api/attachments/${f.id}`, { method: 'DELETE' }), 'File removed')}
                    aria-label={`Remove ${f.fileName}`}
                    className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {openHistory[f.id] && f.earlier.length > 0 && (
              <ol className="border-t border-gray-100 bg-gray-50/70 rounded-b-lg">
                {f.earlier.map((old) => (
                  <li key={old.id} className="px-3 py-2 flex items-center justify-between gap-2 border-b border-gray-100 last:border-0">
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-600 truncate">
                        <span className="font-semibold text-gray-500">v{old.versionNumber}</span> {old.fileName}
                      </p>
                      <p className="text-[10px] text-gray-400 truncate">
                        {old.uploadedBy?.name} · {dateTime(old.uploadedAt)}
                        {old.requestVersionNumber > 1 ? ` · request version ${old.requestVersionNumber}` : ''}
                      </p>
                    </div>
                    <button onClick={() => fetchFile(old)} aria-label={`Download ${old.fileName}`}
                      className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-100 shrink-0">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>

      {canReplace && (
        <input ref={replaceInput} type="file" accept={ACCEPT} className="hidden"
          onChange={(e) => e.target.files[0] && replace(e.target.files[0])} />
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
