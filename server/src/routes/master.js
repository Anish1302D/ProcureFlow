import { Router } from 'express';
import { z } from 'zod';
import { withUser } from '../db.js';
import { notFound } from '../errors.js';
import { intId, param } from '../validate.js';

// Reference data for forms: budget heads and items, financial years,
// departments, courses, and the approval route. Read-only through the API.
export const masterRouter = Router();

const headRow = (r) => ({
  id: r.budget_head_id,
  code: r.code,
  name: r.name,
  headType: r.head_type,
  description: r.description,
});

const itemRow = (r) => ({
  id: r.budget_item_id,
  budgetHeadId: r.budget_head_id,
  code: r.code,
  name: r.name,
  itemType: r.item_type,
  unit: r.unit,
});

masterRouter.get('/budget-heads', async (req, res) => {
  const rows = await withUser(req.user.id, async (db) =>
    (await db.query(
      `SELECT budget_head_id, code, name, head_type, description
         FROM budget_heads WHERE is_active ORDER BY name`,
    )).rows);
  res.json(rows.map(headRow));
});

masterRouter.get('/budget-heads/:id/items', async (req, res) => {
  const headId = param(req, 'id', intId);
  const rows = await withUser(req.user.id, async (db) => {
    const head = await db.query('SELECT 1 FROM budget_heads WHERE budget_head_id = $1', [headId]);
    if (!head.rowCount) throw notFound('Budget head not found');
    return (await db.query(
      `SELECT budget_item_id, budget_head_id, code, name, item_type, unit
         FROM budget_items WHERE budget_head_id = $1 AND is_active ORDER BY name`,
      [headId],
    )).rows;
  });
  res.json(rows.map(itemRow));
});

masterRouter.get('/financial-years', async (req, res) => {
  const rows = await withUser(req.user.id, async (db) =>
    (await db.query(
      `SELECT financial_year_id, label, start_date, end_date, is_active
         FROM financial_years ORDER BY start_date DESC`,
    )).rows);
  res.json(rows.map((r) => ({
    id: r.financial_year_id,
    label: r.label,
    startDate: r.start_date,
    endDate: r.end_date,
    isActive: r.is_active,
  })));
});

masterRouter.get('/departments', async (req, res) => {
  const rows = await withUser(req.user.id, async (db) =>
    (await db.query('SELECT department_id, code, name, funding_type FROM departments ORDER BY name')).rows);
  res.json(rows.map((r) => ({ id: r.department_id, code: r.code, name: r.name, fundingType: r.funding_type })));
});

masterRouter.get('/courses', async (req, res) => {
  const { departmentId } = z.object({ departmentId: intId.optional() }).parse(req.query);
  const rows = await withUser(req.user.id, async (db) =>
    (await db.query(
      `SELECT course_id, department_id, code, name, funding_type FROM courses
        WHERE $1::int IS NULL OR department_id = $1 ORDER BY name`,
      [departmentId ?? null],
    )).rows);
  res.json(rows.map((r) => ({
    id: r.course_id,
    departmentId: r.department_id,
    code: r.code,
    name: r.name,
    fundingType: r.funding_type,
  })));
});

// The approval route, so the request form can show where an amount will go
// before it is submitted.
masterRouter.get('/workflow/stages', async (req, res) => {
  const rows = await withUser(req.user.id, async (db) =>
    (await db.query(
      `SELECT ws.stage_id, ws.code, ws.name, ws.sequence_no, ws.is_final,
              srr.min_amount, srr.max_amount
         FROM workflow_stages ws
         LEFT JOIN stage_routing_rules srr ON srr.stage_id = ws.stage_id
        ORDER BY ws.sequence_no`,
    )).rows);
  res.json(rows.map((r) => ({
    id: r.stage_id,
    code: r.code,
    name: r.name,
    sequence: r.sequence_no,
    isFinal: r.is_final,
    // Requests enter at the stage whose window contains their total.
    entryRange: r.min_amount === null ? null : { min: r.min_amount, maxExclusive: r.max_amount },
  })));
});
