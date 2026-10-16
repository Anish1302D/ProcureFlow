import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import { generateOfficialPdf } from './officialPdfGenerator.js';

test('client generateOfficialPdf builds a valid jsPDF instance with expected pages', async () => {
  const sampleData = {
    title: 'Purchase Request Report',
    requestNumber: 'REQ-2026-TEST',
    generatedAt: '2026-10-01T04:30:00Z',
    request: {
      requestNumber: 'REQ-2026-TEST',
      title: 'Department Server Equipment',
      department: 'Computer Science',
      status: 'APPROVED',
      requestedAmount: 150000,
      sanctionedAmount: 150000,
      financialYear: '2026-2027',
      budgetHead: 'IT Infrastructure',
      requesterName: 'Dr. Anand Deshpande',
      description: 'Equipment procurement for autonomous college laboratory upgrade.',
    },
    items: [
      {
        name: 'Enterprise Server Node',
        code: 'SRV-01',
        description: 'Rackmount server',
        quantity: 1,
        unitCost: 150000,
        totalCost: 150000,
        approvedQuantity: 1,
        approvedAmount: 150000,
      }
    ],
    workflow: [
      {
        action: 'SUBMIT',
        status: 'SUBMITTED',
        by: 'Dr. Anand Deshpande',
        role: 'Head of Department',
        createdAt: '2026-09-15T11:00:00Z',
        comments: 'Submitted for committee review.',
      },
      {
        action: 'APPROVE',
        status: 'APPROVED',
        by: 'Dr. Sunil Gaikwad',
        role: 'Principal',
        createdAt: '2026-09-20T16:45:00Z',
        comments: 'Sanctioned in full.',
      }
    ],
    messages: [
      {
        from: 'Dr. Anand Deshpande',
        recipient: 'Principal',
        role: 'Head',
        createdAt: '2026-09-15T11:00:00Z',
        content: 'Requesting fast-track review.',
      }
    ],
    documents: [
      {
        fileName: 'quotation_v1.pdf',
        fileSize: 204800,
        uploadedBy: 'Dr. Anand Deshpande',
        uploadedAt: '2026-09-15T10:45:00Z',
        version: 1,
        isCurrent: true,
      }
    ],
    decision: {
      finalStatus: 'APPROVED',
      decisionAt: '2026-09-20T16:45:00Z',
      authority: 'Dr. Sunil Gaikwad (Principal)',
      remarks: 'Sanctioned in full.',
      sanctionedAmount: 150000,
    }
  };

  const doc = await generateOfficialPdf(sampleData);
  assert.ok(doc, 'doc is defined');
  const pageCount = doc.internal.getNumberOfPages();
  assert.ok(pageCount >= 1, `expected at least 1 page, got ${pageCount}`);

  const outputBlob = doc.output('arraybuffer');
  assert.ok(outputBlob.byteLength > 1000, 'generated valid PDF byte stream');
  const headerStr = Buffer.from(outputBlob).subarray(0, 8).toString('utf8');
  assert.ok(headerStr.startsWith('%PDF-1.'), 'PDF magic header valid');
});

test('client generateOfficialPdf renders custom item names (Computers, Servers) instead of "Other (specify)"', async () => {
  const customData = {
    title: 'Purchase Request Report',
    requestNumber: 'REQ-2026-CUSTOM',
    generatedAt: '2026-10-16T10:00:00Z',
    request: {
      requestNumber: 'REQ-2026-CUSTOM',
      title: 'IT Requisition',
      department: 'Computer Science',
      status: 'APPROVED',
      requestedAmount: 500000,
      sanctionedAmount: 500000,
      financialYear: '2026-2027',
      budgetHead: 'IT Infrastructure',
    },
    items: [
      {
        name: 'Other (specify)',
        budgetItem: 'OTHER',
        remarks: '[Custom item: Computers] — 5 Desktop PCs',
        requestedQuantity: 5,
        unitCost: 50000,
        requestedAmount: 250000,
        approvedAmount: 250000,
        approvedQuantity: 5,
        status: 'APPROVED',
      },
      {
        name: 'Other (specify)',
        budgetItem: 'OTHER',
        remarks: '[Custom item: Servers] — 2 Rack Servers',
        requestedQuantity: 2,
        unitCost: 125000,
        requestedAmount: 250000,
        approvedAmount: 250000,
        approvedQuantity: 2,
        status: 'APPROVED',
      },
    ],
  };

  const doc = await generateOfficialPdf(customData);
  const pdfText = doc.output();
  assert.ok(pdfText.includes('Computers'), 'PDF output text must include "Computers"');
  assert.ok(pdfText.includes('Servers'), 'PDF output text must include "Servers"');
  assert.ok(!pdfText.includes('Other (specify)'), 'PDF output text must not include "Other (specify)"');
});

