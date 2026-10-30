import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generatePdfReport } from '../src/pdfReport.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');

const demoReportData = {
  title: 'Official Institutional Purchase & Approval Report',
  kind: 'complete',
  requestNumber: 'REQ-2026-0042',
  generatedAt: new Date().toISOString(),
  request: {
    id: 'req-0042',
    requestNumber: 'REQ-2026-0042',
    title: 'High-Performance Computing Cluster Nodes for Data Science & AI Research Lab',
    description: 'Procurement of 4 GPU compute server nodes with high-throughput acceleration for the newly established Master of Science in Data Science and Artificial Intelligence research facility. Crucial for parallel compute student dissertations, sponsored faculty research grants, and university doctoral evaluations.',
    justification: 'The existing laboratory infrastructure is limited to basic desktop workstations incapable of running large-scale tensor computation or training complex neural network models. Sanctioned under the Autonomous College Development Infrastructure Grant FY 2026-2027.',
    department: 'Computer Science',
    departmentCode: 'CS',
    budgetHead: 'Information Technology Infrastructure & Compute Grants',
    budgetHeadCode: 'IT-INFRA',
    budgetHeadType: 'GRANT_IN_AID',
    financialYear: '2026-2027',
    status: 'APPROVED',
    stage: 'COMPLETED',
    stageName: 'Sanctioned & Completed',
    requesterName: 'Dr. Anand Deshpande',
    requesterEmail: 'head.cs@spcollege.edu',
    requesterDepartment: 'Computer Science',
    requestedAmount: 480000,
    sanctionedAmount: 480000,
    unapprovedAmount: 0,
    versionNumber: 2,
    priority: 'HIGH',
    urgency: 'HIGH',
    costCenter: 'PG Research Facility — CS Lab 4',
    createdAt: '2026-09-15T09:30:00Z',
    submittedAt: '2026-09-15T11:00:00Z',
    closedAt: '2026-09-20T16:45:00Z',
  },
  items: [
    {
      id: 'item-42-1',
      name: 'Rack-mount GPU Compute Server Node',
      code: 'IT-SRV-01',
      description: 'Dual Intel Xeon Silver 4410Y, 128GB DDR5 ECC RAM, 1x NVIDIA RTX 4000 Ada Generation 20GB GDDR6, 2x 1.92TB NVMe PCIe Gen4 SSD Enterprise, Dual 10GbE NIC, Redundant 800W Titanium Power Supply, 3-Year 24x7 On-Site OEM Warranty.',
      quantity: 4,
      unitCost: 120000,
      totalCost: 480000,
      approvedQuantity: 4,
      approvedAmount: 480000,
      unapprovedQuantity: 0,
      unapprovedAmount: 0,
    }
  ],
  budget: {
    allocatedAmount: 1500000,
    spentAmount: 420000,
    committedAmount: 200000,
    thisRequestAmount: 480000,
    remainingAmount: 400000,
  },
  workflow: [
    {
      id: 'wf-1',
      action: 'SUBMIT',
      status: 'SUBMITTED',
      by: 'Dr. Anand Deshpande',
      role: 'Head of Department',
      stage: { name: 'Department Head' },
      createdAt: '2026-09-15T11:00:00Z',
      amount: 480000,
      comments: 'Initial submission with technical specifications and quotations from 3 certified OEM enterprise vendors.',
      sentence: 'Dr. Anand Deshpande (Head, CS) submitted the procurement proposal.',
    },
    {
      id: 'wf-2',
      action: 'RETURN',
      status: 'RETURNED',
      by: 'Prof. Ramesh Kulkarni',
      role: 'Purchase Committee Convener',
      stage: { name: 'Purchase Committee' },
      createdAt: '2026-09-17T14:30:00Z',
      amount: 480000,
      comments: 'Please attach comparative market rate analysis sheet and OEM technical compliance certificate as mandated by autonomous college procurement norms.',
      sentence: 'Prof. Ramesh Kulkarni (Purchase Committee) returned the request with scrutiny remarks.',
    },
    {
      id: 'wf-3',
      action: 'RESUBMIT',
      status: 'RESUBMITTED',
      by: 'Dr. Anand Deshpande',
      role: 'Head of Department',
      stage: { name: 'Department Head' },
      createdAt: '2026-09-18T10:15:00Z',
      amount: 480000,
      comments: 'Comparative market rate evaluation sheet uploaded along with revised technical compliance confirmation and 3-year warranty SLA endorsement.',
      sentence: 'Dr. Anand Deshpande resubmitted the corrected proposal.',
    },
    {
      id: 'wf-4',
      action: 'RECOMMEND',
      status: 'ESCALATED',
      by: 'Prof. Ramesh Kulkarni',
      role: 'Purchase Committee Convener',
      stage: { name: 'Purchase Committee' },
      createdAt: '2026-09-19T11:30:00Z',
      amount: 480000,
      comments: 'Technical scrutiny complete. Lowest complying bidder adheres to autonomous procurement ceilings. Strongly recommended for Principal approval.',
      sentence: 'Purchase Committee scrutinized and recommended the proposal.',
    },
    {
      id: 'wf-5',
      action: 'APPROVE',
      status: 'APPROVED',
      by: 'Dr. V. N. Rane',
      role: 'Principal',
      stage: { name: 'Principal' },
      createdAt: '2026-09-20T16:45:00Z',
      amount: 480000,
      comments: 'Sanctioned under Autonomous College Development IT grant for FY 2026-2027. Work order to be issued as per college purchase committee procedure.',
      sentence: 'Dr. V. N. Rane (Principal) approved the request in full.',
    },
  ],
  messages: [
    {
      id: 'msg-1',
      from: 'Dr. Anand Deshpande',
      recipient: 'Purchase Committee',
      role: 'Head of Department',
      createdAt: '2026-09-15T11:00:00Z',
      content: 'Urgent procurement request for upcoming semester PG dissertations and university grant project lab evaluations.',
    },
    {
      id: 'msg-2',
      from: 'Prof. Ramesh Kulkarni',
      recipient: 'Dr. Anand Deshpande',
      role: 'Purchase Committee',
      createdAt: '2026-09-17T14:30:00Z',
      content: 'Please attach comparative market rate analysis sheet and technical compliance matrix as per SP Mandali autonomous college guidelines.',
    },
    {
      id: 'msg-3',
      from: 'Dr. Anand Deshpande',
      recipient: 'Purchase Committee',
      role: 'Head of Department',
      createdAt: '2026-09-18T10:15:00Z',
      content: 'Uploaded all required comparative documentation, warranty SLA confirmations and OEM authorization certificates.',
    },
    {
      id: 'msg-4',
      from: 'Dr. V. N. Rane',
      recipient: 'Accounts Section & Purchase Committee',
      role: 'Principal',
      createdAt: '2026-09-20T16:45:00Z',
      content: 'Approved and sanctioned. Proceed with procurement order and ensure asset registry entry upon delivery and technical verification.',
    }
  ],
  documents: [
    {
      id: 'doc-1',
      fileName: 'vendor_quotations_comparative_table.pdf',
      fileSize: 1048576,
      mimeType: 'application/pdf',
      uploadedBy: 'Dr. Anand Deshpande',
      uploadedAt: '2026-09-15T10:45:00Z',
      version: 1,
      isCurrent: true,
      notes: 'Contains 3 verified bids from OEM authorized partners.',
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
      notes: 'Detailed specification compliance sheet and warranty verification.',
    }
  ],
  resubmissions: [
    {
      versionNumber: 1,
      correctionReason: 'Comparative rate analysis sheet required by Purchase Committee scrutiny',
      previousTotal: 480000,
      newTotal: 480000,
      resubmittedAt: '2026-09-18T10:15:00Z',
    }
  ],
  decision: {
    finalStatus: 'APPROVED',
    decisionAt: '2026-09-20T16:45:00Z',
    authority: 'Dr. V. N. Rane (Principal)',
    remarks: 'Sanctioned under Autonomous College Development IT Grant for FY 2026-2027. Ensure entry in college central dead-stock and asset register upon receipt.',
    sanctionedAmount: 480000,
  },
  auditSummary: {
    reportId: 'REQ-2026-0042',
    generatedAt: new Date().toISOString(),
    updatedAt: '2026-09-20T16:45:00Z',
    totalEvents: 5,
    totalMessages: 4,
    totalDocuments: 2,
    reportVersion: 'v2.0',
  },
  certification: {
    statement: 'This report is a system-generated institutional record containing the information, communications, actions and status history available in the system at the time of report generation.',
  }
};

async function main() {
  const outputPath = path.join(rootDir, 'SP_College_Official_Approval_Report_REQ-2026-0042.pdf');
  console.log(`Generating official PDF report to: ${outputPath}...`);

  const pdfBuffer = await generatePdfReport(demoReportData);
  await fs.writeFile(outputPath, pdfBuffer);

  const stats = await fs.stat(outputPath);
  console.log(`Successfully generated demo PDF report!`);
  console.log(`File: ${outputPath}`);
  console.log(`Size: ${stats.size} bytes`);
}

main().catch((err) => {
  console.error('Error generating demo PDF report:', err);
  process.exit(1);
});
