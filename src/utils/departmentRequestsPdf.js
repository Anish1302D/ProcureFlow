import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { statusInfo } from '../api/format.js';
import { formatIST, formatMoney } from './officialPdfGenerator.js';
import { parseCustomItem } from './customItem.js';
import { addPdfWatermark } from './pdfWatermark.js';

/*
 * Official SP College Department Requisitions & Itemised Requests Report.
 *
 * Downloadable by HODs, faculty members and higher authorities.
 * Features institutional letterhead, executive summary cards, full requisition
 * register, itemised line items table, stage pipeline, and official signature blocks.
 */

const PAGE_W = 595.28;
const CENTER = PAGE_W / 2;
const LEFT = 36;
const RIGHT = 559;
const WIDTH = RIGHT - LEFT;
const MAX_Y = 770;
const TABLE_MARGIN = { left: LEFT, right: PAGE_W - RIGHT, top: 40, bottom: 45 };

const NAVY = [30, 58, 138];
const SLATE_900 = [15, 23, 42];
const SLATE_800 = [30, 41, 59];
const SLATE_700 = [51, 65, 85];
const SLATE_600 = [71, 85, 105];
const SLATE_500 = [100, 116, 139];
const SLATE_300 = [203, 213, 225];
const SLATE_200 = [226, 232, 240];
const SLATE_100 = [241, 245, 249];
const SLATE_50 = [248, 250, 252];
const AMBER = [217, 119, 6];
const INDIGO_500 = [99, 102, 241];
const EMERALD = [16, 185, 129];

const num = (v) => Number(v ?? 0) || 0;
const pct = (part, whole) => (num(whole) > 0 ? Math.round((num(part) / num(whole)) * 100) : 0);
const clean = (s) => (s === null || s === undefined ? '' : String(s).replace(/[\r\n\t]+/g, ' ').trim());

function compactMoney(v) {
  const n = num(v);
  if (n >= 1e7) return `Rs. ${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `Rs. ${(n / 1e5).toFixed(1)} L`;
  return `Rs. ${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export function generateDepartmentRequestsPdf(data, saveAsFilename = null) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const fy = data?.financialYear ?? {};
  const fyLabel = fy.label ? `FY ${fy.label}` : 'Current Financial Year';
  const generatedAt = data?.generatedAt ?? new Date().toISOString();
  const dept = data?.department;
  const isDeptReport = Boolean(dept?.name);
  const deptCode = dept?.code ? ` (${dept.code})` : '';

  const reportId = isDeptReport
    ? `REQ-${(dept.code || 'DEPT').replace(/[^0-9A-Za-z]/g, '')}-FY${(fy.label ?? 'NA').replace(/[^0-9A-Za-z]/g, '')}-${new Date(generatedAt).toISOString().slice(0, 10).replace(/-/g, '')}`
    : `REQ-COMBINED-FY${(fy.label ?? 'NA').replace(/[^0-9A-Za-z]/g, '')}-${new Date(generatedAt).toISOString().slice(0, 10).replace(/-/g, '')}`;

  const register = data?.register ?? [];
  const lineItems = data?.lineItems ?? [];
  const stages = data?.byStage ?? [];

  const totalRequested = register.reduce((acc, r) => acc + num(r.requested), 0);
  const totalSanctioned = register.reduce((acc, r) => acc + num(r.sanctioned), 0);
  const approvedCount = register.filter((r) => ['APPROVED', 'PARTIALLY_APPROVED', 'FULFILLED', 'CLOSED'].includes(r.status)).length;
  const pendingCount = register.filter((r) => !['APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'FULFILLED', 'CLOSED'].includes(r.status)).length;

  let y = 40;

  const ensure = (h) => {
    if (y + h > MAX_Y) {
      doc.addPage();
      y = 45;
    }
  };

  const font = (style, size, color) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };

  let sectionNo = 0;
  const section = (heading, intro) => {
    ensure(70);
    sectionNo += 1;
    doc.setFillColor(...SLATE_100);
    doc.rect(LEFT, y, WIDTH, 16, 'F');
    doc.setFillColor(...NAVY);
    doc.rect(LEFT, y, 2.5, 16, 'F');
    font('bold', 8.5, NAVY);
    doc.text(`${sectionNo}. ${heading.toUpperCase()}`, LEFT + 8, y + 11);
    y += 22;
    if (intro) {
      font('normal', 7, SLATE_600);
      const lines = doc.splitTextToSize(intro, WIDTH);
      doc.text(lines, LEFT, y + 2);
      y += lines.length * 8.5 + 4;
    }
  };

  const emptyNote = (text) => {
    ensure(26);
    doc.setFillColor(...SLATE_50);
    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(0.5);
    doc.rect(LEFT, y, WIDTH, 18, 'FD');
    font('italic', 7, SLATE_500);
    doc.text(text, LEFT + 8, y + 12);
    y += 26;
  };

  const table = (opts) => {
    autoTable(doc, {
      startY: y,
      theme: 'grid',
      margin: TABLE_MARGIN,
      styles: { fontSize: 6.8, cellPadding: 2.8, textColor: SLATE_800, lineColor: SLATE_200, lineWidth: 0.4, overflow: 'linebreak' },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.8 },
      alternateRowStyles: { fillColor: [252, 253, 254] },
      ...opts,
      didParseCell: (cell) => {
        if (opts.totalRow && cell.section === 'body' && cell.row.index === opts.body.length - 1) {
          cell.cell.styles.fontStyle = 'bold';
          cell.cell.styles.fillColor = SLATE_100;
        }
        opts.didParseCell?.(cell);
      },
    });
    y = doc.lastAutoTable.finalY + 12;
  };

  const right = (cols) => Object.fromEntries(cols.map((c) => [c, { halign: 'right' }]));

  // ══════════════════════════════════════════════════════════════════════════
  // LETTERHEAD
  // ══════════════════════════════════════════════════════════════════════════
  font('bold', 8.5, SLATE_800);
  doc.text("SHIKSHANA PRASARAKA MANDALI'S", CENTER, y, { align: 'center' });
  y += 15;
  font('bold', 14, NAVY);
  doc.text('SIR PARASHURAMBHAU COLLEGE', CENTER, y, { align: 'center' });
  y += 13;
  font('bolditalic', 9, SLATE_600);
  doc.text('(Empowered Autonomous)', CENTER, y, { align: 'center' });
  y += 12;
  font('normal', 7.5, SLATE_500);
  doc.text('Tilak Road, Sadashiv Peth, Pune – 411030, Maharashtra, India', CENTER, y, { align: 'center' });
  y += 10;
  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1.5);
  doc.line(LEFT, y, RIGHT, y);
  y += 3;
  doc.setDrawColor(...AMBER);
  doc.setLineWidth(0.5);
  doc.line(LEFT, y, RIGHT, y);
  y += 10;

  // ── Identification banner ────────────────────────────────────────────────
  const bannerH = 52;
  doc.setFillColor(...SLATE_50);
  doc.setDrawColor(...SLATE_300);
  doc.setLineWidth(0.5);
  doc.roundedRect(LEFT, y, WIDTH, bannerH, 3, 3, 'FD');

  const bannerTitle = isDeptReport
    ? `DEPARTMENT REQUISITIONS & ITEMISED REQUESTS — ${dept.name.toUpperCase()}`
    : 'INSTITUTIONAL REQUISITIONS & ITEMISED REQUESTS (COMBINED)';
  const bannerSubtitle = isDeptReport
    ? `Official schedule of requisitions, line items and approval workflow for Department of ${dept.name}`
    : 'Official college-wide schedule of requisitions, line items and approval workflow';

  font('bold', 9.5, SLATE_900);
  doc.text(bannerTitle, LEFT + 10, y + 15);
  font('normal', 7.5, SLATE_500);
  doc.text(bannerSubtitle, LEFT + 10, y + 27);

  doc.setFillColor(224, 231, 255);
  doc.rect(RIGHT - 110, y + 8, 100, 16, 'F');
  font('bold', 8, NAVY);
  doc.text(fyLabel.toUpperCase(), RIGHT - 60, y + 19, { align: 'center' });

  font('normal', 7, SLATE_700);
  doc.text(`Report ID: ${reportId}`, LEFT + 10, y + 43);
  doc.text(`Generated: ${formatIST(generatedAt)}`, LEFT + 165, y + 43);
  doc.text(`Scope: ${isDeptReport ? `${dept.name}${deptCode}` : 'All College Departments'}`, LEFT + 315, y + 43);
  y += bannerH + 8;

  font('normal', 6.8, SLATE_500);
  const scopeText = `Prepared for ${data?.generatedBy?.name ?? 'the Department'}. Coverage: submitted requisitions for ${fyLabel}. Drafts are excluded.`;
  doc.text(scopeText, LEFT, y + 4);
  y += 14;

  // ══════════════════════════════════════════════════════════════════════════
  // 1. REQUISITIONS EXECUTIVE SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  section('Executive Requisitions Summary');

  const cards = [
    ['REQUISITIONS FILED', String(register.length), `${compactMoney(totalRequested)} total requested`, INDIGO_500],
    ['AMOUNT SANCTIONED', compactMoney(totalSanctioned), totalRequested ? `${pct(totalSanctioned, totalRequested)}% of requested` : 'Nothing requested yet', EMERALD],
    ['APPROVED REQUISITIONS', String(approvedCount), register.length ? `${pct(approvedCount, register.length)}% of requisitions` : '—', AMBER],
    ['IN APPROVAL PIPELINE', String(pendingCount), 'Currently undergoing stage review', [139, 92, 246]],
    ['TOTAL LINE ITEMS', String(lineItems.length), 'Item-level requisitions submitted', SLATE_700],
    ['UNAPPROVED BALANCE', compactMoney(Math.max(0, totalRequested - totalSanctioned)), 'Pending decision or unsanctioned', SLATE_500],
  ];

  const gap = 8;
  const cardW = (WIDTH - gap * 2) / 3;
  const cardH = 46;
  ensure(cardH * 2 + gap + 10);
  cards.forEach(([label, value, sub, accent], i) => {
    const cx = LEFT + (i % 3) * (cardW + gap);
    const cy = y + Math.floor(i / 3) * (cardH + gap);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(0.6);
    doc.roundedRect(cx, cy, cardW, cardH, 4, 4, 'FD');
    doc.setFillColor(...accent);
    doc.rect(cx, cy + 6, 2.5, cardH - 12, 'F');
    font('bold', 6, SLATE_500);
    doc.text(label, cx + 10, cy + 12);
    font('bold', 13, SLATE_900);
    doc.text(value, cx + 10, cy + 28);
    font('normal', 6.2, SLATE_500);
    doc.text(doc.splitTextToSize(sub, cardW - 16)[0], cx + 10, cy + 39);
  });
  y += cardH * 2 + gap + 12;

  // ══════════════════════════════════════════════════════════════════════════
  // 2. REQUISITIONS REGISTER
  // ══════════════════════════════════════════════════════════════════════════
  section('Requisitions Register', 'Submitted requests with current workflow stage, status and financial totals.');

  if (!register.length) {
    emptyNote('No submitted requisitions on record for this scope.');
  } else {
    const body = register.map((r, i) => [
      i + 1,
      r.requestNumber,
      formatDate(r.submittedAt),
      doc.splitTextToSize(clean(r.title), 130),
      r.department || '—',
      r.budgetHead || '—',
      r.raisedBy || '—',
      r.stage || '—',
      statusInfo(r.status).label,
      formatMoney(r.requested),
      formatMoney(r.sanctioned),
    ]);
    body.push(['', 'TOTAL', '', '', '', '', '', '', '', formatMoney(totalRequested), formatMoney(totalSanctioned)]);
    table({
      head: [['#', 'Req. No.', 'Date', 'Title', 'Dept', 'Budget Head', 'Requisitioner', 'Stage', 'Status', 'Requested', 'Sanctioned']],
      body,
      totalRow: true,
      columnStyles: {
        0: { halign: 'center', cellWidth: 14 },
        1: { cellWidth: 50 },
        2: { cellWidth: 42 },
        3: { cellWidth: 95 },
        4: { cellWidth: 45 },
        5: { cellWidth: 50 },
        6: { cellWidth: 55 },
        7: { cellWidth: 50 },
        8: { cellWidth: 45 },
        9: { halign: 'right', cellWidth: 45 },
        10: { halign: 'right', cellWidth: 45 },
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. ITEMISED LINE-ITEM BREAKDOWN
  // ══════════════════════════════════════════════════════════════════════════
  section('Itemised Line-Item Breakdown', 'Detailed equipment, consumable and service items requested and approved.');

  if (!lineItems.length) {
    emptyNote('No line items recorded for the requisitions in this scope.');
  } else {
    const totalLineReq = lineItems.reduce((acc, item) => acc + num(item.estimatedTotal), 0);
    const totalLineAppr = lineItems.reduce((acc, item) => acc + num(item.approvedAmount), 0);

    const body = lineItems.map((item, i) => {
      const { displayName, displayRemarks } = parseCustomItem({ name: item.itemName }, item.remarks);
      const name = (displayName && displayName !== 'Other (specify)' && displayName !== 'Other (custom item)')
        ? displayName
        : (item.itemName || '—');
      const rem = displayRemarks ?? item.remarks;
      return [
        i + 1,
        item.requestNumber,
        doc.splitTextToSize(clean(name), 110),
        item.itemType || '—',
        `${num(item.requestedQuantity)} ${item.unit || ''}`.trim(),
        `${num(item.approvedQuantity)} ${item.unit || ''}`.trim(),
        formatMoney(item.estimatedUnitCost),
        formatMoney(item.estimatedTotal),
        formatMoney(item.approvedAmount),
        item.itemStatus || '—',
        doc.splitTextToSize(clean(rem || '—'), 60),
      ];
    });
    body.push(['', 'TOTAL', '', '', '', '', '', formatMoney(totalLineReq), formatMoney(totalLineAppr), '', '']);

    table({
      head: [['#', 'Req. No.', 'Item Description', 'Type', 'Req. Qty', 'Appr. Qty', 'Est. Rate', 'Est. Total', 'Sanctioned', 'Status', 'Remarks']],
      body,
      totalRow: true,
      columnStyles: {
        0: { halign: 'center', cellWidth: 14 },
        1: { cellWidth: 48 },
        2: { cellWidth: 95 },
        3: { cellWidth: 45 },
        4: { halign: 'right', cellWidth: 38 },
        5: { halign: 'right', cellWidth: 38 },
        6: { halign: 'right', cellWidth: 44 },
        7: { halign: 'right', cellWidth: 46 },
        8: { halign: 'right', cellWidth: 46 },
        9: { cellWidth: 40 },
        10: { cellWidth: 50 },
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. STAGE PIPELINE DISTRIBUTION
  // ══════════════════════════════════════════════════════════════════════════
  if (stages.length > 0) {
    section('Approval Pipeline & Workflow Distribution', 'Overview of requisitions active at various governance stages.');
    table({
      head: [['Stage Code', 'Workflow Stage', 'Active Requisitions', 'In-Process Amount', 'Avg Turnaround (Days)', 'Max Delay (Days)']],
      body: stages.map((s) => [
        s.code || '—',
        s.stage,
        s.requests,
        formatMoney(s.amount),
        s.avgDays ? `${s.avgDays} d` : '—',
        s.maxDays ? `${s.maxDays} d` : '—',
      ]),
      columnStyles: {
        0: { cellWidth: 70 },
        ...right([2, 3, 4, 5]),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. OFFICIAL CERTIFICATION & SIGNATURES
  // ══════════════════════════════════════════════════════════════════════════
  section('Institutional Endorsement & Certification');
  ensure(90);

  const sigBoxW = (WIDTH - 16) / 3;
  const sigBoxH = 75;
  const sigLabels = [
    ['REQUISITIONING AUTHORITY', isDeptReport ? `Head, Department of ${dept.name}` : 'Head of Department / Requisitioner'],
    ['INTERNAL AUDIT & ACCOUNTS', 'Finance & Budget Verification'],
    ['COMPETENT APPROVING AUTHORITY', 'Principal / Chairman / CDC'],
  ];

  sigLabels.forEach(([roleTitle, subTitle], i) => {
    const sx = LEFT + i * (sigBoxW + 8);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...SLATE_300);
    doc.setLineWidth(0.6);
    doc.roundedRect(sx, y, sigBoxW, sigBoxH, 3, 3, 'FD');

    doc.setFillColor(...SLATE_100);
    doc.rect(sx, y, sigBoxW, 14, 'F');
    font('bold', 6.2, NAVY);
    doc.text(roleTitle, sx + 6, y + 10);

    font('normal', 6, SLATE_500);
    doc.text(subTitle, sx + 6, y + 24);

    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(0.4);
    doc.line(sx + 10, y + 54, sx + sigBoxW - 10, y + 54);

    font('italic', 5.8, SLATE_500);
    doc.text('Signature & Official Seal', sx + sigBoxW / 2, y + 66, { align: 'center' });
  });
  y += sigBoxH + 15;

  // ── Running headers & footers on every page ──────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    if (i > 1) {
      font('bold', 6.5, NAVY);
      doc.text('S. P. COLLEGE, PUNE — DEPARTMENT REQUISITIONS REPORT', LEFT, 22);
      font('normal', 6.5, SLATE_500);
      doc.text(`${reportId} · ${fyLabel}`, RIGHT, 22, { align: 'right' });
      doc.setDrawColor(...SLATE_200);
      doc.setLineWidth(0.4);
      doc.line(LEFT, 26, RIGHT, 26);
    }

    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(0.4);
    doc.line(LEFT, PAGE_W > 600 ? 560 : 810, RIGHT, PAGE_W > 600 ? 560 : 810);
    font('normal', 6.5, SLATE_500);
    doc.text(`Generated on ${formatIST(generatedAt)} · S. P. College Autonomous Requisition Management System`, LEFT, 822);
    doc.text(`Page ${i} of ${pageCount}`, RIGHT, 822, { align: 'right' });
  }

  addPdfWatermark(doc);

  if (saveAsFilename) {
    doc.save(saveAsFilename);
  }
  return doc;
}
