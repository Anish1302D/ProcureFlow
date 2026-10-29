import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { generateReportsSummaryPdf, summaryTotals } from './reportsSummaryPdf.js';

test('reportsSummaryPdf builds a valid multi-page institutional PDF with all sections', async () => {
  const sampleData = {
    financialYear: {
      id: 1,
      label: '2026-27',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
    },
    generatedAt: '2026-10-04T12:00:00.000Z',
    generatedBy: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Dr. V. Rane (Principal)',
      roles: ['PRINCIPAL', 'HEAD'],
    },
    byBudgetHead: [
      {
        budgetHead: { id: 1, code: 'LAB', name: 'Laboratory', headType: 'CAPITAL' },
        requests: 6,
        approved: 4,
        partial: 1,
        rejected: 0,
        pending: 2,
        requested: 12316700,
        sanctioned: 12070000,
      },
      {
        budgetHead: { id: 2, code: 'MAINT', name: 'Maintenance', headType: 'REVENUE' },
        requests: 1,
        approved: 0,
        partial: 0,
        rejected: 0,
        pending: 1,
        requested: 1000000,
        sanctioned: 0,
      },
      {
        budgetHead: { id: 3, code: 'IT', name: 'IT Equipment', headType: 'CAPITAL' },
        requests: 10,
        approved: 3,
        partial: 1,
        rejected: 2,
        pending: 5,
        requested: 754475,
        sanctioned: 35096,
      },
      {
        budgetHead: { id: 4, code: 'OFF', name: 'Office Expenses', headType: 'REVENUE' },
        requests: 1,
        approved: 0,
        partial: 0,
        rejected: 1,
        pending: 0,
        requested: 100000,
        sanctioned: 0,
      },
    ],
    byStatus: [
      { status: 'APPROVED', requests: 6, requested: 10000000, sanctioned: 10000000 },
      { status: 'UNDER_PRINCIPAL_REVIEW', requests: 5, requested: 1500000, sanctioned: 0 },
      { status: 'UNDER_CDC_REVIEW', requests: 3, requested: 2000000, sanctioned: 0 },
      { status: 'REJECTED', requests: 4, requested: 671175, sanctioned: 0 },
    ],
    byDepartment: [
      { name: 'Computer Science', code: 'CS', requests: 10, approved: 4, rejected: 1, pending: 5, requested: 8000000, sanctioned: 7500000 },
      { name: 'Physics', code: 'PHY', requests: 5, approved: 2, rejected: 1, pending: 2, requested: 4000000, sanctioned: 3500000 },
      { name: 'Chemistry', code: 'CHEM', requests: 3, approved: 1, rejected: 1, pending: 1, requested: 2171175, sanctioned: 1105096 },
    ],
    byStage: [
      { stage: 'Principal Review', code: 'PRINCIPAL', requests: 5, amount: 1500000, avgDays: 2.4, maxDays: 5 },
      { stage: 'CDC Review', code: 'CDC', requests: 3, amount: 2000000, avgDays: 4.8, maxDays: 9 },
    ],
    byItemType: [
      { itemType: 'CAPITAL', lines: 18, requestedQty: 45, approvedQty: 40, requested: 13071175, approved: 12105096 },
      { itemType: 'CONSUMABLE', lines: 12, requestedQty: 250, approvedQty: 100, requested: 1100000, approved: 0 },
    ],
    byFunding: [
      { funding: 'GRANT', requests: 12, approved: 5, rejected: 2, pending: 5, requested: 10000000, sanctioned: 8500000 },
      { funding: 'NON_GRANT', requests: 6, approved: 2, rejected: 1, pending: 3, requested: 4171175, sanctioned: 3605096 },
    ],
    monthly: [
      { month: '2026-06', requests: 4, approved: 2, rejected: 0, pending: 2, requested: 3000000, sanctioned: 2500000 },
      { month: '2026-07', requests: 6, approved: 3, rejected: 1, pending: 2, requested: 6000000, sanctioned: 5500000 },
      { month: '2026-08', requests: 8, approved: 2, rejected: 2, pending: 4, requested: 5171175, sanctioned: 4105096 },
    ],
    provisions: [
      { department: 'Computer Science', budgetHead: 'IT Equipment', allocated: 10000000, utilized: 7500000, committed: 1000000, remaining: 1500000 },
      { department: 'Physics', budgetHead: 'Laboratory', allocated: 5000000, utilized: 3500000, committed: 500000, remaining: 1000000 },
    ],
    pendingOverThreeDays: [
      {
        requestNumber: 'REQ-2026-0012',
        title: 'High Performance GPU Cluster Server Upgrade',
        raisedBy: 'Prof. A. Kulkarni',
        status: 'UNDER_CDC_REVIEW',
        stage: 'CDC Review',
        amount: 1500000,
        daysPending: 9,
        submittedAt: '2026-09-24T10:00:00Z',
      },
      {
        requestNumber: 'REQ-2026-0015',
        title: 'Spectrometer Calibration Kit',
        raisedBy: 'Dr. S. Joshi',
        status: 'UNDER_PRINCIPAL_REVIEW',
        stage: 'Principal Review',
        amount: 250000,
        daysPending: 5,
        submittedAt: '2026-09-28T14:30:00Z',
      },
    ],
    register: [
      {
        requestNumber: 'REQ-2026-0001',
        title: 'Advanced Microscope Setup',
        status: 'APPROVED',
        raisedBy: 'Dr. M. Patwardhan',
        department: 'Physics',
        budgetHead: 'Laboratory',
        stage: 'Principal Review',
        requested: 500000,
        sanctioned: 500000,
        submittedAt: '2026-06-10T09:00:00Z',
        closedAt: '2026-06-15T15:00:00Z',
      },
      {
        requestNumber: 'REQ-2026-0002',
        title: 'Laboratory Reagents Package',
        status: 'UNDER_PRINCIPAL_REVIEW',
        raisedBy: 'Dr. R. Shinde',
        department: 'Chemistry',
        budgetHead: 'Laboratory',
        stage: 'Principal Review',
        requested: 350000,
        sanctioned: null,
        submittedAt: '2026-08-01T11:00:00Z',
        closedAt: null,
      },
    ],
    issues: [
      { status: 'SUBMITTED', n: 3 },
      { status: 'IN_REVIEW', n: 2 },
      { status: 'RESOLVED', n: 1 },
    ],
  };

  const totals = summaryTotals(sampleData);
  assert.equal(totals.requests, 18, 'correct total requests calculated');
  assert.equal(totals.requested, 14171175, 'correct total requested amount calculated');
  assert.equal(totals.sanctioned, 12105096, 'correct total sanctioned amount calculated');

  const doc = generateReportsSummaryPdf(sampleData);
  assert.ok(doc, 'document created');
  const pages = doc.internal.getNumberOfPages();
  assert.ok(pages >= 2, `expected at least 2 pages for detailed summary, got ${pages}`);

  const output = doc.output('arraybuffer');
  assert.ok(output.byteLength > 2000, 'sufficient PDF byte stream generated');
  const magic = Buffer.from(output).subarray(0, 8).toString('utf8');
  assert.ok(magic.startsWith('%PDF-1.'), 'PDF magic header valid');
  const pdfString = doc.output();
  assert.ok(pdfString.includes('Anish Mogam'), 'Must include Anish Mogam watermark');
  assert.ok(pdfString.includes('Madhura Lakade'), 'Must include Madhura Lakade watermark');
  assert.ok(pdfString.includes('Isha Joshi'), 'Must include Isha Joshi watermark');
});

test('departmentRequestsPdf generates valid PDF for department requisitions and line items', async () => {
  const { generateDepartmentRequestsPdf } = await import('./departmentRequestsPdf.js');
  const deptData = {
    financialYear: { id: 1, label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' },
    department: { id: 2, code: 'CS', name: 'Computer Science' },
    generatedAt: '2026-10-04T12:00:00.000Z',
    generatedBy: { id: '00000000-0000-0000-0000-000000000002', name: 'Dr. A. Deshpande (Head, CS)', roles: ['HEAD'] },
    register: [
      {
        id: 'req-1',
        requestNumber: 'REQ-2026-0001',
        title: 'Workstation Computers',
        status: 'APPROVED',
        raisedBy: 'Dr. A. Deshpande',
        department: 'Computer Science',
        budgetHead: 'IT Equipment',
        stage: 'Principal Review',
        requested: 300000,
        sanctioned: 300000,
        submittedAt: '2026-06-10T09:00:00Z',
        closedAt: '2026-06-15T15:00:00Z',
      },
    ],
    lineItems: [
      {
        id: 'item-1',
        requestId: 'req-1',
        requestNumber: 'REQ-2026-0001',
        itemName: 'Dell Core i7 Workstation',
        unit: 'piece',
        itemType: 'CAPITAL',
        requestedQuantity: 5,
        approvedQuantity: 5,
        estimatedUnitCost: 60000,
        estimatedTotal: 300000,
        approvedAmount: 300000,
        itemStatus: 'APPROVED',
        remarks: 'Procured for lab 3',
      },
    ],
    byStage: [
      { code: 'PRINCIPAL', stage: 'Principal Review', requests: 1, amount: 300000, avgDays: 2.5, maxDays: 4 },
    ],
  };

  const doc = generateDepartmentRequestsPdf(deptData);
  assert.ok(doc, 'document created');
  const pages = doc.internal.getNumberOfPages();
  assert.ok(pages >= 1, 'at least 1 page generated');
  const output = doc.output('arraybuffer');
  assert.ok(output.byteLength > 1500, 'sufficient PDF bytes');
  assert.ok(Buffer.from(output).subarray(0, 8).toString('utf8').startsWith('%PDF-1.'));
});

test('issuesReportPdf generates valid PDF for campus issues and maintenance logs', async () => {
  const { generateIssuesReportPdf } = await import('./issuesReportPdf.js');
  const issuesData = {
    financialYear: { id: 1, label: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' },
    department: { id: 2, code: 'CS', name: 'Computer Science' },
    generatedAt: '2026-10-04T12:00:00.000Z',
    generatedBy: { id: '00000000-0000-0000-0000-000000000002', name: 'Dr. A. Deshpande (Head, CS)', roles: ['HEAD'] },
    issuesDetailed: [
      {
        id: 'iss-1',
        issueNumber: 'ISS-0001',
        title: 'Projector display flickering in Room 102',
        description: 'HDMI connection is unstable and projector bulb dims intermittently.',
        status: 'RESOLVED',
        raisedBy: 'Prof. K. Kulkarni',
        department: 'Computer Science',
        departmentCode: 'CS',
        assignedTo: 'Estate Office',
        escalatedTo: null,
        createdAt: '2026-07-01T10:00:00Z',
        updatedAt: '2026-07-03T11:00:00Z',
        escalatedAt: null,
        resolvedAt: '2026-07-03T11:00:00Z',
      },
    ],
    issues: [
      { status: 'RESOLVED', n: 1 },
    ],
  };

  const doc = generateIssuesReportPdf(issuesData);
  assert.ok(doc, 'document created');
  const pages = doc.internal.getNumberOfPages();
  assert.ok(pages >= 1, 'at least 1 page generated');
  const output = doc.output('arraybuffer');
  assert.ok(output.byteLength > 1500, 'sufficient PDF bytes');
  assert.ok(Buffer.from(output).subarray(0, 8).toString('utf8').startsWith('%PDF-1.'));
  const pdfString = doc.output();
  assert.ok(pdfString.includes('Anish Mogam'), 'Must include Anish Mogam watermark');
  assert.ok(pdfString.includes('Madhura Lakade'), 'Must include Madhura Lakade watermark');
  assert.ok(pdfString.includes('Isha Joshi'), 'Must include Isha Joshi watermark');
});

