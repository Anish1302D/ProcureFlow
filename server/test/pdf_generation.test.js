import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';
import { generatePdfReport } from '../src/pdfReport.js';

test('generatePdfReport produces a valid PDF buffer for comprehensive report data', async () => {
  const reportData = {
    title: 'Comprehensive Purchase Request Report',
    kind: 'comprehensive',
    requestNumber: 'REQ-2026-0042',
    generatedAt: '2026-10-01T04:30:00Z',
    request: {
      id: 'req-42',
      requestNumber: 'REQ-2026-0042',
      title: 'High-Performance Computing Cluster Nodes for Data Science Lab',
      description: 'Acquisition of 4 computational server nodes with GPU acceleration for the newly established Master of Science in Data Science research facility.',
      department: 'Computer Science',
      departmentCode: 'CS',
      budgetHead: 'Information Technology Infrastructure',
      budgetHeadCode: 'IT',
      financialYear: '2026-2027',
      status: 'APPROVED',
      stage: 'COMPLETED',
      requesterName: 'Dr. Anand Deshpande',
      requesterEmail: 'head.cs@spcollege.edu',
      requesterDepartment: 'Computer Science',
      requestedAmount: 480000,
      sanctionedAmount: 480000,
      unapprovedAmount: 0,
      createdAt: '2026-09-15T09:30:00Z',
      submittedAt: '2026-09-15T11:00:00Z',
      versionNumber: 2,
    },
    items: [
      {
        id: 'item-1',
        name: 'Rack-mount GPU Compute Server Node',
        code: 'IT-SRV-01',
        description: 'Dual Xeon Silver, 128GB RAM, 1x NVIDIA RTX 4000 Ada 20GB GPU, 2TB NVMe SSD',
        quantity: 4,
        unitCost: 120000,
        totalCost: 480000,
        approvedQuantity: 4,
        approvedAmount: 480000,
        unapprovedQuantity: 0,
        unapprovedAmount: 0,
      }
    ],
    workflow: [
      {
        id: 'wf-1',
        action: 'SUBMIT',
        status: 'SUBMITTED',
        by: 'Dr. Anand Deshpande',
        role: 'Head of Department',
        stage: { name: 'Department Head' },
        createdAt: '2026-09-15T11:00:00Z',
        comments: 'Submitted with quotations from 3 certified vendors.',
        sentence: 'Dr. Anand Deshpande (Head, CS) submitted the request.',
      },
      {
        id: 'wf-2',
        action: 'RETURN',
        status: 'RETURNED',
        by: 'Prof. Ramesh Kulkarni',
        role: 'Purchase Committee Convener',
        stage: { name: 'Purchase Committee' },
        createdAt: '2026-09-17T14:30:00Z',
        comments: 'Please attach comparative market rate analysis and technical compliance certificate.',
        sentence: 'Prof. Ramesh Kulkarni (Purchase Committee) returned the request with remarks.',
      },
      {
        id: 'wf-3',
        action: 'RESUBMIT',
        status: 'RESUBMITTED',
        by: 'Dr. Anand Deshpande',
        role: 'Head of Department',
        stage: { name: 'Department Head' },
        createdAt: '2026-09-18T10:15:00Z',
        comments: 'Comparative rate analysis sheet uploaded along with revised technical compliance confirmation.',
        sentence: 'Dr. Anand Deshpande resubmitted the corrected request.',
      },
      {
        id: 'wf-4',
        action: 'APPROVE',
        status: 'APPROVED',
        by: 'Dr. Sunil Gaikwad',
        role: 'Principal',
        stage: { name: 'Principal' },
        createdAt: '2026-09-20T16:45:00Z',
        comments: 'Sanctioned under IT expansion budget for FY 2026-2027.',
        sentence: 'Dr. Sunil Gaikwad (Principal) approved the request in full.',
      },
    ],
    messages: [
      {
        id: 'msg-1',
        from: 'Dr. Anand Deshpande',
        recipient: 'Purchase Committee',
        role: 'Head of Department',
        createdAt: '2026-09-15T11:00:00Z',
        content: 'Urgent procurement request for upcoming semester research projects.',
      },
      {
        id: 'msg-2',
        from: 'Prof. Ramesh Kulkarni',
        recipient: 'Dr. Anand Deshpande',
        role: 'Purchase Committee',
        createdAt: '2026-09-17T14:30:00Z',
        content: 'Please attach comparative market rate analysis and technical compliance certificate as per autonomous college guidelines.',
      },
      {
        id: 'msg-3',
        from: 'Dr. Anand Deshpande',
        recipient: 'Purchase Committee',
        role: 'Head of Department',
        createdAt: '2026-09-18T10:15:00Z',
        content: 'Uploaded all required comparative documentation and warranty SLA confirmations.',
      }
    ],
    documents: [
      {
        id: 'doc-1',
        fileName: 'vendor_quotations_comparative.pdf',
        fileSize: 1048576,
        mimeType: 'application/pdf',
        uploadedBy: 'Dr. Anand Deshpande',
        uploadedAt: '2026-09-15T10:45:00Z',
        version: 1,
        isCurrent: true,
      },
      {
        id: 'doc-2',
        fileName: 'technical_compliance_certificate.pdf',
        fileSize: 524288,
        mimeType: 'application/pdf',
        uploadedBy: 'Dr. Anand Deshpande',
        uploadedAt: '2026-09-18T10:10:00Z',
        version: 2,
        isCurrent: true,
      }
    ],
    resubmissions: [
      {
        versionNumber: 1,
        correctionReason: 'Comparative rate analysis required',
        previousTotal: 480000,
        newTotal: 480000,
        resubmittedAt: '2026-09-18T10:15:00Z',
      }
    ],
    decision: {
      finalStatus: 'APPROVED',
      decisionAt: '2026-09-20T16:45:00Z',
      authority: 'Dr. Sunil Gaikwad (Principal)',
      remarks: 'Sanctioned under IT expansion budget for FY 2026-2027.',
      sanctionedAmount: 480000,
    },
    auditSummary: {
      totalEvents: 4,
      totalMessages: 3,
      totalDocuments: 2,
      lastUpdatedAt: '2026-09-20T16:45:00Z',
      version: 2,
    },
    certification: {
      statement: 'This report is a system-generated institutional record containing the information, communications, actions and status history available in the system at the time of report generation.',
    }
  };

  const buffer = await generatePdfReport(reportData);
  assert.ok(Buffer.isBuffer(buffer), 'returns a Buffer');
  assert.ok(buffer.length > 5000, 'buffer contains PDF data');
  assert.ok(buffer.toString('utf8', 0, 8).startsWith('%PDF-1.'), 'has valid PDF magic header');
});

test('generatePdfReport handles minimal or missing optional fields gracefully', async () => {
  const minimalReport = {
    title: 'Purchase Request Report',
    requestNumber: 'REQ-EMPTY',
    generatedAt: '2026-10-01T04:30:00Z',
    request: {
      requestNumber: 'REQ-EMPTY',
      title: 'Minimal Test Request',
      status: 'DRAFT',
      requestedAmount: 0,
    },
    items: [],
    workflow: [],
    messages: [],
    documents: [],
    resubmissions: [],
    audit: [],
  };

  const buffer = await generatePdfReport(minimalReport);
  assert.ok(Buffer.isBuffer(buffer), 'returns a Buffer');
  assert.ok(buffer.toString('utf8', 0, 8).startsWith('%PDF-1.'), 'has valid PDF magic header');
});

test('generatePdfReport formats multi-page histories and long messages without error', async () => {
  const longReport = {
    title: 'Multi-Page Workflow Report',
    requestNumber: 'REQ-LONG-01',
    generatedAt: '2026-10-01T04:30:00Z',
    request: {
      requestNumber: 'REQ-LONG-01',
      title: 'Very Long Purchase Request With Extended Workflow and Lengthy Text Content',
      description: 'Detailed description repeating multiple paragraphs to test paragraph wrapping, indentation, bounding box calculation, and automatic page splitting across multiple pages.'.repeat(5),
      department: 'Chemistry',
      status: 'APPROVED',
      requestedAmount: 950000,
      sanctionedAmount: 950000,
    },
    items: Array.from({ length: 12 }, (_, i) => ({
      name: `Laboratory Specialized Chemical Reagent Pack #${i + 1}`,
      code: `CHM-RG-${i + 1}`,
      description: `High purity analytical grade reagent container specification line item ${i + 1}`,
      quantity: 10,
      unitCost: 7500,
      totalCost: 75000,
      approvedQuantity: 10,
      approvedAmount: 75000,
    })),
    workflow: Array.from({ length: 15 }, (_, i) => ({
      action: i % 2 === 0 ? 'FORWARD' : 'REVIEW',
      status: 'UNDER_REVIEW',
      by: `Reviewer Authority Person ${i + 1}`,
      role: `Committee Member Role ${i + 1}`,
      createdAt: new Date(Date.UTC(2026, 8, 1 + i, 10, 0, 0)).toISOString(),
      comments: `Extended evaluation commentary explaining detailed procedural rationale for item review iteration ${i + 1}. `.repeat(3),
    })),
    messages: Array.from({ length: 10 }, (_, i) => ({
      from: `Participant ${i + 1}`,
      recipient: `Recipient ${i + 1}`,
      role: 'Staff',
      createdAt: new Date(Date.UTC(2026, 8, 1 + i, 11, 0, 0)).toISOString(),
      content: `Message body content for communication thread entry #${i + 1}. Contains essential communication history that must never be truncated. `.repeat(4),
    })),
    documents: Array.from({ length: 6 }, (_, i) => ({
      fileName: `official_annexure_document_${i + 1}.pdf`,
      fileSize: 1024 * 1024 * (i + 1),
      uploadedBy: `Uploader ${i + 1}`,
      uploadedAt: new Date(Date.UTC(2026, 8, 1 + i, 9, 0, 0)).toISOString(),
      version: 1,
      isCurrent: true,
    })),
  };

  const buffer = await generatePdfReport(longReport);
  assert.ok(Buffer.isBuffer(buffer), 'returns a Buffer');
  assert.ok(buffer.length > 10000, 'multi-page PDF is substantially sized');
  assert.ok(buffer.toString('utf8', 0, 8).startsWith('%PDF-1.'));
});

test('generatePdfReport displays user-typed custom item names (e.g. Computers, Servers, Laptops) instead of "Other (specify)"', async () => {
  const customItemsReport = {
    title: 'Department Equipment Report',
    requestNumber: 'REQ-2026-0001',
    generatedAt: '2026-10-16T10:00:00Z',
    request: {
      requestNumber: 'REQ-2026-0001',
      title: 'IT Infrastructure Requisition',
      department: 'Computer Science',
      status: 'APPROVED',
      requestedAmount: 500000,
      sanctionedAmount: 500000,
      financialYear: '2026-2027',
      budgetHead: 'Information Technology Infrastructure',
    },
    items: [
      {
        id: 'item-1',
        name: 'Other (specify)',
        budgetItem: 'OTHER',
        code: 'OTHER',
        remarks: '[Custom item: Computers] — Lab systems',
        quantity: 5,
        unitCost: 50000,
        totalCost: 250000,
        approvedQuantity: 5,
        approvedAmount: 250000,
      },
      {
        id: 'item-2',
        name: 'Other (specify)',
        budgetItem: 'OTHER',
        code: 'OTHER',
        remarks: '[Custom item: Servers] — Department server racks',
        quantity: 2,
        unitCost: 125000,
        totalCost: 250000,
        approvedQuantity: 2,
        approvedAmount: 250000,
      },
    ],
  };

  const buffer = await generatePdfReport(customItemsReport);
  assert.ok(Buffer.isBuffer(buffer));
  const rawStr = buffer.toString('latin1');

  let foundComputers = false;
  let foundServers = false;
  let foundOther = false;

  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(rawStr)) !== null) {
    const start = m.index + m[0].length;
    let end = rawStr.indexOf('\rendstream', start);
    if (end === -1) end = rawStr.indexOf('\nendstream', start);
    if (end === -1) continue;
    try {
      const inflated = zlib.inflateSync(buffer.subarray(start, end)).toString('utf8');
      for (const tj of inflated.matchAll(/\[(.*?)\]\s*TJ/gs)) {
        const text = [...tj[1].matchAll(/<([0-9a-fA-F]+)>/g)]
          .map((x) => Buffer.from(x[1], 'hex').toString('utf8'))
          .join('');
        if (text.includes('Computers')) foundComputers = true;
        if (text.includes('Servers')) foundServers = true;
        if (text.includes('Other (specify)')) foundOther = true;
      }
    } catch (_err) {
      // Ignore streams that are not zlib deflate streams
    }
  }

  assert.ok(foundComputers, 'PDF must include custom item name "Computers"');
  assert.ok(foundServers, 'PDF must include custom item name "Servers"');
  assert.ok(!foundOther, 'PDF must not show "Other (specify)"');
});


