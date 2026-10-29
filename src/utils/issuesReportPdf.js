import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatIST } from './officialPdfGenerator.js';
import { addPdfWatermark } from './pdfWatermark.js';

/*
 * Official SP College Campus Issues & Maintenance Log Report.
 *
 * Downloadable by HODs, faculty members and higher authorities.
 * Features institutional letterhead, status breakdown, complete issues
 * register with handler tracking, and official verification blocks.
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

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

const ISSUE_STATUS_LABELS = {
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In Review',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

export function generateIssuesReportPdf(data, saveAsFilename = null) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const fy = data?.financialYear ?? {};
  const fyLabel = fy.label ? `FY ${fy.label}` : 'Current Financial Year';
  const generatedAt = data?.generatedAt ?? new Date().toISOString();
  const dept = data?.department;
  const isDeptReport = Boolean(dept?.name);
  const deptCode = dept?.code ? ` (${dept.code})` : '';

  const reportId = isDeptReport
    ? `ISS-${(dept.code || 'DEPT').replace(/[^0-9A-Za-z]/g, '')}-FY${(fy.label ?? 'NA').replace(/[^0-9A-Za-z]/g, '')}-${new Date(generatedAt).toISOString().slice(0, 10).replace(/-/g, '')}`
    : `ISS-COMBINED-FY${(fy.label ?? 'NA').replace(/[^0-9A-Za-z]/g, '')}-${new Date(generatedAt).toISOString().slice(0, 10).replace(/-/g, '')}`;

  const issuesList = data?.issuesDetailed ?? [];
  const statusCounts = data?.issues ?? [];

  const totalIssues = issuesList.length;
  const inReviewCount = issuesList.filter((i) => i.status === 'IN_REVIEW' || i.status === 'SUBMITTED').length;
  const resolvedCount = issuesList.filter((i) => i.status === 'RESOLVED').length;
  const closedCount = issuesList.filter((i) => i.status === 'CLOSED').length;
  const completedCount = resolvedCount + closedCount;

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
  doc.text('Tilak Road, SadashPeth, Pune – 411030, Maharashtra, India', CENTER, y, { align: 'center' });
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
    ? `DEPARTMENT ISSUES & MAINTENANCE LOG — ${dept.name.toUpperCase()}`
    : 'INSTITUTIONAL CAMPUS ISSUES & MAINTENANCE LOG (COMBINED)';
  const bannerSubtitle = isDeptReport
    ? `Record of non-financial facility, laboratory and infrastructure issues for Department of ${dept.name}`
    : 'Comprehensive college-wide record of non-financial facility, laboratory and infrastructure issues';

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
  const scopeText = `Prepared for ${data?.generatedBy?.name ?? 'the Competent Authority'}. Coverage: non-financial issues logged for ${fyLabel}.`;
  doc.text(scopeText, LEFT, y + 4);
  y += 14;

  // ══════════════════════════════════════════════════════════════════════════
  // 1. EXECUTIVE SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  section('Issues & Resolution Summary');

  const cards = [
    ['TOTAL ISSUES LOGGED', String(totalIssues), 'Maintenance & facility requests', INDIGO_500],
    ['ACTIVE / IN REVIEW', String(inReviewCount), 'Currently undergoing investigation', AMBER],
    ['RESOLVED ISSUES', String(resolvedCount), `${pct(resolvedCount, totalIssues)}% turnaround rate`, EMERALD],
    ['CLOSED & ARCHIVED', String(closedCount), 'Action taken and confirmed', SLATE_700],
    ['OVERALL RESOLUTION RATE', totalIssues ? `${pct(completedCount, totalIssues)}%` : '—', `${completedCount} of ${totalIssues} completed`, [16, 185, 129]],
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
  // 2. ISSUES REGISTER & LOG
  // ══════════════════════════════════════════════════════════════════════════
  section('Detailed Issues Register & Action Log', 'Complete record of reported issues, handlers and timestamps.');

  if (!issuesList.length) {
    emptyNote('No issues reported on record for this scope.');
  } else {
    const body = issuesList.map((iss, i) => [
      i + 1,
      iss.issueNumber,
      formatDate(iss.createdAt),
      iss.department || '—',
      iss.raisedBy || '—',
      doc.splitTextToSize(clean(iss.title), 160),
      doc.splitTextToSize(clean(iss.description), 157),
      ISSUE_STATUS_LABELS[iss.status] || iss.status,
      formatDate(iss.resolvedAt),
    ]);

    table({
      head: [['#', 'Issue No.', 'Logged Date', 'Dept', 'Raised By', 'Title', 'Description Summary', 'Status', 'Resolved']],
      body,
      columnStyles: {
        0: { halign: 'center', cellWidth: 14 },
        1: { cellWidth: 46 },
        2: { cellWidth: 40 },
        3: { cellWidth: 42 },
        4: { cellWidth: 50 },
        5: { cellWidth: 125 },
        6: { cellWidth: 122 },
        7: { cellWidth: 46 },
        8: { cellWidth: 38 },
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. STATUS DISTRIBUTION
  // ══════════════════════════════════════════════════════════════════════════
  if (statusCounts.length > 0) {
    section('Issues Lifecycle Status Breakdown', 'Aggregated volume by operational workflow stage.');
    table({
      head: [['Status Identifier', 'Status Description', 'Issues Count', 'Percentage of Total']],
      body: statusCounts.map((s) => [
        s.status,
        ISSUE_STATUS_LABELS[s.status] || s.status,
        s.n,
        totalIssues ? `${pct(s.n, totalIssues)}%` : '—',
      ]),
      columnStyles: {
        0: { cellWidth: 90 },
        ...right([2, 3]),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. VERIFICATION & CERTIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  section('Institutional Verification & Endorsement');
  ensure(90);

  const sigBoxW = (WIDTH - 16) / 3;
  const sigBoxH = 75;
  const sigLabels = [
    ['FACILITY & ESTATE COORDINATOR', 'Campus Maintenance Cell'],
    ['HEAD OF DEPARTMENT', isDeptReport ? `Department of ${dept.name}` : 'Requisitioning Department'],
    ['PRINCIPAL / COMPETENT AUTHORITY', 'Sir Parashurambhau College'],
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
    doc.text('Signature & Official Stamp', sx + sigBoxW / 2, y + 66, { align: 'center' });
  });
  y += sigBoxH + 15;

  // ── Running headers & footers on every page ──────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    if (i > 1) {
      font('bold', 6.5, NAVY);
      doc.text('S. P. COLLEGE, PUNE — CAMPUS ISSUES & MAINTENANCE LOG', LEFT, 22);
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
    doc.text(`Generated on ${formatIST(generatedAt)} · S. P. College Facility Management Portal`, LEFT, 822);
    doc.text(`Page ${i} of ${pageCount}`, RIGHT, 822, { align: 'right' });
  }

  addPdfWatermark(doc);

  if (saveAsFilename) {
    doc.save(saveAsFilename);
  }
  return doc;
}
