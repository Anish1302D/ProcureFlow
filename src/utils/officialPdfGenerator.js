import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { parseCustomItem } from './customItem.js';
import { addPdfWatermark } from './pdfWatermark.js';

/**
 * Formats a date to Indian Standard Time: DD/MM/YYYY HH:MM IST
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
 * Format currency with Indian grouping and Rs. prefix
 */
export function formatMoney(val) {
  if (val === null || val === undefined || isNaN(Number(val))) return '—';
  return 'Rs. ' + Number(val).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function clean(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * Generates an official, print-ready institutional PDF report for SP College.
 * Returns the jsPDF doc instance and automatically triggers download if saveAsFilename is provided.
 */
export async function generateOfficialPdf(reportData, saveAsFilename = null) {
  // A4 portrait in points: 595.28 x 841.89 pt
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const left = 36;
  const right = 559; // 595.28 - 36
  const contentWidth = right - left; // 523pt
  const maxY = 760;

  const r = reportData.request || {};
  const items = reportData.items || [];
  const budget = reportData.budget;
  const workflow = reportData.workflow || [];
  const comments = reportData.comments || [];
  const documents = reportData.documents || [];
  const resubmissions = reportData.resubmissions || [];
  const decision = reportData.decision || {};
  const auditSummary = reportData.auditSummary || {
    reportId: r.requestNumber || 'REQ-RECORD',
    generatedAt: reportData.generatedAt || new Date().toISOString(),
    updatedAt: r.closedAt || r.submittedAt || r.createdAt,
    totalEvents: workflow.length,
    totalMessages: comments.length,
    totalDocuments: documents.length,
    reportVersion: `v${r.versionNumber || 1}.0`,
  };

  // -------------------------------------------------------------------------
  // 1. INSTITUTIONAL HEADER (PAGE 1)
  // -------------------------------------------------------------------------
  let curY = 40;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(30, 41, 59); // Slate-800
  doc.text("SHIKSHANA PRASARAKA MANDALI'S", 297.64, curY, { align: 'center' });
  curY += 15;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(30, 58, 138); // Deep Navy
  doc.text('SIR PARASHURAMBHAU COLLEGE', 297.64, curY, { align: 'center' });
  curY += 13;

  doc.setFont('helvetica', 'bolditalic');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('(Empowered Autonomous)', 297.64, curY, { align: 'center' });
  curY += 12;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Tilak Road, Sadashiv Peth, Pune – 411030, Maharashtra, India', 297.64, curY, { align: 'center' });
  curY += 10;

  // Header Divider Lines
  doc.setDrawColor(30, 58, 138);
  doc.setLineWidth(1.5);
  doc.line(left, curY, right, curY);
  curY += 3;
  doc.setDrawColor(217, 119, 6); // Amber
  doc.setLineWidth(0.5);
  doc.line(left, curY, right, curY);
  curY += 10;

  // -------------------------------------------------------------------------
  // 2. REPORT COVER / IDENTIFICATION BANNER
  // -------------------------------------------------------------------------
  const bannerY = curY;
  const bannerH = 50;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.5);
  doc.roundedRect(left, bannerY, contentWidth, bannerH, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(15, 23, 42);
  doc.text('OFFICIAL INSTITUTIONAL APPROVAL REPORT', left + 10, bannerY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Autonomous Institution Procurement & Workflow Verification Record', left + 10, bannerY + 26);

  // Status Badge
  const status = (r.status || 'SUBMITTED').replace(/_/g, ' ');
  const isApproved = r.status === 'APPROVED';
  const isRejected = r.status === 'REJECTED';
  const badgeBg = isApproved ? [220, 252, 231] : isRejected ? [254, 226, 226] : [254, 243, 199];
  const badgeText = isApproved ? [22, 101, 52] : isRejected ? [153, 27, 27] : [133, 77, 14];

  doc.setFillColor(...badgeBg);
  doc.rect(right - 140, bannerY + 8, 130, 16, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...badgeText);
  doc.text(status, right - 75, bannerY + 19, { align: 'center' });

  // Metadata bottom line
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);
  const genStr = formatIST(reportData.generatedAt || new Date().toISOString());
  doc.text(`Report ID: ${r.requestNumber || '—'}`, left + 10, bannerY + 41);
  doc.text(`Generated: ${genStr}`, left + 130, bannerY + 41);
  doc.text(`Period: ${r.financialYear || '—'}`, left + 290, bannerY + 41);
  doc.text(`Current Stage: ${r.stage?.name || 'Review Stage'}`, left + 395, bannerY + 41);

  curY = bannerY + bannerH + 12;

  function sectionHeading(num, title) {
    if (curY + 60 > maxY) {
      doc.addPage();
      curY = 45;
    }
    doc.setFillColor(241, 245, 249);
    doc.rect(left, curY, contentWidth, 16, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(30, 58, 138);
    doc.text(`${num}. ${title.toUpperCase()}`, left + 8, curY + 11);
    curY += 21;
  }

  // -------------------------------------------------------------------------
  // SECTION 1: REPORT & APPLICANT DETAILS
  // -------------------------------------------------------------------------
  sectionHeading('1', 'Report & Applicant Details');

  const detailsBody = [
    ['Request Title', r.title || '—', 'Request ID / Number', r.requestNumber || '—'],
    ['Applicant / Raised By', r.raisedBy || '—', 'Department', r.department || '—'],
    ['Course & Funding', `${r.course || 'General'} (${r.course?.includes('Non-Grant') ? 'Non-Grant' : 'Grant'})`, 'Financial Year', r.financialYear || '—'],
    ['Budget Head & Type', r.budgetHead || '—', 'Date Created', formatIST(r.createdAt)],
    ['Date Submitted', formatIST(r.submittedAt), 'Decision / Closed Date', r.closedAt ? formatIST(r.closedAt) : 'Pending Final Decision'],
    ['Current Version', `Version ${r.versionNumber || 1}`, 'Urgency Level', clean(r.extra?.urgency) || 'Normal'],
  ];

  autoTable(doc, {
    startY: curY,
    body: detailsBody,
    theme: 'plain',
    margin: { left, right: 36.28 },
    styles: { fontSize: 7, cellPadding: 2.2, textColor: [30, 41, 59] },
    columnStyles: {
      0: { cellWidth: 90, fontStyle: 'bold', textColor: [71, 85, 105] },
      1: { cellWidth: 171 },
      2: { cellWidth: 92, fontStyle: 'bold', textColor: [71, 85, 105] },
      3: { cellWidth: 170 },
    },
  });

  curY = doc.lastAutoTable.finalY + 4;

  if (r.justification) {
    curY += 3;
    doc.setFillColor(241, 245, 249);
    doc.rect(left, curY, contentWidth, 13, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);
    doc.text('Justification & Statement of Need:', left + 6, curY + 9);
    curY += 15;

    const justText = doc.splitTextToSize(r.justification, contentWidth - 12);
    const boxH = Math.max(16, justText.length * 9 + 6);
    doc.setFillColor(250, 250, 250);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.rect(left, curY, contentWidth, boxH, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(30, 41, 59);
    doc.text(justText, left + 6, curY + 8);
    curY += boxH + 8;
  }

  // Line Items Table
  curY += 2;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 58, 138);
  doc.text('Itemised Requirements & Sanction Breakdown:', left, curY);
  curY += 7;

  const itemBody = items.map((i, idx) => {
    const { displayName } = parseCustomItem(
      typeof i.budgetItem === 'object' ? i.budgetItem : { code: i.code || i.budgetItem, name: i.name },
      i.remarks,
    );
    const resolvedName = (displayName && displayName !== 'Other (specify)' && displayName !== 'Other (custom item)')
      ? displayName
      : (i.name || (typeof i.budgetItem === 'string' ? i.budgetItem : i.budgetItem?.name) || '—');
    const budgetCode = typeof i.budgetItem === 'string' ? i.budgetItem : (i.code || i.budgetItem?.code || '—');
    return [
      idx + 1,
      resolvedName,
      budgetCode,
      i.requestedQuantity != null ? String(i.requestedQuantity) : '—',
      i.approvedQuantity != null ? String(i.approvedQuantity) : '—',
      formatMoney(i.unitCost),
      formatMoney(i.requestedAmount),
      formatMoney(i.approvedAmount),
      i.status || 'PENDING',
    ];
  });

  itemBody.push([
    '',
    'TOTAL AMOUNTS',
    '',
    '',
    '',
    '',
    formatMoney(r.requestedAmount),
    formatMoney(r.sanctionedAmount),
    r.unapprovedAmount > 0 ? `Unapproved: ${formatMoney(r.unapprovedAmount)}` : 'Full Sanction',
  ]);

  autoTable(doc, {
    startY: curY,
    head: [['#', 'Item Description', 'Budget Code', 'Qty Req', 'Qty Appr', 'Unit Cost', 'Requested', 'Sanctioned', 'Status']],
    body: itemBody,
    theme: 'grid',
    margin: { left, right: 36.28, top: 40, bottom: 45 },
    styles: { fontSize: 7, cellPadding: 3, textColor: [30, 41, 59] },
    headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 142 },
      2: { cellWidth: 52 },
      3: { cellWidth: 42, halign: 'right' },
      4: { cellWidth: 42, halign: 'right' },
      5: { cellWidth: 54, halign: 'right' },
      6: { cellWidth: 57, halign: 'right' },
      7: { cellWidth: 57, halign: 'right' },
      8: { cellWidth: 59, halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.row.index === itemBody.length - 1) {
        data.cell.styles.fontStyle = 'bold';
        data.cell.styles.fillColor = [241, 245, 249];
      }
    },
  });

  curY = doc.lastAutoTable.finalY + 10;

  // Department Budget Context Table
  if (budget) {
    if (curY + 55 > maxY) {
      doc.addPage();
      curY = 45;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(30, 58, 138);
    doc.text('Departmental Budget Context & Financial Position:', left, curY);
    curY += 7;

    autoTable(doc, {
      startY: curY,
      head: [['Annual Provision', 'Already Sanctioned', 'Committed / Pending', 'Current Request', 'Remaining Balance']],
      body: [[
        formatMoney(budget.allocatedAmount),
        formatMoney(budget.utilizedAmount),
        formatMoney(budget.committedAmount),
        formatMoney(r.requestedAmount),
        formatMoney(budget.remainingAmount),
      ]],
      theme: 'grid',
      margin: { left, right: 36.28, top: 40, bottom: 45 },
      styles: { fontSize: 7, cellPadding: 3.5, halign: 'right', textColor: [30, 41, 59] },
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'right' },
    });

    curY = doc.lastAutoTable.finalY + 12;
  }

  // -------------------------------------------------------------------------
  // SECTION 2: COMPLETE APPROVAL HISTORY
  // -------------------------------------------------------------------------
  sectionHeading('2', 'Complete Approval History');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text('Chronological record of every institutional workflow action, review progression, and decision event:', left, curY);
  curY += 7;

  const histBody = workflow.map((w, idx) => {
    const statusTrans = w.previousStatus && w.newStatus
      ? `${w.previousStatus.replace(/_/g, ' ')} -> ${w.newStatus.replace(/_/g, ' ')}`
      : (w.newStatus || '—').replace(/_/g, ' ');

    return [
      idx + 1,
      formatIST(w.at),
      w.stage?.name || 'Requester',
      w.by || '—',
      w.action || '—',
      statusTrans,
      w.amountApproved != null ? formatMoney(w.amountApproved) : (w.amountRequested != null ? formatMoney(w.amountRequested) : '—'),
      w.comments || w.rejectionReason || w.sentence || 'Action recorded.',
    ];
  });

  autoTable(doc, {
    startY: curY,
    head: [['#', 'Date & Time (IST)', 'Stage', 'Performed By', 'Action', 'Status Change', 'Amount', 'Remarks & Observations']],
    body: histBody,
    theme: 'grid',
    margin: { left, right: 36.28, top: 40, bottom: 45 },
    styles: { fontSize: 7, cellPadding: 3, textColor: [30, 41, 59] },
    headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 78 },
      2: { cellWidth: 64 },
      3: { cellWidth: 75 },
      4: { cellWidth: 60, halign: 'center' },
      5: { cellWidth: 76 },
      6: { cellWidth: 56, halign: 'right' },
      7: { cellWidth: 96 },
    },
  });

  curY = doc.lastAutoTable.finalY + 12;

  // -------------------------------------------------------------------------
  // SECTION 3: COMPLETE MESSAGE HISTORY
  // -------------------------------------------------------------------------
  sectionHeading('3', 'Complete Message & Communication History');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text('Complete unedited messages, official scrutiny notes, correction dialogues, and formal communications:', left, curY);
  curY += 7;

  const msgList = [];
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
      at: c.createdAt,
      sender: c.author || 'User',
      role: c.stage || (c.visibility === 'UP_CHAIN' ? 'Review Authority (Up-Chain)' : 'All Participants'),
      message: c.body || '—',
    });
  });

  msgList.sort((a, b) => new Date(a.at || 0).getTime() - new Date(b.at || 0).getTime());

  if (msgList.length === 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(left, curY, contentWidth, 18, 'FD');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('No separate communication messages were recorded. All remarks are preserved in the Approval History above.', left + 8, curY + 12);
    curY += 26;
  } else {
    const msgBody = msgList.map((m, idx) => [
      idx + 1,
      formatIST(m.at),
      m.sender,
      m.role,
      m.message,
    ]);

    autoTable(doc, {
      startY: curY,
      head: [['#', 'Date & Time (IST)', 'Sender', 'Recipient / Scope', 'Message & Communication Content']],
      body: msgBody,
      theme: 'grid',
      margin: { left, right: 36.28, top: 40, bottom: 45 },
      styles: { fontSize: 7, cellPadding: 3, textColor: [30, 41, 59] },
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 80 },
        2: { cellWidth: 85 },
        3: { cellWidth: 80 },
        4: { cellWidth: 260 },
      },
    });

    curY = doc.lastAutoTable.finalY + 12;
  }

  // -------------------------------------------------------------------------
  // SECTION 4: DOCUMENTS & VERIFICATION
  // -------------------------------------------------------------------------
  sectionHeading('4', 'Documents & Verification');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(71, 85, 105);
  doc.text('Verification record of all quotations, specifications, bills, and institutional attachments:', left, curY);
  curY += 7;

  if (documents.length === 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.rect(left, curY, contentWidth, 18, 'FD');
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text('No documents or quotations were attached to this request.', left + 8, curY + 12);
    curY += 26;
  } else {
    const docBody = documents.map((d, idx) => {
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

    autoTable(doc, {
      startY: curY,
      head: [['#', 'Document Name', 'Ver', 'Req Ver', 'Uploaded By', 'Uploaded (IST)', 'Verification Status', 'Replacement / Audit Notes']],
      body: docBody,
      theme: 'grid',
      margin: { left, right: 36.28, top: 40, bottom: 45 },
      styles: { fontSize: 7, cellPadding: 3, textColor: [30, 41, 59] },
      headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 18, halign: 'center' },
        1: { cellWidth: 132 },
        2: { cellWidth: 26, halign: 'center' },
        3: { cellWidth: 42, halign: 'center' },
        4: { cellWidth: 75 },
        5: { cellWidth: 75 },
        6: { cellWidth: 75, halign: 'center' },
        7: { cellWidth: 80 },
      },
    });

    curY = doc.lastAutoTable.finalY + 12;
  }

  // -------------------------------------------------------------------------
  // SECTION 5: FINAL INSTITUTIONAL DECISION
  // -------------------------------------------------------------------------
  sectionHeading('5', 'Final Institutional Decision');

  if (curY + 85 > maxY) {
    doc.addPage();
    curY = 45;
  }

  const isDecided = ['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CLOSED', 'FULFILLED', 'FULFILMENT_PENDING'].includes(r.status);
  const decisionBg = isApproved ? [240, 253, 244] : isRejected ? [254, 242, 242] : [255, 251, 235];
  const decisionBorder = isApproved ? [134, 239, 172] : isRejected ? [252, 165, 165] : [253, 230, 138];
  const decisionText = isApproved ? [22, 101, 52] : isRejected ? [153, 27, 27] : [146, 64, 14];

  doc.setFillColor(...decisionBg);
  doc.setDrawColor(...decisionBorder);
  doc.roundedRect(left, curY, contentWidth, 74, 3, 3, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...decisionText);
  doc.text(`DECISION STATUS: ${(r.status || 'UNDER REVIEW').replace(/_/g, ' ')}`, left + 12, curY + 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 41, 59);
  doc.text(`Decision Authority: ${decision.authority || (r.stage?.name ?? 'Competent Sanctioning Authority')}`, left + 12, curY + 28);
  doc.text(`Decision Date & Time: ${decision.decidedAt ? formatIST(decision.decidedAt) : (isDecided && r.closedAt ? formatIST(r.closedAt) : 'Under Active Consideration')}`, left + 12, curY + 39);
  doc.text(`Sanctioned Amount: ${formatMoney(r.sanctionedAmount)} of ${formatMoney(r.requestedAmount)} requested`, left + 12, curY + 50);

  const decRemarks = decision.remarks || (isDecided ? 'Final decision recorded in institutional approval register.' : 'Awaiting review completion by assigned authority.');
  doc.text(`Stipulations / Remarks: ${decRemarks}`, left + 12, curY + 61, { width: contentWidth - 24 });

  curY += 86;

  // -------------------------------------------------------------------------
  // SECTION 6: SYSTEM AUDIT INFORMATION
  // -------------------------------------------------------------------------
  sectionHeading('6', 'System Audit Information');

  autoTable(doc, {
    startY: curY,
    head: [['Audit Metric', 'System Value', 'Audit Metric', 'System Value']],
    body: [
      ['Report Identifier', auditSummary.reportId || r.requestNumber, 'Report Specification', auditSummary.reportVersion || 'v1.0 Institutional'],
      ['Generated Timestamp', formatIST(auditSummary.generatedAt), 'Last Updated Timestamp', formatIST(auditSummary.updatedAt)],
      ['Total Workflow Events', String(auditSummary.totalEvents || workflow.length), 'Total Communication Items', String(auditSummary.totalMessages || comments.length)],
      ['Total Uploaded Documents', String(auditSummary.totalDocuments || documents.length), 'Digital Seal Verification', 'HMAC SHA-256 Tamper-Evident'],
    ],
    theme: 'grid',
    margin: { left, right: 36.28, top: 40, bottom: 45 },
    styles: { fontSize: 7, cellPadding: 3.5, textColor: [30, 41, 59] },
    headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 120 },
      1: { cellWidth: 141 },
      2: { cellWidth: 120 },
      3: { cellWidth: 142 },
    },
  });

  curY = doc.lastAutoTable.finalY + 12;

  // -------------------------------------------------------------------------
  // SECTION 7: CERTIFICATION & OFFICIAL ENDORSEMENT
  // -------------------------------------------------------------------------
  sectionHeading('7', 'Institutional Certification & Official Endorsement');

  if (curY + 110 > maxY) {
    doc.addPage();
    curY = 45;
  }

  // Quote box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(left, curY, contentWidth, 30, 2, 2, 'FD');

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(30, 41, 59);
  doc.text(
    '"This report is a system-generated institutional record containing the information, communications, actions and status history available in the system at the time of report generation."',
    297.64,
    curY + 18,
    { align: 'center', maxWidth: contentWidth - 20 },
  );

  curY += 40;

  // Sign-off signature areas
  const sigY = curY + 28;
  const sigW = contentWidth / 3;

  // Signature 1
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.8);
  doc.line(left + 15, sigY, left + sigW - 15, sigY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text('Dealing Assistant / Scrutiny', left + 15, sigY + 11, { width: sigW - 30, align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Signature & Date', left + 15, sigY + 22, { width: sigW - 30, align: 'center' });

  // Signature 2
  doc.line(left + sigW + 15, sigY, left + 2 * sigW - 15, sigY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text('Purchase Committee / HOD', left + sigW + 15, sigY + 11, { width: sigW - 30, align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Verified & Recommended', left + sigW + 15, sigY + 22, { width: sigW - 30, align: 'center' });

  // Signature 3
  doc.line(left + 2 * sigW + 15, sigY, right - 15, sigY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  doc.text('Sanctioning Authority / Principal', left + 2 * sigW + 15, sigY + 11, { width: sigW - 30, align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Official Institutional Seal', left + 2 * sigW + 15, sigY + 22, { width: sigW - 30, align: 'center' });

  // -------------------------------------------------------------------------
  // RUNNING HEADERS & FOOTERS ACROSS ALL PAGES
  // -------------------------------------------------------------------------
  const totalPages = doc.internal.getNumberOfPages();
  const genIST = formatIST(reportData.generatedAt || new Date().toISOString());

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Running Header on pages 2+
    if (i > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text('S.P. COLLEGE, PUNE — OFFICIAL APPROVAL REPORT', left, 22);

      doc.setFont('helvetica', 'normal');
      doc.text(`Report ID: ${r.requestNumber || '—'}`, right, 22, { align: 'right' });

      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.5);
      doc.line(left, 27, right, 27);
    }

    // Running Footer on every page
    const footerY = 812;
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.5);
    doc.line(left, footerY, right, footerY);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(`Report ID: ${r.requestNumber || '—'} · S.P. College Institutional Hub`, left, footerY + 11);
    doc.text(`Generated: ${genIST}`, 297.64, footerY + 11, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text(`Page ${i} of ${totalPages}`, right, footerY + 11, { align: 'right' });
  }

  addPdfWatermark(doc);

  if (typeof saveAsFilename === 'string' && saveAsFilename.trim().length > 0) {
    doc.save(saveAsFilename.trim());
  }

  return doc;
}
