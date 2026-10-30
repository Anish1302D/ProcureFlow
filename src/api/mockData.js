// Realistic institutional mock dataset for S.P. College Approval Hub.
// Automatically used when the local development API server is offline or unreachable.

export const MOCK_USERS = {
  'head.cs@spcollege.edu': {
    id: 'usr-head-cs',
    email: 'head.cs@spcollege.edu',
    name: 'Dr. Anand Deshpande (Head, CS)',
    roles: ['HEAD'],
    stages: [{ stageId: 'stg-hod', code: 'DEPARTMENT_HEAD', name: 'Department Head' }],
    can: { raiseRequests: true, manageIssues: false, viewInventory: true, viewAudit: false, approve: true },
  },
  'principal@spcollege.edu': {
    id: 'usr-principal',
    email: 'principal@spcollege.edu',
    name: 'Dr. V. N. Rane (Principal)',
    roles: ['PRINCIPAL'],
    stages: [{ stageId: 'stg-principal', code: 'PRINCIPAL', name: 'Principal' }],
    can: { raiseRequests: true, manageIssues: true, viewInventory: true, viewAudit: true, approve: true },
  },
  'pc1@spcollege.edu': {
    id: 'usr-pc1',
    email: 'pc1@spcollege.edu',
    name: 'Prof. Ramesh Kulkarni (Purchase Committee)',
    roles: ['PURCHASE_COMMITTEE'],
    stages: [{ stageId: 'stg-pc', code: 'PURCHASE_COMMITTEE', name: 'Purchase Committee' }],
    can: { raiseRequests: true, manageIssues: false, viewInventory: true, viewAudit: false, approve: true },
  },
  'admin@spcollege.edu': {
    id: 'usr-admin',
    email: 'admin@spcollege.edu',
    name: 'System Administrator',
    roles: ['ADMIN'],
    stages: [],
    can: { raiseRequests: true, manageIssues: true, viewInventory: true, viewAudit: true, approve: true },
  },
  'cdc.grant@spcollege.edu': {
    id: 'usr-cdc-grant',
    email: 'cdc.grant@spcollege.edu',
    name: 'Dr. P. Shinde (CDC Grant)',
    roles: ['CDC_MEMBER', 'CDC_GRANT_MEMBER'],
    stages: [{ stageId: 'stg-cdc', code: 'CDC', name: 'College Development Committee' }],
    can: { raiseRequests: true, manageIssues: false, viewInventory: true, viewAudit: false, approve: true },
  },
};

export const MOCK_REQUESTS = [
  {
    id: 'req-0042',
    requestNumber: 'REQ-2026-0042',
    title: 'High-Performance Computing Cluster Nodes for Data Science Lab',
    department: 'Computer Science',
    departmentCode: 'CS',
    budgetHead: 'Information Technology Infrastructure',
    budgetHeadCode: 'IT',
    budgetHeadType: 'GRANT_IN_AID',
    financialYear: '2026-2027',
    status: 'APPROVED',
    currentStage: 'COMPLETED',
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
    costCenter: 'PG Research Facility',
    createdAt: '2026-09-15T09:30:00Z',
    submittedAt: '2026-09-15T11:00:00Z',
    closedAt: '2026-09-20T16:45:00Z',
    description: 'Procurement of 4 GPU compute nodes for the newly sanctioned M.Sc. Data Science and Artificial Intelligence laboratory. Requires high-throughput parallel compute capabilities for student dissertations and university research grant projects.',
    justification: 'The existing laboratory infrastructure is limited to dual-core systems unable to run neural network training pipelines. Sanctioned under the Autonomous College Development IT grant.',
    items: [
      {
        id: 'item-42-1',
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
        comments: 'Submitted with quotations from 3 certified OEM vendors.',
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
        action: 'RECOMMEND',
        status: 'ESCALATED',
        by: 'Prof. Ramesh Kulkarni',
        role: 'Purchase Committee Convener',
        stage: { name: 'Purchase Committee' },
        createdAt: '2026-09-19T11:30:00Z',
        comments: 'Technical evaluation verified. Recommended for Principal sanction.',
        sentence: 'Purchase Committee recommended the proposal.',
      },
      {
        id: 'wf-5',
        action: 'APPROVE',
        status: 'APPROVED',
        by: 'Dr. V. N. Rane',
        role: 'Principal',
        stage: { name: 'Principal' },
        createdAt: '2026-09-20T16:45:00Z',
        comments: 'Sanctioned under IT expansion budget for FY 2026-2027.',
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
        content: 'Urgent procurement request for upcoming semester research projects and lab courses.',
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
        content: 'Uploaded all required comparative documentation, warranty SLA confirmations and OEM authorization letters.',
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
        correctionReason: 'Comparative rate analysis required by purchase scrutiny',
        previousTotal: 480000,
        newTotal: 480000,
        resubmittedAt: '2026-09-18T10:15:00Z',
      }
    ],
    budget: {
      allocatedAmount: 1500000,
      spentAmount: 420000,
      committedAmount: 200000,
      thisRequestAmount: 480000,
      remainingAmount: 400000,
    },
    decision: {
      finalStatus: 'APPROVED',
      decisionAt: '2026-09-20T16:45:00Z',
      authority: 'Dr. V. N. Rane (Principal)',
      remarks: 'Sanctioned under IT expansion budget for FY 2026-2027.',
      sanctionedAmount: 480000,
    },
    auditSummary: {
      reportId: 'REQ-2026-0042',
      generatedAt: '2026-10-01T04:30:00Z',
      updatedAt: '2026-09-20T16:45:00Z',
      totalEvents: 5,
      totalMessages: 3,
      totalDocuments: 2,
      reportVersion: 'v2.0',
    },
    certification: {
      statement: 'This report is a system-generated institutional record containing the information, communications, actions and status history available in the system at the time of report generation.',
    }
  },
  {
    id: 'req-0038',
    requestNumber: 'REQ-2026-0038',
    title: 'Digital Oscilloscopes and Signal Generators for Electronics Lab',
    department: 'Physics & Electronics',
    departmentCode: 'PHY',
    budgetHead: 'Laboratory Equipment & Consumables',
    budgetHeadCode: 'LAB-EQ',
    financialYear: '2026-2027',
    status: 'IN_REVIEW',
    currentStage: 'PURCHASE_COMMITTEE',
    stageName: 'Purchase Committee',
    requesterName: 'Prof. Suresh Joshi',
    requestedAmount: 185000,
    sanctionedAmount: 0,
    versionNumber: 1,
    createdAt: '2026-09-25T14:20:00Z',
    submittedAt: '2026-09-25T15:00:00Z',
    items: [
      {
        id: 'item-38-1',
        name: 'Digital Storage Oscilloscope 100MHz Dual Channel',
        code: 'PHY-DSO-01',
        quantity: 5,
        unitCost: 25000,
        totalCost: 125000,
        approvedQuantity: 0,
        approvedAmount: 0,
      },
      {
        id: 'item-38-2',
        name: 'Arbitrary Function Generator 25MHz',
        code: 'PHY-FG-01',
        quantity: 4,
        unitCost: 15000,
        totalCost: 60000,
        approvedQuantity: 0,
        approvedAmount: 0,
      }
    ],
    workflow: [
      {
        action: 'SUBMIT',
        status: 'SUBMITTED',
        by: 'Prof. Suresh Joshi',
        role: 'Faculty Requester',
        createdAt: '2026-09-25T15:00:00Z',
        comments: 'Equipment for UG & PG experimental practicals.',
      }
    ],
    messages: [],
    documents: [
      {
        fileName: 'quotations_electronics_equipment.pdf',
        fileSize: 412000,
        uploadedBy: 'Prof. Suresh Joshi',
        uploadedAt: '2026-09-25T14:45:00Z',
        version: 1,
        isCurrent: true,
      }
    ]
  },
  {
    id: 'req-0031',
    requestNumber: 'REQ-2026-0031',
    title: 'Library Reference Books & E-Resource Subscriptions',
    department: 'Central Library',
    departmentCode: 'LIB',
    budgetHead: 'Library & Academic Resources',
    budgetHeadCode: 'LIB-RES',
    financialYear: '2026-2027',
    status: 'APPROVED',
    currentStage: 'COMPLETED',
    stageName: 'Completed',
    requesterName: 'Dr. Manisha Kulkarni',
    requestedAmount: 95000,
    sanctionedAmount: 95000,
    versionNumber: 1,
    createdAt: '2026-09-10T10:00:00Z',
    submittedAt: '2026-09-10T11:30:00Z',
    closedAt: '2026-09-14T17:00:00Z',
    items: [
      {
        id: 'item-31-1',
        name: 'International Journal & E-Book Database Annual Bundle',
        code: 'LIB-EBK-01',
        quantity: 1,
        unitCost: 95000,
        totalCost: 95000,
        approvedQuantity: 1,
        approvedAmount: 95000,
      }
    ],
    workflow: [
      {
        action: 'SUBMIT',
        status: 'SUBMITTED',
        by: 'Dr. Manisha Kulkarni',
        role: 'Librarian',
        createdAt: '2026-09-10T11:30:00Z',
        comments: 'Annual subscription renewal for research departments.',
      },
      {
        action: 'APPROVE',
        status: 'APPROVED',
        by: 'Dr. V. N. Rane',
        role: 'Principal',
        createdAt: '2026-09-14T17:00:00Z',
        comments: 'Approved under Autonomous Library Grant.',
      }
    ],
    messages: [],
    documents: []
  }
];

export const MOCK_DASHBOARD = {
  financialYear: '2026-2027',
  awaitingMyDecision: 2,
  attention: {
    pendingOverThreeDays: 1,
  },
  counts: {
    total: 14,
    pending: 3,
    approved: 9,
    partiallyApproved: 1,
    returned: 1,
    rejected: 0,
    withHigherAuthority: 2,
  },
};

export const MOCK_BUDGET_SPEND = {
  rows: [
    { budgetHead: 'IT Infrastructure', provision: 2500000, sanctioned: 1480000, balance: 1020000 },
    { budgetHead: 'Laboratory Equipment & Consumables', provision: 3500000, sanctioned: 2150000, balance: 1350000 },
    { budgetHead: 'Library & Academic Resources', provision: 1200000, sanctioned: 890000, balance: 310000 },
    { budgetHead: 'Seminars, Conferences & Workshops', provision: 800000, sanctioned: 450000, balance: 350000 },
  ]
};

export const MOCK_ISSUES = {
  total: 2,
  rows: [
    {
      id: 'iss-1',
      title: 'Air conditioning unit malfunction in Seminar Hall 2',
      status: 'IN_REVIEW',
      category: 'MAINTENANCE',
      priority: 'MEDIUM',
      createdAt: '2026-09-28T10:00:00Z',
      reporterName: 'Prof. K. Sharma',
    }
  ]
};
