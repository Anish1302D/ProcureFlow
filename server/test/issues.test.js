import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { expectStatus, pdf, startApi } from './helpers.js';

let t;
const tok = {};
const who = {};
let issueId;

before(async () => {
  t = await startApi();
  for (const [key, email] of Object.entries({
    head: 'head.cs@spcollege.edu', incharge: 'incharge@spcollege.edu',
    principal: 'principal@spcollege.edu', admin: 'admin@spcollege.edu',
  })) {
    tok[key] = await t.login(email);
    who[key] = expectStatus(await t.api('GET', '/api/auth/me', { token: tok[key] }), 200).id;
  }
});
after(() => t?.close());

test('anyone can raise an issue, and the Principal hears about it', async () => {
  const issue = expectStatus(await t.api('POST', '/api/issues', {
    token: tok.head, body: { title: 'Projector in room 204 is broken', description: 'No image since Monday.' },
  }), 201);
  issueId = issue.id;
  assert.match(issue.issueNumber, /^ISS-\d{4,}$/);
  assert.equal(issue.status, 'SUBMITTED');
  assert.deepEqual(issue.events.map((e) => e.action), ['CREATED']);

  const n = expectStatus(await t.api('GET', '/api/notifications', { token: tok.principal }), 200);
  assert.ok(n.items.some((x) => x.issue?.id === issueId));
});

test('only participants can see an issue', async () => {
  expectStatus(await t.api('GET', `/api/issues/${issueId}`, { token: tok.incharge }), 404);
  expectStatus(await t.api('GET', `/api/issues/${issueId}`, { token: tok.principal }), 200);
  expectStatus(await t.api('GET', `/api/issues/${issueId}`, { token: tok.admin }), 200);
});

test('the raiser cannot change the status themselves', async () => {
  expectStatus(await t.api('PATCH', `/api/issues/${issueId}`, {
    token: tok.head, body: { status: 'IN_REVIEW' } }), 403);
});

test('the admin can view but not update an issue', async () => {
  expectStatus(await t.api('GET', `/api/issues/${issueId}`, { token: tok.admin }), 200);
  expectStatus(await t.api('PATCH', `/api/issues/${issueId}`, {
    token: tok.admin, body: { status: 'IN_REVIEW' } }), 403);
});

test('the Principal moves it to review', async () => {
  const res = expectStatus(await t.api('PATCH', `/api/issues/${issueId}`, {
    token: tok.principal, body: { status: 'IN_REVIEW', note: 'Investigating the projector' },
  }), 200);
  assert.equal(res.status, 'IN_REVIEW');
  assert.deepEqual(res.events.map((e) => e.action), ['CREATED', 'IN_REVIEW']);
});

test('the Principal can attach evidence and resolve the issue', async () => {
  expectStatus(await t.api('POST', `/api/issues/${issueId}/attachments`,
    { token: tok.principal, form: pdf('service-report.pdf').form }), 201);
  const res = expectStatus(await t.api('PATCH', `/api/issues/${issueId}`, {
    token: tok.principal, body: { status: 'RESOLVED', note: 'Projector lamp replaced' } }), 200);
  assert.equal(res.status, 'RESOLVED');
  assert.ok(res.resolvedAt);
});

test('the raiser is told, sees the attachment, and confirms by closing', async () => {
  const n = expectStatus(await t.api('GET', '/api/notifications', { token: tok.head }), 200);
  assert.ok(n.items.some((x) => x.issue?.id === issueId && /resolved/.test(x.subject)));
  const detail = expectStatus(await t.api('GET', `/api/issues/${issueId}`, { token: tok.head }), 200);
  assert.equal(detail.attachments.length, 1);
  assert.deepEqual(detail.permissions.statusesAllowed, ['CLOSED']);
  expectStatus(await t.api('PATCH', `/api/issues/${issueId}`, { token: tok.head, body: { status: 'CLOSED' } }), 200);
});

test('a closed issue is final', async () => {
  expectStatus(await t.api('PATCH', `/api/issues/${issueId}`, {
    token: tok.principal, body: { status: 'IN_REVIEW' } }), 409);
  expectStatus(await t.api('POST', `/api/issues/${issueId}/events`, {
    token: tok.head, body: { note: 'one more thing' } }), 409);
});

test('lists are scoped', async () => {
  const mine = expectStatus(await t.api('GET', '/api/issues?mine=true', { token: tok.head }), 200);
  assert.deepEqual(mine.items.map((i) => i.id), [issueId]);
  const incharge = expectStatus(await t.api('GET', '/api/issues', { token: tok.incharge }), 200);
  assert.equal(incharge.items.length, 0);
  const principal = expectStatus(await t.api('GET', '/api/issues', { token: tok.principal }), 200);
  assert.equal(principal.total, 1);
});
