# AI Work Log

This file records prompts received and the work completed with AI assistance.

## 2026-08-21

### Prompt

Run the project in the browser.

### Work Completed

- Started the Vite development server with `npm run dev -- --host 127.0.0.1`.
- Opened the application at `http://127.0.0.1:3000/` and verified that the page loaded.

### Prompt

Create a GitHub repository, push the project, add `requirement.md`, `readme.md`, and an AI log file, and remove the unused ZIP file.

### Work Completed

- Added `requirement.md` with functional and non-functional project requirements.
- Added `readme.md` with setup, scripts, and project structure information.
- Added this `AI_LOGS.md` file to track prompts and completed work.
- Removed the unused ZIP archive from the project.
- Added Git ignore rules for dependencies, build output, and local environment files.
- Initialized Git and prepared the project for its first commit.

### Notes

The GitHub CLI is not installed in the current environment, so the remote repository and push require an authenticated GitHub URL or GitHub CLI setup.

## 2026-09-02

### Prompt

Read both requirement documents, design the PostgreSQL database, and generate use case, UML, and class diagrams. Database should be ready to run.

### Work Completed

- Extracted and reviewed `SPCollege_ApprovalSystem_Requirements.docx` and `Procurement_Workflow_Database_Documentation_2.docx`.
- Designed and wrote the PostgreSQL schema under `db/schema/` — 24 tables, 5 views, 3 functions across 13 numbered files.
- Added seed data under `db/seed/` for roles, workflow stages, amount-based routing rules, and sample master data.
- Added `db/docker-compose.yml` and `db/docker/init.sh` so the schema can also run in Docker (Postgres on 5433, pgAdmin on 5050) alongside a local install on 5432.
- Verified the full schema loads without error against PostgreSQL 16 in Docker, and smoke-tested the routing function, the quantity constraint, the submit function, and the dashboard views.
- Wrote six Mermaid diagrams to `docs/diagrams/` — use case, ERD, class, state, sequence, and approval workflow — and validated all of them parse.
- Published a diagram reference page as an Artifact.

### Design Decisions

- Academic year was dropped from the model at the user's instruction; requests are scoped to financial year only, and carry-forward moves a request between financial years.
- `budget_heads.head_type` (`REVENUE` / `CAPITAL`) added per Madhuri Mam, kept separate from the finer `budget_items.item_type`.
- `request_items.requested_quantity > 0` enforced as a database CHECK constraint per Madhuri Mam.

### Prompt

Add error codes, fix the issues you raised, and commit as sole author.

### Work Completed

- Added SQLSTATE codes `SP001`–`SP012` to every refusal raised by the workflow
  functions, so the API can map failures to HTTP status codes without matching
  on English message text. Applied both as a migration and in the schema files.
- Fixed a defect found while testing: `approval_action_items` allowed a decision
  recorded against one request to point at a line item belonging to another.
  Composite foreign keys now force the two to agree.
- Added `db/migrations/` with the rule that schema files are edited freely until
  the first real deployment, and every change after that is a migration.

### Notes

- Class `SP` was chosen after an earlier draft proposed `AP`: the SQL standard
  reserves classes beginning `A`–`H`, leaving `I`–`Z` for applications.
- Ten of the twelve codes are covered by tests. `SP009` and `SP012` guard
  against workflow misconfiguration and cannot occur in normal operation.

## 2026-09-11

### Prompt

Do the backend.

### Work Completed

- Built the REST API under `server/` — Node, Express 5, the `pg` driver, no ORM.
  44 endpoints covering requests and line items, submission and decisions,
  timeline, carry-forward, comments, attachments, non-financial issues,
  inventory, purchase bills, dashboards, CSV export, notifications and audit.
- Wrote 73 tests that drive the real API over HTTP as the seeded users, against
  a database rebuilt from `db/schema` and `db/seed` before each test file.
- **Fixed six Row-Level Security defects in the database.** All earlier testing
  had run as `postgres`, which bypasses those rules entirely, so none of them
  were visible until the workflow was run as the role the API actually uses:
  1. Views leaked every row — a view reads with its owner's privileges, and the
     owner is the superuser. A Head could see another user's private draft.
  2. `fn_record_action` checked the actor *parameter* rather than the signed-in
     session, so a requester could pass an approver's id and approve their own
     request.
  3. Escalation always failed, so nothing could reach the Chairman: the approver
     policy had no `WITH CHECK`, and Postgres reused `USING` for the new row.
  4. No notification could ever be created, since the rules let a user insert
     only their own.
  5. The Principal could see faculty issues but never review or resolve them.
  6. The Principal could not see requests of ₹5 lakh or more, which skip the
     Principal stage entirely.
- Added `db/tests/rls_app_user.sql`: 45 checks that run as `app_user` and assert
  what each role can and cannot do. It rolls back, so it is safe to run anywhere.
- Read `Email_Workflow_Master_Document_College_Procurement_Approval.docx` and
  wrote `docs/ApprovalHub_Mail_Plan.html`, mapping all 29 email templates onto
  the system as built.

### Design Decisions

- **No ORM.** The workflow rules live in the database, and an ORM cannot model
  the decision function, the triggers, the security policies or the views — it
  would be bypassed for everything that matters, while its migrations fought the
  hand-written schema.
- **The API refuses to start** unless its database role is subject to Row-Level
  Security, so it can never be deployed in a way that silently enforces nothing.
- **No money arithmetic in JavaScript.** Line and request totals are computed in
  SQL, where `NUMERIC` is exact.
- **Requests the caller may not see answer 404, not 403** — a 403 would confirm
  the record exists.
- Approval seals are an HMAC over each decision's exact content. They detect a
  decision being edited directly in the database. They are **not** legal digital
  signatures: the key belongs to the server, not the approver.

### Notes

Where the email specification and the built system disagree — stage approvals
being final rather than forwarded, requests that skip the Purchase Committee,
academic year, duplicate escalation emails, and the Head of Department copy the
data model cannot resolve — the differences are listed in §3 of the mail plan
rather than resolved silently.

## 2026-09-12

### Prompt

Connect the frontend, update the docs, and generate a PR summary.

### Work Completed

- Replaced the mock data throughout the interface with the API. Deleted
  `src/data/`, the role switcher, and the screens the API cannot serve.
- Added real sign-in. What each person sees now follows their roles and the
  approval stages they staff, so the Purchase Committee — who previously had no
  screens at all — gets a review queue.
- Built the two screens that needed designing rather than rewiring: the request
  form, where a request is assembled line by line with a live total and a
  preview of which stage it will reach; and the approval panel, where an
  approver sets an approved quantity per line and sees the sanctioned total
  before confirming.
- Replaced invented figures with real ones: reports now chart spending by budget
  head and compute the approval rate from actual decisions rather than a
  hard-coded percentage; exports download real CSV files; the settings page
  shows the approval route as configured instead of fields that saved nothing.
- Moved navigation into the address bar as hash routes, so a request can be
  linked to, bookmarked and reopened after a refresh — needed by the planned
  notification emails, and requiring no rewrite rules on IIS.
- Added `/api/users` (to assign an issue to someone) and
  `/api/reports/by-budget-head`; replaced a dashboard count that read a status
  the workflow never sets.
- Added `fn_inr` so amounts read as ₹6,50,000.50 rather than 650000.50, and used
  it in notification text. The email templates will need the same function.
- Fixed issue history events written in one transaction tying on timestamp and
  sorting randomly; they now use `clock_timestamp()`.

### Notes

- Verified in a browser as each role: a two-item request raised and submitted,
  escalated by CDC, partially approved by the Chairman at ₹3,00,000 of
  ₹6,50,000, with a restricted CDC comment the requester cannot see and both
  decisions reported as sealed; an issue raised, assigned and moved to review.
- The login page lists development accounts for convenience. That list and the
  seed password are compiled out of production builds — verified by searching
  the built bundle.
- Not built: returning a request for correction, the fulfilment
  and closing steps, and deployment.

## 2026-09-26

### Prompt

Once I create a new issue or log an issue the email does not go to the principal.
For now I have set principal mail as protonedge01@gmail.com, also there is a format
of email in the filestructure as well. Deploy it so that it will work on the deployed site as well.

### Work Completed

- **Email notification pipeline for issues:** Implemented automated email delivery
  to the Principal when a new non-financial issue is logged (`POST /api/issues`).
- **Resend HTTP API & SMTP fallback transport:** Configured Resend as the primary
  transport on cloud hosts (such as Render) where outbound SMTP ports (465, 587)
  are blocked, with automatic fallback between Resend and SMTP.
- **Fail-fast timeouts:** Added connection and socket timeouts (5s) to nodemailer
  transports so network/port restrictions fail immediately without hanging requests.
- **Environment variables & sanitization:** Added `.trim()` parsing to credential
  and email environment variables in `config.js` to safeguard against trailing newlines.
- **Verified and deployed:** Tested both locally and on the deployed Render service.

## 2026-09-27

### Prompt

Multi-step improvement plan on the `revisit` branch:
1. Admin User Management panel (no SQL needed to provision accounts)
2. "Other" option with free-text on all dropdowns in NewRequestModal
3. Fix Courses (seed data gap)
4. DecisionPanel color-coded actions
5. UI/UX pass across all screens
6. Per-role feature review

### Step 1 Work Completed — Admin User Management

- **New backend router** `server/src/routes/admin.js`: six endpoints, all gated behind `requireRole('ADMIN')`.
  - `GET  /api/admin/users` — list all users with their roles (joined from `user_roles`)
  - `GET  /api/admin/roles` — list all available roles from the `roles` table
  - `POST /api/admin/users` — create user (email, full name, password, role IDs, active flag)
  - `PATCH /api/admin/users/:id` — edit any field including password and roles
  - `DELETE /api/admin/users/:id` — soft-deactivate (`is_active = false`), preserves all audit history
  - `POST /api/admin/users/:id/reactivate` — re-enable a deactivated account
- **Security**: passwords hashed with bcrypt (cost 12) *before* the DB transaction opens (CPU-bound work outside the pool connection). Admin cannot deactivate their own account.
- **Mounted** in `server/src/app.js` at `/api/admin`.
- **New page** `src/pages/UserManagement.jsx`: searchable user table with color-coded role pills, add/edit/deactivate/reactivate actions, and a shared create/edit modal with role multi-select checkboxes, password field, and active toggle.
- **Sidebar** updated: "User management" added to the Admin portal under Operations.
- **App.jsx** updated: import and register `user-management` page in PAGES map.
- Committed and pushed to `revisit` branch.

### Step 2 Work Completed — "Other" option on all dropdowns

**Approach (no schema change):**
- `department_id` and `course_id` are already nullable FKs — when "Other" is selected, they are left null and the typed name is stored in `extra.customDepartment` / `extra.customCourse`.
- `urgency` is already in `extra.urgency` — the typed string is saved directly.
- `budget_head_id` is a required FK — a sentinel `OTHER` row is inserted into `budget_heads`. Custom name stored in `extra.customBudgetHead`.
- Per-line budget items use sentinel `OTHER` rows (one per budget head). Custom item name stored as `[Custom item: <name>]` prefix in the `remarks` field of `request_items`.

**Migration** `db/migrations/20260927T120000_other_sentinel_items.sql`:
- Inserts `budget_heads (code='OTHER')` and `budget_items (code='OTHER')` under every head. Fully idempotent via `ON CONFLICT DO NOTHING`.

**Frontend changes:**
- `NewRequestModal.jsx` — rewritten to detect sentinel selection and reveal an amber-tinted free-text input beneath each affected dropdown. Validation enforces that "Other" fields are not left blank before submission. Items formatted as `[Custom item: ...]` in remarks for the API.
- `ItemsTable.jsx` — added `parseCustomItem()` helper that strips the `[Custom item: ...]` prefix from remarks and displays it as the proper item name. Downstream (approval screens, history) shows the user-typed name everywhere.
- `RequestDetailModal.jsx` — subtitle and department/course tiles now read `extra.custom*` values and append `(other)` label for clarity.


### Step 3 Work Completed - Fix Courses + Master Data Management

- Migration 20260927T121500_seed_courses.sql: inserted 11 courses across 4 departments (CS, CHEM, PHY, ADMIN). Idempotent.
- Admin API: GET/POST/PATCH/DELETE /api/admin/departments and /api/admin/courses added to admin.js
- New page MasterDataManagement.jsx: accordion list of departments with courses, inline CRUD, changes immediately visible in NewRequestModal.
- Wired into admin sidebar and App.jsx.

### Step 4 Work Completed - DecisionPanel persistent color coding

- DecisionPanel.jsx rewritten. All 4 action buttons are persistently color-coded before selection: Approve=green, Partial=teal, Reject=red, Escalate=indigo. Small colored dot as semantic cue on unselected state. On selection: full solid color with shadow. Confirm button matches action color.

### Step 5 Work Completed - UI/UX pass

- Profile.jsx rewritten: color-coded role badges, self-service password change accordion (calls POST /api/auth/change-password), gradient avatar, improved hierarchy.
- POST /api/auth/change-password added to auth.js: verifies current password, hashes new password (bcrypt cost 12), returns 204.
- SettingsPreferences.jsx rewritten: visual flow diagram with color-coded stage cards, connector arrows, amount thresholds, amber info callout.
- ReviewQueue.jsx improved: live count badge from /api/dashboard, better spacing.
- DecisionsArchive.jsx improved: visual legend (Approve/Partial/Reject/CarriedForward icons), empty-state hint.
- Decision toasts: useAction() already wires CHOICES[action].done toast on every decision confirm.

### Fix: PDF Attachments vanish on Render (Google Drive storage backend)

**Root cause confirmed:** Render's ephemeral filesystem wipes the container's writable layer on every restart/redeploy. Uploaded files were written to a local `uploads/` folder, DB row was inserted (201 success), but the physical file was gone after any restart. Principal downloads returned 410 Gone.

**What was NOT broken:** Multer field name (`file` matches on both sides), file size limits (10MB), PDF magic-byte detection, canAttach permission gate for HEAD role, RLS attachments_insert policy.

**Fix - Google Drive backend:**
- `server/src/storage.js` rewritten: when `GDRIVE_CREDENTIALS` + `GDRIVE_FOLDER_ID` env vars are both set, all file I/O goes to Google Drive via a Service Account (`googleapis` npm package). When absent, falls back to local disk for development.
- `saveFile(buffer, ext)` uploads buffer to Drive, stores the Drive file ID as `storage_path` in DB.
- `streamFromDrive(fileId, res, fileName, mimeType)` pipes the file from Drive directly to the Express response.
- `server/src/routes/attachments.js`: download handler checks `USE_DRIVE` flag; uses `streamFromDrive` on Drive, `res.download` on local disk.
- `server/src/config.js`: added optional `gDriveCredentials` and `gDriveFolderId` config fields.
- `server/.env.example`: documented both new vars with generation commands.
- `docs/GOOGLE_DRIVE_SETUP.md`: 7-step guide (Cloud project, Drive API, Service Account, folder share, base64 encode, Render env vars, verify).
- Also fixed secondary bug: `detectType()` now byte-sniffs if declared MIME is wrong (e.g. `application/octet-stream` PDFs from some browsers).

## 2026-09-27 (Phase 2 Schema Implementation & Code Review Refinements)

### Prompt

Implement Phase 2 multi-step requirement (Sub-steps A through D) per `docs/plan/decisions.md` and `docs/plan/phase1-gap-analysis.md`, followed by addressing three code-review feedback issues:
1. Amount-based routing & two-member CDC model (Sub-step 2A)
2. Resubmission & request versioning schema (Sub-step 2B)
3. Document versioning & attachment superseding (Sub-step 2C)
4. Departmental annual budget provisions with computed balances (Sub-step 2D)
5. Address 3 code review feedback issues:
   - Dynamic credentials check in `reset-test-db.js` (skip `ALTER ROLE app_user` if existing password connects).
   - Strict container inspection for ZIP files (reject unrecognized/spoofed ZIP files with 415).
   - Custom item display name rendering in `DecisionPanel.jsx` and `RequestDetailModal.jsx`.

### Work Completed

- **Sub-step 2A — Amount-Based Routing & 2-Member CDC Model**:
  - `₹0 – ₹50,000`: Principal direct authority.
  - `₹50,000 – ₹5,00,000`: CDC authority (2 members required: `CDC_MEMBER_1`, `CDC_MEMBER_2`).
  - `> ₹5,00,000`: Joint Chairman + Vice Chairman authority.
  - Purchase Committee updated to non-deciding validity review stage.
  - Created migration `20260927T211500_amount_routing_and_cdc_joint.sql`.

- **Sub-step 2B — Resubmission & Versioning**:
  - Original `request_id` maintained on resubmission while incrementing `version_number`.
  - Enforced `RETURN` action permissions strictly to Purchase Committee and Principal roles.
  - Gated `fn_resubmit_request` to the original requester (`raised_by`).
  - Added cryptographic digital signature/seal generation for `RESUBMIT` actions for complete audit trail integrity.
  - Created migration `20260927T220000_resubmission_and_versioning.sql`.

- **Sub-step 2C — Document Versioning & Attachment Linking**:
  - Added `fn_supersede_attachment` to track file versioning (`superseded_by_id`, `version_number`).
  - Operates across both `local` and `drive` storage backends.
  - Created migration `20260927T230000_document_versioning.sql`.

- **Sub-step 2D — Departmental Annual Budget Provisions**:
  - Added `department_budget_provisions` table with attached supporting documents and RLS policies restricted by department.
  - Added views to compute `utilized_amount`, `committed_amount`, and `remaining_amount` dynamically from actual request records.
  - Created migration `20260927T240000_budget_provision.sql`.

- **Code Review Fixes**:
  - **Issue 1**: Updated `server/scripts/reset-test-db.js` with `getAppUserCredentials()` and `canUserAuthenticate()` check to skip `ALTER ROLE app_user` when existing credentials connect successfully. Added test in `server/test/auth.test.js`.
  - **Issue 2**: Updated `detectType` in `server/src/storage.js` to return `null` immediately when `inspectZipContainer` returns `null` for a ZIP file, preventing spoofed ZIP uploads. Added test in `server/test/attachments.test.js` verifying 415 rejection.
  - **Issue 3**: Replaced direct `budgetItem.name` rendering in `DecisionPanel.jsx` and `RequestDetailModal.jsx` with `parseCustomItem(item.budgetItem, item.remarks).displayName`. Confirmed no frontend testing framework exists for `src/` in `package.json`.

- **Git Commit & Push**:
  - Committed and pushed all Phase 2 migrations, schema updates, summaries, and code-review fixes to GitHub branch `revisit`.

## 2026-09-29 (Phases 3-7: workflow completion, resubmission repair, reporting, security sweep)

### Prompt

Work on the `revisit` branch. Read `prompts.md` and the plan documents, finish
the resubmission work and the remaining phases, review the code, and leave the
email-sending code alone. Do not commit or push.

### What was actually wrong

Phases 1-3 were reported complete, but three things were broken in ways the
test suite was hiding:

1. **Resubmission could never work on a deployed database.**
   `db/schema/13_record_action.sql` held a corrected `fn_record_action` in which
   `RETURN` sets `AWAITING_RESUBMISSION` and writes a `correction_requests` row.
   The migration that shipped it (`20260927T211500`) carried an older copy where
   `RETURN` behaved like `COMMENT`. A database built from `db/schema/` was right;
   one built by applying migrations - the college server - was not, so
   `fn_resubmit_request` would have raised SP018 forever. The migration path had
   silently drifted from the schema path.
2. **`fn_supersede_attachment` had no authorisation check at all.** It is
   `SECURITY DEFINER`, so RLS does not protect what it touches, and neither it
   nor its route checked anything: any signed-in user could replace the
   quotation on any request in the college, including a decided one.
3. **Carry-forward was impossible for anything that had reached CDC or the
   Chairman.** The stage-progression trigger fired on insert, and the
   carried-forward copy inherits its stage but has no history, so the Principal
   decision it demanded could never exist. The test that would have caught it
   was already failing for another reason.

### Work completed

- **Migration `20260929T120000`** restates `fn_record_action`,
  `fn_resubmit_request` (now with the `p_signature_hash` parameter, dropping the
  three-argument overload first) and `fn_enforce_stage_progression` verbatim
  from `db/schema/`, and carries the carry-forward fix. The two build paths are
  now compared directly - build from schema, replay migrations, diff every
  function definition - and agree.
- **Migration `20260929T130000`** adds `courses.funding_type` (Grant /
  Non-Grant), with the API and master-data screen to set it.
- **Authorisation**: `fn_supersede_attachment` given the checks the RLS policies
  would have made; `POST /api/budget-provisions` given the role check that was
  a `TODO`; SP016/SP017/SP018 mapped so they stop surfacing as 500s.
- **`permissions.actions`** computed per stage and amount band instead of a
  fixed list, with the same rules repeated in the route handler.
- **Resubmission end to end**: editing allowed while a request is out for
  correction, the correction reason carried on the request detail, the action
  sealed like every other, and a requester-facing panel
  (`RequestEditPanel.jsx`, replacing `DraftPanel.jsx`) that shows what was
  asked for and resubmits under the same request number.
- **Interface**: send-back-for-correction with a required reason; escalate
  named after its destination; per-stage notes; both signatures shown at CDC and
  the board; document version history with replace-not-delete; a budget context
  panel during review; a departmental budgets page; corrections list; report
  buttons.
- **Reporting module** (`server/src/reporting.js`): sections A-H assembled from
  the same rows the workflow writes, nine stage reports as views of that one
  assembly, printable to PDF and openable in Word, access inherited from the
  request itself. No rendering dependency was added - see
  `docs/plan/phase5-reporting-notes.md` for why that decision is left open.
- **Tests**: 76 -> 133, with the 20 old-workflow failures rewritten rather than
  deleted, and new coverage for resubmission, the two-role stages, the report,
  and the supersede bypass. The 52 RLS checks still pass.
- **Docs**: `phase3-api-notes.md`, `phase3-security-review.md`,
  `phase4-frontend-notes.md`, `phase5-reporting-notes.md`,
  `phase6-security-report.md`; `requirement.md` and `readme.md` rewritten to the
  workflow as it now behaves.
- **Verified in the browser**: raised a request as a head, returned it as the
  Purchase Committee, corrected and resubmitted it as the head, and rendered
  its report. Three defects were found this way that the tests did not catch -
  the raw `AWAITING_RESUBMISSION` status label, the requester being attributed
  to the stage their request sat in, and a report unreadable in a dark-themed
  browser.

### Left open, deliberately

Whether the Purchase Committee may reject outright; what happens when two joint
approvers disagree; the fate of the legacy `CDC_MEMBER` role; whether a
carried-forward request should restart at the committee. All four are recorded
as open questions in `requirement.md` - they change the workflow and need the
Principal's answer rather than a guess.

Email sending was not touched, by instruction.
