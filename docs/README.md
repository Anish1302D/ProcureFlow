# Documentation

Three reference pages, each standalone HTML — open them directly in a browser.
They fetch fonts (and, for the diagrams page, Mermaid) from a CDN on first load,
so the first open needs an internet connection.

## Where to start

| If you want to | Read |
|---|---|
| Understand the data model and the workflow | **Schema Plates** |
| Work on the API | **Backend Build Plan**, §2 first |
| Work on email notifications | **No-Reply Mail Plan**, §3 first |
| Run the system | `readme.md` at the repository root |
| Know what each part does | `db/README.md`, `server/README.md` |
| See what happened and why | `AI_LOGS.md` |

## Schema Plates

`ApprovalHub_Schema_Plates.html` — the design reference for the database. Six
diagrams (use case, approval workflow, entity relationships, class model,
request lifecycle, escalation sequence), the rules the schema enforces, and a
module-by-module file reference.

The diagram sources are in `diagrams/*.mmd`, one per diagram, and render
anywhere Mermaid is supported (GitHub, mermaid.live, VS Code).

| File | Diagram |
|---|---|
| `01_use_case.mmd` | Use case — six actors, twenty use cases |
| `02_erd.mmd` | Entity relationships — the full relational model |
| `03_class.mmd` | Class model, including the workflow engine |
| `04_state.mmd` | Request lifecycle — all fourteen states |
| `05_sequence.mmd` | Escalation of a ₹6,00,000 request to Chairman + Vice Chairman |
| `06_workflow.mmd` | Approval workflow — routing and escalation |

## Backend Build Plan

`ApprovalHub_Backend_Plan.html` — why the API has no ORM, the `withUser`
primitive that makes Row-Level Security work, all endpoints, error mapping, and
the build order. Written before the API existed; the API now follows it, and
`server/README.md` is the up-to-date reference.

**Read §2 before writing any data-access code.** The `SET LOCAL` versus `SET`
distinction there is the difference between working access control and one
person seeing another's requests.

## No-Reply Mail Plan

`ApprovalHub_Mail_Plan.html` — how the system will send email: the no-reply
sender and its headers, the outbox and worker that keep mail from ever delaying
or contradicting an approval, recipient rules, all 29 templates from the email
specification checked against what the system can trigger today, provider and
DNS setup, and the decisions still needed.

**Read §3 first.** It lists where the email specification and the built system
disagree — including four templates that cannot be sent until the workflow
gains the steps they describe.

Nothing in this plan is built yet.
