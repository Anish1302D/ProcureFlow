# S.P. College Approval and Workflow Management System

## Purpose

A role-based web application for the college's procurement approvals and
faculty issues, with inventory, purchase bills, reporting, notifications and a
full audit trail.

Sources: `SPCollege_ApprovalSystem_Requirements.docx`,
`Procurement_Workflow_Database_Documentation_2.docx`, and
`Email_Workflow_Master_Document_College_Procurement_Approval.docx`.

## Roles

Roles are data, not code: adding a CDC member is a row, not a release.

| Role | Does |
|---|---|
| Head of Department, Activity In-charge | Raise requests; follow their own; correct and resubmit ones sent back; declare the department's annual budget provision |
| Purchase Committee | Check every request for completeness; pass it to the Principal or send it back for correction. Never decides the spending |
| Principal | Sees every request whatever its size; decides up to ₹50,000; refers larger ones on; read all college data; manage faculty issues |
| CDC (Grant and Non-Grant members) | Decide ₹50,000 to ₹5 lakh — **both** must record a decision |
| Chairman, Vice Chairman | Decide above ₹5 lakh jointly — **both** must record a decision; no further escalation |
| Administrator | Inventory, purchase bills, exports, audit log |
| Anyone signed in | Raise and follow faculty issues |

## Approval workflow

Every request, whatever its size, takes the same first two steps: the Purchase
Committee checks it is complete, then the Principal sees it. Who decides the
money depends on the amount.

```
Requester → Purchase Committee (completeness) → Principal (always)
                                                   ├─ up to ₹50,000 ....... Principal decides
                                                   ├─ ₹50,000 – ₹5,00,000 .. CDC Grant + CDC Non-Grant
                                                   └─ above ₹5,00,000 ...... Chairman + Vice Chairman
```

- **The Purchase Committee cannot approve.** It confirms the quotation and
  supporting papers are there and passes the request to the Principal, or sends
  it back to the requester for correction.
- **The Principal is never skipped.** Nothing reaches CDC or the Chairman
  without a Principal decision in its history; the database refuses it.
- **Two signatures where two are required.** At CDC and at the Chairman/Vice
  Chairman stage both members must each record a decision, in either order, and
  each is a row of its own. One signature leaves the request where it is.
- **Sending back for correction** belongs to the Purchase Committee and the
  Principal. The request returns to the requester under the same request
  number, keeps every earlier version, and comes back to the stage that sent it
  back.

The ₹50,000 and ₹5,00,000 thresholds are authoritative
(`docs/plan/decisions.md`); the ₹1,50,000 / ₹15,00,000 figures that appear in
some earlier documents are a documentation error.

## Functional requirements

- Sign in with a college email; every screen follows the person's real roles.
- A request carries **many line items**, each with a budget item, quantity and
  unit cost. The request total is the sum of its lines, never typed in.
- **Partial approval at item and quantity level.** The original request is never
  overwritten: requested, approved and unapproved quantities and amounts all
  remain on the record.
- Rejection requires a reason. Every decision is recorded with who took it,
  when, and against which items, and is sealed so later alteration is detectable.
- **Comments carry a visibility**: everyone on the request, up the chain, or one
  stage only. A restricted CDC note reaches the Principal but not the requester.
- Attachments (quotations, bills, photographs) on requests and issues. Past the
  draft a document is **replaced rather than removed**: every version stays,
  numbered, with who replaced it and why.
- **Correction and resubmission.** A request sent back keeps its request number
  and gains a new version; the earlier version's fields, items and documents all
  remain on record, and no approver can move it while it is with the requester.
- **Departmental budget provision** for the year, declared by the head of the
  department with its sanction letter attached. What has been sanctioned and
  what is committed are computed from the requests themselves, never typed in,
  and are shown to whoever is reviewing a request.
- A **formal report** per request — request, items, budget, documents, the
  workflow as a narrative, resubmissions, audit trail, and the route the
  request actually took — printable to PDF and openable in Word.
- Unfinished requests **carry forward** to a later financial year, keeping the
  original request, its history and its signatures.
- Faculty issues: free text, deliberately lightweight, routed to the Principal,
  who can assign, escalate or resolve them.
- Inventory records and purchase bills, bills linked to approved requests.
- Notifications when a request reaches someone and when a decision is made.
- Dashboards, spending by budget head, a "pending more than 3 days" view, CSV
  export, and an append-only audit log.

## Non-functional requirements

- **Access control in the database, not only the interface.** Row-Level Security
  decides what each person can see; the application cannot widen it.
- Approval authority comes from stage staffing, never from a role list in code.
- Money is computed in SQL, where `NUMERIC` is exact, and displayed with Indian
  digit grouping (₹6,50,000.50).
- Responsive interface, usable on desktop and mobile widths.
- Files are stored outside the database; only their metadata is recorded.
- Runs on the college's own Windows server: PostgreSQL, a Node service, and
  static files behind IIS.
- Dependencies, build output and environment files are never committed.

## Current scope

Implemented: the database (`db/`), the REST API (`server/`), and the interface
(`src/`) connected to it. See `readme.md` for how to run all three.

Not yet built:

- **The fulfilment and closing steps** after a request is approved.
- **Deployment** to the college server.

## Open questions

1. May the Purchase Committee **reject** a request outright? It cannot approve
   one, and the Principal is meant to see every request — which a rejection at
   the committee would prevent. The code currently allows it.
2. What happens when the two members of a joint stage **disagree**, or when one
   of them rejects? Neither `decisions.md` nor the requirements say, and the
   code currently lets the second decision overwrite the first's item figures.
3. Does `budget_heads.head_type` replace `budget_items.item_type`, or sit
   alongside it?
4. Should a request that is **carried forward** resume at the stage it left off
   at, as it does now, or start again from the Purchase Committee in the new
   financial year?
