# S.P. College Approval Hub — Team Working Plan

This is the working plan for the team. It divides the remaining work into
streams that can run in parallel without colliding, and it contains the full
email specification (section 6) so that work can start immediately.

Read `docs/IMPLEMENTATION_STATUS.md` first — it is the audit of what actually
exists today. This file says who does what next.

---

## 1. Ground rules

1. **Do not build over an open question.** Section 3 lists decisions that change
   the state machine or the schema. If your task depends on one, get the answer
   first or you will build it twice.
2. **One stream per person.** The streams in section 4 are drawn so two people
   rarely edit the same file. If you must touch a file outside your stream, say
   so in the group first.
3. **Tests must pass before you push.**
   ```bash
   cd server && npm test
   ```
   ```bash
   psql -U postgres -d spc_approval -f db/tests/rls_app_user.sql
   ```
   Currently 133 API tests and 52 access checks pass. Do not push a red suite.
4. **Never weaken a test to make it pass.** If a test blocks you because the
   rule changed, change the assertion to the new rule and say so in the commit
   message.
5. **Schema changes go in a migration** *and* are mirrored into `db/schema/`,
   with the filename added to `db/schema/17_schema_migrations.sql`. Then prove
   the two agree: build a database from `db/schema/`, replay every migration
   over it, and confirm no function changed. See `db/migrations/README.md`.
6. **Enforce on the server, never in the browser only.** Hiding a button is not
   a rule. Every rule needs a check in the route *and* in the database, and a
   test that calls the API directly and asserts the refusal.
7. **No AI tool names, model names or AI attribution anywhere** — not in code,
   comments, commit messages, documentation, UI text or generated reports. This
   is normal team software.
8. **Keep it local for now.** Do not push to a shared branch until the P0 work
   in section 4 is done and reviewed.

---

## 2. Where the project stands

Working and enforced at the database level: the full approval routing
(Purchase Committee → Principal → CDC or Chairman by amount), Purchase
Committee as review-only, the Principal as a mandatory gate, return for
correction and resubmission with full version history, document versioning,
budget provisions with computed utilisation, two-signature CDC and board
stages, a tamper-evident audit trail, and role-based access backed by
row-level security.

Not finished: true PDF/DOCX reports and college branding, several notification
gaps, server-side validation of "Other" values, one routing enforcement hole,
and the deployment/hosting decision.

Full detail, with evidence and file references: `docs/IMPLEMENTATION_STATUS.md`.

---

## 3. Blocking decisions — ask before building

These go to Ma'am / the Principal. Until each is answered, the work that
depends on it is blocked. Numbers match section 14 of the audit.

| # | Question | Blocks |
|---|---|---|
| Q2 | May the Purchase Committee reject a request outright, or only pass it on / send it back? | Stream A, email event E5 |
| Q3 | When the two CDC members (or Chairman and Vice Chairman) disagree, or one rejects — what happens? | Stream A, email events E12–E14 |
| Q4 | At exactly ₹50,000 and exactly ₹5,00,000, who decides? (Built as: the lower authority.) | Stream A |
| Q5 | May the Principal refer a request **below** ₹50,000 upward? | Stream A (P0 item A1) |
| Q6 | Is "Vice President" the same office as "Vice Chairman", and is that person a decision-maker or review-only? | Stream A, Stream E, email E11/E14 |
| Q10 | Do budget provisions follow the academic year or the financial year? (Built as: financial year.) | Stream C |
| Q8, Q9 | Must quotations be embedded in reports? Which stages need a downloadable PDF/DOCX? | Stream D |
| Q1 | Is "Final Approval" a separate step after the deciding authority, or a label for their decision? | Stream A |

Write the answers into `docs/plan/decisions.md`, beside the existing ones.

---

## 4. Work streams

Each stream is a person's lane. Priorities: **P0** blocks everything,
**P1** is core function, **P2** is reports and documents, **P3** is polish.

### Stream A — Workflow rules and enforcement (P0)
*Owner: the person most comfortable with SQL and the approval logic.*

| # | Task | Files |
|---|---|---|
| A1 | Refuse a Principal escalation below ₹50,000 server-side — or, per Q5, expose it deliberately in `actionsAt()`. Today the UI hides it but the API accepts it and routes the request to CDC. | `server/src/routes/requests.js`, `db/schema/13_record_action.sql` + migration |
| A2 | Validate "Other" custom values in the API. A direct call can select the "Other" budget head with no `extra.customBudgetHead`, producing a head literally named "Other (specify)" with nothing specified. Same for department, course, urgency, item name. | `server/src/routes/requests.js` |
| A3 | Implement the Q2 answer for Purchase Committee rejection. | `db/schema/13_record_action.sql`, `server/src/routes/requests.js`, `src/components/requests/DecisionPanel.jsx` |
| A4 | Implement the Q3 answer for joint-stage disagreement. Today the second approver's item figures silently overwrite the first's. | `db/schema/13_record_action.sql` |
| A5 | A test for each of the above that calls the API directly and asserts the refusal. | `server/test/authz.test.js` |

**Done when:** each rule is refused by the route *and* by the database, and a
test proves it by calling the API, not by clicking.

### Stream B — Notifications and email (P1)
*Owner: see section 6 for the full specification. This is the largest single
piece of work and it is fully specified, so it can start today.*

| # | Task | Files |
|---|---|---|
| B1 | **Fix the recipient bug first.** Almost every request email is sent to `config.principalEmail`, not to the person it is addressed to — `recipientName` is the requester but `recipientEmail` is the Principal (`requests.js` lines ~147 and ~251). Resolve and send to the real address. | `server/src/routes/requests.js` |
| B2 | Remove the hardcoded default address `protonedge01@gmail.com` from `config.principalEmail`; require it from the environment or drop the fallback entirely. | `server/src/config.js`, `server/.env.example` |
| B3 | Set `APP_URL` properly so the button in each email links to the real site. It currently defaults to `http://localhost:3000`. | `server/src/config.js`, `server/.env.example`, `server/src/emailTemplates.js` |
| B4 | Send the arrival email to the **Purchase Committee** when a request is submitted. Today submission emails the Principal, and the committee — who must act — gets nothing. | `server/src/routes/requests.js` |
| B5 | Implement every event in the matrix in section 6.3, with the per-role bodies in 6.5. | `server/src/routes/requests.js`, `server/src/emailTemplates.js` |
| B6 | In-app notification when a request is returned for correction. The trigger covers `UNDER_*` and the terminal statuses; `AWAITING_RESUBMISSION` matches neither, so the requester is told nothing in the app. | `db/schema/16_notifications.sql` + migration |
| B7 | Notify the Principal and Purchase Committee when a department submits or updates its budget provision. | `server/src/routes/budget.js` |

### Stream C — Budget and request history (P1)
*Owner: backend + a little frontend.*

| # | Task | Files |
|---|---|---|
| C1 | Expose prior request versions and immutable audit trail. `request_versions` stores a full snapshot of every version including items and documents. Add `GET /api/requests/:id/versions`, version history modal tabs, comparison diffs, and item-level recommendation preservation. (In progress on `feature/request-versioning`) | `server/src/routes/requests.js`, `src/components/modals/RequestDetailModal.jsx` |
| C2 | Add a review step to budget provisions so the Principal can record that they have seen one (reviewed by, reviewed at, optional note). Today they can only read it. | `db/` migration, `server/src/routes/budget.js`, `src/pages/BudgetProvisions.jsx` |
| C3 | Keep a history of provision changes. `POST` currently overwrites the amount with no record of the previous value. | `db/` migration, `server/src/routes/budget.js` |
| C4 | Implement the Q10 answer if provisions must follow the academic year. | `db/` migration + everything reading `financial_year_id` for budgets |

### Stream D — Reporting (P2)
*Owner: whoever takes the report work end to end. Blocked on Q8 and Q9.*

| # | Task | Files |
|---|---|---|
| D1 | Add the S.P. College logo to the report header (currently the text "S. P. College") and to the application sidebar (currently a plain "SP" tile). Add the asset to the repository. | `server/src/reporting.js`, `src/components/layout/Sidebar.jsx` |
| D2 | Generate a true PDF server-side. The data assembly already exists — this is a rendering layer only. | `server/src/reporting.js`, `server/package.json` |
| D3 | Generate a true `.docx` if Q9 says the office needs an editable copy. What exists today is HTML in a `.doc` container, which Word opens but which is not Office Open XML. | same |
| D4 | Surface the stage reports. Nine kinds exist behind `?kind=` but only the complete report is linked in the interface. | `src/components/modals/RequestDetailModal.jsx` |
| D5 | Embed quotations in the report if Q8 requires it. | `server/src/reporting.js` |

### Stream E — Master data, roles and interface (P2/P3)
*Owner: frontend-leaning.*

| # | Task | Files |
|---|---|---|
| E1 | Correct "Vice President" to "Vice Chairman" throughout once Q6 is answered — role code, seed users, stage display name "Chairman + VP", role labels, report stage names. | `db/seed/01_roles_and_stages.sql`, `db/seed/03_users_and_approvers.sql`, `src/api/format.js`, `server/src/reporting.js` |
| E2 | Remove the legacy `CDC_MEMBER` role once Q11 confirms it, or document why it stays. It grants nothing today but invites a future member being staffed with it and wondering why their approval does not count. | seed files |
| E3 | Fix the stale Purchase Committee role description, still "Reviews requests below 50,000". | `db/seed/01_roles_and_stages.sql` |
| E4 | Replace the browser `prompt()` used to ask why a document is being replaced with a proper dialog. | `src/components/ui/Attachments.jsx` |
| E5 | Add a frontend test setup — there is none at all — and cover the decision panel, the resubmission panel and the "Other" dropdowns. | `package.json`, new test files |

### Stream F — Deployment (P0 decision, P2 work)
*Owner: whoever will actually install this on the college server.*

| # | Task | Files |
|---|---|---|
| F1 | Settle the hosting question. The repository is configured for Vercel (frontend) and Render (API), while the stated target is the college's own Microsoft/IIS server. | `vercel.json` |
| F2 | Decide the file store. Google Drive via a service account exists as a workaround for Render's disposable filesystem; on a college server the local disk is persistent and procurement documents would not leave college infrastructure. | `server/src/storage.js`, `docs/GOOGLE_DRIVE_SETUP.md` |
| F3 | Make sure the development seed cannot reach the server. `db/seed/03_users_and_approvers.sql` creates eleven accounts sharing one password, and the login page lists them in development builds. | `db/seed/`, build configuration |
| F4 | Real secrets: `JWT_SECRET`, the signing secret, the database password, `app_user`'s password, `PRINCIPAL_EMAIL`, `APP_URL`, SMTP credentials. None committed. | `server/.env` (never committed) |

> **Note:** the application is deployed *on* a Microsoft server environment. Do
> not build an "Exchange Service" feature into the application. Mail goes out
> over ordinary SMTP.

---

## 5. Suggested split

With four people:

- **Person 1 — Stream A.** Start now; A1 and A2 need no decision.
- **Person 2 — Stream B.** Start now with B1–B4, which are bugs and
  configuration. Then work through the matrix in section 6.
- **Person 3 — Stream C**, then help with Stream D.
- **Person 4 — Stream E**, then Stream F with whoever owns the server.

Whoever finishes first picks up Stream D, which is the longest tail.

---

## 6. Email specification

Everything in this section can be implemented today. It describes what each
role receives at each stage. Sections 6.1 and 6.2 are the rules; 6.3 is the
event matrix; 6.4 is the subject-line format; 6.5 is what goes in the body for
each role.

### 6.1 What exists now

- `server/src/emailTemplates.js` — `buildRequestStatusEmail()` and
  `buildIssueCreatedEmail()` produce complete styled HTML. **Reuse these; do
  not write a second template system.**
- `server/src/mailer.js` — `sendMail()` with a Resend or SMTP transport.
- `notifyRequestAsync()` in `server/src/routes/requests.js` — fire-and-forget,
  errors logged, never affecting the API response. **Keep that property.**

`buildRequestStatusEmail()` already accepts everything below:

```
request, recipientEmail, recipientName, ccRecipients,
notificationType, emailAction, eventDescription,
decision, approverName, approverRole, decisionDate,
approvedItems, rejectedItems, approvalRemarks, rejectionReason,
actionRequired, ctaText, ctaUrl,
workflowStage, nextStage, pendingSince, pendingDays
```

### 6.2 Rules that must not be broken

1. **Send to the real person.** Resolve the recipient's own address. Do not send
   everything to the Principal's address as the code does today (task B1).
2. **Never include a signature or seal hash.** Those prove the record is
   unaltered; they do not belong in an email.
3. **Respect comment visibility.** A `STAGE_ONLY` or `UP_CHAIN` comment must
   never appear in an email to the requester. Only the action's own comment,
   the rejection reason and the correction reason are safe to show them.
4. **Never show one department's budget figures to another department.** Budget
   blocks go to the reviewers of that request and to that department's own head.
5. **One email per recipient per event.** Do not CC a group where each member
   should get their own, addressed by name.
6. **Mail failure must never fail the request.** Keep the fire-and-forget shape
   and log failures.
7. **Amounts in Indian digit grouping** — ₹6,50,000.50, not ₹650,000.50. The
   template's `formatAmount()` already does this.
8. **Every email names the request number** in the subject and the footer.
9. **Plain-text fallback** for every email.

### 6.3 Event matrix — who is emailed, at every stage

`ACTION` = this person must do something. `INFO` = for their awareness.

| # | Event | Stage | Recipient | Type | Subject key (6.4) | Body (6.5) |
|---|---|---|---|---|---|---|
| E1 | Request submitted | → Purchase Committee | Each Purchase Committee member | **ACTION** | `review-required` | PC body |
| E1b | Request submitted | → Purchase Committee | Requester | INFO | `submitted` | Requester body |
| E2 | Committee passes it on | PC → Principal | Principal | **ACTION** | `review-required` | Principal body |
| E2b | Committee passes it on | PC → Principal | Requester | INFO | `progress` | Requester body |
| E3 | Committee sends it back | PC → requester | Requester | **ACTION** | `correction-required` | Correction body |
| E3b | Committee sends it back | PC → requester | Purchase Committee member who returned it | INFO | `confirmation` | Short confirmation |
| E4 | Requester resubmits | → PC or Principal | Every approver staffed at the stage it returns to | **ACTION** | `resubmitted` | PC or Principal body, marked *revised* |
| E4b | Requester resubmits | — | Requester | INFO | `confirmation` | Short confirmation |
| E5 | Committee rejects *(pending Q2)* | PC | Requester | INFO | `rejected` | Decision body |
| E6 | Principal approves (≤ ₹50,000) | Principal | Requester | INFO | `approved` | Decision body |
| E6b | Principal approves | Principal | Purchase Committee | INFO | `outcome` | Outcome body |
| E7 | Principal partially approves | Principal | Requester | INFO | `partially-approved` | Decision body with the item table |
| E7b | Principal partially approves | Principal | Purchase Committee | INFO | `outcome` | Outcome body |
| E8 | Principal rejects | Principal | Requester | INFO | `rejected` | Decision body with the reason |
| E8b | Principal rejects | Principal | Purchase Committee | INFO | `outcome` | Outcome body |
| E9 | Principal sends it back | Principal → requester | Requester | **ACTION** | `correction-required` | Correction body |
| E9b | Principal sends it back | — | Purchase Committee | INFO | `outcome` | Outcome body |
| E10 | Principal refers to CDC (₹50k–₹5L) | Principal → CDC | **CDC Grant Member** | **ACTION** | `decision-required` | CDC body |
| E10 | Principal refers to CDC | Principal → CDC | **CDC Non-Grant Member** | **ACTION** | `decision-required` | CDC body |
| E10b | Principal refers to CDC | — | Requester | INFO | `progress` | Requester body |
| E10c | Principal refers to CDC | — | Purchase Committee | INFO | `outcome` | Outcome body |
| E11 | Principal refers to the board (> ₹5L) | Principal → Chairman + Vice Chairman | **Chairman** | **ACTION** | `decision-required` | Board body |
| E11 | Principal refers to the board | — | **Vice Chairman** | **ACTION** | `decision-required` | Board body |
| E11b | Principal refers to the board | — | Requester | INFO | `progress` | Requester body |
| E12 | First CDC member decides | CDC | The **other** CDC member | **ACTION** | `second-signature-required` | CDC body, showing the first decision |
| E13 | Both CDC members have decided | CDC → decided | Requester | INFO | `approved` / `partially-approved` / `rejected` | Decision body |
| E13b | Both CDC members have decided | — | Principal | INFO | `outcome` | Outcome body |
| E13c | Both CDC members have decided | — | Purchase Committee | INFO | `outcome` | Outcome body |
| E14 | First board member decides | Final authority | The **other** board member | **ACTION** | `second-signature-required` | Board body, showing the first decision |
| E15 | Both board members have decided | Final → decided | Requester | INFO | `approved` / `partially-approved` / `rejected` | Decision body |
| E15b | Both board members have decided | — | Principal | INFO | `outcome` | Outcome body |
| E16 | Department submits/updates its budget provision | Budget | Principal | **ACTION** | `budget-review` | Budget body |
| E16b | Department submits/updates its budget provision | — | Purchase Committee | INFO | `budget-recorded` | Budget body |
| E16c | Department submits/updates its budget provision | — | The head who submitted it | INFO | `confirmation` | Short confirmation |
| E17 | Request carried forward to a new year | — | Requester | INFO | `carried-forward` | Short confirmation |
| E18 | Pending more than 3 days *(optional, P2)* | any | Approvers at the current stage | **ACTION** | `reminder` | Reminder body |

Events E12 and E14 are the ones most easily missed: when one member of a
two-signature stage decides, the **other** member must be told that the request
is now waiting on them alone.

### 6.4 Subject lines

Format:

```
[S.P. College] <REQUEST NUMBER> — <event from the recipient's point of view>
```

Prefix `Action required:` when the recipient must act.

| Key | Subject |
|---|---|
| `review-required` | `[S.P. College] REQ-2026-0001 — Action required: review request (₹30,000)` |
| `decision-required` | `[S.P. College] REQ-2026-0001 — Action required: your decision (₹2,00,000)` |
| `second-signature-required` | `[S.P. College] REQ-2026-0001 — Action required: your signature completes the decision` |
| `correction-required` | `[S.P. College] REQ-2026-0001 — Action required: corrections needed before this can proceed` |
| `submitted` | `[S.P. College] REQ-2026-0001 — Submitted for approval` |
| `resubmitted` | `[S.P. College] REQ-2026-0001 — Resubmitted with corrections (version 2)` |
| `progress` | `[S.P. College] REQ-2026-0001 — Now with the Principal` |
| `approved` | `[S.P. College] REQ-2026-0001 — Approved (₹30,000 sanctioned)` |
| `partially-approved` | `[S.P. College] REQ-2026-0001 — Partly approved (₹1,00,000 of ₹2,01,000 sanctioned)` |
| `rejected` | `[S.P. College] REQ-2026-0001 — Not approved` |
| `outcome` | `[S.P. College] REQ-2026-0001 — Outcome: approved by the Principal` |
| `confirmation` | `[S.P. College] REQ-2026-0001 — Your resubmission was received` |
| `budget-review` | `[S.P. College] Computer Science — annual budget provision submitted for 2026-27` |
| `budget-recorded` | `[S.P. College] Computer Science — annual budget provision recorded` |
| `carried-forward` | `[S.P. College] REQ-2026-0001 — Carried forward to 2027-28` |
| `reminder` | `[S.P. College] REQ-2026-0001 — Still awaiting your review (4 days)` |

Rules: never put a person's name in the subject; never exceed about 78
characters; always include the request number; include the amount only where it
helps the reader triage.

### 6.5 Body content, per role

Every email has the same frame: college header → one sentence saying what
happened → the request summary → the role-specific block → what to do next →
footer (request number, timestamp, "this is an automated message, please do not
reply").

**The request summary block, in every request email:**
request number · title · department · raised by · financial year · budget head
and type · amount requested · current status and stage.

---

**Requester** (Head of Department / Activity In-charge)

- What happened, in plain words, and who did it — name and role.
- Their item table: item, quantity, unit cost, amount. Once decided, add
  approved quantity, approved amount and **unapproved amount**, which is what
  they will ask about.
- On a decision: sanctioned total against requested total.
- On a rejection: the reason, in full.
- On a return: the correction reason, in full, and the deadline if one is set.
- Never any other stage's private comments.
- Button: **View your request**.

**Purchase Committee**

- Framed as a completeness check, not a decision: this stage confirms the
  request is complete and properly documented, and passes it to the Principal,
  who decides.
- A checklist: justification present (yes/no), quotations attached (how many),
  supporting documents (how many), budget provision recorded for this
  department and year (yes/no).
- Item table: requested quantities and amounts only — no approved column; they
  do not approve.
- The department's budget position: annual provision, already sanctioned,
  committed, this request, remaining.
- If this is a resubmission: a **Revised — version N** banner, the correction
  that was asked for, and who asked.
- What they can do: pass it to the Principal, send it back for correction, or
  record observations.
- Button: **Review request**.

**Principal**

- The Purchase Committee's observations and the name of the member who passed
  it on — this is the main thing they are reading for.
- Item table: requested, and approved once decided.
- Budget block: annual provision, already sanctioned, committed and awaiting
  decision, this request, remaining if everything pending is approved. Flag it
  when the remaining figure would go negative.
- **The band, stated plainly**, because it decides what they can do:
  - ≤ ₹50,000 — "This request is yours to decide."
  - ₹50,000–₹5,00,000 — "Above ₹50,000: after your review this goes to CDC."
  - above ₹5,00,000 — "Above ₹5,00,000: after your review this goes to the
    Chairman and Vice Chairman."
- History so far: submitted on, committee reviewed on, resubmissions if any.
- Button: **Review request**.

**CDC Grant Member / CDC Non-Grant Member**

- "This request is CDC's to decide" and the amount band that brought it here.
- **The other member's status, always** — "CDC Non-Grant Member: approved on 29
  September" or "still to decide". This is the single most important line in
  the email.
- A clear statement: **both approvals are required; either may go first.** When
  one has already decided, say so: "Your signature completes the decision."
- The Principal's note when they referred it.
- Item table and the department's budget block.
- Button: **Record your decision**.

**Chairman / Vice Chairman**

- Identical shape to the CDC body, with the other board member's status and the
  same both-required statement.
- Add that this is the final stage: there is nothing above it and the request
  cannot be escalated further.
- The full journey in brief: committee reviewed → Principal referred → now with
  you.
- Button: **Record your decision**.

**Head of Department — budget provision**

- Confirmation of what was recorded: department, financial year, budget head (or
  all heads), amount, and whether the sanction document is attached.
- A reminder if no document is attached.
- Button: **View departmental budgets**.

**Principal — budget provision review**

- Which department, which year, the amount, who submitted it and when.
- Whether the sanction document is attached.
- That department's position for the year so far: sanctioned, committed,
  remaining.
- Button: **Review budget provision**.

**Outcome emails** (to the Purchase Committee and the Principal after someone
else has decided)

- Short. Who decided, what they decided, the sanctioned amount, the date.
- No action, no checklist, no button beyond **View request**.

### 6.6 Implementation order for Stream B

1. B1–B3 — recipient bug, hardcoded address, `APP_URL`. Nothing else is worth
   doing until an email reaches the right person with a working link.
2. E1, E1b, E2, E2b — the ordinary path.
3. E3, E4 — correction and resubmission, including the in-app notification
   (B6).
4. E6–E9 — the Principal's decisions.
5. E10–E15 — CDC and the board. **E12 and E14 are the ones to get right.**
6. E16 — budget provisions (B7).
7. E17, E18 — carry-forward and the reminder digest.

### 6.7 Testing email work

- Set an SMTP or Resend test account in your own `.env`; do not commit it.
- For each event, assert the **recipient list** and the **subject key** — that
  is where the mistakes are, not in the HTML.
- Assert that a `STAGE_ONLY` comment never appears in a requester's email.
- Assert that mail failure leaves the API response unchanged: the existing
  suite already logs SMTP failures without failing, and that must stay true.
- Check the rendered HTML in Outlook, since the college runs on a Microsoft
  environment — table-based layout and inline styles, no flexbox or grid.

---

## 7. Definition of done

Before you call a task finished:

- [ ] The rule is enforced in the route **and** in the database
- [ ] A test calls the API directly and asserts the refusal or the behaviour
- [ ] `cd server && npm test` passes in full
- [ ] `db/tests/rls_app_user.sql` passes in full
- [ ] Any schema change has a migration, is mirrored into `db/schema/`, is
      listed in `17_schema_migrations.sql`, and the two build paths agree
- [ ] The interface reflects the change — no button that the server refuses,
      no rule that exists only as a hidden button
- [ ] No AI tool or model names anywhere in the change
- [ ] The commit message explains *why*, not just what

---

## 8. Ready for Ma'am / the Principal when

- [ ] All questions in section 3 answered and recorded in `docs/plan/decisions.md`
- [ ] Stream A complete
- [ ] Stream B complete through E15
- [ ] Reports carry the college logo
- [ ] One complete request walked through on the real server: raised → committee
      → Principal → CDC or board → report printed
- [ ] One returned request corrected and resubmitted on the real server
- [ ] A printed report shown to the Principal for format approval
