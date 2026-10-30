import pg from 'pg';
import { config } from './config.js';

// NUMERIC arrives from pg as a string to protect precision. Amounts here are
// NUMERIC(14,2), well inside the range a double holds exactly to two decimal
// places, so they are parsed to numbers for a friendlier JSON API. No money
// arithmetic happens in JavaScript: totals and line amounts are computed in
// SQL, where NUMERIC is exact.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 3000,
});

/**
 * Runs `fn` inside a transaction that carries the caller's identity, so every
 * statement is filtered by the database's Row-Level Security policies.
 *
 * The identity is set with set_config(..., true) — the parameterised form of
 * SET LOCAL. It is scoped to this transaction and discarded on commit. A plain
 * SET would persist on the pooled connection and hand this user's identity to
 * whichever request borrows the connection next.
 */
export async function withUser(userId, fn) {
  if (!userId) {
    throw new Error('withUser requires a user id');
  }
  const client = await pool.connect();
  let broken;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // A connection that cannot roll back is in an unknown state; passing the
      // error to release() destroys it instead of returning it to the pool.
      broken = rollbackErr;
    }
    throw err;
  } finally {
    client.release(broken);
  }
}

/**
 * Runs several queries on one transaction's client, one after another.
 *
 * A single connection executes one statement at a time regardless, so
 * Promise.all over the same client gains nothing — and pg deprecates it,
 * removing it in pg 9.
 */
export async function queryAll(db, queries) {
  const results = [];
  for (const [text, params] of queries) {
    results.push(await db.query(text, params));
  }
  return results;
}

/**
 * For the few queries that run before anyone is identified — sign-in and
 * token checks. With no app.user_id set, every RLS policy evaluates to false,
 * so this can only reach tables without RLS (users, roles).
 */
export function anonQuery(text, params) {
  return pool.query(text, params);
}

/**
 * Refuses to start if the configured role bypasses Row-Level Security. A
 * superuser or BYPASSRLS role would see every row regardless of policy —
 * the API would appear to work while enforcing nothing.
 */
export async function assertRlsEnforced() {
  const { rows } = await pool.query(
    `SELECT current_user AS role, rolsuper, rolbypassrls
       FROM pg_roles WHERE rolname = current_user`,
  );
  const { role, rolsuper, rolbypassrls } = rows[0];
  if (rolsuper || rolbypassrls) {
    throw new Error(
      `Refusing to start: connected as "${role}", which bypasses Row-Level Security. ` +
        'Set DATABASE_URL to connect as app_user.',
    );
  }
  return role;
}
