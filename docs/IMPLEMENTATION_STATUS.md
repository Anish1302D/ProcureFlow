# S.P. College Approval Hub
## Implementation Status & Requirements Audit

*Audit date: 30 September 2026 · Branch: `revisit` · Working tree: uncommitted changes present*

---

### 1. Executive Summary

The system is substantially built and the revised approval workflow is correctly
enforced at the database level, which is the level that matters. A request now
enters at the Purchase Committee regardless of amount, the Principal is a
mandatory gate that cannot be skipped, and the decision then belongs to the
Principal (≤ ₹50,000), both CDC members (≤ ₹5,00,000) or the Chairman and Vice
Chairman jointly (above that). This is enforced by a trigger and by row-level
security, not only by the interface.

**What is genuinely finished:** the routing and state machine, the
return-for-correction and resubmission cycle, document versioning, the budget
provision module, the two-signature model at CDC and the board, the audit trail
with tamper-evident seals, and role-based access control backed by row-level
security. 133 API tests and 52 row-level-security checks pass.

**The main shortfalls are in reporting and in a handful of enforcement gaps.**
Reports exist and are complete in *content* — every section A–H the requirements
list is assembled from the real records — but they are produced as a printable
HTML page and a Word-openable `.doc`, not as true PDF or `.docx` binaries, and
they carry text branding rather than the college logo. Separately, a Principal
can escalate a ≤ ₹50,000 request through the API even though the interface does
not offer it, the Purchase Committee cannot record a *partial recommendation*,
and there is no clean way for the Principal to send feedback to the Purchase
Committee without the requester seeing it.

**Two deployment-level inconsistencies need a decision:** the repository is
configured for Vercel + Render hosting and optional Google Drive file storage,
while the stated target is the college's own Microsoft/IIS server environment.

**Twelve items are genuinely ambiguous** and are listed in section 14 rather
than guessed at. The most consequential are what "Final Approval" means as a
distinct step, whether the Purchase Committee may reject outright, and what
happens when two joint approvers disagree.

**AI attribution is present in two files** (`prompts.md`, `AI_LOGS.md`) and in
one line of a planning note. Details in section 17. No application source file,
comment, migration, UI string or generated report contains AI attribution, and
no commit carries an AI co-author trailer.

---

### 2. What Has Been Completed

Each item below was verified by reading the implementation, not by the presence
of a file. Where a claim is about enforcement, the enforcing code is named.

#### 2.1 Approval routing and the state machine ✅

- **Every request enters at the Purchase Committee.** `fn_route_stage()` returns
  the Purchase Committee stage unconditionally
  (`db/schema/12_functions.sql`), and `stage_routing_rules` was collapsed to a
  single 0–unbounded row (`db/seed/01_roles_and_stages.sql`).
- **Amount bands.** `fn_record_action` sends a Principal escalation to CDC at
  `≤ 500000` and to the final authority above it
  (`db/schema/13_record_action.sql`).
- **The Principal cannot be skipped.** `fn_enforce_stage_progression`, a
  `BEFORE INSERT OR UPDATE OF current_stage_id` trigger on `requests`, refuses
  any move into CDC or the final authority without an existing Principal-stage
  `approval_actions` row, and refuses the Purchase Committee → CDC jump outright
  (`SP016`). Because it is a trigger it also binds direct SQL, not just the API.
- **Status vocabulary** covers the whole cycle including `AWAITING_RESUBMISSION`
  (`db/schema/01_enums.sql`).

#### 2.2 Purchase Committee is review-only ✅

Enforced in four independent places, as the requirement asks:

| Layer | Mechanism | File |
|---|---|---|
| Database function | `SP005` on `APPROVE`/`PARTIAL_APPROVE` at the PC stage | `db/schema/13_record_action.sql` |
| Row-level security | `requests_approver_update` forbids a PC user setting an approved status | `db/schema/14_rls.sql` |
| API route | route-level refusal before the function is called | `server/src/routes/requests.js` (~line 956) |
| Interface | `actionsAt()` never offers Approve at this stage | `server/src/routes/requests.js`, `src/components/requests/DecisionPanel.jsx` |

The Purchase Committee is offered **Pass to Principal**, **Send back for
correction** and **Reject**.

#### 2.3 Return for correction and resubmission ✅ (core)

- `RETURN` sets the request to `AWAITING_RESUBMISSION`, writes a
  `correction_requests` row recording who asked, at which stage, the previous
  status and the reason, and requires a reason to be given.
- `fn_resubmit_request` keeps the **same `request_id` and request number**,
  increments `current_version_number`, writes a full `request_versions` snapshot
  (fields *and* an items snapshot), marks the correction resolved with the
  version that answered it, recomputes the total from the items, and returns the
  request to the stage that sent it back.
- While a request is out for correction no approver can move it:
  `fn_record_action` refuses every action (`SP017`) and the progression trigger
  refuses the transition.
- Only the requester may resubmit (`SP004`), and only a request that was
  actually returned (`SP018`).
- The action is sealed like every other decision
  (`server/src/routes/requests.js`, `seal()` from `server/src/signing.js`).

Files: `db/schema/12_functions.sql`, `db/schema/13_record_action.sql`,
`db/migrations/20260929T120000_fix_return_action_and_resubmit_seal.sql`,
`src/components/requests/RequestEditPanel.jsx`.

#### 2.4 Document versioning ✅

- `attachments` carries `version_number`, `superseded_by_id`,
  `request_version_number` and `replacement_reason`
  (`db/migrations/20260927T230000_document_versioning.sql`).
- `fn_supersede_attachment` writes a new row and points the old one at it — the
  old file is never deleted and stays queryable.
- Past the draft the interface offers **Replace** rather than Delete, and shows
  the version chain with each earlier version downloadable
  (`src/components/ui/Attachments.jsx`).
- File payloads live outside the database; only metadata is stored
  (`server/src/storage.js`).

#### 2.5 Two-signature stages ✅

- CDC requires **both** `CDC_GRANT_MEMBER` and `CDC_NON_GRANT_MEMBER`; the final
  authority requires both `CHAIRMAN` and `VICE_PRESIDENT`. `fn_record_action`
  counts **distinct roles**, so two people holding the same role do not satisfy
  the stage — proved by `server/test/authz.test.js` test 5.
- Order does not matter; either may act first.
- Each decision is its own `approval_actions` row with its own user, comments,
  timestamp and seal.
- `permissions.jointApprovals` on the request detail names both required roles
  and whether each has decided; the decision panel displays it.

#### 2.6 Budget provision module ✅

- `budget_provisions` keyed on department + financial year + optional budget
  head, with `v_department_budget_summary` computing utilised, committed,
  remaining and available **from the requests themselves**, never typed in
  (`db/migrations/20260927T240000_budget_provision.sql`).
- `fn_get_department_budget_context()` feeds the review screen.
- Endpoints: list, read, upsert (restricted to `HEAD`/`ADMIN`), attach the
  sanction document, and per-request budget context
  (`server/src/routes/budget.js`, `server/src/routes/attachments.js`,
  `server/src/routes/requests.js`).
- Interface: `src/pages/BudgetProvisions.jsx` (menu: "Departmental budgets") and
  `src/components/requests/BudgetContext.jsx` shown during review.

#### 2.7 Master data ✅

- **Budget head type** is an enum `REVENUE | CAPITAL`, `NOT NULL` on
  `budget_heads` (`db/schema/01_enums.sql`, `02_master_data.sql`).
- **"Other" options** exist as sentinel reference rows on budget heads and on
  every budget head's item list
  (`db/migrations/20260927T120000_other_sentinel_items.sql`), with custom text
  captured for budget head, department, course, urgency and item name.
- **Courses carry Grant / Non-Grant** via `courses.funding_type`
  (`db/migrations/20260929T130000_course_funding_type.sql`), exposed by the
  course APIs and editable in Master data with a coloured tag in the list.

#### 2.8 Audit trail ✅

- `approval_actions` records every action with actor, stage, previous and new
  status, amount snapshot, comments, rejection reason and a signature.
- Decisions are sealed with a keyed HMAC over the exact decision content; the
  timeline endpoint recomputes each seal and reports `VERIFIED`, `MISMATCH` or
  `UNSEALED`, so a row edited directly in the database is detectable
  (`server/src/signing.js`, `GET /api/requests/:id/timeline`). A regression test
  actually tampers with a row and asserts the mismatch.
- `audit_logs` receives a row per action, readable only by administrators.
- `request_versions` and `correction_requests` preserve the resubmission record.

#### 2.9 Security and access control ✅

- JWT bearer auth carrying only the user id; roles and active status re-read on
  every request so deactivation takes effect immediately (`server/src/auth.js`).
- bcrypt cost 12, a dummy-hash comparison on unknown accounts to avoid user
  enumeration, and a login rate limiter (`server/src/routes/auth.js`).
- `helmet`, configured CORS origins (`server/src/app.js`).
- The API connects as `app_user`, never a superuser, and sets `app.user_id` per
  transaction with `SET LOCAL`; with no identity every policy evaluates false —
  it fails closed (`server/src/db.js`, `db/schema/14_rls.sql`).
- Row-level security is enabled on `requests`, `request_items`,
  `approval_actions`, `comments`, `notifications`, `attachments`, `issues`,
  `audit_logs`, `correction_requests`, `request_versions` and
  `budget_provisions`.
- Approval authority comes from stage staffing, never from a role list in code —
  an administrator is explicitly *not* an approver (`server/test/authz.test.js`
  test 12).

#### 2.10 Reporting — data assembly and delivery ✅ (format: see §3)

- `server/src/reporting.js` assembles sections A–H from the same rows the
  workflow writes, and renders a college-headed printable page.
- Nine report kinds (`complete`, `purchase-committee`, `principal`, `cdc`,
  `board`, `resubmission`, `rejection`, `partial-approval`, `decision`), each a
  **view of the same assembly** rather than separate arithmetic.
- Section H draws only the stages the request actually passed through.
- Access inherits request access exactly, in every format — a caller who cannot
  open the request gets 404 from the report too (`server/test/reporting.test.js`).

#### 2.11 Tests ✅

`server/test/` — 133 tests, all passing:

| File | Tests | Covers |
|---|---|---|
| `workflow.test.js` | 49 | End-to-end workflow, both bands, resubmission, joint stages, seals, carry-forward |
| `phase3_routes.test.js` | 21 | Phase 3 routes, document versioning, supersede bypass |
| `authz.test.js` | 13 | Authorisation edges and bypass attempts |
| `attachments.test.js` | 10 | Upload, type sniffing, storage, deletion |
| `issues.test.js` | 10 | Non-financial issues |
| `auth.test.js` | 9 | Sign-in, password change |
| `code_review_issues.test.js` | 9 | Prior review fixes |
| `reporting.test.js` | 6 | Report figures, route, resubmission, access |
| `inventory.test.js` | 6 | Inventory and purchase bills |

`db/tests/rls_app_user.sql` — 52 access checks, all passing, run as `app_user`
(never as a superuser, which would bypass the rules under test).

---

### 3. Partially Completed

#### 3.1 Reporting format and branding 🟡

**Exists:** complete data assembly, nine report kinds, a print-ready A4-styled
HTML page (`GET /api/requests/:id/report.html`), a Word-openable download
(`GET /api/requests/:id/report.doc`, HTML in a `.doc` container), and JSON
(`GET /api/requests/:id/report`).

**Missing:**
- True **PDF** generated server-side. Today the PDF is produced by the user
  pressing Print → Save as PDF. Adequate for filing a copy; not adequate if a
  report must be attached to an email or archived automatically.
- True **`.docx`** (Office Open XML). The `.doc` file is HTML that Word opens
  and can edit; it is not a real `.docx`.
- **College logo.** The header is the text "S. P. College"
  (`server/src/reporting.js` line ~390). There is no logo image anywhere in the
  repository (`src/assets` does not exist) and no placeholder for one.
- **Attachments are listed, not embedded.** The Documents section names each
  file, its version, uploader and date, but the quotation itself is not included
  in the report.

Both binary formats need a rendering library (`pdfkit`/`puppeteer`, `docx`),
which is a deliberate dependency decision — see §14 Q9.

#### 3.2 Purchase Committee partial recommendation 🟡

**Exists:** the Purchase Committee can review everything (justification,
quotations, supporting documents, budget context, previous comments and
correction history), pass the request on, send it back, reject it, and record
observations as comments or as the comment on its action.

**Missing:** there is no way to record a **partial recommendation** — a
suggestion that only some lines should be sanctioned. `PARTIAL_APPROVE` is
correctly blocked at this stage because it would be a decision, and no separate
"recommendation" action or item-level recommendation record exists. The
requirement asks for "partial approval/recommendation where applicable".

Affected: `db/schema/13_record_action.sql`, `server/src/routes/requests.js`,
`src/components/requests/DecisionPanel.jsx`.

#### 3.3 Principal → Purchase Committee feedback 🟡

**Exists:** comments with three visibilities — `ALL`, `UP_CHAIN`, `STAGE_ONLY`
(`server/src/routes/comments.js`, policy in `db/schema/14_rls.sql`).

**Missing:** `UP_CHAIN` is enforced as `viewer.sequence_no >= author.sequence_no`
— it travels *upward*. A Principal (sequence 2) writing `UP_CHAIN` is read by
CDC and the Chairman but **not** by the Purchase Committee (sequence 1). So the
Principal's only way to reach the committee is `ALL`, which the requester also
reads. There is no downward or stage-addressed feedback channel.

#### 3.4 Reviewers distinguishing original from revised 🟡

**Exists:** `request_versions` stores a complete snapshot of each version
including an items snapshot; the request detail exposes `versionNumber` and the
`corrections` list; documents carry the request version they were uploaded
under; the report's resubmission section shows the amount before and after and
the correction that was asked for.

**Missing:** **no API or screen reads `request_versions` back.** A grep shows it
is referenced only by `server/src/reporting.js`, and then only for amounts. A
reviewer therefore cannot open "version 1" to see the original title,
justification or line items. The data is preserved but not retrievable.

#### 3.5 Budget provision review by the Principal 🟡

**Exists:** the Principal (and the Purchase Committee, CDC and the board) can
read every department's provision and its documents, and see the computed
figures during review.

**Missing:** there is no *review action* — no approve/acknowledge/query state on
a provision, no reviewed-by or reviewed-at column, no workflow. "Principal should
be able to review the budget provision" is satisfied as *visibility* only.

#### 3.6 Notifications 🟡

**Exists:** database triggers create in-app notifications when a request enters
a review stage (to everyone staffed there), when it is escalated (to the
requester) and when it is approved, partially approved, rejected or carried
forward (`db/schema/16_notifications.sql`). Email is sent separately by the
application for the same events.

**Missing — two specific gaps:**
1. **`AWAITING_RESUBMISSION` is not covered.** The trigger's branches are
   `UNDER_*` and the four terminal statuses; a request sent back for correction
   matches neither, so **the requester receives no in-app notification that their
   request was returned**. (An email is sent by the route's notification path, so
   this is a gap in the in-app channel specifically.)
2. **No notification when a department submits or updates its budget
   provision.** `server/src/routes/budget.js` contains no notification call, and
   there is no trigger on `budget_provisions`.

#### 3.7 "Other" custom values 🟡

**Exists:** sentinel rows, five custom fields in the interface, and frontend
validation that refuses to submit when "Other" is chosen and the free-text box
is empty (`src/components/modals/NewRequestModal.jsx`).

**Missing:** **the backend does not validate it.** `extra` is accepted as
`z.record(z.string(), z.unknown())` (`server/src/routes/requests.js`), so a
direct API call can select the "Other" budget head and supply no
`customBudgetHead` at all, producing a request whose head is literally "Other
(specify)" with nothing specified. This is frontend-only validation of the kind
the requirements warn against.

Also worth noting as a design risk rather than a gap: a custom **item name** is
stored by encoding it into the line's `remarks` text as
`[Custom item: name] — remarks` and parsing it back in the interface
(`src/utils/customItem.js`). It round-trips correctly, including bracket
escaping, but it is a wire format inside a free-text column rather than a
column of its own.

---

### 4. Incorrect / Needs Modification

#### 4.1 ⚠️ The API lets the Principal escalate a ≤ ₹50,000 request

- **Current behaviour:** `actionsAt()` does not offer `ESCALATE` to the Principal
  at or below ₹50,000, so the button is hidden. But the route's guards
  (`server/src/routes/requests.js` lines 955–975) check only that the Principal
  does not *approve* above ₹50,000; nothing refuses an *escalation* below it.
  `fn_record_action` then routes it to CDC because `50000 <= 500000`.
- **Required behaviour:** at ≤ ₹50,000 the Principal is the decision authority.
  Either the escalation must be refused server-side, or it must be an
  intentional, documented power.
- **Why it matters:** this is exactly the "frontend button hiding is not
  enforcement" case in requirement M — a direct API call moves a request into a
  band it does not belong to.
- **Affected:** `server/src/routes/requests.js`, `db/schema/13_record_action.sql`.
- *(Whether the Principal should be allowed to refer a small request upward is
  itself a question — §14 Q5. The enforcement gap should be closed either way.)*

#### 4.2 ⚠️ Deployment configuration targets Vercel + Render, not the college server

- **Current behaviour:** `vercel.json` rewrites `/api/*` to
  `https://sp-college-approval-hub.onrender.com`, i.e. the frontend is built for
  Vercel and the API for Render. `docs/GOOGLE_DRIVE_SETUP.md` and
  `server/src/storage.js` add Google Drive as the file store when
  `GDRIVE_CREDENTIALS` and `GDRIVE_FOLDER_ID` are set (a fix for Render's
  ephemeral filesystem).
- **Required behaviour:** deployment on the college's own Microsoft server
  environment — which `requirement.md` itself states ("Runs on the college's own
  Windows server: PostgreSQL, a Node service, and static files behind IIS").
- **Why it matters:** on an on-premises Windows/IIS host the Drive workaround is
  unnecessary (the filesystem is persistent) and may be unacceptable for
  procurement documents leaving college infrastructure. The Vercel rewrite would
  point the college's users at a third-party host.
- **Affected:** `vercel.json`, `server/src/storage.js`,
  `docs/GOOGLE_DRIVE_SETUP.md`, `server/.env.example`.
- **Note:** no "Exchange Service" feature exists in the application, and none
  should be added.

#### 4.3 ⚠️ "Vice President" vs "Vice Chairman" terminology

- **Current behaviour:** the role code is `VICE_PRESIDENT`, the seeded user is
  "Smt. L. Karve (Vice President)", and the stage is displayed as
  "Chairman + VP" (`db/seed/01_roles_and_stages.sql`,
  `db/seed/03_users_and_approvers.sql`).
- **Required behaviour:** the revised requirements consistently say **Vice
  Chairman**.
- **Why it matters:** these labels appear in reports, notifications and the
  approval history the Principal will read. If they are the same person the
  labels should be corrected; if they are different offices, the role model is
  wrong. See §14 Q6.
- **Affected:** seed data, `src/api/format.js` (`ROLE_LABELS`),
  `server/src/reporting.js` (`STAGE_NAMES`).

#### 4.4 ⚠️ The Purchase Committee can reject outright

- **Current behaviour:** `REJECT` is permitted and offered at the Purchase
  Committee stage, which terminates the request there.
- **Conflict:** `docs/plan/decisions.md` states the Principal "ALWAYS sees every
  request, regardless of amount — this stage is never skipped". A rejection by
  the committee means the Principal never sees it.
- **Affected:** `db/schema/13_record_action.sql`,
  `server/src/routes/requests.js`, `src/components/requests/DecisionPanel.jsx`.
- **Status:** flagged rather than changed — see §14 Q2. It is listed here
  because it is a direct conflict with a confirmed decision, but removing a
  rejection power is a workflow change that needs confirmation.

#### 4.5 ⚠️ Academic year vs financial year

- **Current behaviour:** the entire system is financial-year based.
  `budget_provisions` is keyed on `financial_year_id`; there is no academic-year
  concept anywhere, by an explicit documented design rule ("Financial year only
  — no academic year anywhere", `db/README.md`).
- **Required behaviour (as worded):** requirement F says budget provisions are
  provided "at the beginning of the **academic** year".
- **Why it matters:** if provisions genuinely follow the academic year
  (June–May) rather than the financial year (April–March), every budget figure
  is aggregated over the wrong window. See §14 Q10.

---

### 5. Remaining Work

#### P0 — Critical workflow / security

- [ ] Refuse a Principal escalation below ₹50,000 server-side, or confirm it is
      intended and document it (§4.1)
- [ ] Validate "Other" custom values in the API, not only in the browser (§3.7)
- [ ] Decide and implement the Purchase Committee's rejection power (§4.4, Q2)
- [ ] Decide the joint-stage disagreement rule and enforce it — today the second
      approver's item figures silently overwrite the first's (Q3)
- [ ] Confirm the deployment target and remove or gate the Vercel/Render/Drive
      configuration accordingly (§4.2)

#### P1 — Core functionality

- [ ] Notify the requester in-app when a request is returned for correction
      (§3.6)
- [ ] Notify the Purchase Committee and Principal when a department submits or
      updates its budget provision (§3.6)
- [ ] Expose `request_versions` through an API and a screen so reviewers can read
      the original submission, not only that one exists (§3.4)
- [ ] Add a partial-recommendation action for the Purchase Committee (§3.2)
- [ ] Add a stage-addressed or downward feedback channel for Principal → Purchase
      Committee (§3.3)
- [ ] Add a review action/state to budget provisions for the Principal (§3.5)
- [x] Correct Vice President / Vice Chairman terminology once confirmed (§4.3)
- [ ] Confirm and remove the legacy `CDC_MEMBER` role (Q11)

#### P2 — Reporting / documents

- [ ] Generate a true PDF server-side (`pdfkit` against the existing assembled
      data is the smaller change)
- [ ] Generate a true `.docx` where the college needs an editable formal copy
- [ ] Add the S.P. College logo to the report header, and a favicon/logo asset to
      the application
- [ ] Decide whether quotations must be embedded in the report or referenced
      (Q8), and implement if embedding is required
- [ ] Confirm which stages require their own downloadable report and surface
      those in the interface (today only the complete report is linked from the
      request screen, though nine kinds exist in the API)

#### P3 — UI / polish

- [ ] Replace the browser `prompt()` used to capture a document-replacement
      reason with a proper dialog (`src/components/ui/Attachments.jsx`)
- [ ] Add a frontend test setup — there is currently none at all (§13)
- [ ] Remove AI attribution from `prompts.md` and `AI_LOGS.md` (§17)
- [ ] Add a logo/brand asset and replace the "SP" text tile in the sidebar
      (`src/components/layout/Sidebar.jsx`)

---

### 6. Requirement-by-Requirement Matrix

| Requirement | Current Status | Evidence / Files | What Remains | Priority |
|---|---|---|---|---|
| **A.** PC is review-only, no final approval | ✅ IMPLEMENTED | `13_record_action.sql` (SP005), `14_rls.sql`, `requests.js:956` | — | — |
| **A.** ≤ ₹50k: PC → Principal → final | ✅ IMPLEMENTED | `12_functions.sql`, `13_record_action.sql`; `workflow.test.js` | — | — |
| **A.** ₹50k–₹5L: PC → Principal → CDC | ✅ IMPLEMENTED | `fn_record_action` escalation branch; `workflow.test.js` | — | — |
| **A.** > ₹5L: PC → Principal → Chairman | ✅ IMPLEMENTED | `fn_record_action`; `workflow.test.js` | — | — |
| **A.** Principal mandatory before CDC/Chairman | ✅ IMPLEMENTED | `fn_enforce_stage_progression` trigger (SP016) | — | — |
| **A.** No direct PC → CDC/Chairman | ✅ IMPLEMENTED | Same trigger, second clause | — | — |
| **A.** "Final Approval" as a distinct step | ❓ AMBIGUOUS | No such stage exists; last authority's approval is terminal | Confirm meaning (Q1) | P0 |
| **B.** PC reviews request/justification/quotations/documents | ✅ IMPLEMENTED | `RequestDetailModal.jsx`, `GET /api/requests/:id` | — | — |
| **B.** PC reviews budget information | ✅ IMPLEMENTED | `BudgetContext.jsx`, `GET /api/requests/:id/budget-context` | — | — |
| **B.** PC reviews previous/revised documents | ✅ IMPLEMENTED | `Attachments.jsx` version chains | — | — |
| **B.** PC forwards / escalates | ✅ IMPLEMENTED | `ESCALATE` → Principal; labelled "Pass to Principal" | — | — |
| **B.** PC requests resubmission | ✅ IMPLEMENTED | `RETURN` + `correction_requests` | — | — |
| **B.** PC gives observations | ✅ IMPLEMENTED | Comments + action comments | — | — |
| **B.** PC partial approval/recommendation | ❌ NOT IMPLEMENTED | `PARTIAL_APPROVE` blocked at PC; no recommendation record | Add a recommendation action (§3.2) | P1 |
| **B.** PC has no final Approve (FE/API/DB/RBAC) | ✅ IMPLEMENTED | All four layers, table in §2.2 | — | — |
| **C.** Principal reviews requests/documents/quotations | ✅ IMPLEMENTED | Request detail, attachments | — | — |
| **C.** Principal reviews PC observations | ✅ IMPLEMENTED | Timeline + comments on the request | — | — |
| **C.** Principal reviews budget analysis | ✅ IMPLEMENTED | `BudgetContext.jsx` | — | — |
| **C.** Principal approves/rejects where applicable | ✅ IMPLEMENTED | Band-aware `actionsAt()`; SP005 above ₹50k | — | — |
| **C.** Principal sends back for correction | ✅ IMPLEMENTED | `RETURN`, restricted to PC and Principal | — | — |
| **C.** Principal gives feedback to PC | 🟡 PARTIAL | `UP_CHAIN` travels upward only; `ALL` includes the requester | Downward/stage-addressed channel (§3.3) | P1 |
| **C.** Principal routes to CDC or Chairman by amount | ✅ IMPLEMENTED | `fn_record_action` | — | — |
| **C.** Principal reviews complete approval history | ✅ IMPLEMENTED | `GET /api/requests/:id/timeline` with seal status | — | — |
| **C.** Principal mandatory before higher authority | ✅ IMPLEMENTED | Trigger, verified | — | — |
| **D.** Same request ID on resubmission | ✅ IMPLEMENTED | `fn_resubmit_request`; verified in browser and tests | — | — |
| **D.** Complete previous history preserved | ✅ IMPLEMENTED | `approval_actions` retained; `request_versions` snapshots | — | — |
| **D.** Revised/additional documents allowed | ✅ IMPLEMENTED | Upload + supersede while awaiting resubmission | — | — |
| **D.** Previous document versions preserved | ✅ IMPLEMENTED | `superseded_by_id` chain, nothing deleted | — | — |
| **D.** Records who requested correction | ✅ IMPLEMENTED | `correction_requests.requested_by` | — | — |
| **D.** Records the reason | ✅ IMPLEMENTED | `correction_requests.reason`, mandatory | — | — |
| **D.** Records when resubmission happened | ✅ IMPLEMENTED | `request_versions.submitted_at`, `resolved_at` | — | — |
| **D.** Reviewers distinguish original vs revised | 🟡 PARTIAL | Versions stored but never read back except for amounts | Expose version detail (§3.4) | P1 |
| **D.** Returns to the correct workflow stage | ✅ IMPLEMENTED | Returns to the stage that sent it back | Confirm this is desired (Q12) | P2 |
| **D.** No new request created | ✅ IMPLEMENTED | Verified end-to-end in the browser | — | — |
| **E.** Dedicated documents section | ✅ IMPLEMENTED | Documents section on the request screen | — | — |
| **E.** Access to quotations/supporting/budget/revised docs | ✅ IMPLEMENTED | `attachments` + budget provision attachments | — | — |
| **E.** Previous versions accessible | ✅ IMPLEMENTED | Version history UI | — | — |
| **E.** Upload / storage / permissions / versioning | ✅ IMPLEMENTED | `attachments.js`, `storage.js`, RLS, supersede | Storage backend decision (§4.2) | P0 |
| **F.** HOD submits annual budget provision | ✅ IMPLEMENTED | `POST /api/budget-provisions`, `HEAD`/`ADMIN` + RLS | — | — |
| **F.** HOD uploads the budget PDF | ✅ IMPLEMENTED | `POST /api/budget-provisions/:id/attachments` | — | — |
| **F.** Principal reviews the provision | 🟡 PARTIAL | Read access only; no review action or state | Add review step (§3.5) | P1 |
| **F.** Reviewers notified where required | ❌ NOT IMPLEMENTED | No notification on budget submission | Add (§3.6) | P1 |
| **F.** Annual / utilised / committed / current / remaining | ✅ IMPLEMENTED | `v_department_budget_summary`, all computed | — | — |
| **F.** Academic year timing | ⚠️ INCORRECT | System is financial-year only, by design rule | Confirm (Q10) | P0 |
| **G.** Budget head + head type | ✅ IMPLEMENTED | `budget_head_type` enum, `NOT NULL` | — | — |
| **G.** Revenue / Capital values | ✅ IMPLEMENTED | `01_enums.sql` | — | — |
| **G.** Budget items support "Other" | ✅ IMPLEMENTED | Sentinel item per head | — | — |
| **G.** Custom value when "Other" chosen | 🟡 PARTIAL | Captured and displayed; **not validated server-side** | API validation (§3.7) | P0 |
| **H.** Courses Grant / Non-Grant | ✅ IMPLEMENTED | `courses.funding_type` + API + Master data UI | — | — |
| **H.** Dropdowns offer "Other" with custom input | ✅ IMPLEMENTED | Head, department, course, urgency, item | Same validation gap as G | P0 |
| **I.** CDC involved ₹50k–₹5L | ✅ IMPLEMENTED | `fn_record_action` | — | — |
| **I.** Two CDC users exist in the role model | ✅ IMPLEMENTED | `CDC_GRANT_MEMBER`, `CDC_NON_GRANT_MEMBER` seeded and staffed | — | — |
| **I.** Authorization correct | ✅ IMPLEMENTED | Stage staffing + distinct-role counting | — | — |
| **I.** Workflow supports both users | ✅ IMPLEMENTED | Both required, either order | — | — |
| **I.** History records the correct user | ✅ IMPLEMENTED | One `approval_actions` row each, sealed | — | — |
| **I.** Frontend reflects the requirement | ✅ IMPLEMENTED | `jointApprovals` shown in the decision panel | — | — |
| **I.** Sequential vs independent vs either-sufficient | ❓ AMBIGUOUS | Built as *both required, either order* per `decisions.md`; rejection rule unspecified | Confirm rejection/disagreement (Q3) | P0 |
| **J.** > ₹5L goes PC → Principal → Chairman | ✅ IMPLEMENTED | `fn_record_action` | — | — |
| **J.** Chairman/VC review visibility | 🟡 PARTIAL | They see requests that reached their stage; not others | Confirm intended breadth (Q7) | P2 |
| **J.** Vice Chairman decision authority | ❓ AMBIGUOUS | Built as a required co-approver | Confirm (Q6) | P0 |
| **K.** Reports explain the approval journey | ✅ IMPLEMENTED | Narrative built per `approval_actions` row | — | — |
| **K.** Request info / department / amount / budget / justification | ✅ IMPLEMENTED | Sections A–C | — | — |
| **K.** Quotations/supporting documents in the report | 🟡 PARTIAL | Listed with version and uploader; not embedded | Confirm and implement (Q8) | P2 |
| **K.** PC review + observations | ✅ IMPLEMENTED | Section E narrative includes comments | — | — |
| **K.** Principal review / decision / feedback | ✅ IMPLEMENTED | Section E | — | — |
| **K.** CDC review/approval | ✅ IMPLEMENTED | Both members appear separately | — | — |
| **K.** Chairman review/approval | ✅ IMPLEMENTED | Section E | — | — |
| **K.** Resubmission history | ✅ IMPLEMENTED | Section F, rendered only when it happened | — | — |
| **K.** Document history | ✅ IMPLEMENTED | Section D, all versions | — | — |
| **K.** Dates / users / roles / timeline / final status | ✅ IMPLEMENTED | Sections A, E, G, H | — | — |
| **K.** PDF output | 🟡 PARTIAL | Print-to-PDF from the browser; no server-side PDF | Add a PDF generator | P2 |
| **K.** DOCX output | 🟡 PARTIAL | `.doc` (HTML in a Word container), not `.docx` | Add a DOCX generator | P2 |
| **K.** S.P. College branding/logo | 🟡 PARTIAL | Text header only; no logo asset exists | Add logo | P2 |
| **K.** Different reports per stage | ✅ IMPLEMENTED | Nine kinds via `?kind=` | Surface them in the UI | P2 |
| **L.** Audit of submission/review/approval/rejection | ✅ IMPLEMENTED | `approval_actions` + `audit_logs` | — | — |
| **L.** Audit of resubmission/correction | ✅ IMPLEMENTED | `correction_requests`, `request_versions`, RESUBMIT action | — | — |
| **L.** Audit of document changes | 🟡 PARTIAL | Version chain records who/when/why; no `audit_logs` row per upload | Consider audit rows for documents | P2 |
| **L.** Audit of budget decisions | 🟡 PARTIAL | `created_by`/`updated_at` on the provision only; no history of changes | Consider provision history | P2 |
| **L.** Comments / timestamps / users / roles | ✅ IMPLEMENTED | Throughout | — | — |
| **L.** Trustworthy, not just a frontend display | ✅ IMPLEMENTED | HMAC seals + tamper test; admin-only audit log | — | — |
| **M.** RBAC | ✅ IMPLEMENTED | `auth.js`, `roles.js`, stage staffing | — | — |
| **M.** Backend authorization | ✅ IMPLEMENTED | Route guards + DB functions | One gap: §4.1 | P0 |
| **M.** RLS policies | ✅ IMPLEMENTED | 11 tables; 52 checks | — | — |
| **M.** Unauthorized workflow transitions blocked | ✅ IMPLEMENTED | Trigger-enforced | Except §4.1 | P0 |
| **M.** Document access permissions | ✅ IMPLEMENTED | `attachments` RLS; supersede now authorised | — | — |
| **M.** Cannot bypass approval stages | ✅ IMPLEMENTED | SP016 trigger | — | — |
| **M.** Cannot call APIs to act without authority | ✅ IMPLEMENTED | Tested directly in `authz.test.js` | — | — |
| **N.** Schema / migrations | ✅ IMPLEMENTED | 13 migrations; schema-vs-migration parity verified | — | — |
| **N.** API routes | ✅ IMPLEMENTED | 11 routers under `server/src/routes/` | — | — |
| **N.** Frontend pages/components | ✅ IMPLEMENTED | 23 pages, ~25 components | — | — |
| **N.** Authentication | ✅ IMPLEMENTED | JWT, bcrypt 12, rate limit | — | — |
| **N.** Workflow/state machine | ✅ IMPLEMENTED | `fn_record_action` + trigger | — | — |
| **N.** Document handling | ✅ IMPLEMENTED | Local disk or Google Drive | Backend choice (§4.2) | P0 |
| **N.** Report generation | 🟡 PARTIAL | HTML/.doc only | §3.1 | P2 |
| **N.** Notifications | 🟡 PARTIAL | Two gaps (§3.6) | P1 | P1 |
| **N.** Tests | 🟡 PARTIAL | 133 API + 52 RLS; **zero frontend tests** | Add frontend tests | P3 |
| **N.** Environment/config | ✅ IMPLEMENTED | `server/.env.example`, `config.js` | — | — |
| **N.** Deployment config | ⚠️ INCORRECT | Vercel + Render vs stated Microsoft/IIS target | §4.2 | P0 |

---

### 7. Approval Workflow Audit

#### Required workflow

```
                         ┌──────────────────────────────┐
Requester ──► Purchase   │ ≤ ₹50,000     → Principal     │──► Final Approval
              Committee  │ ₹50k–₹5,00,000→ CDC           │
              (review)   │ > ₹5,00,000   → Chairman      │
                 │       └──────────────────────────────┘
                 └──► Principal (mandatory, always) ──────┘
```

#### Current workflow, as implemented

```
Requester
   │  fn_submit_request → fn_route_stage() → always PURCHASE_COMMITTEE
   ▼
PURCHASE_COMMITTEE  (sequence 1)
   │  ESCALATE ("Pass to Principal")  → PRINCIPAL
   │  RETURN    → AWAITING_RESUBMISSION (back to requester, same request id)
   │  REJECT    → REJECTED                       ← conflicts with "Principal always sees" (§4.4)
   │  APPROVE / PARTIAL_APPROVE → refused, SP005
   ▼
PRINCIPAL  (sequence 2, mandatory — trigger SP016 guards every path past it)
   │  amount ≤ ₹50,000 : APPROVE / PARTIAL_APPROVE / REJECT / RETURN   ← Principal decides
   │  amount > ₹50,000 : ESCALATE / REJECT / RETURN
   │        ESCALATE and amount ≤ ₹5,00,000 → CDC
   │        ESCALATE and amount > ₹5,00,000 → FINAL_AUTHORITY
   ▼
CDC  (sequence 3)                          FINAL_AUTHORITY  (sequence 4, is_final)
   │  CDC_GRANT_MEMBER  ─┐                    │  CHAIRMAN        ─┐
   │  CDC_NON_GRANT_MEMBER┤ both required      │  VICE_PRESIDENT  ─┤ both required
   │  either order       ─┘                    │  either order    ─┘
   │  ESCALATE refused (route guard)           │  ESCALATE refused, SP006
   ▼                                           ▼
APPROVED / PARTIALLY_APPROVED / REJECTED   (status computed from the item rows)
```

#### Mismatches

| # | Mismatch | Severity |
|---|---|---|
| 1 | The API accepts a Principal escalation at ≤ ₹50,000 although the UI hides it, moving the request into CDC's band (§4.1) | **High** |
| 2 | The Purchase Committee can reject outright, so the Principal never sees the request (§4.4) | **High**, pending Q2 |
| 3 | "Final Approval" is not a distinct step; the last authority's approval is terminal (Q1) | Needs confirmation |
| 4 | The Purchase Committee cannot record a partial recommendation (§3.2) | Medium |
| 5 | No rule for two joint approvers disagreeing; the second overwrites the first's item figures (Q3) | Medium |
| 6 | A carried-forward request resumes at the stage it left off at, so it can re-enter a new year already past the Principal (Q12) | Low, pending confirmation |

**Boundary behaviour as built** (confirm against Q4): exactly ₹50,000 → the
Principal decides. Exactly ₹5,00,000 → CDC decides. Both boundaries are
inclusive of the lower authority.

---

### 8. Resubmission Audit

**What happens today, traced end to end and verified in a browser:**

1. **Send back.** The Purchase Committee or the Principal chooses "Send back for
   correction" and must type a reason (enforced in the browser, in the route
   schema, and in `fn_record_action`). Any other stage is refused.
2. **Database.** `fn_record_action` writes an `approval_actions` row
   (action `RETURN`, sealed), sets the status to `AWAITING_RESUBMISSION`, leaves
   `current_stage_id` untouched, and inserts a `correction_requests` row with
   the requester of the correction, the stage, the previous status and the
   reason.
3. **Frozen for approvers.** Every action is refused while the status is
   `AWAITING_RESUBMISSION` (`SP017`), and the progression trigger refuses to
   move it except by resubmission. Approvers see an amber banner naming the
   requester it is waiting on and the reason.
4. **The requester corrects it.** `permissions.canEdit` becomes true for the
   owner, so title, description, department, course, budget head, line items and
   documents can all be changed. Documents are replaced with new versions rather
   than deleted; the new version records the request version it belongs to.
5. **Resubmit.** `POST /api/requests/:id/resubmit` calls
   `fn_resubmit_request`, which: refuses anyone but the raiser (`SP004`) and any
   status but `AWAITING_RESUBMISSION` (`SP018`); increments the version;
   snapshots the whole request *and its items* into `request_versions`; marks the
   open correction resolved with the answering version number; recomputes the
   total from the items; returns the status to the stage's review status; writes
   a sealed `RESUBMIT` action.
6. **Result.** Same `request_id`, same request number (`REQ-2026-0001` before and
   after), history intact — the timeline reads `SUBMIT → RETURN → RESUBMIT` with
   the original return reason still attached.

**Gaps:**

- **Prior versions are written but never read.** Nothing exposes the contents of
  `request_versions`, so a reviewer cannot see what the original actually said —
  only that a resubmission occurred and how the total changed (§3.4).
- **No in-app notification** reaches the requester when the request is sent back;
  only email (§3.6).
- **Return stage.** The request goes back to whoever returned it — a Principal
  return skips a second Purchase Committee check. Reasonable, but unconfirmed
  (Q12).

**A defect found and fixed during the previous session, recorded here because it
affects any database built before that fix:** the migration that shipped the
`RETURN` handling carried an older version in which `RETURN` behaved like a
comment — the status never changed, so resubmission was impossible on any
database built by applying migrations rather than from `db/schema/`. Fixed by
`db/migrations/20260929T120000_fix_return_action_and_resubmit_seal.sql`. **Any
already-deployed database must have this migration applied.**

---

### 9. Budget Audit

| Aspect | Status | Detail |
|---|---|---|
| Annual provision | ✅ | `budget_provisions.allocated_amount`, unique per department + financial year + (optional) budget head |
| HOD submission | ✅ | `POST /api/budget-provisions`, `requireRole('HEAD','ADMIN')`, upsert semantics; `budget_provisions_write` policy confines a head to their own department |
| Budget PDF upload | ✅ | `POST /api/budget-provisions/:id/attachments`; only that department's head or an administrator; accepted types include PDF |
| Principal review | 🟡 | Read access yes (`budget_provisions_read` grants Principal, PC, CDC, Chairman, VP); **no review action, state or timestamp** |
| Utilised amount | ✅ | Computed: sum of `sanctioned_amount` for APPROVED / PARTIALLY_APPROVED / FULFILMENT_PENDING / FULFILLED |
| Pending / committed | ✅ | Computed: sum of `tentative_total_cost` for SUBMITTED / all `UNDER_*` / `AWAITING_RESUBMISSION` |
| Current request amount | ✅ | Shown in the review panel alongside the provision |
| Remaining amount | ✅ | `allocated − (utilised + committed)`; a second figure `available = allocated − utilised` is also computed |
| Budget head | ✅ | `budget_heads` master with code, name, description, active flag |
| Revenue / Capital | ✅ | `budget_head_type` enum, `NOT NULL` |
| "Other" / custom values | 🟡 | Sentinel rows and custom capture work; **no server-side validation** that the custom text was supplied |
| Notifications on submission | ❌ | None |
| Academic vs financial year | ⚠️ | Financial year only (Q10) |

**Strength worth noting:** utilised and committed are derived from the request
records by a view, never stored as totals, so the budget figures cannot drift out
of step with the approvals. This is verified by the RLS test suite, which
approves a request and then asserts the computed figures moved.

**Risk:** a provision row can be silently overwritten. `POST` upserts on
conflict, replacing `allocated_amount` and `remarks` with no history of the
previous value and no audit row.

---

### 10. Document Audit

| Aspect | Status | Detail |
|---|---|---|
| Upload | ✅ | `POST /api/requests/:id/attachments`, `/issues/:id/attachments`, `/budget-provisions/:id/attachments` |
| Type checking | ✅ | Content sniffed, not trusted from the name or declared type; ZIP containers inspected so a spoofed `.docx` is rejected (415) — `server/src/storage.js` |
| Size limit | ✅ | `MAX_UPLOAD_MB` (10 MB default), enforced by multer |
| Storage | ✅ / ⚠️ | Local disk, or Google Drive via a service account when `GDRIVE_*` is set. Files are stored outside the database with generated names; the original filename is never used as a path. Backend choice conflicts with the stated deployment target (§4.2) |
| Download | ✅ | Always through the API so the visibility check applies; never a static folder |
| Access control | ✅ | `attachments_read` policy: admin, uploader, or whoever can see the parent request/issue/provision |
| Deletion | ✅ | Only the uploader or an admin, and only while the request is a draft or the issue open — a decided request's documents cannot be removed |
| Versioning | ✅ | `fn_supersede_attachment` adds a new version and links the old one; nothing is deleted; all versions stay queryable |
| Version metadata | ✅ | Version number, uploader, timestamp, replacement reason, and the request version it belongs to |
| History UI | ✅ | Current file with earlier versions folded behind a history control, each downloadable |
| Audit rows | 🟡 | The version chain is the history; no `audit_logs` entry per upload or replacement |

**A high-severity defect found and fixed in the previous session, recorded for
completeness:** `fn_supersede_attachment` is `SECURITY DEFINER` and originally
made *no authorisation check at all*, so any signed-in user could replace the
quotation on any request in the college — including a decided one — with the
replacement recorded as a legitimate new version. It now checks the actor, the
caller's reach (mirroring the insert policy) and the request's status, and a
test attempts the bypass and asserts the refusal.

---

### 11. Reporting Audit

**Generator:** `server/src/reporting.js` — `assembleReport()` builds the data,
`renderReportHtml()` renders it. Routes in `server/src/routes/reports.js`.

**Existing outputs**

| Format | Endpoint | Reality |
|---|---|---|
| JSON | `GET /api/requests/:id/report` | Complete assembled data |
| HTML | `GET /api/requests/:id/report.html` | A4-styled, print-ready; PDF via the browser's print dialog |
| True PDF | `GET /api/requests/:id/report.pdf` | ✅ Print-ready official institutional A4 PDF (PDFKit backend stream + client jsPDF fallback) with SPM header, chronological history, complete messages, documents, decision, audit and certification |
| True `.docx` | — | ❌ none |

**Report kinds** (`?kind=`): `complete`, `purchase-committee`, `principal`,
`cdc`, `board`, `resubmission`, `rejection`, `partial-approval`, `decision`.
Each shows a subset of sections of the *same* assembly, so no stage report can
disagree with the complete one. Only the complete report is currently linked
from the request screen.

**Data included**

| Section | Content | Source |
|---|---|---|
| A. Request information | Number, title, requester, department, course, financial year, budget head + type, dates, status, version, justification | `requests` |
| B. Item details | Item, budget item, quantities requested/approved/unapproved, unit cost, amounts | `request_items` |
| C. Budget information | Provision, sanctioned, committed, this request, remaining | `fn_get_department_budget_context` |
| D. Supporting documents | Every version with uploader, date, version numbers, replacement reason, current/replaced | `attachments` |
| E. Workflow history | One narrative sentence per recorded action, with amounts, reasons and remarks | `approval_actions` |
| F. Resubmission history | Version, correction asked for, who asked, who resubmitted, amount before/after — rendered only if it happened | `request_versions` + `correction_requests` |
| G. Audit trail | Time, user, action, previous and new status — **administrators only**, by policy | `audit_logs` |
| H. Route taken | Only the stages this request actually visited | computed from its own history |

**Missing**

- True PDF and `.docx` binaries.
- **Logo.** Text "S. P. College" only; no image asset exists in the repository.
- Quotations are **referenced, not embedded** (Q8).
- No batch or period report (e.g. all requests for a department this year) —
  only per-request reports, plus the existing CSV export and by-budget-head
  summary on the Reports page.

**Correctness safeguards:** every figure is read from the rows the workflow
itself writes; `reporting.test.js` asserts the item amounts sum to the
sanctioned total, that a narrative never names a stage the request did not
visit, that a resubmitted request reports both sides, and that the audit section
appears for an administrator and not for the requester.

---

### 12. RBAC & Security Audit

**Roles** (`db/seed/01_roles_and_stages.sql`): `HEAD`, `ACTIVITY_INCHARGE`,
`PURCHASE_COMMITTEE`, `PRINCIPAL`, `CDC_MEMBER` (legacy), `CDC_GRANT_MEMBER`,
`CDC_NON_GRANT_MEMBER`, `CHAIRMAN`, `VICE_PRESIDENT`, `CLERK`, `ADMIN`.

| Role | Can see | Can do |
|---|---|---|
| Head / Activity In-charge | Own requests incl. drafts | Raise, edit own draft, correct and resubmit a returned request, declare their own department's provision (HEAD) |
| Purchase Committee | Requests at or past their stage | Pass to Principal, send back, reject, comment. **Cannot approve** |
| Principal | Every submitted request (read-all, never edit-all) | Decide ≤ ₹50k, refer above, reject, send back, comment |
| CDC Grant / Non-Grant | Requests at or past the CDC stage | Approve / partially approve / reject; both required |
| Chairman / Vice Chairman | Requests at or past the final stage | Approve / partially approve / reject; both required; cannot escalate |
| Administrator | Everything, plus the audit log | Master data, users, inventory, bills, exports. **Not an approver** |
| Clerk | Nothing by default | Issues only |
| Not signed in | Nothing | Fails closed |

**Enforcement layers:** JWT → route role guards → `withUser` transaction setting
`app.user_id` → RLS policies → `SECURITY DEFINER` functions that check for
themselves → triggers that bind even direct SQL.

**Verified bypass attempts (all refused, in `authz.test.js`,
`phase3_routes.test.js`, `workflow.test.js`):** PC approving; Principal
approving above ₹50k; a single CDC member closing a request; two members of the
same CDC role satisfying the stage; one chairman closing the final stage;
resubmission by someone other than the raiser; CDC returning for correction;
CDC escalating; an administrator acting as an approver; a head reading another
department's request; a head writing another department's provision; a
non-head writing any provision; a stranger replacing a document; reading a
report for a request one cannot see.

**Open security findings**

| # | Finding | Severity |
|---|---|---|
| 1 | Principal escalation below ₹50,000 is not refused server-side (§4.1) | **High** |
| 2 | "Other" custom values are validated only in the browser (§3.7) | Medium |
| 3 | Budget provisions can be overwritten with no history or audit row (§9) | Medium |
| 4 | Legacy `CDC_MEMBER` role is still assigned to both CDC users; it grants nothing today but is confusing (Q11) | Low |
| 5 | Development seed (`db/seed/03`) creates eleven accounts sharing one password and the login page lists them; documented as development-only, but it must not reach the college server | Medium (deployment) |
| 6 | No CSRF concern (bearer tokens, not cookies), but the token is held in `localStorage`, so any XSS would expose it | Low–Medium |

---

### 13. Testing Status

**Existing and passing — verified by running them during this audit period:**

- `cd server && npm test` → **133 tests, 133 pass, 0 fail**
- `psql -f db/tests/rls_app_user.sql` → **52 checks, 52 pass, 0 fail**
- Schema/migration parity → building from `db/schema/` and replaying every
  migration leaves every function identical.

**Covered well:** routing across all three bands, PC restrictions, Principal band
restrictions, the full return/resubmit cycle, both joint stages including
same-role and single-signature cases, document versioning and the supersede
bypass, seals and tamper detection, report figures and access, RLS for every
role.

**Missing**

- **No frontend tests at all.** `package.json` has no test script and no test
  runner is installed. Every UI claim in this audit rests on reading the code and
  on manual browser verification.
- No test that a Principal escalation below ₹50,000 is refused — because it is
  not currently refused (§4.1).
- No test for the "Other" custom-value path, in the browser or the API.
- No test for notification content or delivery.
- No test for budget provision overwrite behaviour.
- No load or concurrency test — notably two approvers at a joint stage acting
  simultaneously.
- Email paths are exercised only incidentally; the suite logs SMTP failures
  (expected, since mail failures are deliberately non-fatal).

**Critical workflows that should have tests before the Principal sees the
system:** the ≤ ₹50k escalation refusal once decided; the "Other" path
end-to-end; joint-stage simultaneous approval; resubmission after a *Principal*
return (currently covered in `authz.test.js` 8 but not in the main workflow
suite); report generation for a rejected request.

---

### 14. Ambiguities Requiring Ma'am/Principal Confirmation

**Q1. What does "Final Approval" mean as a separate box in the flow?**
**Why it matters:** the requirement diagram shows "Final Approval" after the
Principal, CDC or Chairman. The system treats the last authority's approval *as*
the final approval — there is no further step. If "Final Approval" is a distinct
act (issuing a sanction order, a purchase order, a signed letter), it does not
exist and would be new work.
**Possible interpretations:** (a) a label for the terminal decision, which is
what is built; (b) a further formal step with its own record and document.

**Q2. May the Purchase Committee reject a request outright?**
**Why it matters:** it can today. But `decisions.md` records that the Principal
always sees every request, and a committee rejection means the Principal never
does. One of the two rules has to give.
**Possible interpretations:** (a) the committee may only pass on or send back,
never reject — the Principal rejects; (b) the committee may reject clearly
invalid requests, and the "Principal always sees" rule means "of those that
proceed".

**Q3. What happens when the two approvers at a joint stage disagree?**
**Why it matters:** both CDC members (and both board members) must decide. Today
both decisions are recorded, but the second one's item figures overwrite the
first's, and a single rejection ends the request. `decisions.md` explicitly left
this open.
**Possible interpretations:** (a) either rejection kills it; (b) a rejection
sends it back for correction; (c) a disagreement escalates to the Principal or
the Chairman; (d) the more restrictive decision wins on each line.

**Q4. Exact boundary behaviour at ₹50,000 and ₹5,00,000.**
**Why it matters:** a request for exactly ₹50,000 is currently the Principal's to
decide, and one for exactly ₹5,00,000 is CDC's. If either boundary should fall
the other way, every request at those amounts routes wrongly.
**Possible interpretations:** (a) as built — lower authority includes the
boundary; (b) the boundary belongs to the higher authority.

**Q5. May the Principal refer a request below ₹50,000 upward?**
**Why it matters:** the interface says no; the API currently allows it (§4.1).
The answer decides whether we close the gap or expose the power deliberately —
for example for a sensitive small purchase the Principal wants CDC to see.
**Possible interpretations:** (a) never — the Principal decides and the API must
refuse; (b) at the Principal's discretion, and the interface should offer it.

**Q6. Is "Vice President" the same office as "Vice Chairman", and is that person
a decision-maker or a reviewer?**
**Why it matters:** the role is coded `VICE_PRESIDENT` and is built as a
*required co-approver* — a request above ₹5,00,000 cannot complete without both
signatures. The revised requirements say "Chairman/Vice Chairman" and explicitly
decline to assume decision authority. If the Vice Chairman is review-only, the
final stage is wrong today.
**Possible interpretations:** (a) same office, both must approve (as built);
(b) same office, Chairman decides and the Vice Chairman reviews; (c) different
offices.

**Q7. What should the Chairman and Vice Chairman be able to *see*?**
**Why it matters:** today they see only requests that reached their stage. A
₹2,00,000 request decided by CDC is invisible to them. The requirement says
"appropriate review visibility" without defining it.
**Possible interpretations:** (a) only what reaches them, as built; (b) read
access to everything, like the Principal; (c) read access to everything above
some amount.

**Q8. Must the quotations themselves be embedded in the report, or is a list
enough?**
**Why it matters:** embedding PDFs into a generated report is substantially more
work than listing them and changes the format decision in Q9.
**Possible interpretations:** (a) a list with name, version, uploader and date,
as built; (b) the quotation pages appended to the report; (c) a report plus a
zip of the documents.

**Q9. Which stages need a separate downloadable report, and in which format?**
**Why it matters:** nine report kinds exist in the API but only the complete one
is linked in the interface, and no true PDF/`.docx` is generated. Adding real
binary formats means adding a rendering library to the server, which affects
deployment size on the college machine.
**Possible interpretations:** (a) print-to-PDF from the browser is sufficient;
(b) the server must produce a PDF file (needed if a report is ever emailed or
archived automatically); (c) a true editable `.docx` is required for the office
to amend before filing.

**Q10. Do budget provisions follow the academic year or the financial year?**
**Why it matters:** the requirement says "at the beginning of the academic
year", but the system is financial-year only, by an explicit earlier design
decision. If provisions really run June–May while requests are counted
April–March, the utilised and remaining figures cover the wrong window.
**Possible interpretations:** (a) "academic year" was loose wording for the
financial year, as built; (b) provisions genuinely follow the academic year and
need their own period.

**Q11. Is the legacy `CDC_MEMBER` role safe to remove?**
**Why it matters:** it is seeded and assigned to both CDC users but grants
nothing — the two-role count ignores it. Leaving it invites someone to staff a
future CDC member with it and wonder why their approval does not count.
**Possible interpretations:** (a) remove it; (b) keep it as a general "is on the
CDC" marker used for visibility.

**Q12. Where should a returned request go when it is resubmitted, and where
should a carried-forward request restart?**
**Why it matters:** a resubmitted request returns to whoever sent it back — so a
Principal return skips a second committee check. A carried-forward request
resumes at the stage it left off at, so it can begin a new financial year
already past the Principal.
**Possible interpretations:** (a) as built; (b) any correction re-enters at the
Purchase Committee; (c) carry-forward restarts the whole workflow in the new
year.

---

### 15. Recommended Implementation Order

**Stage 1 — decisions first (no code).** Put Q1–Q12 to Ma'am/the Principal.
Q2, Q3, Q5, Q6 and Q10 each change the state machine or the data model, and
building before they are answered risks rework. Record the answers in
`docs/plan/decisions.md` beside the existing ones.

**Stage 2 — close the enforcement gaps (small, safe, no decisions needed).**
1. Server-side validation of "Other" custom values.
2. Refuse the Principal's sub-₹50,000 escalation, *or* expose it deliberately,
   per Q5.
3. Add tests for both.

These are self-contained and reduce the chance that later work is built over a
hole.

**Stage 3 — act on the answers.** Purchase Committee rejection (Q2), joint-stage
disagreement (Q3), Vice Chairman authority (Q6), boundary behaviour (Q4),
academic year (Q10). Schema changes, if any, come here — before reporting work
depends on them.

**Stage 4 — the visible gaps.** In-app notification on return; budget-submission
notification; a read API and screen for prior request versions; Purchase
Committee partial recommendation; Principal → committee feedback; a review step
on budget provisions.

**Stage 5 — reporting.** Once Q8 and Q9 are settled: add the logo, then the PDF
generator, then `.docx` if required, then surface the stage reports in the
interface. Do this after Stage 4 so the reports describe a finished workflow.

**Stage 6 — deployment.** Settle the hosting question (§4.2), remove or gate the
Vercel/Render/Drive configuration, confirm the file store for an on-premises
Windows host, and make sure the development seed cannot reach the college
server.

**Stage 7 — polish and tests.** Frontend test setup, the replacement-reason
dialog, branding assets, and removing AI attribution from the two files in §17.

---

### 16. Files / Modules Requiring Attention

| Path | Why |
|---|---|
| `server/src/routes/requests.js` | Sub-₹50k escalation gap (§4.1); `extra` accepted unvalidated (§3.7); would host a partial-recommendation action |
| `db/schema/13_record_action.sql` | Purchase Committee rejection (Q2); joint-stage disagreement (Q3); band boundaries (Q4) |
| `db/schema/16_notifications.sql` | No `AWAITING_RESUBMISSION` branch; no budget-provision notification |
| `server/src/routes/budget.js` | No notification on submission; no review action; upsert overwrites without history |
| `server/src/reporting.js` | Text branding only; no PDF/`.docx`; attachments referenced not embedded |
| `server/src/routes/reports.js` | Stage report kinds exist but are not surfaced in the interface |
| `vercel.json` | Points the frontend at a Render-hosted API; conflicts with the stated deployment target |
| `server/src/storage.js`, `docs/GOOGLE_DRIVE_SETUP.md` | Google Drive backend; revisit for an on-premises Windows host |
| `db/seed/01_roles_and_stages.sql`, `db/seed/03_users_and_approvers.sql` | `VICE_PRESIDENT` naming (Q6); legacy `CDC_MEMBER` (Q11); the Purchase Committee role description still reads "Reviews requests below 50,000"; development accounts must not reach production |
| `src/components/requests/DecisionPanel.jsx` | Would host a partial-recommendation control; stage copy depends on Q2 |
| `src/components/ui/Attachments.jsx` | `window.prompt()` for the replacement reason |
| `src/components/modals/NewRequestModal.jsx`, `src/utils/customItem.js` | Custom-value handling; item names encoded into `remarks` |
| `package.json` (root) | No test runner for the frontend |
| `prompts.md`, `AI_LOGS.md` | AI attribution (§17) |
| `requirement.md` | Still lists open questions that overlap this audit; keep it and `docs/plan/decisions.md` in step |

---

### 17. AI Attribution / Unwanted Metadata Check

Searched the whole repository (excluding `node_modules` and `dist`) for
*claude*, *anthropic*, *gemini*, *openai*, *gpt*, *copilot*, *chatgpt*, *llm*,
*co-authored-by*, *generated by*, *AI generated* and *antigravity*, in source,
SQL, Markdown, JSON, HTML and configuration, plus the full git history including
author and committer fields.

**Findings — two files need cleaning:**

| File | What it contains | Count |
|---|---|---|
| `prompts.md` | The phase plan written around specific AI models and an agent tool: "Claude Sonnet", "Gemini 3 Pro", "Gemini 3 Flash", "GPT-OSS-120B", "AntiGravity", a model-selection rationale section, per-phase "**Model:**" lines, "Prompt to give AntiGravity" headings, and a summary table assigning models to phases | ~45 references |
| `AI_LOGS.md` | Titled "AI Work Log", opens "This file records prompts received and the work completed with AI assistance", and is structured as "### Prompt" / "### Work Completed" throughout | Whole file (414 lines); no model names |
| `docs/plan/phase5-reporting-notes.md` | One line: "wants a true PDF generated by the server" | 1 — **not** AI attribution, ordinary English |

**Clean — no action needed:**

- **Git history:** no `Co-authored-by` trailer anywhere; authors are only
  `Anish <anishmogam@gmail.com>`, `Anish Mogam <anishmogam@gmail.com>` and
  `ISHA JOSHI <ishajoshi306@gmail.com>`. No AI email addresses.
- **All application source** — `server/src/**`, `src/**`, `db/schema/**`,
  `db/migrations/**`, `db/seed/**`, tests: no AI references in code, comments,
  strings, UI text or generated reports.
- **Generated reports** carry only "S. P. College" and "S. P. College Approval
  Hub".
- Innocent matches for "generated by" in `db/schema/15_numbering.sql`,
  `db/schema/16_notifications.sql`, `db/seed/03_users_and_approvers.sql` and
  `db/migrations/20260911T120000_backend_rls_fixes.sql` all read "Generated by
  the database…" — normal technical English, **not** AI attribution.

**Recommended (not done in this audit, which changes no other file):**

- [ ] Rewrite `prompts.md` as a plain phased delivery plan with the model
      assignments, the "AntiGravity" references and the model-quota rationale
      removed — or move it out of the repository entirely, since it is a working
      document rather than project documentation.
- [ ] Rename `AI_LOGS.md` to something like `CHANGELOG.md` or
      `docs/development-log.md` and reword its header and section headings
      ("Prompt" → "Change requested" or similar) so it reads as an ordinary
      development log.
- [ ] Check `.docx` files in the repository root
      (`SP_College_Approval_Hub_Revised_Workflow.docx` and the others) for
      AI-related wording and document metadata/author fields. Binary documents
      were **not** inspected in this audit.

No new AI attribution was introduced by this audit.

---

### 18. Final Readiness Checklist

**Before the system is shown to Ma'am / the Principal**

- [ ] All twelve questions in §14 answered and recorded in
      `docs/plan/decisions.md`
- [ ] P0 items in §5 complete, each with a test
- [ ] Sub-₹50,000 escalation behaviour settled and enforced server-side
- [ ] "Other" custom values validated in the API
- [ ] Purchase Committee rejection behaviour settled
- [ ] Joint-stage disagreement rule settled and enforced
- [ ] In-app notification when a request is returned for correction
- [ ] AI attribution removed from `prompts.md` and `AI_LOGS.md`; root `.docx`
      files checked
- [ ] College logo present in the report header and in the application

**Before it is used for real approvals**

- [ ] `db/migrations/20260929T120000_fix_return_action_and_resubmit_seal.sql`
      applied to the live database (without it, resubmission cannot work)
- [ ] Deployment target confirmed; Vercel/Render/Drive configuration removed or
      deliberately retained
- [ ] File storage confirmed for the college server, with a backup routine
- [ ] `db/seed/03_users_and_approvers.sql` **not** loaded, or every password
      reset; the development quick-login list not reachable in the production
      build
- [ ] Real users created and staffed at their stages — no one can approve
      anything without `stage_approvers` rows
- [ ] `JWT_SECRET`, signing secret and database password set to real values and
      not committed
- [ ] `app_user` password set; the API confirmed *not* connecting as a superuser
- [ ] A dated database backup taken before the first live request
- [ ] The full test suite and the RLS suite pass against the deployed schema
- [ ] One complete request walked through end to end on the real server:
      raise → committee → Principal → CDC or board → report printed
- [ ] One returned request corrected and resubmitted on the real server
- [ ] A report printed and shown to the Principal for format approval
