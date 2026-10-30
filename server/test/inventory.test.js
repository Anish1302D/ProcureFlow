import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { expectStatus, startApi } from './helpers.js';

let t;
const tok = {};

before(async () => {
  t = await startApi();
  tok.admin = await t.login('admin@spcollege.edu');
  tok.principal = await t.login('principal@spcollege.edu');
  tok.head = await t.login('head.cs@spcollege.edu');
});
after(() => t?.close());

let itemId;

test('the administrator records inventory', async () => {
  const res = expectStatus(await t.api('POST', '/api/inventory', {
    token: tok.admin,
    body: { name: 'Wireless microphone', quantity: 2, unit: 'piece', condition: 'NEW', location: 'Seminar hall' },
  }), 201);
  itemId = res.id;
  assert.equal(res.quantity, 2);
  const updated = expectStatus(await t.api('PATCH', `/api/inventory/${itemId}`, {
    token: tok.admin, body: { condition: 'GOOD', quantity: 1.5 } }), 200);
  assert.deepEqual([updated.condition, updated.quantity], ['GOOD', 1.5]);
});

test('the Principal can view inventory but not change it', async () => {
  const list = expectStatus(await t.api('GET', '/api/inventory', { token: tok.principal }), 200);
  assert.ok(list.items.some((i) => i.id === itemId));
  expectStatus(await t.api('PATCH', `/api/inventory/${itemId}`, {
    token: tok.principal, body: { quantity: 99 } }), 403);
});

test('a requester cannot see inventory at all', async () => {
  expectStatus(await t.api('GET', '/api/inventory', { token: tok.head }), 403);
  expectStatus(await t.api('GET', '/api/purchase-bills', { token: tok.head }), 403);
});

test('unknown fields are ignored, not written', async () => {
  const res = expectStatus(await t.api('PATCH', `/api/inventory/${itemId}`, {
    token: tok.admin, body: { notes: 'checked', inventory_id: '00000000-0000-4000-8000-000000000000' } }), 200);
  assert.equal(res.id, itemId);
});

test('bills attach only to approved requests', async () => {
  const heads = expectStatus(await t.api('GET', '/api/budget-heads', { token: tok.head }), 200);
  const office = heads.find((h) => h.code === 'OFFICE').id;
  const items = expectStatus(await t.api('GET', `/api/budget-heads/${office}/items`, { token: tok.head }), 200);
  const draft = expectStatus(await t.api('POST', '/api/requests', {
    token: tok.head,
    body: { title: 'Paper', budgetHeadId: office, items: [{ budgetItemId: items[0].id, quantity: 5, unitCost: 300 }] },
  }), 201);

  const bill = { billNumber: 'INV-881', vendorName: 'Shah Stationers', billDate: '2026-09-10', billAmount: 1500 };
  expectStatus(await t.api('POST', '/api/purchase-bills', {
    token: tok.admin, body: { ...bill, requestId: draft.id } }), 422);

  expectStatus(await t.api('POST', `/api/requests/${draft.id}/submit`, { token: tok.head }), 200);
  // Validity check by the committee, then the Principal decides: under
  // ₹50,000 that is the whole route.
  const pc = await t.login('pc1@spcollege.edu');
  const principal = await t.login('principal@spcollege.edu');
  expectStatus(await t.api('POST', `/api/requests/${draft.id}/actions`, {
    token: pc, body: { action: 'ESCALATE', comments: 'In order' } }), 201);
  expectStatus(await t.api('POST', `/api/requests/${draft.id}/actions`, {
    token: principal, body: { action: 'APPROVE' } }), 201);

  const res = expectStatus(await t.api('POST', '/api/purchase-bills', {
    token: tok.admin, body: { ...bill, requestId: draft.id } }), 201);
  assert.equal(res.request.requestNumber, draft.requestNumber);
  expectStatus(await t.api('POST', '/api/purchase-bills', {
    token: tok.admin, body: { ...bill, requestId: draft.id } }), 409);
});

test('only the administrator reads the audit log', async () => {
  expectStatus(await t.api('GET', '/api/audit', { token: tok.principal }), 403);
  const log = expectStatus(await t.api('GET', '/api/audit?entityType=request', { token: tok.admin }), 200);
  assert.ok(log.items.some((e) => e.action === 'APPROVE'));
});
