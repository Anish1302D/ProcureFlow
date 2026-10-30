import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth.js';
import { withUser } from '../db.js';
import { notFound, unprocessable } from '../errors.js';
import { INVENTORY_READER_ROLES, INVENTORY_WRITER_ROLES } from '../roles.js';
import { amount, id, intId, pagination, param } from '../validate.js';

// Inventory and purchase bills. These tables carry no Row-Level Security —
// they are college records rather than personal ones — so access is decided
// here by role.
export const inventoryRouter = Router();

const read = requireRole(...INVENTORY_READER_ROLES);
const write = requireRole(...INVENTORY_WRITER_ROLES);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

const inventoryRow = (r) => ({
  id: r.inventory_id,
  name: r.name,
  quantity: r.quantity,
  unit: r.unit,
  condition: r.condition,
  location: r.location,
  acquiredOn: r.acquired_on,
  notes: r.notes,
  budgetItem: r.budget_item_id ? { id: r.budget_item_id, name: r.budget_item_name } : null,
  department: r.department_id ? { id: r.department_id, name: r.department_name } : null,
  requestId: r.request_id,
  billId: r.bill_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const SELECT_INVENTORY = `
  SELECT ii.*, bi.name AS budget_item_name, d.name AS department_name, count(*) OVER () AS total_count
    FROM inventory_items ii
    LEFT JOIN budget_items bi ON bi.budget_item_id = ii.budget_item_id
    LEFT JOIN departments d   ON d.department_id   = ii.department_id`;

inventoryRouter.get('/inventory', read, async (req, res) => {
  const f = z.object({
    departmentId: intId.optional(),
    q: z.string().trim().max(100).optional(),
    ...pagination,
  }).parse(req.query);
  const q = f.q ? `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await withUser(req.user.id, async (db) => (await db.query(
    `${SELECT_INVENTORY}
      WHERE ($1::int IS NULL OR ii.department_id = $1)
        AND ($2::text IS NULL OR ii.name ILIKE $2 OR ii.location ILIKE $2)
      ORDER BY ii.name, ii.inventory_id
      LIMIT $3 OFFSET $4`,
    [f.departmentId ?? null, q, f.limit, f.offset],
  )).rows);
  res.json({ items: rows.map(inventoryRow), total: rows[0]?.total_count ?? 0, limit: f.limit, offset: f.offset });
});

const inventoryFields = {
  name: z.string().trim().min(1).max(200),
  quantity: amount,
  unit: z.string().trim().max(30).nullable(),
  condition: z.enum(['NEW', 'GOOD', 'FAIR', 'DAMAGED', 'DISPOSED']).nullable(),
  location: z.string().trim().max(200).nullable(),
  acquiredOn: isoDate.nullable(),
  notes: z.string().trim().max(2000).nullable(),
  budgetItemId: intId.nullable(),
  departmentId: intId.nullable(),
  requestId: id.nullable(),
  billId: id.nullable(),
};
const INVENTORY_COLUMNS = {
  name: 'name', quantity: 'quantity', unit: 'unit', condition: 'condition', location: 'location',
  acquiredOn: 'acquired_on', notes: 'notes', budgetItemId: 'budget_item_id',
  departmentId: 'department_id', requestId: 'request_id', billId: 'bill_id',
};

const createInventory = z.object(inventoryFields).partial().required({ name: true, quantity: true });
const updateInventory = z.object(inventoryFields).partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');

inventoryRouter.post('/inventory', write, async (req, res) => {
  const body = createInventory.parse(req.body);
  const row = await withUser(req.user.id, async (db) => {
    const keys = Object.keys(body);
    const { rows } = await db.query(
      `INSERT INTO inventory_items (${keys.map((k) => INVENTORY_COLUMNS[k]).join(', ')})
       VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING inventory_id`,
      keys.map((k) => body[k]),
    );
    return (await db.query(`${SELECT_INVENTORY} WHERE ii.inventory_id = $1`, [rows[0].inventory_id])).rows[0];
  });
  res.status(201).json(inventoryRow(row));
});

inventoryRouter.patch('/inventory/:id', write, async (req, res) => {
  const inventoryId = param(req, 'id');
  const body = updateInventory.parse(req.body);
  const row = await withUser(req.user.id, async (db) => {
    const keys = Object.keys(body);
    const { rowCount } = await db.query(
      `UPDATE inventory_items SET ${keys.map((k, i) => `${INVENTORY_COLUMNS[k]} = $${i + 2}`).join(', ')}
        WHERE inventory_id = $1`,
      [inventoryId, ...keys.map((k) => body[k])],
    );
    if (!rowCount) throw notFound('Inventory item not found');
    return (await db.query(`${SELECT_INVENTORY} WHERE ii.inventory_id = $1`, [inventoryId])).rows[0];
  });
  res.json(inventoryRow(row));
});

// ---------------------------------------------------------------------------
// Purchase bills
// ---------------------------------------------------------------------------

const billRow = (r) => ({
  id: r.bill_id,
  billNumber: r.bill_number,
  vendorName: r.vendor_name,
  billDate: r.bill_date,
  billAmount: r.bill_amount,
  request: r.request_id ? { id: r.request_id, requestNumber: r.request_number } : null,
  attachmentId: r.attachment_id,
  createdAt: r.created_at,
});

// The linked request number comes through RLS: a reader who cannot see that
// request gets the bill without it.
const SELECT_BILLS = `
  SELECT pb.*, r.request_number, count(*) OVER () AS total_count
    FROM purchase_bills pb
    LEFT JOIN requests r ON r.request_id = pb.request_id`;

inventoryRouter.get('/purchase-bills', read, async (req, res) => {
  const f = z.object({ requestId: id.optional(), ...pagination }).parse(req.query);
  const rows = await withUser(req.user.id, async (db) => (await db.query(
    `${SELECT_BILLS}
      WHERE ($1::uuid IS NULL OR pb.request_id = $1)
      ORDER BY pb.bill_date DESC NULLS LAST, pb.created_at DESC
      LIMIT $2 OFFSET $3`,
    [f.requestId ?? null, f.limit, f.offset],
  )).rows);
  res.json({ items: rows.map(billRow), total: rows[0]?.total_count ?? 0, limit: f.limit, offset: f.offset });
});

const billSchema = z.object({
  billNumber: z.string().trim().min(1).max(100),
  vendorName: z.string().trim().max(200).optional(),
  billDate: isoDate.optional(),
  billAmount: amount,
  requestId: id.optional(),
  attachmentId: id.optional(),
});

inventoryRouter.post('/purchase-bills', write, async (req, res) => {
  const body = billSchema.parse(req.body);
  const row = await withUser(req.user.id, async (db) => {
    if (body.requestId) {
      const { rows } = await db.query(
        'SELECT current_status FROM requests WHERE request_id = $1', [body.requestId]);
      if (!rows[0]) throw unprocessable('Linked request not found');
      if (!['APPROVED', 'PARTIALLY_APPROVED', 'FULFILMENT_PENDING', 'FULFILLED'].includes(rows[0].current_status)) {
        throw unprocessable('Bills can only be recorded against an approved request');
      }
    }
    const { rows } = await db.query(
      `INSERT INTO purchase_bills (bill_number, vendor_name, bill_date, bill_amount, request_id, attachment_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING bill_id`,
      [body.billNumber, body.vendorName ?? null, body.billDate ?? null, body.billAmount,
        body.requestId ?? null, body.attachmentId ?? null],
    );
    return (await db.query(`${SELECT_BILLS} WHERE pb.bill_id = $1`, [rows[0].bill_id])).rows[0];
  });
  res.status(201).json(billRow(row));
});
