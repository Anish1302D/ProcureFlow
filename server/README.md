# API

REST API for the S.P. College Approval & Workflow Management System. Node,
Express 5 and PostgreSQL through the `pg` driver — no ORM.

The business rules live in the database: routing, approval authority, partial
approval, the sanctioned total, notifications and Row-Level Security. This API
is deliberately thin — authentication, validation and transport. An approval is
one call to `fn_record_action`, not logic re-implemented here.

## Setup

Requires Node 22+ and the database from `db/` running (Docker on port 5433 by
default).

1. Give `app_user` a login password on the database:

   ```sql
   ALTER ROLE app_user LOGIN PASSWORD '<choose one>';
   ```

2. Configure:

   ```bash
   cd server
   cp .env.example .env     # then fill in DATABASE_URL, JWT_SECRET, SIGNING_SECRET
   npm install
   ```

3. Run:

   ```bash
   npm run dev     # restarts on change
   npm start
   ```

   `GET http://localhost:4000/health` should answer `{"status":"ok"}`.

Development accounts come from `db/seed/03_users_and_approvers.sql`, all with
the password `ChangeMe#2026` — for example `principal@spcollege.edu`.

## Security model

**The API must connect as `app_user`.** It checks at startup and refuses to run
as `postgres` or any role that bypasses Row-Level Security — as a superuser
every policy is silently ignored and everyone sees everything.

Every data access runs inside `withUser()` (`src/db.js`), which opens a
transaction and identifies the caller with a transaction-scoped setting. The
database's policies then decide what each person sees. Routes contain no
`WHERE raised_by = …` filters; they are not needed.

Other safeguards, each covered by a test:

- Passwords are compared in the API with bcrypt, so plaintext never reaches the
  database or its logs. Unknown addresses are checked against a dummy hash, so
  response time does not reveal which addresses have accounts.
- Sign-in is limited to 10 attempts per 15 minutes per address and client.
- Tokens carry only the user id. Roles and active status are re-read on every
  request, so disabling an account takes effect at once.
- A request the caller may not see answers **404**, never 403 — a 403 would
  confirm it exists.
- Uploads are checked by their content, not their name or declared type; stored
  under generated names; downloadable only through the API.
- CSV exports neutralise cells that spreadsheets would run as formulas.

### Approval seals

Each decision is sealed with an HMAC over its exact content — request, action,
approver, and every item's approved quantity and amount — stored in
`digital_signatures`. The timeline recomputes it and reports each decision as
`VERIFIED`, `MISMATCH` (edited since it was recorded) or `UNSEALED`.

This proves a decision is unaltered since the API recorded it. It is **not** a
legal digital signature: the key is the server's, not the approver's. Proving
that an approver personally signed needs per-user keys such as a DSC token.

Keep `SIGNING_SECRET` stable — changing it makes every existing seal report
`MISMATCH`.

## Endpoints

All under `/api`, all requiring `Authorization: Bearer <token>` except sign-in.
Errors are `{ "error": { "code", "message", "details"? } }`; `code` is a
database SQLSTATE such as `SP004` where one applies (see `db/README.md`).

| | |
|---|---|
| **Auth** | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` |
| **Reference data** | `GET /budget-heads` · `GET /budget-heads/:id/items` · `GET /financial-years` · `GET /departments` · `GET /courses` · `GET /workflow/stages` |
| **Requests** | `GET /requests` · `POST /requests` · `GET /requests/:id` · `PATCH /requests/:id` · `DELETE /requests/:id` |
| **Line items** (drafts) | `POST /requests/:id/items` · `PATCH /requests/:id/items/:itemId` · `DELETE /requests/:id/items/:itemId` |
| **Workflow** | `POST /requests/:id/submit` · `POST /requests/:id/actions` · `GET /requests/:id/timeline` · `POST /requests/:id/carry-forward` |
| **Comments** | `GET /requests/:id/comments` · `POST /requests/:id/comments` |
| **Attachments** | `POST /requests/:id/attachments` · `POST /issues/:id/attachments` · `GET /attachments/:id` · `DELETE /attachments/:id` |
| **Issues** | `GET /issues` · `POST /issues` · `GET /issues/:id` · `PATCH /issues/:id` · `POST /issues/:id/events` |
| **Inventory** | `GET /inventory` · `POST /inventory` · `PATCH /inventory/:id` · `GET /purchase-bills` · `POST /purchase-bills` |
| **Reports** | `GET /dashboard` · `GET /reports/pending` · `GET /exports/requests.csv` · `GET /audit` |
| **Notifications** | `GET /notifications` · `POST /notifications/:id/read` · `POST /notifications/read-all` |

`GET /requests` filters: `status` (comma-separated), `financialYearId`, `stage`,
`mine=true`, `awaitingMe=true`, `q`, `limit`, `offset`.

### Recording a decision

```http
POST /api/requests/:id/actions
{ "action": "APPROVE", "comments": "optional" }
{ "action": "REJECT", "rejectionReason": "Insufficient budget allocation" }
{ "action": "ESCALATE", "comments": "Grant budget unavailable" }
{ "action": "PARTIAL_APPROVE",
  "itemDecisions": [
    { "requestItemId": "…", "approvedQuantity": 2 },
    { "requestItemId": "…", "approvedQuantity": 0 },
    { "requestItemId": "…", "approvedQuantity": 5, "approvedAmount": 60000 } ] }
```

A partial approval must decide **every** item. `approvedAmount` defaults to
quantity × unit cost; supply it to approve a lower price than requested.

`GET /requests/:id` returns a `permissions` block — `canEdit`, `canSubmit`,
`actions`, `canAttach`, `canCarryForward` — for deciding what the UI offers.
It grants nothing: every action is checked again when attempted.

### Who may do what

| Role | May |
|---|---|
| Head, Activity In-charge | Raise requests; see their own |
| Stage approvers | Decide requests at their stage; see requests at or past it |
| Principal | Read every submitted request; manage issues; view inventory |
| Purchase Committee | Also view inventory and bills |
| Admin | Everything, including inventory changes and the audit log |
| Anyone signed in | Raise and follow their own issues |

Role lists live in `src/roles.js`. Approval authority is not among them — it
comes from stage staffing in the database.

## Tests

```bash
npm test
```

133 tests drive the real API over HTTP, signed in as the seeded users, against a
database rebuilt from `db/schema` and `db/seed` before each test file. They
cover the full escalation path to the Chairman, partial approval, authority
refusals, visibility between roles, seal tamper detection, uploads, issues,
inventory and the audit log.

Nine of those tests (`test/code_review_issues.test.js`) are pure unit tests and
need no database; the other eight files do.

### Prerequisites

A reachable PostgreSQL and two connection strings in `server/.env`:

- `TEST_ADMIN_URL` — a superuser connection, used only to build the throwaway
  `spc_api_test` database.
- `DATABASE_URL` — the `app_user` connection the API under test uses, exactly
  as in production. `app_user` is created `NOLOGIN` by `db/schema/14_rls.sql`;
  `scripts/reset-test-db.js` gives it the password from this URL on first run.

**Mind the port.** `db/docker-compose.yml` publishes PostgreSQL on **5433**, to
avoid clashing with a local installation already using 5432 — so `.env.example`
shows 5433. If you instead use a PostgreSQL installed directly on the machine,
it is on **5432** and both URLs must say so. A connection refusal at startup is
an environment failure, not a test result, and the suite now says which host it
could not reach.

### Row-Level Security checks

Separately from `npm test`, 52 SQL assertions check that RLS holds when queried
as `app_user` directly. They assert exact row counts, so they need a database
freshly built from schema and seed:

```bash
node scripts/reset-test-db.js
psql -U postgres -d spc_api_test -f ../db/tests/rls_app_user.sql
```

Everything runs in one transaction that is rolled back, so no rows survive.

## Not included

- **Legal digital signatures.** See "Approval seals" above.
- **Guaranteed email delivery.** Notification email is sent fire-and-forget
  (`notifyRequestAsync` in `src/routes/requests.js`): a send that fails is
  logged and the request still proceeds. There is no retry queue, and with no
  SMTP or Resend credentials configured nothing goes out at all.
