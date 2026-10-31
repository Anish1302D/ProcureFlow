import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

describe('Authorized Request Versions API Contract', () => {
  // Mock request versions handler simulating the logic in server/src/routes/requests.js
  function processVersionsQuery(request, versionRows, caller) {
    if (!request) {
      const err = new Error('Request not found');
      err.status = 404;
      throw err;
    }

    // Role and department visibility evaluation matching RLS
    const isAdmin = caller.roles.includes('ADMIN');
    const isPrincipal = caller.roles.includes('PRINCIPAL');
    const isStageApprover = caller.roles.some((r) =>
      ['PURCHASE_COMMITTEE', 'CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER', 'CHAIRMAN', 'VICE_PRESIDENT'].includes(r)
    );
    const isRequester = caller.id === request.raised_by;
    const isDepartmentHead = caller.roles.includes('HEAD') && caller.departmentId === request.department_id;

    if (!isAdmin && !isPrincipal && !isStageApprover && !isRequester && !isDepartmentHead) {
      const err = new Error('Request not found');
      err.status = 404;
      throw err;
    }

    const currentVersionNumber = request.current_version_number;

    return versionRows.map((r) => ({
      versionId: r.version_id,
      requestId: r.request_id,
      versionNumber: r.version_number,
      isCurrent: r.version_number === currentVersionNumber,
      title: r.title,
      description: r.description,
      department: r.department_id ? { id: r.department_id, name: r.department_name } : null,
      course: r.course_id ? { id: r.course_id, name: r.course_name } : null,
      financialYear: { id: r.financial_year_id, code: r.financial_year_code },
      budgetHead: { id: r.budget_head_id, name: r.budget_head_name, headType: r.head_type },
      tentativeTotalCost: Number(r.tentative_total_cost),
      extra: r.extra || {},
      items: typeof r.items_snapshot === 'string' ? JSON.parse(r.items_snapshot) : r.items_snapshot,
      documents: typeof r.documents_snapshot === 'string' ? JSON.parse(r.documents_snapshot) : r.documents_snapshot,
      submittedBy: {
        id: r.submitted_by,
        name: r.submitted_by_name,
        email: r.submitted_by_email,
      },
      submittedAt: r.submitted_at,
      correction: r.correction_id ? {
        id: r.correction_id,
        reason: r.correction_reason,
        requestedBy: {
          id: r.correction_requested_by,
          name: r.correction_requested_by_name,
        },
        stageName: r.correction_stage_name,
      } : null,
    }));
  }

  const sampleRequest = {
    request_id: 'req-uuid-101',
    raised_by: 'user-head-cs',
    department_id: 10,
    current_version_number: 2,
  };

  const sampleVersionRows = [
    {
      version_id: 'ver-uuid-1',
      request_id: 'req-uuid-101',
      version_number: 1,
      title: 'Lab Upgrades v1',
      description: 'Initial purchase of computers',
      department_id: 10,
      department_name: 'Computer Science',
      course_id: null,
      course_name: null,
      financial_year_id: 2,
      financial_year_code: '2025-26',
      budget_head_id: 101,
      budget_head_name: 'Hardware & Infrastructure',
      head_type: 'CAPITAL',
      tentative_total_cost: '200000.00',
      extra: {},
      items_snapshot: JSON.stringify([
        { request_item_id: 'item-1', item_name: 'Core i7 PC', requested_quantity: 4, estimated_unit_cost: 50000, estimated_total: 200000 },
      ]),
      documents_snapshot: JSON.stringify([
        { attachment_id: 'att-1', file_name: 'quote_a.pdf', size_bytes: 45000, version_number: 1 },
      ]),
      submitted_by: 'user-head-cs',
      submitted_by_name: 'Prof. CS Head',
      submitted_by_email: 'cs.head@spcollege.edu',
      submitted_at: '2026-10-31T08:00:00Z',
      correction_id: null,
    },
    {
      version_id: 'ver-uuid-2',
      request_id: 'req-uuid-101',
      version_number: 2,
      title: 'Lab Upgrades v2 (Revised)',
      description: 'Negotiated lower quantity with additional SSDs',
      department_id: 10,
      department_name: 'Computer Science',
      course_id: null,
      course_name: null,
      financial_year_id: 2,
      financial_year_code: '2025-26',
      budget_head_id: 101,
      budget_head_name: 'Hardware & Infrastructure',
      head_type: 'CAPITAL',
      tentative_total_cost: '165000.00',
      extra: {},
      items_snapshot: JSON.stringify([
        { request_item_id: 'item-1', item_name: 'Core i7 PC', requested_quantity: 3, estimated_unit_cost: 50000, estimated_total: 150000 },
        { request_item_id: 'item-2', item_name: '1TB NVMe SSD', requested_quantity: 3, estimated_unit_cost: 5000, estimated_total: 15000 },
      ]),
      documents_snapshot: JSON.stringify([
        { attachment_id: 'att-1', file_name: 'quote_a.pdf', size_bytes: 45000, version_number: 1 },
        { attachment_id: 'att-2', file_name: 'revised_quote.pdf', size_bytes: 52000, version_number: 1 },
      ]),
      submitted_by: 'user-head-cs',
      submitted_by_name: 'Prof. CS Head',
      submitted_by_email: 'cs.head@spcollege.edu',
      submitted_at: '2026-10-31T09:30:00Z',
      correction_id: 'corr-101',
      correction_reason: 'Please reduce quantity to fit revised capital allocation',
      correction_requested_by: 'user-principal',
      correction_requested_by_name: 'Dr. Principal',
      correction_stage_name: 'Principal Review',
    },
  ];

  test('Authorized requester receives structured versions with current version flagged', () => {
    const caller = { id: 'user-head-cs', roles: ['HEAD'], departmentId: 10 };
    const versions = processVersionsQuery(sampleRequest, sampleVersionRows, caller);

    assert.equal(versions.length, 2);

    // Version 1 check
    assert.equal(versions[0].versionNumber, 1);
    assert.equal(versions[0].isCurrent, false);
    assert.equal(versions[0].tentativeTotalCost, 200000);
    assert.equal(versions[0].items.length, 1);
    assert.equal(versions[0].documents.length, 1);
    assert.equal(versions[0].correction, null);

    // Version 2 check (Current)
    assert.equal(versions[1].versionNumber, 2);
    assert.equal(versions[1].isCurrent, true);
    assert.equal(versions[1].tentativeTotalCost, 165000);
    assert.equal(versions[1].items.length, 2);
    assert.equal(versions[1].documents.length, 2);
    assert.ok(versions[1].correction);
    assert.equal(versions[1].correction.reason, 'Please reduce quantity to fit revised capital allocation');
    assert.equal(versions[1].correction.stageName, 'Principal Review');
  });

  test('Approver roles (Purchase Committee, Principal, CDC, Admin) can read versions', () => {
    const approvers = [
      { id: 'admin-1', roles: ['ADMIN'] },
      { id: 'prin-1', roles: ['PRINCIPAL'] },
      { id: 'pc-1', roles: ['PURCHASE_COMMITTEE'] },
      { id: 'cdc-1', roles: ['CDC_GRANT_MEMBER'] },
      { id: 'chair-1', roles: ['CHAIRMAN'] },
    ];

    for (const approver of approvers) {
      const versions = processVersionsQuery(sampleRequest, sampleVersionRows, approver);
      assert.equal(versions.length, 2, `Approver ${approver.roles[0]} should be able to read versions`);
    }
  });

  test('Unauthorized user from another department is refused with HTTP 404', () => {
    const outsider = { id: 'user-other-dept', roles: ['HEAD'], departmentId: 99 };
    assert.throws(
      () => processVersionsQuery(sampleRequest, sampleVersionRows, outsider),
      (err) => err.status === 404
    );
  });
});
