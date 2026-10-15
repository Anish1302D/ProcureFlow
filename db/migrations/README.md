# Migrations

`db/schema/` is the **greenfield** definition — it builds the database from nothing.
Once the college server holds real requests, approvals and signatures, rerunning those
files is not an option: they `CREATE` objects that already exist, and a `down -v` style
rebuild destroys live data.

From that point on, every schema change is a numbered migration in this folder.

## The rule

- **Before first deployment** — edit `db/schema/*.sql` freely and rebuild.
- **After first deployment** — never edit a schema file expecting it to take effect.
  Add a migration here, mirror the change into `db/schema/` so a fresh build
  still produces the same result, and add the migration's filename to
  `db/schema/17_schema_migrations.sql` so a fresh build records it as applied.

A fresh build creates `schema_migrations` itself — there is no baseline step to
remember. Each migration also creates the table if it is missing, for databases
built before that file existed.

### Proving a migration matches the schema files

The two must produce identical databases. Build one fresh, apply the migration to
another, and compare their structure:

```bash
pg_dump -U postgres -s --no-owner spc_approval > migrated.sql
pg_dump -U postgres -s --no-owner spc_fresh    > fresh.sql
diff migrated.sql fresh.sql      # only the random \restrict token lines may differ
```

## Naming

```
<UTC timestamp>_<short_description>.sql
20260902T180000_add_budget_head_type.sql
```

Timestamps sort chronologically and avoid collisions when two people add migrations
in the same week.

## Writing one

Each file is plain SQL wrapped in a transaction, and must be safe to run against a
database that already contains data:

```sql
BEGIN;

ALTER TABLE budget_heads
    ADD COLUMN IF NOT EXISTS head_type budget_head_type;

UPDATE budget_heads SET head_type = 'REVENUE' WHERE head_type IS NULL;

ALTER TABLE budget_heads
    ALTER COLUMN head_type SET NOT NULL;

COMMIT;
```

Points that matter in practice:

- Wrap in `BEGIN`/`COMMIT` so a failure rolls back cleanly. PostgreSQL supports
  transactional DDL — use it.
- Backfill existing rows *before* adding a `NOT NULL` constraint, or the migration
  fails on any non-empty table.
- Prefer `IF NOT EXISTS` / `IF EXISTS` so a partially-applied migration can be rerun.
- Adding an index on a large live table? Use `CREATE INDEX CONCURRENTLY` — but that
  cannot run inside a transaction, so put it in its own migration with no `BEGIN`.

## Applying them on production (Neon)

Production is hosted on Neon. Follow [docs/DEPLOY_DB_NEON.md](../../docs/DEPLOY_DB_NEON.md):
back up with a Neon branch, pre-flight check, then `node scripts/run-pending-migrations.js`
from `server/`. Run migrations **before** deploying code that depends on them.

## Applying them

Track what has been applied:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Apply a migration, then record it:

```bash
psql -U postgres -d spc_approval -f db/migrations/20260902T180000_example.sql
psql -U postgres -d spc_approval \
  -c "INSERT INTO schema_migrations (filename) VALUES ('20260902T180000_example.sql');"
```

Check what is outstanding:

```bash
psql -U postgres -d spc_approval -c "SELECT filename, applied_at FROM schema_migrations ORDER BY filename;"
```

## Moving to a tool

The manual flow above is fine for a handful of migrations. Once it becomes tedious,
`node-pg-migrate` does the same thing with up/down pairs and automatic tracking:

```bash
npm install --save-dev node-pg-migrate pg
npx node-pg-migrate up
```

Point it at this folder with `-m db/migrations` and set `DATABASE_URL` in the
environment. Switching later costs nothing — backfill `schema_migrations` with the
filenames already applied and carry on.

## Before any migration on the college server

```bash
pg_dump -Fc spc_approval > backup_$(date +%Y%m%d_%H%M).dump
```

Restore with `pg_restore -d spc_approval backup_....dump` if a migration goes wrong.
