# Running database migrations on Neon (production)

The production database is hosted on **Neon**. Code merged to `main` can need a
database migration before it works; this page is the checklist for running one.

> **Pending now — `20261015T180000_cdc_route_single_rule.sql` (CDC fix, 15 Oct 2026).**
> The API on `main` calls the new database function `app_cdc_on_route`. If the
> backend has already been deployed from `main` and this migration has **not** been
> run on Neon, opening any request and the "Awaiting my decision" list fail with a
> server error. Run the steps below as soon as possible, and always run migrations
> **before** deploying backend code that depends on them.

What the CDC migration fixes: CDC members were notified of requests they could not
open (teaching members told about Non-Grant requests). It puts the "which CDC
member is on this request's route" rule into one function that visibility,
decisions, notifications and the API all share.

---

## 1. Back up: create a Neon branch

Neon Console → your project → **Branches** → **Create branch**, from the
production branch. Name it e.g. `backup-before-cdc-fix-2026-10-15`.

A branch is an instant copy of the database at that moment. If anything goes
wrong, restore the production branch from it (Branches → production → **Restore**).

## 2. Get the direct (unpooled) connection string

Neon Console → **Connect** → turn **Connection pooling off**. The host must *not*
contain `-pooler`. Migrations run multi-statement SQL in one session, which the
pooled endpoint is not meant for.

Keep it out of git: set it only in your terminal for this run (step 4). Never put
it in `server/.env` or commit it.

## 3. Pre-flight check (Neon SQL Editor)

See which migrations Neon has recorded:

```sql
SELECT filename, applied_at
  FROM schema_migrations
 WHERE filename >= '20261004'
 ORDER BY filename;
```

**If `20261004T130000_notify_member_and_return_status.sql` and
`20261004T170000_cdc_funding_separation.sql` are missing from that list**, do not
let the runner execute them: they contain 4 October versions of functions that
later migrations replaced, and re-running them reverts `fn_record_action`,
`app_is_stage_participant` and `fn_notify_request_status`. First confirm the
database already has what they added:

```sql
SELECT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_name = 'departments' AND column_name = 'funding_type') AS has_department_funding,
       to_regprocedure('app_request_funding_type(uuid)') IS NOT NULL         AS has_funding_function;
```

If both are `true`, record the two files as applied instead of running them:

```sql
INSERT INTO schema_migrations (filename) VALUES
    ('20261004T130000_notify_member_and_return_status.sql'),
    ('20261004T170000_cdc_funding_separation.sql')
ON CONFLICT (filename) DO NOTHING;
```

If either is `false`, stop: the database is older than expected. Ask before going on.

## 4. Run the migrations

From the `server/` folder, with the direct connection string from step 2:

```powershell
# Windows PowerShell
$env:DATABASE_URL_UNPOOLED = 'postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require'
node scripts/run-pending-migrations.js
Remove-Item Env:DATABASE_URL_UNPOOLED
```

```bash
# macOS / Linux / Git Bash
DATABASE_URL_UNPOOLED='postgresql://USER:PASSWORD@HOST.neon.tech/DBNAME?sslmode=require' \
  node scripts/run-pending-migrations.js
```

Check the output:

- It must say `Connecting to database (Neon Cloud)...`. If it says `Local`, the
  variable was not picked up — you are not talking to Neon.
- The pending list should be what you expect — for this release,
  `20261015T180000_cdc_route_single_rule.sql`. It applies each file in its own
  transaction and stops at the first error, rolling that file back.
- Running it a second time must print `No pending migrations!`.

## 5. Verify (Neon SQL Editor)

```sql
SELECT to_regprocedure('app_cdc_on_route(uuid,text,text)') IS NOT NULL AS cdc_rule_installed;

SELECT filename, applied_at FROM schema_migrations
 WHERE filename = '20261015T180000_cdc_route_single_rule.sql';
```

Then in the app: raise a ₹1,00,000 request from a **Non-Grant** department, pass it
through the Purchase Committee and the Principal, and check that only the CDC
Non-Grant (non-teaching) member is notified, can open it, and can decide it — and
that teaching CDC members are not notified.

## 6. Deploy the backend

Only after step 5 passes, deploy (or redeploy) the backend from `main`.

## If something goes wrong

Restore the production branch from the backup branch made in step 1, then report
the runner's error output. Do not edit migration files that have already been run
on Neon — add a new migration instead (see `db/migrations/README.md`).
