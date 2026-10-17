-- Non-financial issues raised by faculty. Intentionally lightweight per the
-- requirements doc: free text + optional attachments, routed to Principal.

CREATE TABLE issues (
    issue_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_number        TEXT NOT NULL UNIQUE,      -- 'ISS-0007'
    raised_by           UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    status              issue_status NOT NULL DEFAULT 'SUBMITTED',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ
);

CREATE INDEX issues_status_idx     ON issues(status);
CREATE INDEX issues_raised_by_idx  ON issues(raised_by);

CREATE TABLE issue_events (
    event_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id     UUID NOT NULL REFERENCES issues(issue_id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    action       TEXT NOT NULL,     -- 'CREATED', 'IN_REVIEW', 'ASSIGNED', 'ESCALATED', 'RESOLVED', 'COMMENT'
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX issue_events_issue_idx ON issue_events(issue_id, created_at);

ALTER TABLE notifications
    ADD CONSTRAINT notifications_issue_fk
    FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE;

ALTER TABLE attachments
    ADD CONSTRAINT attachments_issue_fk
    FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE;

-- Annual departmental budget provision table
CREATE TABLE budget_provisions (
    budget_provision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id       INTEGER NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT,
    financial_year_id   INTEGER NOT NULL REFERENCES financial_years(financial_year_id) ON DELETE RESTRICT,
    budget_head_id      INTEGER REFERENCES budget_heads(budget_head_id) ON DELETE RESTRICT,
    allocated_amount    NUMERIC(14,2) NOT NULL CHECK (allocated_amount >= 0),
    remarks             TEXT,
    created_by          UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX budget_provisions_dept_fy_head_uq
    ON budget_provisions (department_id, financial_year_id, COALESCE(budget_head_id, -1));

CREATE INDEX budget_provisions_dept_idx ON budget_provisions(department_id);
CREATE INDEX budget_provisions_fy_idx   ON budget_provisions(financial_year_id);

ALTER TABLE attachments
    ADD CONSTRAINT attachments_budget_provision_fk
    FOREIGN KEY (budget_provision_id) REFERENCES budget_provisions(budget_provision_id) ON DELETE CASCADE;
