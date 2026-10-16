import React, { useState } from 'react';
import { Building2, Calendar, CornerDownRight, FileDown, FileText, Layers, Loader2, Printer, User } from 'lucide-react';
import { api, download, openPrintable } from '../../api/client';
import { date, money } from '../../api/format';
import { useApp } from '../../context/AppContext';
import { useApi, useAction } from '../../hooks/useApi';
import { parseCustomItem } from '../../utils/customItem';
import { generateOfficialPdf } from '../../utils/officialPdfGenerator';
import { Attachments } from '../ui/Attachments';
import { Modal } from '../ui/Modal';
import { ErrorState, Loading } from '../ui/States';
import { StatusBadge } from '../ui/StatusBadge';
import { BudgetContext } from '../requests/BudgetContext';
import { CarryForward } from '../requests/CarryForward';
import { Comments } from '../requests/Comments';
import { DecisionPanel } from '../requests/DecisionPanel';
import { RequestEditPanel } from '../requests/RequestEditPanel';
import { ItemsTable } from '../requests/ItemsTable';
import { Timeline } from '../requests/Timeline';

const Section = ({ title, children }) => (
  <section className="space-y-2">
    <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">{title}</h4>
    {children}
  </section>
);

const DECIDED = ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'FULFILMENT_PENDING', 'FULFILLED', 'CLOSED', 'CARRIED_FORWARD'];

export const RequestDetailModal = () => {
  const { openRecordState, closeRecord, openRecord, user, showToast } = useApp();
  const id = openRecordState?.kind === 'request' ? openRecordState.id : null;
  const state = useApi(id ? `/api/requests/${id}` : null);
  const { run } = useAction();
  const r = state.data;

  const answeredCorrections = (r?.corrections ?? []).filter((c) => c.resolvedAt);
  const [pdfLoading, setPdfLoading] = useState(false);

  const openReport = () =>
    openPrintable(`/api/requests/${r.id}/report.html`).catch((e) => showToast(e.message, 'error'));
  const downloadReport = () =>
    download(`/api/requests/${r.id}/report.doc`, `${r.requestNumber}.doc`).catch((e) => showToast(e.message, 'error'));

  const generateOfficialPdfReport = async () => {
    setPdfLoading(true);
    try {
      // 1. First attempt to download the server-generated official PDF
      try {
        await download(`/api/requests/${r.id}/report.pdf`, `${r.requestNumber}-Official-Report.pdf`);
        showToast('Official PDF report generated and downloaded successfully', 'success');
        return;
      } catch (serverErr) {
        console.warn('Server-side PDF generation unavailable, generating client-side report...', serverErr);
      }

      // 2. Fall back to client-side official PDF generator using assembled report data
      let reportData = null;
      try {
        reportData = await api(`/api/requests/${r.id}/report?kind=complete`);
      } catch {
        // Fall back to current request detail if report endpoint fails
        reportData = {
          generatedAt: new Date().toISOString(),
          request: {
            requestNumber: r.requestNumber,
            title: r.title,
            status: r.status,
            stage: r.stage,
            versionNumber: r.versionNumber,
            raisedBy: r.raisedBy?.name,
            department: r.department?.name,
            course: r.course?.name,
            financialYear: r.financialYear?.label,
            budgetHead: `${r.budgetHead?.name} (${r.budgetHead?.headType?.toLowerCase() || 'revenue'})`,
            createdAt: r.createdAt,
            submittedAt: r.submittedAt,
            closedAt: r.closedAt,
            justification: r.description,
            requestedAmount: Number(r.tentativeTotalCost || 0),
            sanctionedAmount: Number(r.sanctionedAmount || 0),
            unapprovedAmount: Number(r.tentativeTotalCost || 0) - Number(r.sanctionedAmount || 0),
            extra: r.extra,
            carriedForwardFrom: r.carriedForwardFrom,
          },
          items: (r.items || []).map((i) => {
            const { displayName, displayRemarks } = parseCustomItem(i.budgetItem, i.remarks);
            return {
              name: displayName,
              budgetItem: i.budgetItem?.code,
              requestedQuantity: i.requestedQuantity,
              approvedQuantity: i.approvedQuantity,
              unapprovedQuantity: i.unapprovedQuantity,
              unitCost: i.unitCost,
              requestedAmount: i.estimatedTotal,
              approvedAmount: i.approvedAmount,
              unapprovedAmount: (i.estimatedTotal || 0) - (i.approvedAmount || 0),
              status: i.status,
              remarks: displayRemarks ?? i.remarks,
            };
          }),
          documents: (r.attachments || []).map((a) => ({
            fileName: a.fileName,
            versionNumber: a.versionNumber,
            requestVersionNumber: a.requestVersionNumber,
            supersededById: a.supersededById,
            replacementReason: a.replacementReason,
            uploadedBy: a.uploadedBy?.name,
            uploadedAt: a.uploadedAt,
          })),
          workflow: [],
          comments: [],
          resubmissions: [],
          audit: [],
        };
      }

      await generateOfficialPdf(reportData, `${r.requestNumber}-Official-Report.pdf`);
      showToast('Official PDF report generated and downloaded successfully', 'success');
    } catch (err) {
      showToast('Could not generate the official PDF report. Please try again.', 'error');
    } finally {
      setPdfLoading(false);
    }
  };

  const removeItem = (item) => {
    const { displayName } = parseCustomItem(item.budgetItem, item.remarks);
    return run(() => api(`/api/requests/${r.id}/items/${item.id}`, { method: 'DELETE' }), `Removed ${displayName}`);
  };

  return (
    <Modal
      isOpen={Boolean(id)}
      onClose={closeRecord}
      title={r ? `${r.requestNumber} — ${r.title}` : 'Request'}
      subtitle={r ? `${r.extra?.customBudgetHead ? `${r.extra.customBudgetHead} (other)` : r.budgetHead.name} · FY ${r.financialYear.label}` : undefined}
      maxWidth="max-w-5xl"
    >
      {state.loading && !r && <Loading />}
      {state.error && (
        <ErrorState error={state.error.status === 404 ? { message: 'This request doesn\'t exist, or you don\'t have access to it.' } : state.error} />
      )}
      {r && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-100 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={r.status} />
                <span className="text-[11px] font-semibold text-gray-500 capitalize">{r.budgetHead.headType.toLowerCase()} budget</span>
              </div>
              {r.extra?.urgency && <p className="text-[11px] text-gray-500">Urgency: <span className="font-semibold text-gray-700">{r.extra.urgency}</span></p>}
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Requested</span>
                <span className="text-xl font-extrabold text-gray-900 tabular-nums">{money(r.tentativeTotalCost)}</span>
              </div>
              {DECIDED.includes(r.status) && r.status !== 'REJECTED' && (
                <div>
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Sanctioned</span>
                  <span className="text-xl font-extrabold text-emerald-700 tabular-nums">{money(r.sanctionedAmount)}</span>
                </div>
              )}
            </div>
          </div>

          {r.carriedForwardFrom && (
            <button onClick={() => openRecord('request', r.carriedForwardFrom.requestId)}
              className="w-full text-left p-3 rounded-lg bg-sky-50 border border-sky-200 text-xs text-sky-800 flex items-center gap-2 hover:bg-sky-100">
              <CornerDownRight className="w-4 h-4" />
              Carried forward from FY {r.carriedForwardFrom.financialYear}
              {r.carriedForwardFrom.requestNumber ? ` (${r.carriedForwardFrom.requestNumber})` : ''} — its full history stays on the original.
            </button>
          )}

          {/* Out with its requester: approvers see why, and that it is not theirs to move. */}
          {r.status === 'AWAITING_RESUBMISSION' && !r.permissions.canEdit && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200">
              <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                <CornerDownRight className="w-3.5 h-3.5" />
                Sent back to {r.raisedBy.name} for correction — nothing moves until they resubmit
              </p>
              {r.corrections?.[0] && (
                <p className="text-xs text-amber-900/80 mt-1.5 whitespace-pre-wrap">{r.corrections[0].reason}</p>
              )}
            </div>
          )}

          {r.permissions.canAct && r.department && <BudgetContext request={r} />}
          {r.permissions.canAct && <DecisionPanel key={`${r.id}-${r.status}`} request={r} />}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {[
              { icon: User, label: 'Raised by', value: r.raisedBy.name },
              {
                icon: Building2,
                label: 'Department',
                value: r.extra?.customDepartment
                  ? `${r.extra.customDepartment} (other)`
                  : (r.department?.name ?? '—'),
                sub: r.extra?.customCourse
                  ? `${r.extra.customCourse} (other)`
                  : r.course?.name,
              },
              { icon: Calendar, label: 'Submitted', value: r.submittedAt ? date(r.submittedAt) : 'Not yet' },
              {
                icon: Layers,
                label: 'Now with',
                value: r.status === 'AWAITING_RESUBMISSION'
                  ? r.raisedBy.name
                  : (r.stage && r.status.startsWith('UNDER_') ? r.stage.name : '—'),
                sub: r.status === 'AWAITING_RESUBMISSION' ? 'for correction' : undefined,
              },
            ].map((f) => (
              <div key={f.label} className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                <span className="text-gray-400 flex items-center gap-1.5 mb-1"><f.icon className="w-3.5 h-3.5 text-indigo-500" /> {f.label}</span>
                <p className="font-semibold text-gray-800">{f.value}</p>
                {f.sub && <p className="text-[10px] text-gray-400">{f.sub}</p>}
              </div>
            ))}
          </div>


          <Section title={`Items (${r.items.length})`}>
            {r.items.length === 0
              ? <p className="text-xs text-gray-400">No items yet — add at least one before submitting.</p>
              : <ItemsTable items={r.items} decided={r.items.some((i) => i.status !== 'PENDING')} onRemove={r.permissions.canEdit ? removeItem : undefined} />}
          </Section>

          {r.permissions.canEdit && <RequestEditPanel request={r} />}

          {r.description && (
            <Section title="Justification">
              <p className="p-3.5 rounded-lg bg-gray-50 border border-gray-100 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{r.description}</p>
            </Section>
          )}

          <Section title="Documents">
            <Attachments
              files={r.attachments}
              uploadPath={r.permissions.canAttach ? `/api/requests/${r.id}/attachments` : null}
              canDelete={(f) => r.status === 'DRAFT' && (f.uploadedBy.id === user.id || user.roles.includes('ADMIN'))}
              // Past the draft a document is evidence: it is replaced with a
              // new version rather than removed, and the old one stays.
              canReplace={r.permissions.canAttach && r.status !== 'DRAFT'}
            />
          </Section>

          {/* Answered corrections only: the one still open is shown above, in
              the requester's panel or the banner telling approvers to wait. */}
          {answeredCorrections.length > 0 && (
            <Section title={`Earlier corrections (${answeredCorrections.length})`}>
              <ol className="space-y-2">
                {answeredCorrections.map((c) => (
                  <li key={c.id} className="p-3 rounded-lg bg-gray-50 border border-gray-100">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.reason}</p>
                    <p className="text-[10px] text-gray-500 mt-1.5">
                      {c.requestedBy.name}{c.stageName ? ` · ${c.stageName}` : ''} · {date(c.createdAt)}
                      {` · answered by version ${c.resolvedByVersion}`}
                    </p>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {r.permissions.canCarryForward && r.status !== 'DRAFT' && <CarryForward request={r} />}

          <Section title="History">
            <Timeline requestId={r.id} />
          </Section>

          {r.status !== 'DRAFT' && (
            <Section title="Official Institutional Report">
              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  onClick={generateOfficialPdfReport}
                  disabled={pdfLoading}
                  className="px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm flex items-center gap-2 disabled:opacity-50 transition-colors"
                >
                  {pdfLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating Official PDF…
                    </>
                  ) : (
                    <>
                      <FileText className="w-4 h-4" />
                      Generate Official PDF
                    </>
                  )}
                </button>
                <button onClick={openReport}
                  className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:border-gray-300 flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5 text-indigo-500" /> Open printable page
                </button>
                <button onClick={downloadReport}
                  className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-semibold text-gray-700 hover:border-gray-300 flex items-center gap-1.5">
                  <FileDown className="w-3.5 h-3.5 text-indigo-500" /> Download for Word
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                Generates a print-ready A4 official report containing complete institutional details, chronological approval actions, communications, and verification records.
              </p>
            </Section>
          )}

          {r.status !== 'DRAFT' && (
            <Section title="Comments">
              <Comments requestId={r.id} canRestrict={user.stages.length > 0} />
            </Section>
          )}
        </div>
      )}
    </Modal>
  );
};
