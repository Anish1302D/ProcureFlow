# Running database migrations on Neon (production)

The production database is hosted on **Neon**. Code merged to `main` can need a
database migration before it works; this page is the checklist for running one.

> **Pending now — invitations, password recovery and 2-step verification
> (branch `30-invite-link-for-new-users`).** Two migrations, in this order:
>
> 1. `20261018T120000_invitations_and_password_recovery.sql`
> 2. `20261018T130000_two_step_verification.sql`
>
> **Before deploying the backend**, set these on the server (Render now, the
> college cPanel server later) — see `server/.env.example` for details:
>
> | Variable | Value |
> |---|---|
> | `NODE_ENV` | `production` |
> | `APP_URL` | the https address people open the app at (no trailing slash) |
> | `MFA_ENCRYPTION_KEY` | 64 hex characters, generated once, kept with the database backups |
> | `MAIL_FROM_NAME` | sender name people see (optional) |
> | email provider | `BREVO_API_KEY` + `BREVO_SENDER_EMAIL`, or `RESEND_API_KEY` + `RESEND_FROM`, or `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` (cPanel mail) |
>
> Without `APP_URL` invitations and reset emails are refused rather than sent with
> a broken link; without `MFA_ENCRYPTION_KEY` the administrator cannot complete
> 2-step verification. After deploying, the administrator's next sign-in asks them
> to set up an authenticator app. If no administrator can sign in, use
> `docs/ADMIN_RECOVERY.md`.
>
> The earlier CDC migration (`20261015T180000_cdc_route_single_rule.sql`) has
> already been run on Neon.

What this release changes: accounts exist only by emailed invitation (the
administrator never sees links or sets passwords), forgotten passwords are reset
by email, repeated wrong passwords pause sign-in, an account's email changes only
when the new address confirms, and the administrator signs in with 2-step
verification.

---

## 1. Back up: create a Neon branch

Neon Console → your project → **Branches** → **Create branch**, from the
production branch. Name it after the date and release, e.g. `backup-before-invitations-2026-10-18`.

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
  `20261018T120000_invitations_and_password_recovery.sql` then
  `20261018T130000_two_step_verification.sql`. It applies each file in its own
  transaction and stops at the first error, rolling that file back.
- Running it a second time must print `No pending migrations!`.

## 5. Verify (Neon SQL Editor)

```sql
SELECT to_regprocedure('fn_issue_password_reset(text,text,integer,text,integer)') IS NOT NULL AS reset_links_installed,
       to_regclass('mfa_recovery_codes') IS NOT NULL AS two_step_installed;

SELECT filename, applied_at FROM schema_migrations
 WHERE filename LIKE '20261018T%' ORDER BY filename;
```

Then in the app, after deploying (step 6):

1. The administrator signs in and is asked to set up an authenticator app; they
   save their recovery codes.
2. Invite a test person with your own second email address: the invitation arrives,
   names the role, and setting a password from it works.
3. Use **Forgot password?** for that test account: the reset email arrives and works.

## 6. Deploy the backend

Only after step 5 passes, deploy (or redeploy) the backend from `main`.

## If something goes wrong

Restore the production branch from the backup branch made in step 1, then report
the runner's error output. Do not edit migration files that have already been run
on Neon — add a new migration instead (see `db/migrations/README.md`).
