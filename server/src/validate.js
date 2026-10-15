import { z } from 'zod';
import { HttpError } from './errors.js';

// Any 8-4-4-4-12 hex id. Stricter RFC-version checks add nothing here: ids
// only ever come from gen_random_uuid(). Lower-cased, matching how Postgres
// prints them, so an id compares and seals the same however the client typed it.
export const id = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid id')
  .transform((value) => value.toLowerCase());

export const intId = z.coerce.number().int().positive();

// Money and quantity columns are NUMERIC(…, 2). Rejecting a third decimal
// place here means Postgres never silently rounds what the user typed.
const twoDecimals = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

export const amount = z
  .number()
  .finite()
  .nonnegative()
  .max(999_999_999_999.99)
  .refine(twoDecimals, 'At most two decimal places');

export const positiveAmount = z
  .number()
  .finite()
  .positive('Amount must be greater than zero')
  .max(999_999_999_999.99)
  .refine(twoDecimals, 'At most two decimal places');

export const quantity = z
  .number()
  .finite()
  .positive('Quantity must be greater than zero')
  .max(9_999_999_999.99)
  .refine(twoDecimals, 'At most two decimal places');

export const approvedQuantity = z
  .number()
  .finite()
  .nonnegative()
  .max(9_999_999_999.99)
  .refine(twoDecimals, 'At most two decimal places');

export const pagination = {
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
};

// Query strings arrive as text; "true"/"1" mean yes.
export const flag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')
  .optional();

/** Validates a route parameter, answering 400 rather than a database error. */
export function param(req, name, schema = id) {
  const result = schema.safeParse(req.params[name]);
  if (!result.success) {
    throw new HttpError(400, `Invalid ${name}`);
  }
  return result.data;
}
