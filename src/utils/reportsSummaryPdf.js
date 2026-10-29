import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { statusInfo } from '../api/format.js';
import { formatIST, formatMoney } from './officialPdfGenerator.js';
import { addPdfWatermark } from './pdfWatermark.js';

/*
 * The Reports page as an official, print-ready institutional document.
 *
 * Same letterhead, banner, numbered sections, running headers / footers and
 * certification block as the per-request Official Approval Report, so the two
 * read as one family of college records. The figures come from
 * GET /api/reports/summary, which runs under the reader's row-level security:
 * the Principal's report covers the college, anyone else's only what they can
 * already see.
 */

// ── Layout (A4 portrait, points) ────────────────────────────────────────────
const PAGE_W = 595.28;
const CENTER = PAGE_W / 2;
const LEFT = 36;
const RIGHT = 559;
const WIDTH = RIGHT - LEFT; // 523pt
const MAX_Y = 770;
const TABLE_MARGIN = { left: LEFT, right: PAGE_W - RIGHT, top: 40, bottom: 45 };

// ── Palette (matches officialPdfGenerator) ──────────────────────────────────
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
const INDIGO_200 = [199, 210, 254];
const INDIGO_500 = [99, 102, 241];
const EMERALD = [16, 185, 129];
const EMERALD_700 = [4, 120, 87];

// Status tones for the distribution bar, keyed like format.js's TONES.
const TONE_RGB = {
  gray: [148, 163, 184],
  amber: [245, 158, 11],
  violet: [139, 92, 246],
  emerald: [16, 185, 129],
  teal: [20, 184, 166],
  red: [239, 68, 68],
  sky: [14, 165, 233],
  orange: [249, 115, 22],
};
const STATUS_TONE = {
  SUBMITTED: 'amber',
  UNDER_PURCHASE_COMMITTEE_REVIEW: 'amber',
  UNDER_PRINCIPAL_REVIEW: 'orange',
  UNDER_CDC_REVIEW: 'violet',
  UNDER_FINAL_AUTHORITY_REVIEW: 'violet',
  AWAITING_RESUBMISSION: 'orange',
  APPROVED: 'emerald',
  PARTIALLY_APPROVED: 'teal',
  REJECTED: 'red',
  ESCALATED: 'violet',
  FULFILMENT_PENDING: 'sky',
  FULFILLED: 'emerald',
  CLOSED: 'gray',
  CARRIED_FORWARD: 'gray',
};

// ── Formatting helpers ──────────────────────────────────────────────────────
const num = (v) => Number(v ?? 0) || 0;
const pct = (part, whole) => (num(whole) > 0 ? Math.round((num(part) / num(whole)) * 100) : 0);
const pctLabel = (part, whole) => (num(whole) > 0 ? `${pct(part, whole)}%` : '—');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const statusLabel = (s) => statusInfo(s).label;
const title = (s) => (s ? String(s).charAt(0) + String(s).slice(1).toLowerCase().replace(/_/g, ' ') : '—');
const clean = (s) => (s === null || s === undefined ? '' : String(s).replace(/[\r\n\t]+/g, ' ').trim());

/** Rs. 1.2 Cr / Rs. 121.1 L / Rs. 35,096 — compact, for stat tiles. */
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

function monthLabel(ym) {
  const [y, m] = String(ym).split('-').map(Number);
  if (!y || !m) return ym ?? '—';
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Totals across the budget-head rows — the exact arithmetic the page uses. */
export function summaryTotals(data) {
  const rows = data?.byBudgetHead ?? [];
  const t = rows.reduce((acc, r) => ({
    requests: acc.requests + num(r.requests),
    approved: acc.approved + num(r.approved),
    partial: acc.partial + num(r.partial),
    rejected: acc.rejected + num(r.rejected),
    pending: acc.pending + num(r.pending),
    requested: acc.requested + num(r.requested),
    sanctioned: acc.sanctioned + num(r.sanctioned),
  }), { requests: 0, approved: 0, partial: 0, rejected: 0, pending: 0, requested: 0, sanctioned: 0 });
  t.decided = t.approved + t.rejected;
  return t;
}

/**
 * Builds the report. Returns the jsPDF instance; saves it when a filename is
 * given.
 */
export function generateReportsSummaryPdf(data, saveAsFilename = null) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const fy = data?.financialYear ?? {};
  const fyLabel = fy.label ? `FY ${fy.label}` : 'Current Financial Year';
  const generatedAt = data?.generatedAt ?? new Date().toISOString();
  const dept = data?.department;
  const isDeptReport = Boolean(dept?.name);
  const deptCode = dept?.code ? ` (${dept.code})` : '';
  const reportId = isDeptReport
    ? `RPT-${(dept.code || 'DEPT').replace(/[^0-9A-Za-z]/g, '')}-FY${(fy.label ?? 'NA').replace(/[^0-9A-Za-z]/g, '')}-${new Date(generatedAt).toISOString().slice(0, 10).replace(/-/g, '')}`
    : `RPT-FY${(fy.label ?? 'NA').replace(/[^0-9A-Za-z]/g, '')}-${new Date(generatedAt).toISOString().slice(0, 10).replace(/-/g, '')}`;
  const totals = summaryTotals(data);
  const heads = data?.byBudgetHead ?? [];
  const statuses = data?.byStatus ?? [];
  const depts = data?.byDepartment ?? [];
  const stages = data?.byStage ?? [];
  const itemTypes = data?.byItemType ?? [];
  const funding = data?.byFunding ?? [];
  const monthly = data?.monthly ?? [];
  const provisions = data?.provisions ?? [];
  const ageing = data?.pendingOverThreeDays ?? [];
  const register = data?.register ?? [];
  const issues = data?.issues ?? [];
  const roles = data?.generatedBy?.roles ?? [];
  const collegeWide = roles.some((r) => ['PRINCIPAL', 'ADMIN', 'CHAIRMAN', 'VICE_PRESIDENT'].includes(r));

  let y = 40;

  // ── helpers bound to this document ────────────────────────────────────────
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
  const subheading = (text) => {
    ensure(40);
    font('bold', 7.5, NAVY);
    doc.text(text, LEFT, y + 2);
    y += 9;
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
    ? `DEPARTMENT APPROVAL & BUDGET REPORT — ${dept.name.toUpperCase()}`
    : 'INSTITUTIONAL PROCUREMENT & BUDGET UTILISATION REPORT';
  const bannerSubtitle = isDeptReport
    ? `Departmental analysis of submitted purchase requests, budget head sanctions and provisions for ${dept.name}`
    : 'Consolidated college-wide analysis of submitted purchase requests, sanctions and the approval pipeline';

  font('bold', 10, SLATE_900);
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
  doc.text(`Period: ${formatDate(fy.startDate)} – ${formatDate(fy.endDate)}`, LEFT + 315, y + 43);
  y += bannerH + 8;

  font('normal', 6.8, SLATE_500);
  const scopeText = isDeptReport
    ? `Prepared for ${data?.generatedBy?.name ?? 'the Competent Authority'}. Coverage: submitted requests for Department of ${dept.name}${deptCode} for ${fyLabel}. Drafts are excluded.`
    : (collegeWide
      ? `Prepared for ${data?.generatedBy?.name ?? 'the Competent Authority'}. Coverage: all submitted requests across all college departments for ${fyLabel}. Drafts are excluded.`
      : `Prepared for ${data?.generatedBy?.name ?? 'the requesting user'}. Coverage: only the requests this user is permitted to view for ${fyLabel}. Drafts are excluded.`);
  doc.text(scopeText, LEFT, y + 4);
  y += 14;

  // ══════════════════════════════════════════════════════════════════════════
  // 1. EXECUTIVE SUMMARY
  // ══════════════════════════════════════════════════════════════════════════
  section('Executive Summary');

  const cards = [
    ['REQUESTS SUBMITTED', String(totals.requests), `${compactMoney(totals.requested)} requested`, INDIGO_500],
    ['AMOUNT SANCTIONED', compactMoney(totals.sanctioned), totals.requested ? `${pct(totals.sanctioned, totals.requested)}% of the amount requested` : 'Nothing requested yet', EMERALD],
    ['APPROVAL RATE', totals.decided ? `${pct(totals.approved, totals.decided)}%` : '—', totals.decided ? `${totals.approved} approved of ${totals.decided} decided` : 'No decisions yet', AMBER],
    ['IN APPROVAL PIPELINE', String(totals.pending), `${plural(ageing.length, 'request')} pending over 3 days`, [139, 92, 246]],
    ['REJECTED', String(totals.rejected), totals.requests ? `${pct(totals.rejected, totals.requests)}% of submitted requests` : '—', [239, 68, 68]],
    ['UNSANCTIONED BALANCE', compactMoney(Math.max(0, totals.requested - totals.sanctioned)), 'Requested but not (yet) sanctioned', SLATE_500],
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

  // Narrative
  const topHead = heads[0];
  const topDept = depts[0];
  const narrative = [
    `During ${fyLabel} (${formatDate(fy.startDate)} to ${formatDate(fy.endDate)}), ${plural(totals.requests, 'purchase request')} with a combined estimated value of ${formatMoney(totals.requested)} ${totals.requests === 1 ? 'was' : 'were'} submitted through the S.P. College Approval Hub.`,
    totals.decided
      ? `Of the ${totals.decided} requests decided so far, ${totals.approved} ${totals.approved === 1 ? 'was' : 'were'} sanctioned${totals.partial ? ` (${totals.partial} of them partially)` : ''} and ${totals.rejected} rejected, giving an approval rate of ${pct(totals.approved, totals.decided)}%.`
      : 'No request has reached a final decision yet.',
    `A total of ${formatMoney(totals.sanctioned)} has been sanctioned, equal to ${pctLabel(totals.sanctioned, totals.requested)} of the amount requested. ${plural(totals.pending, 'request')} ${totals.pending === 1 ? 'remains' : 'remain'} in the approval pipeline.`,
    topHead ? `${topHead.budgetHead.name} (${title(topHead.budgetHead.headType)}) is the largest budget head by value at ${formatMoney(topHead.requested)}, ${pctLabel(topHead.requested, totals.requested)} of all funds requested.` : '',
    topDept && depts.length > 1 ? `${topDept.name} accounts for the highest departmental demand at ${formatMoney(topDept.requested)}.` : '',
  ].filter(Boolean).join(' ');
  font('normal', 7.3, SLATE_800);
  const narrLines = doc.splitTextToSize(narrative, WIDTH - 16);
  const narrH = narrLines.length * 9.5 + 10;
  ensure(narrH + 6);
  doc.setFillColor(...SLATE_50);
  doc.setDrawColor(...SLATE_200);
  doc.rect(LEFT, y, WIDTH, narrH, 'FD');
  doc.text(narrLines, LEFT + 8, y + 11, { lineHeightFactor: 1.3 });
  y += narrH + 12;

  // ══════════════════════════════════════════════════════════════════════════
  // 2. BUDGET HEAD-WISE ANALYSIS
  // ══════════════════════════════════════════════════════════════════════════
  section('Budget Head-wise Analysis', 'Requested versus sanctioned amounts for each budget head, as shown on the Reports page. Sanctioned amounts count only requests that have been approved or partially approved.');

  if (!heads.length) {
    emptyNote('No submitted requests were found for this financial year.');
  } else {
    // Legend
    ensure(20);
    font('normal', 6.5, SLATE_500);
    doc.setFillColor(...INDIGO_200);
    doc.rect(RIGHT - 128, y - 5, 10, 5, 'F');
    doc.text('Requested', RIGHT - 115, y);
    doc.setFillColor(...EMERALD);
    doc.rect(RIGHT - 70, y - 5, 10, 5, 'F');
    doc.text('Sanctioned', RIGHT - 57, y);
    y += 8;

    const max = Math.max(1, ...heads.map((h) => num(h.requested)));
    heads.forEach((h) => {
      ensure(26);
      font('bold', 7.2, SLATE_800);
      const name = h.budgetHead.name;
      doc.text(name, LEFT, y + 6);
      const nameW = doc.getTextWidth(name);
      font('normal', 6.6, SLATE_500);
      doc.text(` · ${title(h.budgetHead.headType).toLowerCase()} · ${plural(h.requests, 'request')}`, LEFT + nameW, y + 6);
      font('bold', 7, EMERALD_700);
      const ofText = ` of ${formatMoney(h.requested)}`;
      font('normal', 7, SLATE_600);
      const ofW = doc.getTextWidth(ofText);
      doc.text(ofText, RIGHT, y + 6, { align: 'right' });
      font('bold', 7, EMERALD_700);
      doc.text(formatMoney(h.sanctioned), RIGHT - ofW, y + 6, { align: 'right' });

      const barY = y + 10;
      doc.setFillColor(...SLATE_100);
      doc.roundedRect(LEFT, barY, WIDTH, 5, 2.5, 2.5, 'F');
      const rw = Math.max(2, (num(h.requested) / max) * WIDTH);
      doc.setFillColor(...INDIGO_200);
      doc.roundedRect(LEFT, barY, rw, 5, 2.5, 2.5, 'F');
      if (num(h.sanctioned) > 0) {
        const sw = Math.max(2, (num(h.sanctioned) / max) * WIDTH);
        doc.setFillColor(...EMERALD);
        doc.roundedRect(LEFT, barY, sw, 5, 2.5, 2.5, 'F');
      }
      y += 24;
    });
    y += 4;

    subheading('Detailed budget head statement:');
    const body = heads.map((h, i) => [
      i + 1,
      h.budgetHead.name,
      title(h.budgetHead.headType),
      h.requests, h.approved, h.partial, h.rejected, h.pending,
      formatMoney(h.requested), formatMoney(h.sanctioned),
      pctLabel(h.sanctioned, h.requested),
      pctLabel(h.requested, totals.requested),
    ]);
    body.push(['', 'TOTAL', '', totals.requests, totals.approved, totals.partial, totals.rejected, totals.pending,
      formatMoney(totals.requested), formatMoney(totals.sanctioned), pctLabel(totals.sanctioned, totals.requested), '100%']);
    table({
      head: [['#', 'Budget Head', 'Type', 'Req.', 'Appr.*', 'Partial', 'Rej.', 'Pending', 'Requested', 'Sanctioned', 'Sanction %', 'Share']],
      body,
      totalRow: true,
      columnStyles: { 0: { halign: 'center', cellWidth: 16 }, ...right([3, 4, 5, 6, 7, 8, 9, 10, 11]) },
    });
    font('italic', 6.2, SLATE_500);
    doc.text('* Approved includes partially approved, fulfilment-pending, fulfilled and closed requests.', LEFT, y - 5);
    y += 4;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 3. STATUS DISTRIBUTION
  // ══════════════════════════════════════════════════════════════════════════
  section('Request Status Distribution', 'Where every submitted request stands today.');

  if (!statuses.length) {
    emptyNote('No submitted requests to classify.');
  } else {
    const total = statuses.reduce((s, r) => s + num(r.requests), 0) || 1;
    ensure(40);
    let x = LEFT;
    statuses.forEach((s) => {
      const w = (num(s.requests) / total) * WIDTH;
      doc.setFillColor(...TONE_RGB[STATUS_TONE[s.status] ?? 'gray']);
      doc.rect(x, y, w, 9, 'F');
      x += w;
    });
    y += 15;
    // Legend
    let lx = LEFT;
    font('normal', 6.4, SLATE_600);
    statuses.forEach((s) => {
      const label = `${statusLabel(s.status)} (${s.requests})`;
      const w = doc.getTextWidth(label) + 18;
      if (lx + w > RIGHT) { lx = LEFT; y += 10; }
      doc.setFillColor(...TONE_RGB[STATUS_TONE[s.status] ?? 'gray']);
      doc.rect(lx, y - 5, 7, 5, 'F');
      doc.text(label, lx + 10, y);
      lx += w;
    });
    y += 12;

    table({
      head: [['#', 'Status', 'Requests', 'Share', 'Amount Requested', 'Amount Sanctioned']],
      body: [
        ...statuses.map((s, i) => [i + 1, statusLabel(s.status), s.requests, pctLabel(s.requests, total), formatMoney(s.requested), formatMoney(s.sanctioned)]),
        ['', 'TOTAL', total, '100%', formatMoney(statuses.reduce((a, s) => a + num(s.requested), 0)), formatMoney(statuses.reduce((a, s) => a + num(s.sanctioned), 0))],
      ],
      totalRow: true,
      columnStyles: { 0: { halign: 'center', cellWidth: 16 }, ...right([2, 3, 4, 5]) },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 4. DEPARTMENT-WISE ANALYSIS
  // ══════════════════════════════════════════════════════════════════════════
  section('Department-wise Analysis', 'Demand, outcomes and sanctions for each department raising requests.');
  if (!depts.length) {
    emptyNote('No departmental data for this period.');
  } else {
    table({
      head: [['#', 'Department', 'Req.', 'Approved', 'Rejected', 'Pending', 'Requested', 'Sanctioned', 'Sanction %', 'Approval Rate']],
      body: depts.map((d, i) => [
        i + 1, d.name + (d.code ? ` (${d.code})` : ''), d.requests, d.approved, d.rejected, d.pending,
        formatMoney(d.requested), formatMoney(d.sanctioned), pctLabel(d.sanctioned, d.requested),
        pctLabel(d.approved, num(d.approved) + num(d.rejected)),
      ]),
      columnStyles: { 0: { halign: 'center', cellWidth: 16 }, ...right([2, 3, 4, 5, 6, 7, 8, 9]) },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 5. FUNDING SOURCE & ITEM CATEGORY
  // ══════════════════════════════════════════════════════════════════════════
  section('Funding Source & Item Category Analysis', 'Grant-aided versus non-grant (self-financed) courses, and the nature of the items requested.');

  subheading('By funding source of the course:');
  if (!funding.length) {
    emptyNote('No funding data available.');
  } else {
    table({
      head: [['Funding Source', 'Requests', 'Approved', 'Rejected', 'Pending', 'Requested', 'Sanctioned', 'Sanction %']],
      body: funding.map((f) => [
        f.funding === 'GRANT' ? 'Grant-aided' : f.funding === 'NON_GRANT' ? 'Non-Grant (Self-financed)' : 'Not linked to a course',
        f.requests, f.approved, f.rejected, f.pending, formatMoney(f.requested), formatMoney(f.sanctioned), pctLabel(f.sanctioned, f.requested),
      ]),
      columnStyles: right([1, 2, 3, 4, 5, 6, 7]),
    });
  }

  subheading('By item category (line-item level):');
  if (!itemTypes.length) {
    emptyNote('No line items recorded.');
  } else {
    const itTotal = itemTypes.reduce((a, r) => ({ lines: a.lines + num(r.lines), requested: a.requested + num(r.requested), approved: a.approved + num(r.approved) }), { lines: 0, requested: 0, approved: 0 });
    table({
      head: [['Item Category', 'Line Items', 'Qty Requested', 'Qty Approved', 'Value Requested', 'Value Approved', 'Approved %', 'Share of Value']],
      body: [
        ...itemTypes.map((r) => [
          title(r.itemType), r.lines,
          num(r.requestedQty).toLocaleString('en-IN'), num(r.approvedQty).toLocaleString('en-IN'),
          formatMoney(r.requested), formatMoney(r.approved), pctLabel(r.approved, r.requested), pctLabel(r.requested, itTotal.requested),
        ]),
        ['TOTAL', itTotal.lines, '', '', formatMoney(itTotal.requested), formatMoney(itTotal.approved), pctLabel(itTotal.approved, itTotal.requested), '100%'],
      ],
      totalRow: true,
      columnStyles: right([1, 2, 3, 4, 5, 6, 7]),
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 6. MONTHLY TREND
  // ══════════════════════════════════════════════════════════════════════════
  section('Monthly Submission Trend', 'Requests grouped by the month they were submitted.');
  if (!monthly.length) {
    emptyNote('No submissions recorded in this period.');
  } else {
    // Chart
    const chartH = 90;
    ensure(chartH + 30);
    const max = Math.max(1, ...monthly.map((m) => num(m.requested)));
    const slot = WIDTH / monthly.length;
    const barW = Math.min(18, slot / 3);
    const baseY = y + chartH;
    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(0.4);
    [0, 0.5, 1].forEach((f) => {
      const gy = baseY - f * (chartH - 12);
      doc.line(LEFT, gy, RIGHT, gy);
      font('normal', 5.5, SLATE_500);
      if (f > 0) doc.text(compactMoney(max * f), LEFT + 1, gy - 2);
    });
    monthly.forEach((m, i) => {
      const cx = LEFT + slot * i + slot / 2;
      const rh = (num(m.requested) / max) * (chartH - 12);
      const sh = (num(m.sanctioned) / max) * (chartH - 12);
      doc.setFillColor(...INDIGO_200);
      doc.rect(cx - barW - 1, baseY - rh, barW, rh, 'F');
      doc.setFillColor(...EMERALD);
      if (sh > 0) doc.rect(cx + 1, baseY - sh, barW, sh, 'F');
      font('normal', 6, SLATE_600);
      doc.text(monthLabel(m.month), cx, baseY + 9, { align: 'center' });
      font('bold', 5.8, SLATE_700);
      doc.text(String(m.requests), cx - barW / 2 - 1, baseY - rh - 2, { align: 'center' });
    });
    y = baseY + 20;

    table({
      head: [['Month', 'Submitted', 'Approved', 'Rejected', 'Pending', 'Requested', 'Sanctioned', 'Sanction %']],
      body: monthly.map((m) => [monthLabel(m.month), m.requests, m.approved, m.rejected, m.pending, formatMoney(m.requested), formatMoney(m.sanctioned), pctLabel(m.sanctioned, m.requested)]),
      columnStyles: right([1, 2, 3, 4, 5, 6, 7]),
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 7. APPROVAL PIPELINE & AGEING
  // ══════════════════════════════════════════════════════════════════════════
  section('Approval Pipeline & Ageing', 'Requests currently under review, by the stage they are waiting at, and every request pending for more than three days.');

  subheading('Pending requests by approval stage:');
  if (!stages.length) {
    emptyNote('No request is currently under review.');
  } else {
    table({
      head: [['Stage', 'Requests Waiting', 'Value Under Review', 'Average Days Pending', 'Longest Wait (days)']],
      body: stages.map((s) => [s.stage ?? '—', s.requests, formatMoney(s.amount), num(s.avgDays).toFixed(1), s.maxDays ?? '—']),
      columnStyles: right([1, 2, 3, 4]),
    });
  }

  subheading('Requests pending for more than 3 days:');
  if (!ageing.length) {
    emptyNote('No request has been pending for more than three days.');
  } else {
    table({
      head: [['#', 'Request No.', 'Title', 'Raised By', 'Current Stage', 'Amount', 'Submitted', 'Days']],
      body: ageing.map((a, i) => [i + 1, a.requestNumber, clean(a.title), a.raisedBy, a.stage ?? statusLabel(a.status), formatMoney(a.amount), formatDate(a.submittedAt), a.daysPending]),
      columnStyles: { 0: { halign: 'center', cellWidth: 16 }, 1: { cellWidth: 62 }, 2: { cellWidth: 120 }, 5: { halign: 'right' }, 7: { halign: 'right', cellWidth: 28 } },
      didParseCell: (c) => {
        if (c.section === 'body' && c.column.index === 7 && num(c.cell.raw) > 7) {
          c.cell.styles.textColor = [185, 28, 28];
          c.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 8. DEPARTMENTAL BUDGET PROVISIONS
  // ══════════════════════════════════════════════════════════════════════════
  section('Departmental Budget Provisions', 'Annual provisions declared by departments against what has already been sanctioned and what is committed in pending requests.');
  if (!provisions.length) {
    emptyNote('No budget provisions have been declared (or are visible) for this financial year.');
  } else {
    const pt = provisions.reduce((a, p) => ({
      allocated: a.allocated + num(p.allocated), utilized: a.utilized + num(p.utilized),
      committed: a.committed + num(p.committed), remaining: a.remaining + num(p.remaining),
    }), { allocated: 0, utilized: 0, committed: 0, remaining: 0 });
    table({
      head: [['Department', 'Budget Head', 'Annual Provision', 'Sanctioned', 'Committed', 'Remaining', 'Utilised %']],
      body: [
        ...provisions.map((p) => [p.department, p.budgetHead ?? 'All heads', formatMoney(p.allocated), formatMoney(p.utilized), formatMoney(p.committed), formatMoney(p.remaining), pctLabel(p.utilized, p.allocated)]),
        ['TOTAL', '', formatMoney(pt.allocated), formatMoney(pt.utilized), formatMoney(pt.committed), formatMoney(pt.remaining), pctLabel(pt.utilized, pt.allocated)],
      ],
      totalRow: true,
      columnStyles: right([2, 3, 4, 5, 6]),
      didParseCell: (c) => {
        if (c.section === 'body' && c.column.index === 5 && String(c.cell.raw).includes('-')) {
          c.cell.styles.textColor = [185, 28, 28];
        }
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 9. COMPLETE REQUEST REGISTER
  // ══════════════════════════════════════════════════════════════════════════
  section('Complete Request Register', `Every submitted request for ${fyLabel}, in order of submission.`);
  if (!register.length) {
    emptyNote('No submitted requests.');
  } else {
    table({
      head: [['#', 'Request No.', 'Title', 'Department', 'Budget Head', 'Status', 'Requested', 'Sanctioned', 'Submitted']],
      body: register.map((r, i) => [
        i + 1, r.requestNumber, clean(r.title), r.department ?? '—', r.budgetHead, statusLabel(r.status),
        formatMoney(r.requested), r.sanctioned != null ? formatMoney(r.sanctioned) : '—', formatDate(r.submittedAt),
      ]),
      styles: { fontSize: 6.3, cellPadding: 2.4, textColor: SLATE_800, lineColor: SLATE_200, lineWidth: 0.4 },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6.3 },
      columnStyles: { 0: { halign: 'center', cellWidth: 16 }, 1: { cellWidth: 58 }, 2: { cellWidth: 110 }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { cellWidth: 52 } },
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 10. NON-FINANCIAL ISSUES
  // ══════════════════════════════════════════════════════════════════════════
  section('Faculty Issues (Non-Financial)', 'Issues logged by staff during the financial year, by status.');
  if (!issues.length) {
    emptyNote('No faculty issues were logged in this period.');
  } else {
    const it = issues.reduce((a, r) => a + num(r.n), 0);
    table({
      head: [['Status', 'Issues', 'Share']],
      body: [...issues.map((r) => [statusInfo(r.status, 'issue').label, r.n, pctLabel(r.n, it)]), ['TOTAL', it, '100%']],
      totalRow: true,
      tableWidth: 260,
      columnStyles: right([1, 2]),
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 11. KEY OBSERVATIONS
  // ══════════════════════════════════════════════════════════════════════════
  section('Key Observations');
  const obs = [];
  if (topHead) obs.push(`${topHead.budgetHead.name} carries the largest share of demand (${pctLabel(topHead.requested, totals.requested)} of value) with ${formatMoney(topHead.sanctioned)} sanctioned of ${formatMoney(topHead.requested)}.`);
  const unsanctionedHeads = heads.filter((h) => num(h.sanctioned) === 0);
  if (unsanctionedHeads.length) obs.push(`No amount has yet been sanctioned under ${unsanctionedHeads.map((h) => h.budgetHead.name).join(', ')}.`);
  const capital = heads.filter((h) => h.budgetHead.headType === 'CAPITAL').reduce((a, h) => a + num(h.requested), 0);
  if (totals.requested) obs.push(`Capital heads account for ${pctLabel(capital, totals.requested)} of requested value; revenue heads for ${pctLabel(totals.requested - capital, totals.requested)}.`);
  if (stages.length) {
    const busiest = [...stages].sort((a, b) => num(b.requests) - num(a.requests))[0];
    obs.push(`The ${busiest.stage} stage holds the most pending requests (${busiest.requests}, worth ${formatMoney(busiest.amount)}), with an average wait of ${num(busiest.avgDays).toFixed(1)} days.`);
  }
  if (ageing.length) obs.push(`${plural(ageing.length, 'request')} ${ageing.length === 1 ? 'has' : 'have'} been pending for more than three days; the oldest, ${ageing[0].requestNumber}, has waited ${ageing[0].daysPending} days.`);
  else if (totals.pending) obs.push('All pending requests are within the three-day review window.');
  const over = provisions.filter((p) => num(p.remaining) < 0);
  if (over.length) obs.push(`Commitments exceed the declared provision for ${over.map((p) => p.department).join(', ')}.`);
  const high = provisions.filter((p) => num(p.remaining) >= 0 && pct(p.utilized, p.allocated) >= 90);
  if (high.length) obs.push(`${high.map((p) => p.department).join(', ')} ${high.length === 1 ? 'has' : 'have'} utilised 90% or more of the annual provision.`);
  if (totals.decided) obs.push(`The overall approval rate on decided requests is ${pct(totals.approved, totals.decided)}% (${totals.approved} approved, ${totals.rejected} rejected).`);
  if (!obs.length) obs.push('There is not yet enough activity in this period to draw observations.');

  obs.forEach((o, i) => {
    font('normal', 7.2, SLATE_800);
    const lines = doc.splitTextToSize(o, WIDTH - 22);
    ensure(lines.length * 9 + 6);
    doc.setFillColor(...NAVY);
    doc.circle(LEFT + 5, y + 3.2, 1.6, 'F');
    font('bold', 7.2, NAVY);
    doc.text(`${i + 1}.`, LEFT + 10, y + 5);
    font('normal', 7.2, SLATE_800);
    doc.text(lines, LEFT + 22, y + 5);
    y += lines.length * 9 + 5;
  });
  y += 8;

  // ══════════════════════════════════════════════════════════════════════════
  // 12. SYSTEM AUDIT INFORMATION
  // ══════════════════════════════════════════════════════════════════════════
  section('System Audit Information');
  table({
    head: [['Audit Metric', 'System Value', 'Audit Metric', 'System Value']],
    body: [
      ['Report Identifier', reportId, 'Report Type', 'Consolidated FY Summary'],
      ['Financial Year', fyLabel, 'Period Covered', `${formatDate(fy.startDate)} – ${formatDate(fy.endDate)}`],
      ['Generated Timestamp', formatIST(generatedAt), 'Generated By', data?.generatedBy?.name ?? '—'],
      ['Requests Analysed', String(totals.requests), 'Budget Heads Covered', String(heads.length)],
      ['Departments Covered', String(depts.length), 'Data Scope', collegeWide ? 'College-wide' : 'Restricted to user visibility'],
      ['Data Source', 'S.P. College Approval Hub (live)', 'Access Control', 'Row-Level Security enforced'],
    ],
    headStyles: { fillColor: SLATE_600, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: { 0: { fontStyle: 'bold', textColor: SLATE_600 }, 2: { fontStyle: 'bold', textColor: SLATE_600 } },
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 13. CERTIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  section('Institutional Certification & Official Endorsement');
  ensure(110);
  doc.setFillColor(...SLATE_50);
  doc.setDrawColor(...SLATE_300);
  doc.roundedRect(LEFT, y, WIDTH, 30, 2, 2, 'FD');
  font('italic', 7, SLATE_800);
  doc.text(
    '"This report is a system-generated institutional record of the requests, sanctions and approval status available in the system at the time of report generation."',
    CENTER, y + 13, { align: 'center', maxWidth: WIDTH - 20 },
  );
  y += 40;

  const sigY = y + 34;
  const sigW = WIDTH / 3;
  [
    ['Accounts / Office Superintendent', 'Prepared & Verified'],
    ['Purchase Committee Convener', 'Reviewed'],
    ['Principal', 'Official Institutional Seal'],
  ].forEach(([role, note], i) => {
    const x0 = LEFT + i * sigW + 15;
    const x1 = LEFT + (i + 1) * sigW - 15;
    doc.setDrawColor(148, 163, 184);
    doc.setLineWidth(0.8);
    doc.line(x0, sigY, x1, sigY);
    font('bold', 7.5, SLATE_700);
    doc.text(role, (x0 + x1) / 2, sigY + 11, { align: 'center' });
    font('normal', 6.5, SLATE_500);
    doc.text(note, (x0 + x1) / 2, sigY + 21, { align: 'center' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RUNNING HEADERS & FOOTERS
  // ══════════════════════════════════════════════════════════════════════════
  const pages = doc.internal.getNumberOfPages();
  const genIST = formatIST(generatedAt);
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    if (i > 1) {
      font('bold', 7, SLATE_500);
      doc.text(`S.P. COLLEGE, PUNE — PROCUREMENT & BUDGET REPORT · ${fyLabel.toUpperCase()}`, LEFT, 22);
      font('normal', 7, SLATE_500);
      doc.text(`Report ID: ${reportId}`, RIGHT, 22, { align: 'right' });
      doc.setDrawColor(...SLATE_300);
      doc.setLineWidth(0.5);
      doc.line(LEFT, 27, RIGHT, 27);
    }
    const fy0 = 812;
    doc.setDrawColor(...SLATE_300);
    doc.setLineWidth(0.5);
    doc.line(LEFT, fy0, RIGHT, fy0);
    font('normal', 7, SLATE_500);
    doc.text(`Report ID: ${reportId} · S.P. College Institutional Hub`, LEFT, fy0 + 11);
    doc.text(`Generated: ${genIST}`, CENTER, fy0 + 11, { align: 'center' });
    font('bold', 7, NAVY);
    doc.text(`Page ${i} of ${pages}`, RIGHT, fy0 + 11, { align: 'right' });
  }

  addPdfWatermark(doc);

  if (typeof saveAsFilename === 'string' && saveAsFilename.trim()) doc.save(saveAsFilename.trim());
  return doc;
}
