import React, { useState } from 'react';
import { Paperclip, X } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { ACCEPT } from '../ui/Attachments';
import { Modal } from '../ui/Modal';

// Deliberately lightweight (requirements §3.2): free text, no categories.
export const NewIssueModal = () => {
  const { modals, closeModal, showToast, refresh, openRecord } = useApp();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);

  const close = () => { closeModal('newIssue'); setTitle(''); setDescription(''); setFile(null); };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const issue = await api('/api/issues', { method: 'POST', body: { title: title.trim(), description: description.trim() } });
      let message = `${issue.issueNumber} logged — the Principal has been notified`;
      if (file) {
        const upload = new FormData();
        upload.append('file', file);
        try {
          await api(`/api/issues/${issue.id}/attachments`, { method: 'POST', form: upload });
        } catch (err) {
          message += `, but the file wasn't attached: ${err.message}`;
        }
      }
      showToast(message, 'success');
      close();
      refresh();
      openRecord('issue', issue.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-white border border-gray-200 rounded-lg px-3.5 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

  return (
    <Modal isOpen={modals.newIssue} onClose={close} title="Log an issue" subtitle="Maintenance, facilities or anything else that needs the Principal's attention — not purchases.">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label htmlFor="issue-title" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">What's the issue? *</label>
          <input id="issue-title" required minLength={3} maxLength={200} className={inputCls}
            placeholder="e.g. Wi-Fi drops out in Room B-204" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label htmlFor="issue-desc" className="block text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1.5">Details *</label>
          <textarea id="issue-desc" required rows={4} maxLength={5000} className={inputCls}
            placeholder="Where, since when, and how it affects teaching or students." value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {file ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gray-100 text-xs text-gray-700">
              <Paperclip className="w-3 h-3" /> {file.name}
              <button type="button" onClick={() => setFile(null)} aria-label="Remove file" className="text-gray-400 hover:text-red-600"><X className="w-3 h-3" /></button>
            </span>
          ) : (
            <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 cursor-pointer hover:underline">
              <Paperclip className="w-3.5 h-3.5" /> Attach a photo or document
              <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => setFile(e.target.files[0] ?? null)} />
            </label>
          )}
          <span className="text-[11px] text-gray-400">optional</span>
        </div>
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-100">
          <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100">Cancel</button>
          <button type="submit" disabled={saving} className="px-5 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
            {saving ? 'Logging…' : 'Log issue'}
          </button>
        </div>
      </form>
    </Modal>
  );
};
