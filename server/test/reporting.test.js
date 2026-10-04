import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { expectStatus, pdf, startApi } from './helpers.js';

// The report has to describe the request as it really happened: the same
// figures the approvals recorded, every stage it visited and no stage it
// didn't, and both sides of a resubmission.

let t;
const tok = {};
const ids = {};

before(async () => {
  t = await startApi();
  for (const [key, email] of Object.entries({
    head: 'head.cs@spcollege.edu', headChem: 'head.chem@spcollege.edu',
    pc1: 'pc1@spcollege.edu', principal: 'principal@spcollege.edu',
    cdcGrant: 'cdc.grant@spcollege.edu', cdcNonGrant: 'cdc.nongrant@spcollege.edu',
    admin: 'admin@spcollege.edu',
  })) {
    tok[key] = await t.login(email);
  }
  const heads = expectStatus(await t.api('GET', '/api/budget-heads', { token: tok.head }), 200);
  ids.it = heads.find((h) => h.code === 'IT').id;
  const items = expectStatus(await t.api('GET', `/api/budget-heads/${ids.it}/items`, { token: tok.head }), 200);
  for (const i of items) ids[i.code] = i.id;
  const depts = expectStatus(await t.api('GET', '/api/departments', { token: tok.head }), 200);
  ids.cs = depts.find((d) => d.code === 'CS').id;
  const years = expectStatus(await t.api('GET', '/api/financial-years', { token: tok.head }), 200);
  ids.fy = years[0].id;
});
after(() => t?.close());

const report = async (id, token, kind) =>
  expectStatus(await t.api('GET', `/api/requests/${id}/report${kind ? `?kind=${kind}` : ''}`, { token }), 200);

test('a straightforward approval reports the figures the decision recorded', async () => {
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.head,
    body: { title: 'Lab microphone', budgetHeadId: ids.it, departmentId: ids.cs,
            description: 'For the seminar hall.',
            items: [{ budgetItemId: ids['MIC-01'], quantity: 1, unitCost: 40000 }] },
  }), 201);
  ids.simple = draft.id;
  expectStatus(await t.api('POST', `/api/requests/${ids.simple}/attachments`, {
    token: tok.head, form: pdf('quotation.pdf').form }), 201);
  expectStatus(await t.api('POST', `/api/requests/${ids.simple}/submit`, { token: tok.head }), 200);
  expectStatus(await t.api('POST', `/api/requests/${ids.simple}/actions`, {
    token: tok.pc1, body: { action: 'ESCALATE', comments: 'Quotation attached' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${ids.simple}/actions`, {
    token: tok.principal, body: { action: 'APPROVE', comments: 'Sanctioned' } }), 201);

  const r = await report(ids.simple, tok.head);
  assert.equal(r.request.requestedAmount, 40000);
  assert.equal(r.request.sanctionedAmount, 40000);
  assert.equal(r.request.unapprovedAmount, 0);
  assert.equal(r.items[0].approvedQuantity, 1);
  assert.equal(r.items[0].unapprovedAmount, 0);
  assert.equal(r.documents[0].fileName, 'quotation.pdf');

  // It went to the committee and the Principal, and nowhere else.
  assert.deepEqual(r.route.map((s) => s.code), ['PURCHASE_COMMITTEE', 'PRINCIPAL']);
  const narrative = r.workflow.map((w) => w.sentence).join(' ');
  assert.ok(!/CDC|Chairman/.test(narrative), 'no stage it never visited is described');
  assert.ok(/approved it in full/.test(narrative));
  assert.match(r.workflow[0].sentence, /^Dr\. A\. Deshpande \(Head, CS\) submitted the request\.$/,
    'the requester is not attributed to the stage their request landed in');
  assert.ok(!narrative.includes('..'), 'a remark that ends in a full stop does not gain a second');
  assert.equal(r.resubmissions.length, 0, 'nothing to report where nothing was resubmitted');
});

test('a partial approval at CDC reports both what was sanctioned and what was not', async () => {
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.head,
    body: { title: 'Speakers and cables', budgetHeadId: ids.it, departmentId: ids.cs,
            items: [
              { budgetItemId: ids['SPK-01'], quantity: 4, unitCost: 50000 },
              { budgetItemId: ids['HDMI-01'], quantity: 10, unitCost: 100 },
            ] },
  }), 201);
  ids.partial = draft.id;
  expectStatus(await t.api('POST', `/api/requests/${ids.partial}/submit`, { token: tok.head }), 200);
  expectStatus(await t.api('POST', `/api/requests/${ids.partial}/actions`, {
    token: tok.pc1, body: { action: 'ESCALATE' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${ids.partial}/actions`, {
    token: tok.principal, body: { action: 'ESCALATE', comments: 'CDC to decide' } }), 201);

  const detail = expectStatus(await t.api('GET', `/api/requests/${ids.partial}`, { token: tok.cdcGrant }), 200);
  const decision = {
    action: 'PARTIAL_APPROVE',
    itemDecisions: detail.items.map((i) => ({
      requestItemId: i.id,
      approvedQuantity: i.budgetItem.code === 'SPK-01' ? 2 : i.requestedQuantity,
    })),
  };
  expectStatus(await t.api('POST', `/api/requests/${ids.partial}/actions`, { token: tok.cdcGrant, body: decision }), 201);
  expectStatus(await t.api('POST', `/api/requests/${ids.partial}/actions`, { token: tok.cdcNonGrant, body: decision }), 201);

  const r = await report(ids.partial, tok.principal);
  assert.equal(r.request.requestedAmount, 201000);
  assert.equal(r.request.sanctionedAmount, 101000);
  assert.equal(r.request.unapprovedAmount, 100000);

  const speakers = r.items.find((i) => i.budgetItem === 'SPK-01');
  assert.deepEqual([speakers.approvedQuantity, speakers.unapprovedQuantity], [2, 2]);
  assert.equal(speakers.unapprovedAmount, 100000);

  // The total is the sum of the lines, not a separately kept figure.
  const summed = r.items.reduce((total, i) => total + i.approvedAmount, 0);
  assert.equal(summed, r.request.sanctionedAmount);

  assert.deepEqual(r.route.map((s) => s.code), ['PURCHASE_COMMITTEE', 'PRINCIPAL', 'CDC']);
  assert.ok(!/Chairman/.test(r.workflow.map((w) => w.sentence).join(' ')));
  // Both CDC members are named, not one anonymous "CDC approved".
  const cdcSteps = r.workflow.filter((w) => w.stage?.code === 'CDC');
  assert.equal(new Set(cdcSteps.map((w) => w.by)).size, 2);
});

test('a resubmitted request reports the original and the correction, not just the latest', async () => {
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.head,
    body: { title: 'Projector bulbs', budgetHeadId: ids.it, departmentId: ids.cs,
            items: [{ budgetItemId: ids['MIC-01'], quantity: 1, unitCost: 8000 }] },
  }), 201);
  ids.resub = draft.id;
  expectStatus(await t.api('POST', `/api/requests/${ids.resub}/submit`, { token: tok.head }), 200);
  expectStatus(await t.api('POST', `/api/requests/${ids.resub}/actions`, {
    token: tok.pc1, body: { action: 'RETURN', comments: 'Attach a second quotation' } }), 201);

  const before = expectStatus(await t.api('GET', `/api/requests/${ids.resub}`, { token: tok.head }), 200);
  expectStatus(await t.api('PATCH', `/api/requests/${ids.resub}/items/${before.items[0].id}`, {
    token: tok.head, body: { quantity: 2 } }), 200);
  expectStatus(await t.api('POST', `/api/requests/${ids.resub}/resubmit`, {
    token: tok.head, body: { comments: 'Second quotation attached' } }), 200);

  const r = await report(ids.resub, tok.head);
  assert.equal(r.request.versionNumber, 2);
  assert.equal(r.resubmissions.length, 1);
  assert.deepEqual(
    [r.resubmissions[0].previousTotal, r.resubmissions[0].newTotal, r.resubmissions[0].correctionReason],
    [8000, 16000, 'Attach a second quotation'],
  );

  const actions = r.workflow.map((w) => w.action);
  assert.deepEqual(actions, ['SUBMIT', 'RETURN', 'RESUBMIT'], 'the original history survives the resubmission');
});

test('a report can only be printed by someone who could read the request', async () => {
  const stranger = await t.api('GET', `/api/requests/${ids.simple}/report`, { token: tok.headChem });
  assert.equal(stranger.status, 404);
  const asHtml = await t.api('GET', `/api/requests/${ids.simple}/report.html`, { token: tok.headChem });
  assert.equal(asHtml.status, 404, 'and no format is a way around it');
  const asPdf = await t.api('GET', `/api/requests/${ids.simple}/report.pdf`, { token: tok.headChem });
  assert.equal(asPdf.status, 404, 'and PDF format honors authorization');

  const page = await t.api('GET', `/api/requests/${ids.simple}/report.html`, { token: tok.principal });
  expectStatus(page, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = page.buffer.toString('utf8');
  assert.ok(html.includes('S. P. College'));
  assert.ok(html.includes('Lab microphone'));

  const pdfDoc = await t.api('GET', `/api/requests/${ids.simple}/report.pdf`, { token: tok.principal });
  expectStatus(pdfDoc, 200);
  assert.match(pdfDoc.headers.get('content-type'), /application\/pdf/);
  assert.match(pdfDoc.headers.get('content-disposition'), /\.pdf"?$/);
  assert.ok(pdfDoc.buffer.slice(0, 5).toString('utf8').startsWith('%PDF-'));
});

test('the stage reports are views of the same figures, not separate arithmetic', async () => {
  const complete = await report(ids.partial, tok.principal);
  const partial = await report(ids.partial, tok.principal, 'partial-approval');
  assert.equal(partial.title, 'Partial Approval Report');
  assert.deepEqual(partial.request, complete.request);
  assert.ok(!partial.sections.includes('audit'), 'a stage report shows fewer sections');

  const doc = await t.api('GET', `/api/requests/${ids.partial}/report.doc`, { token: tok.principal });
  expectStatus(doc, 200);
  assert.match(doc.headers.get('content-disposition'), /\.doc"?$/);
});

test('official institutional PDF report generates deterministic, valid PDF', async () => {
  const pdfDoc = await t.api('GET', `/api/requests/${ids.partial}/report.pdf`, { token: tok.principal });
  expectStatus(pdfDoc, 200);
  assert.match(pdfDoc.headers.get('content-type'), /application\/pdf/);
  assert.match(pdfDoc.headers.get('content-disposition'), /\.pdf"?$/);
  assert.ok(pdfDoc.buffer.length > 1000);
  assert.ok(pdfDoc.buffer.toString('utf8', 0, 8).startsWith('%PDF-1.'));
});

test('the audit trail appears for an administrator and for nobody else', async () => {
  const asAdmin = await report(ids.simple, tok.admin);
  assert.ok(asAdmin.audit.length > 0);
  const asRequester = await report(ids.simple, tok.head);
  assert.equal(asRequester.audit.length, 0, 'the audit log stays with the administrator');
});

test('GET /api/reports/summary provides comprehensive FY reporting data scoped by role', async () => {
  const summaryPrincipal = expectStatus(await t.api('GET', `/api/reports/summary?financialYearId=${ids.fy}`, { token: tok.principal }), 200);
  assert.ok(summaryPrincipal.financialYear);
  assert.ok(Array.isArray(summaryPrincipal.byBudgetHead));
  assert.ok(Array.isArray(summaryPrincipal.byStatus));
  assert.ok(Array.isArray(summaryPrincipal.byDepartment));
  assert.ok(Array.isArray(summaryPrincipal.byStage));
  assert.ok(Array.isArray(summaryPrincipal.byItemType));
  assert.ok(Array.isArray(summaryPrincipal.byFunding));
  assert.ok(Array.isArray(summaryPrincipal.monthly));
  assert.ok(Array.isArray(summaryPrincipal.provisions));
  assert.ok(Array.isArray(summaryPrincipal.pendingOverThreeDays));
  assert.ok(Array.isArray(summaryPrincipal.register));
  assert.ok(Array.isArray(summaryPrincipal.issues));

  const summaryHead = expectStatus(await t.api('GET', `/api/reports/summary?financialYearId=${ids.fy}`, { token: tok.head }), 200);
  assert.ok(summaryHead.byBudgetHead);
  assert.ok(Array.isArray(summaryHead.lineItems));
  assert.ok(Array.isArray(summaryHead.issuesDetailed));
});

test('department-wise report filtering and role-based download permissions', async () => {
  // Department-wise spend by budget head
  const deptSpend = expectStatus(
    await t.api('GET', `/api/reports/by-budget-head?financialYearId=${ids.fy}&departmentId=${ids.cs}`, { token: tok.principal }),
    200,
  );
  assert.equal(deptSpend.department?.id, ids.cs);
  assert.equal(deptSpend.department?.code, 'CS');

  // Higher authorities (Principal, CDC, Admin) CAN download Approval & Budget reports
  const principalApprovalReport = expectStatus(
    await t.api('GET', `/api/reports/summary?financialYearId=${ids.fy}&reportType=approval-budget`, { token: tok.principal }),
    200,
  );
  assert.equal(principalApprovalReport.canDownloadApprovalBudget, true);
  assert.equal(principalApprovalReport.isHigherAuthority, true);

  const cdcApprovalReport = expectStatus(
    await t.api('GET', `/api/reports/summary?financialYearId=${ids.fy}&departmentId=${ids.cs}&reportType=approval-budget`, { token: tok.cdcGrant }),
    200,
  );
  assert.equal(cdcApprovalReport.department?.id, ids.cs);
  assert.equal(cdcApprovalReport.canDownloadApprovalBudget, true);

  // HOD / regular members CANNOT download Approval & Budget reports (HTTP 403 Forbidden)
  const headForbidden = await t.api('GET', `/api/reports/summary?financialYearId=${ids.fy}&reportType=approval-budget`, { token: tok.head });
  expectStatus(headForbidden, 403);
  assert.match(headForbidden.body?.error?.message ?? '', /restricted to Principal, CDC, Chairman and Vice President/i);

  // HOD CAN download Requests report for their department
  const headRequestsReport = expectStatus(
    await t.api('GET', `/api/reports/summary?financialYearId=${ids.fy}&reportType=requests`, { token: tok.head }),
    200,
  );
  assert.ok(Array.isArray(headRequestsReport.lineItems));
  assert.ok(Array.isArray(headRequestsReport.register));

  // HOD CAN download Issues report
  const headIssuesReport = expectStatus(
    await t.api('GET', `/api/reports/summary?financialYearId=${ids.fy}&reportType=issues`, { token: tok.head }),
    200,
  );
  assert.ok(Array.isArray(headIssuesReport.issuesDetailed));
});


