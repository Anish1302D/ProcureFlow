import PDFDocument from 'pdfkit';
import { parseCustomItem } from './customItem.js';

/**
 * Format date to Indian Standard Time: DD/MM/YYYY HH:MM IST
 */
export function formatIST(dateInput) {
  if (!dateInput) return '—';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const find = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${find('day')}/${find('month')}/${find('year')} ${find('hour')}:${find('minute')} IST`;
}

/**
 * Format currency with Indian digit grouping and Rs. prefix
 */
export function formatMoney(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return '—';
  return 'Rs. ' + Number(val).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Clean & sanitize text for PDF output
 */
function clean(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\u00A0-\u024F]/g, ' ').trim();
}

/**
 * Generates an official, print-ready institutional PDF report conforming to SP College specifications.
 * Streams directly to output stream or returns a promise resolving to a Buffer.
 */
export async function generatePdfReport(report, _spec = {}, streamOrRes = null) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: { top: 40, bottom: 45, left: 36, right: 36 },
        bufferPages: true,
        info: {
          Title: `${report.request.requestNumber} — Official Institutional Approval Report`,
          Author: 'S.P. College Approval Hub',
          Subject: 'Official Institutional Procurement & Workflow Report',
          Keywords: 'SP College, Approval Hub, Procurement, Audit, Official Report',
          CreationDate: new Date(),
        },
      });

      const chunks = [];
      if (streamOrRes && typeof streamOrRes.write === 'function') {
        doc.pipe(streamOrRes);
      } else {
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
      }

      if (streamOrRes && typeof streamOrRes.on === 'function') {
        streamOrRes.on('finish', () => resolve());
        streamOrRes.on('error', (err) => reject(err));
      }

      doc.on('error', (err) => reject(err));

      const left = 36;
      const right = 559; // 595.28 - 36
      const contentWidth = right - left; // 523pt
      const maxY = 760; // Safe bottom limit before page break to avoid overflow

      const r = report.request;
      const items = report.items || [];
      const budget = report.budget;
      const workflow = report.workflow || [];
      const comments = report.comments || [];
      const documents = report.documents || [];
      const resubmissions = report.resubmissions || [];
      const _audit = report.audit || [];
      const decision = report.decision || {};
      const auditSummary = report.auditSummary || {
        reportId: r.requestNumber,
        generatedAt: report.generatedAt || new Date().toISOString(),
        updatedAt: r.closedAt || r.submittedAt || r.createdAt,
        totalEvents: workflow.length,
        totalMessages: comments.length,
        totalDocuments: documents.length,
        reportVersion: `v${r.versionNumber || 1}.0`,
      };

      // -------------------------------------------------------------------------
      // TABLE HELPER WITH AUTOMATIC PAGE BREAKS & REPEATING HEADERS
      // -------------------------------------------------------------------------
      function renderTable({ headers, rows, colWidths, alignments = [], headerBg = '#1E3A8A', headerColor = '#FFFFFF' }) {
        const startX = left;
        const totalW = colWidths.reduce((a, b) => a + b, 0);

        function drawHeaderRow() {
          const headerH = 17;
          const headerY = doc.y;
          doc.rect(startX, headerY, totalW, headerH).fill(headerBg);
          let curX = startX;
          headers.forEach((h, idx) => {
            const w = colWidths[idx];
            const align = alignments[idx] || 'left';
            doc.fillColor(headerColor).fontSize(7).font('Helvetica-Bold');
            doc.text(h, curX + 3, headerY + 4.5, { width: w - 6, align, lineBreak: false });
            curX += w;
          });
          doc.y = headerY + headerH;
        }

        // Draw initial table header
        if (doc.y + 45 > maxY) {
          doc.addPage();
        }
        drawHeaderRow();

        // Draw data rows
        rows.forEach((row, rowIdx) => {
          // Calculate max cell height in this row
          doc.fontSize(7).font('Helvetica');
          let maxCellH = 14;
          row.forEach((cell, idx) => {
            const w = colWidths[idx];
            const text = String(cell || '—');
            const h = doc.heightOfString(text, { width: w - 6 });
            if (h + 8 > maxCellH) maxCellH = h + 8;
          });

          // Check for page overflow
          if (doc.y + maxCellH > maxY) {
            doc.addPage();
            drawHeaderRow();
          }

          const rowY = doc.y;
          // Row background
          const bg = rowIdx % 2 === 1 ? '#F8FAFC' : '#FFFFFF';
          doc.rect(startX, rowY, totalW, maxCellH).fill(bg);

          // Row borders
          doc.rect(startX, rowY, totalW, maxCellH).strokeColor('#E2E8F0').lineWidth(0.5).stroke();

          // Cell text
          let curX = startX;
          row.forEach((cell, idx) => {
            const w = colWidths[idx];
            const align = alignments[idx] || 'left';
            const isTotalRow = row.isTotal;
            doc.fillColor('#1E293B').fontSize(7).font(isTotalRow ? 'Helvetica-Bold' : 'Helvetica');
            doc.text(String(cell || '—'), curX + 3, rowY + 4, {
              width: w - 6,
              align,
            });
            curX += w;
          });

          doc.y = rowY + maxCellH;
        });

        doc.y += 6; // Spacing after table
      }

      function ensureSpace(heightNeeded) {
        if (doc.y + heightNeeded > maxY) {
          doc.addPage();
        }
      }

      function drawSectionTitle(secNum, title) {
        ensureSpace(70); // Ensure section header never sits alone at bottom
        doc.y += 3;
        const barY = doc.y;
        doc.rect(left, barY, contentWidth, 16).fill('#F1F5F9');
        doc.fillColor('#1E3A8A').fontSize(8.5).font('Helvetica-Bold');
        doc.text(`${secNum}. ${title.toUpperCase()}`, left + 8, barY + 4, { lineBreak: false });
        doc.y = barY + 19;
      }

      // -------------------------------------------------------------------------
      // COVER / HEADER (PAGE 1)
      // -------------------------------------------------------------------------
      // Institutional Crest & Header
      doc.fillColor('#1E293B').fontSize(8.5).font('Helvetica-Bold').text("SHIKSHANA PRASARAKA MANDALI'S", left, doc.y, { align: 'center', characterSpacing: 0.5 });
      doc.moveDown(0.2);
      doc.fillColor('#1E3A8A').fontSize(13.5).font('Helvetica-Bold').text('SIR PARASHURAMBHAU COLLEGE', { align: 'center' });
      doc.moveDown(0.15);
      doc.fillColor('#475569').fontSize(9).font('Helvetica-BoldOblique').text('(Empowered Autonomous)', { align: 'center' });
      doc.moveDown(0.15);
      doc.fillColor('#64748B').fontSize(7.5).font('Helvetica').text('Tilak Road, Sadashiv Peth, Pune – 411030, Maharashtra, India', { align: 'center' });
      doc.moveDown(0.4);

      // Header Rule
      doc.rect(left, doc.y, contentWidth, 1.5).fill('#1E3A8A');
      doc.y += 2.5;
      doc.rect(left, doc.y, contentWidth, 0.5).fill('#D97706');
      doc.y += 7;

      // -------------------------------------------------------------------------
      // 1. REPORT COVER / IDENTIFICATION
      // -------------------------------------------------------------------------
      const bannerY = doc.y;
      doc.rect(left, bannerY, contentWidth, 50).fillAndStroke('#F8FAFC', '#CBD5E1');

      doc.fillColor('#0F172A').fontSize(10.5).font('Helvetica-Bold');
      doc.text('OFFICIAL INSTITUTIONAL APPROVAL REPORT', left + 10, bannerY + 7, { align: 'left', lineBreak: false });

      doc.fillColor('#64748B').fontSize(7.5).font('Helvetica');
      doc.text('Autonomous Institution Procurement & Workflow Verification Record', left + 10, bannerY + 20, { lineBreak: false });

      // Status pill on the right of banner
      const statusColor = r.status === 'APPROVED' ? '#166534' : r.status === 'REJECTED' ? '#991B1B' : '#854D0E';
      const statusBg = r.status === 'APPROVED' ? '#DCFCE7' : r.status === 'REJECTED' ? '#FEE2E2' : '#FEF3C7';
      const statusText = (r.status || 'SUBMITTED').replace(/_/g, ' ');
      doc.rect(right - 145, bannerY + 7, 135, 17).fill(statusBg);
      doc.fillColor(statusColor).fontSize(8).font('Helvetica-Bold').text(statusText, right - 145, bannerY + 11.5, { width: 135, align: 'center', lineBreak: false });

      // Metadata 4-box line inside banner
      const metaY = bannerY + 34;
      doc.fillColor('#334155').fontSize(7).font('Helvetica');
      doc.text(`Report ID: ${r.requestNumber}`, left + 10, metaY, { lineBreak: false });
      doc.text(`Generated: ${formatIST(report.generatedAt)}`, left + 130, metaY, { lineBreak: false });
      doc.text(`Period: ${r.financialYear}`, left + 295, metaY, { lineBreak: false });
      doc.text(`Current Stage: ${r.stage?.name || 'Review Stage'}`, left + 395, metaY, { lineBreak: false });

      doc.y = bannerY + 56;

      // -------------------------------------------------------------------------
      // 2. REPORT / APPLICANT DETAILS
      // -------------------------------------------------------------------------
      drawSectionTitle('1', 'Report & Applicant Details');

      // Key-Value Grid for applicant & request info
      const details = [
        ['Request Title', r.title || '—'],
        ['Request ID / Number', r.requestNumber || '—'],
        ['Applicant / Raised By', r.raisedBy || r.requesterName || r.requester || '—'],
        ['Department', r.department || '—'],
        ['Course & Funding', `${r.course || 'General'} (${r.course?.includes('Non-Grant') ? 'Non-Grant' : 'Grant'})`],
        ['Financial Year', r.financialYear || '—'],
        ['Budget Head & Type', r.budgetHead || '—'],
        ['Date Created', formatIST(r.createdAt)],
        ['Date Submitted', formatIST(r.submittedAt)],
        ['Decision / Closed Date', r.closedAt ? formatIST(r.closedAt) : 'Pending Final Decision'],
        ['Current Version', `Version ${r.versionNumber || 1}`],
        ['Urgency Level', clean(r.extra?.urgency) || 'Normal'],
      ];

      // Two column key-value display
      const colW = (contentWidth - 10) / 2;
      doc.fontSize(7);
      details.forEach(([k, v], idx) => {
        const isLeft = idx % 2 === 0;
        const curX = isLeft ? left : left + colW + 10;
        const curY = isLeft ? doc.y : doc.y - 13;

        doc.font('Helvetica-Bold').fillColor('#475569').text(`${k}:`, curX, curY, { width: 95, lineBreak: false });
        doc.font('Helvetica').fillColor('#0F172A').text(v, curX + 97, curY, { width: colW - 97, lineBreak: false });

        if (!isLeft || idx === details.length - 1) {
          doc.y += 13;
        }
      });

      // Justification box
      if (r.justification) {
        doc.y += 2;
        ensureSpace(32);
        const justY = doc.y;
        doc.rect(left, justY, contentWidth, 13).fill('#F1F5F9');
        doc.font('Helvetica-Bold').fontSize(7).fillColor('#334155').text('Justification & Statement of Need:', left + 6, justY + 3, { lineBreak: false });
        doc.y = justY + 14;
        const descH = doc.heightOfString(r.justification, { width: contentWidth - 12 });
        doc.rect(left, doc.y, contentWidth, descH + 6).fillAndStroke('#FAFAFA', '#E2E8F0');
        doc.font('Helvetica').fontSize(7).fillColor('#1E293B').text(r.justification, left + 6, doc.y + 3, { width: contentWidth - 12 });
        doc.y += descH + 9;
      }

      // 2.A Item Details Table
      doc.y += 2;
      ensureSpace(45);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1E3A8A').text('Itemised Requirements & Sanction Breakdown:', left, doc.y);
      doc.y += 5;

      const itemHeaders = ['#', 'Item Description', 'Budget Code', 'Qty Req', 'Qty Appr', 'Unit Cost', 'Requested', 'Sanctioned', 'Status'];
      const itemWidths = [18, 142, 52, 42, 42, 54, 57, 57, 59];
      const itemAlign = ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'center'];

      const itemRows = items.map((i, idx) => {
        const { displayName } = parseCustomItem(
          typeof i.budgetItem === 'object' ? i.budgetItem : { code: i.code || i.budgetItem, name: i.name },
          i.remarks,
        );
        const resolvedName = (displayName && displayName !== 'Other (specify)' && displayName !== 'Other (custom item)')
          ? displayName
          : (i.name || (typeof i.budgetItem === 'string' ? i.budgetItem : i.budgetItem?.name) || '—');
        const budgetCode = i.code || (typeof i.budgetItem === 'string' ? i.budgetItem : i.budgetItem?.code) || '—';
        return [
          idx + 1,
          resolvedName,
          budgetCode,
          i.quantity != null ? String(i.quantity) : (i.requestedQuantity != null ? String(i.requestedQuantity) : '—'),
          i.approvedQuantity != null ? String(i.approvedQuantity) : '—',
          formatMoney(i.unitCost),
          formatMoney(i.totalCost ?? i.requestedAmount),
          formatMoney(i.approvedAmount ?? i.sanctionedAmount),
          i.status || (i.approvedQuantity > 0 ? 'APPROVED' : 'PENDING'),
        ];
      });

      // Add totals row
      const totalsRow = [
        '',
        'TOTAL AMOUNTS',
        '',
        '',
        '',
        '',
        formatMoney(r.requestedAmount),
        formatMoney(r.sanctionedAmount),
        r.unapprovedAmount > 0 ? `Unapproved: ${formatMoney(r.unapprovedAmount)}` : 'Full Sanction',
      ];
      totalsRow.isTotal = true;
      itemRows.push(totalsRow);

      renderTable({
        headers: itemHeaders,
        rows: itemRows,
        colWidths: itemWidths,
        alignments: itemAlign,
        headerBg: '#1E3A8A',
      });

      // 2.B Department Budget Context
      if (budget) {
        ensureSpace(65); // Keep title + table together
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1E3A8A').text('Departmental Budget Context & Financial Position:', left, doc.y);
        doc.y += 5;

        const budgetHeaders = ['Annual Provision', 'Already Sanctioned', 'Committed / Pending', 'Current Request', 'Remaining Balance'];
        const budgetWidths = [105, 105, 105, 104, 104];
        const budgetAlign = ['right', 'right', 'right', 'right', 'right'];
        const budgetRows = [[
          formatMoney(budget.allocatedAmount),
          formatMoney(budget.utilizedAmount),
          formatMoney(budget.committedAmount),
          formatMoney(r.requestedAmount),
          formatMoney(budget.remainingAmount),
        ]];

        renderTable({
          headers: budgetHeaders,
          rows: budgetRows,
          colWidths: budgetWidths,
          alignments: budgetAlign,
          headerBg: '#334155',
        });
      }

      // -------------------------------------------------------------------------
      // 3. COMPLETE APPROVAL HISTORY
      // -------------------------------------------------------------------------
      drawSectionTitle('2', 'Complete Approval History');
      doc.font('Helvetica').fontSize(7).fillColor('#475569')
        .text('Chronological record of every institutional workflow action, review progression, and decision event:', left, doc.y);
      doc.y += 5;

      const histHeaders = ['#', 'Date & Time (IST)', 'Stage', 'Performed By', 'Action', 'Status Change', 'Amount', 'Remarks & Observations'];
      const histWidths = [18, 78, 64, 75, 60, 76, 56, 96];
      const histAlign = ['center', 'left', 'left', 'left', 'center', 'left', 'right', 'left'];

      const histRows = workflow.map((w, idx) => {
        const statusTrans = w.previousStatus && w.newStatus
          ? `${w.previousStatus.replace(/_/g, ' ')} -> ${w.newStatus.replace(/_/g, ' ')}`
          : (w.newStatus || '—').replace(/_/g, ' ');

        return [
          idx + 1,
          formatIST(w.at || w.createdAt || w.timestamp || w.actionAt),
          w.stage?.name || 'Requester',
          w.by || '—',
          w.action || '—',
          statusTrans,
          w.amountApproved != null ? formatMoney(w.amountApproved) : (w.amount != null ? formatMoney(w.amount) : (w.amountRequested != null ? formatMoney(w.amountRequested) : '—')),
          w.comments || w.rejectionReason || w.sentence || 'Action recorded.',
        ];
      });

      renderTable({
        headers: histHeaders,
        rows: histRows,
        colWidths: histWidths,
        alignments: histAlign,
        headerBg: '#1E3A8A',
      });

      // -------------------------------------------------------------------------
      // 4. COMPLETE MESSAGE HISTORY
      // -------------------------------------------------------------------------
      drawSectionTitle('3', 'Complete Message & Communication History');
      doc.font('Helvetica').fontSize(7).fillColor('#475569')
        .text('Complete unedited messages, official scrutiny notes, correction dialogues, and formal communications:', left, doc.y);
      doc.y += 5;

      // Combine discussion comments + correction notes
      const msgList = [];

      // Add correction dialogues
      resubmissions.forEach((resub) => {
        if (resub.correctionReason) {
          msgList.push({
            at: resub.correctionRequestedAt,
            sender: resub.correctionRequestedBy || 'Approving Authority',
            role: 'Correction Requisition',
            message: `[CORRECTION REQUESTED for v${resub.versionNumber}]: ${resub.correctionReason}`,
          });
        }
        if (resub.submittedAt) {
          msgList.push({
            at: resub.submittedAt,
            sender: resub.submittedBy || 'Requester',
            role: 'Resubmission Response',
            message: `[RESUBMITTED v${resub.versionNumber}]: Resubmission response with updated details. Prior total: ${formatMoney(resub.previousTotal)}, Revised total: ${formatMoney(resub.newTotal)}.`,
          });
        }
      });

      comments.forEach((c) => {
        msgList.push({
          at: c.createdAt || c.at,
          sender: c.author || c.sender || 'User',
          role: c.stage || c.role || (c.visibility === 'UP_CHAIN' ? 'Review Authority (Up-Chain)' : 'All Participants'),
          message: c.body || c.message || c.content || '—',
        });
      });

      // Add direct messages from messages array if provided
      const rawMessages = report.messages || [];
      rawMessages.forEach((m) => {
        msgList.push({
          at: m.at || m.createdAt || m.sentAt || m.timestamp,
          sender: m.sender || m.from || 'User',
          role: m.role || m.recipient || 'All Participants',
          message: m.message || m.content || '—',
        });
      });

      // Sort chronologically
      msgList.sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());

      if (msgList.length === 0) {
        ensureSpace(24);
        const emptyY = doc.y;
        doc.rect(left, emptyY, contentWidth, 18).fillAndStroke('#F8FAFC', '#E2E8F0');
        doc.font('Helvetica-Oblique').fontSize(7).fillColor('#64748B')
          .text('No separate communication messages were recorded. All remarks are preserved in the Approval History above.', left + 8, emptyY + 5, { lineBreak: false });
        doc.y = emptyY + 23;
      } else {
        const msgHeaders = ['#', 'Date & Time (IST)', 'Sender', 'Recipient / Scope', 'Message & Communication Content'];
        const msgWidths = [18, 80, 85, 80, 260];
        const msgAlign = ['center', 'left', 'left', 'left', 'left'];

        const msgRows = msgList.map((m, idx) => [
          idx + 1,
          formatIST(m.at || m.createdAt || m.sentAt || m.timestamp),
          m.sender || m.from || '—',
          m.role || m.recipient || '—',
          m.message || m.content || '—',
        ]);

        renderTable({
          headers: msgHeaders,
          rows: msgRows,
          colWidths: msgWidths,
          alignments: msgAlign,
          headerBg: '#334155',
        });
      }

      // -------------------------------------------------------------------------
      // 5. DOCUMENTS / VERIFICATION
      // -------------------------------------------------------------------------
      drawSectionTitle('4', 'Documents & Verification');
      doc.font('Helvetica').fontSize(7).fillColor('#475569')
        .text('Verification record of all quotations, specifications, bills, and institutional attachments:', left, doc.y);
      doc.y += 5;

      if (documents.length === 0) {
        ensureSpace(24);
        const emptyY = doc.y;
        doc.rect(left, emptyY, contentWidth, 18).fillAndStroke('#F8FAFC', '#E2E8F0');
        doc.font('Helvetica-Oblique').fontSize(7).fillColor('#64748B')
          .text('No documents or quotations were attached to this request.', left + 8, emptyY + 5, { lineBreak: false });
        doc.y = emptyY + 23;
      } else {
        const docHeaders = ['#', 'Document Name', 'Ver', 'Req Ver', 'Uploaded By', 'Uploaded (IST)', 'Verification Status', 'Replacement / Audit Notes'];
        const docWidths = [18, 132, 26, 42, 75, 75, 75, 80];
        const docAlign = ['center', 'left', 'center', 'center', 'left', 'left', 'center', 'left'];

        const docRows = documents.map((d, idx) => {
          const isSuperseded = Boolean(d.supersededById);
          return [
            idx + 1,
            d.fileName || 'Document',
            String(d.versionNumber || 1),
            `v${d.requestVersionNumber || 1}`,
            d.uploadedBy || 'User',
            formatIST(d.uploadedAt),
            isSuperseded ? 'Superseded' : 'Verified / Active',
            isSuperseded ? (d.replacementReason || 'Replaced by newer version') : 'Current sanctioned document',
          ];
        });

        renderTable({
          headers: docHeaders,
          rows: docRows,
          colWidths: docWidths,
          alignments: docAlign,
          headerBg: '#1E3A8A',
        });
      }

      // -------------------------------------------------------------------------
      // 6. FINAL DECISION
      // -------------------------------------------------------------------------
      drawSectionTitle('5', 'Final Institutional Decision');

      const isDecided = ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CLOSED', 'FULFILLED', 'FULFILMENT_PENDING'].includes(r.status);
      ensureSpace(85);
      const decBoxY = doc.y;

      const decisionBg = r.status === 'APPROVED' ? '#F0FDF4' : r.status === 'REJECTED' ? '#FEF2F2' : '#FFFBEB';
      const decisionBorder = r.status === 'APPROVED' ? '#86EFAC' : r.status === 'REJECTED' ? '#FCA5A5' : '#FDE68A';

      doc.rect(left, decBoxY, contentWidth, 74).fillAndStroke(decisionBg, decisionBorder);

      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(r.status === 'APPROVED' ? '#166534' : r.status === 'REJECTED' ? '#991B1B' : '#92400E');
      doc.text(`DECISION STATUS: ${(r.status || 'UNDER REVIEW').replace(/_/g, ' ')}`, left + 12, decBoxY + 8, { lineBreak: false });

      doc.font('Helvetica').fontSize(7.5).fillColor('#1E293B');
      doc.text(`Decision Authority: ${decision.authority || (r.stage?.name ?? 'Competent Sanctioning Authority')}`, left + 12, decBoxY + 23, { lineBreak: false });
      doc.text(`Decision Date & Time: ${decision.decidedAt ? formatIST(decision.decidedAt) : (isDecided && r.closedAt ? formatIST(r.closedAt) : 'Under Active Consideration')}`, left + 12, decBoxY + 34, { lineBreak: false });
      doc.text(`Sanctioned Amount: ${formatMoney(r.sanctionedAmount)} of ${formatMoney(r.requestedAmount)} requested`, left + 12, decBoxY + 45, { lineBreak: false });

      const decRemarks = decision.remarks || (isDecided ? 'Final decision recorded in institutional approval register.' : 'Awaiting review completion by assigned authority.');
      doc.text(`Stipulations / Remarks: ${decRemarks}`, left + 12, decBoxY + 56, { width: contentWidth - 24, lineBreak: false });

      doc.y = decBoxY + 80;

      // -------------------------------------------------------------------------
      // 7. AUDIT INFORMATION
      // -------------------------------------------------------------------------
      drawSectionTitle('6', 'System Audit Information');

      const auditHeaders = ['Audit Metric', 'System Value', 'Audit Metric', 'System Value'];
      const auditWidths = [120, 141, 120, 142];
      const auditAlign = ['left', 'left', 'left', 'left'];

      const auditRows = [
        ['Report Identifier', auditSummary.reportId || r.requestNumber, 'Report Specification', auditSummary.reportVersion || 'v1.0 Institutional'],
        ['Generated Timestamp', formatIST(auditSummary.generatedAt), 'Last Updated Timestamp', formatIST(auditSummary.updatedAt)],
        ['Total Workflow Events', String(auditSummary.totalEvents || workflow.length), 'Total Communication Items', String(auditSummary.totalMessages || comments.length)],
        ['Total Uploaded Documents', String(auditSummary.totalDocuments || documents.length), 'Digital Seal Verification', 'HMAC SHA-256 Tamper-Evident'],
      ];

      renderTable({
        headers: auditHeaders,
        rows: auditRows,
        colWidths: auditWidths,
        alignments: auditAlign,
        headerBg: '#475569',
      });

      // -------------------------------------------------------------------------
      // 8. CERTIFICATION & OFFICIAL SIGNATURES
      // -------------------------------------------------------------------------
      ensureSpace(95);
      drawSectionTitle('7', 'Institutional Certification & Official Endorsement');

      // Certification quote box
      const certBoxY = doc.y;
      doc.rect(left, certBoxY, contentWidth, 26).fillAndStroke('#F8FAFC', '#CBD5E1');
      doc.font('Helvetica-Oblique').fontSize(7).fillColor('#1E293B');
      doc.text(
        '"This report is a system-generated institutional record containing the information, communications, actions and status history available in the system at the time of report generation."',
        left + 10,
        certBoxY + 6,
        { width: contentWidth - 20, align: 'center' },
      );

      doc.y = certBoxY + 31;

      // Sign-off signature areas
      const sigY = doc.y + 16;
      const sigW = contentWidth / 3;

      // Signature 1
      doc.strokeColor('#94A3B8').lineWidth(0.8).dash(3, { space: 2 });
      doc.moveTo(left + 15, sigY).lineTo(left + sigW - 15, sigY).stroke();
      doc.undash();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#334155').text('Dealing Assistant / Scrutiny', left + 15, sigY + 5, { width: sigW - 30, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(6.5).fillColor('#64748B').text('Signature & Date', left + 15, sigY + 16, { width: sigW - 30, align: 'center', lineBreak: false });

      // Signature 2
      doc.dash(3, { space: 2 });
      doc.moveTo(left + sigW + 15, sigY).lineTo(left + 2 * sigW - 15, sigY).stroke();
      doc.undash();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#334155').text('Purchase Committee / HOD', left + sigW + 15, sigY + 5, { width: sigW - 30, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(6.5).fillColor('#64748B').text('Verified & Recommended', left + sigW + 15, sigY + 16, { width: sigW - 30, align: 'center', lineBreak: false });

      // Signature 3
      doc.dash(3, { space: 2 });
      doc.moveTo(left + 2 * sigW + 15, sigY).lineTo(right - 15, sigY).stroke();
      doc.undash();
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#334155').text('Sanctioning Authority / Principal', left + 2 * sigW + 15, sigY + 5, { width: sigW - 30, align: 'center', lineBreak: false });
      doc.font('Helvetica').fontSize(6.5).fillColor('#64748B').text('Official Institutional Seal', left + 2 * sigW + 15, sigY + 16, { width: sigW - 30, align: 'center', lineBreak: false });

      // -------------------------------------------------------------------------
      // RUNNING HEADERS & FOOTERS ACROSS ALL BUFFERED PAGES
      // -------------------------------------------------------------------------
      const range = doc.bufferedPageRange();
      const totalPages = range.count;
      const genIST = formatIST(report.generatedAt);

      const COPYRIGHT_AUTHORS_STRING = 'Anish Mogam, Madhura Lakade and Isha Joshi';
      const COPYRIGHT_YEAR = '2026';

      for (let i = range.start; i < range.start + totalPages; i++) {
        doc.switchToPage(i);
        doc.page.margins.top = 0;
        doc.page.margins.bottom = 0;
        const pageNum = i - range.start + 1;

        // Diagonal watermark across page center
        doc.save();
        doc.fillColor('#64748B').fillOpacity(0.11);
        doc.rotate(-38, { origin: [297.64, 420] });
        doc.fontSize(14).font('Helvetica-Bold');
        doc.text(`Copyright © ${COPYRIGHT_YEAR} ${COPYRIGHT_AUTHORS_STRING}`, 297.64 - 250, 410, { width: 500, align: 'center', lineBreak: false });
        doc.fontSize(10).font('Helvetica');
        doc.text('ProcureFlow — All Rights Reserved · Proprietary Institutional System', 297.64 - 250, 428, { width: 500, align: 'center', lineBreak: false });
        doc.restore();

        // Running Header on pages 2+
        if (pageNum > 1) {
          doc.fillColor('#64748B').fontSize(7).font('Helvetica-Bold');
          doc.text('S.P. COLLEGE, PUNE — OFFICIAL APPROVAL REPORT', left, 22, { width: 300, align: 'left', lineBreak: false });
          doc.font('Helvetica').text(`Report ID: ${r.requestNumber}`, right - 180, 22, { width: 180, align: 'right', lineBreak: false });
          doc.rect(left, 32, contentWidth, 0.5).fill('#CBD5E1');
        }

        // Running Footer on every page
        const footerY = 812;
        doc.rect(left, footerY, contentWidth, 0.5).fill('#CBD5E1');

        doc.fillColor('#64748B').fontSize(7).font('Helvetica');
        doc.text(`Report ID: ${r.requestNumber} · S.P. College Institutional Hub`, left, footerY + 4, { width: 220, align: 'left', lineBreak: false });
        doc.text(`Generated: ${genIST}`, left + 200, footerY + 4, { width: 160, align: 'center', lineBreak: false });
        doc.font('Helvetica-Bold').fillColor('#1E3A8A').text(`Page ${pageNum} of ${totalPages}`, right - 100, footerY + 4, { width: 100, align: 'right', lineBreak: false });

        // Copyright running footer
        doc.fillColor('#64748B').fontSize(6.5).font('Helvetica');
        doc.text(`Copyright © ${COPYRIGHT_YEAR} ${COPYRIGHT_AUTHORS_STRING}. All Rights Reserved.`, left, footerY + 14, { width: contentWidth, align: 'center', lineBreak: false });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
