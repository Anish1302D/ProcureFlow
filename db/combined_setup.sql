-- Extensions required by the schema.
-- Run once per database.

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive text (emails, codes)

-- Enumerated types.
-- Keep all controlled vocabularies here so they are easy to find and evolve.

CREATE TYPE budget_head_type AS ENUM ('REVENUE', 'CAPITAL');

CREATE TYPE budget_item_type AS ENUM ('CONSUMABLE', 'CAPITAL', 'REVENUE');

CREATE TYPE request_status AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_PURCHASE_COMMITTEE_REVIEW',
    'UNDER_PRINCIPAL_REVIEW',
    'UNDER_CDC_REVIEW',
    'UNDER_FINAL_AUTHORITY_REVIEW',
    'APPROVED',
    'PARTIALLY_APPROVED',
    'REJECTED',
    'ESCALATED',
    'FULFILMENT_PENDING',
    'FULFILLED',
    'CLOSED',
    'CARRIED_FORWARD'
);

CREATE TYPE request_item_status AS ENUM (
    'PENDING',
    'APPROVED',
    'PARTIALLY_APPROVED',
    'REJECTED'
);

CREATE TYPE approval_action_type AS ENUM (
    'SUBMIT',
    'APPROVE',
    'PARTIAL_APPROVE',
    'REJECT',
    'ESCALATE',
    'FORWARD',
    'RETURN',
    'COMMENT',
    'CARRY_FORWARD',
    'CLOSE'
);

CREATE TYPE workflow_stage_code AS ENUM (
    'PURCHASE_COMMITTEE',
    'PRINCIPAL',
    'CDC',
    'FINAL_AUTHORITY'
);

CREATE TYPE comment_visibility AS ENUM (
    'ALL',          -- everyone who can see the request
    'UP_CHAIN',     -- current stage and above only
    'STAGE_ONLY'    -- only the stage that authored it
);

CREATE TYPE notification_channel AS ENUM ('IN_APP', 'EMAIL');

CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'READ', 'FAILED');

CREATE TYPE issue_status AS ENUM (
    'SUBMITTED',
    'IN_REVIEW',
    'ESCALATED',
    'RESOLVED',
    'CLOSED'
);

-- Master data: users, roles, org structure, budgets, financial years.
-- These tables are seeded once and change rarely.

CREATE TABLE roles (
    role_id      SERIAL PRIMARY KEY,
    code         TEXT NOT NULL UNIQUE,          -- e.g. 'PRINCIPAL', 'CDC_GRANT_MEMBER'
    name         TEXT NOT NULL,
    description  TEXT
);

CREATE TABLE users (
    user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          CITEXT NOT NULL UNIQUE,
    full_name      TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_roles (
    user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_id    INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE departments (
    department_id SERIAL PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL
);

CREATE TABLE courses (
    course_id      SERIAL PRIMARY KEY,
    department_id  INTEGER NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT,
    code           TEXT NOT NULL,
    name           TEXT NOT NULL,
    UNIQUE (department_id, code)
);

CREATE TABLE financial_years (
    financial_year_id SERIAL PRIMARY KEY,
    label             TEXT NOT NULL UNIQUE,        -- '2026-27'
    start_date        DATE NOT NULL,
    end_date          DATE NOT NULL,
    is_active         BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (end_date > start_date)
);

-- Only one active FY at a time.
CREATE UNIQUE INDEX financial_years_only_one_active
    ON financial_years ((is_active)) WHERE is_active;

CREATE TABLE budget_heads (
    budget_head_id SERIAL PRIMARY KEY,
    code           TEXT NOT NULL UNIQUE,
    name           TEXT NOT NULL,
    head_type      budget_head_type NOT NULL,     -- REVENUE | CAPITAL (per Madhuri Mam)
    description    TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE budget_items (
    budget_item_id SERIAL PRIMARY KEY,
    budget_head_id INTEGER NOT NULL REFERENCES budget_heads(budget_head_id) ON DELETE RESTRICT,
    code           TEXT NOT NULL,
    name           TEXT NOT NULL,
    item_type      budget_item_type NOT NULL,     -- CONSUMABLE | CAPITAL | REVENUE
    unit           TEXT,                          -- 'piece', 'litre', ...
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (budget_head_id, code)
);

CREATE INDEX budget_items_head_idx ON budget_items(budget_head_id);

-- Workflow engine: configurable stages, per-stage approvers, amount-based routing.
-- Roles are data; adding a CDC member is INSERT INTO stage_approvers, not a code change.

CREATE TABLE workflow_stages (
    stage_id     SERIAL PRIMARY KEY,
    code         workflow_stage_code NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    sequence_no  INTEGER NOT NULL UNIQUE,      -- order in the chain
    is_final     BOOLEAN NOT NULL DEFAULT FALSE
);

-- Amount-based routing rules. A request enters the first stage whose
-- [min_amount, max_amount) window contains the requested total, and
-- escalates upward from there.
CREATE TABLE stage_routing_rules (
    rule_id      SERIAL PRIMARY KEY,
    stage_id     INTEGER NOT NULL REFERENCES workflow_stages(stage_id) ON DELETE CASCADE,
    min_amount   NUMERIC(14,2) NOT NULL,       -- inclusive
    max_amount   NUMERIC(14,2),                -- exclusive; NULL = no upper bound
    CHECK (min_amount >= 0),
    CHECK (max_amount IS NULL OR max_amount > min_amount)
);

-- Users who can act at a given stage. A stage may have many approvers.
CREATE TABLE stage_approvers (
    stage_id  INTEGER NOT NULL REFERENCES workflow_stages(stage_id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_id   INTEGER REFERENCES roles(role_id),
    PRIMARY KEY (stage_id, user_id)
);

CREATE INDEX stage_approvers_user_idx ON stage_approvers(user_id);

-- Financial requests + line items. Item-level and quantity-level partial
-- approval preserved; originals are never overwritten.

CREATE TABLE requests (
    request_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_number        TEXT NOT NULL UNIQUE,       -- human-readable 'REQ-1024'
    raised_by             UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    department_id         INTEGER REFERENCES departments(department_id),
    course_id             INTEGER REFERENCES courses(course_id),
    financial_year_id     INTEGER NOT NULL REFERENCES financial_years(financial_year_id),
    budget_head_id        INTEGER NOT NULL REFERENCES budget_heads(budget_head_id),
    title                 TEXT NOT NULL,
    description           TEXT,
    tentative_total_cost  NUMERIC(14,2) NOT NULL CHECK (tentative_total_cost >= 0),
    sanctioned_amount     NUMERIC(14,2) CHECK (sanctioned_amount IS NULL OR sanctioned_amount >= 0),
    current_status        request_status NOT NULL DEFAULT 'DRAFT',
    current_stage_id      INTEGER REFERENCES workflow_stages(stage_id),
    extra                 JSONB NOT NULL DEFAULT '{}'::jsonb,  -- brand pref, urgency, specs...
    carried_forward_from_request_id UUID REFERENCES requests(request_id),
    carried_forward_from_fy_id      INTEGER REFERENCES financial_years(financial_year_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at  TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at     TIMESTAMPTZ,
    CHECK (sanctioned_amount IS NULL OR sanctioned_amount <= tentative_total_cost)
);

CREATE INDEX requests_status_idx        ON requests(current_status);
CREATE INDEX requests_stage_idx         ON requests(current_stage_id);
CREATE INDEX requests_raised_by_idx     ON requests(raised_by);
CREATE INDEX requests_fy_idx            ON requests(financial_year_id);
CREATE INDEX requests_budget_head_idx   ON requests(budget_head_id);

CREATE TABLE request_items (
    request_item_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id           UUID NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
    budget_item_id       INTEGER NOT NULL REFERENCES budget_items(budget_item_id) ON DELETE RESTRICT,
    item_type_snapshot   budget_item_type NOT NULL,   -- frozen at request time
    requested_quantity   NUMERIC(12,2) NOT NULL,
    estimated_unit_cost  NUMERIC(14,2) NOT NULL,
    estimated_total      NUMERIC(14,2) NOT NULL,
    approved_quantity    NUMERIC(12,2) NOT NULL DEFAULT 0,
    approved_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    item_status          request_item_status NOT NULL DEFAULT 'PENDING',
    remarks              TEXT,
    -- Madhuri Mam: requested quantity must be > 0.
    CHECK (requested_quantity > 0),
    CHECK (estimated_unit_cost >= 0),
    CHECK (estimated_total >= 0),
    CHECK (approved_quantity >= 0 AND approved_quantity <= requested_quantity),
    CHECK (approved_amount >= 0 AND approved_amount <= estimated_total)
);

CREATE INDEX request_items_request_idx ON request_items(request_id);
CREATE INDEX request_items_status_idx  ON request_items(item_status);

-- Every decision taken on a request lands here. The full life of a request
-- is reconstructable from these rows (plus comments and audit_logs).

CREATE TABLE digital_signatures (
    signature_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    signed_hash   TEXT NOT NULL,               -- signature payload / hash
    signed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE approval_actions (
    action_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id           UUID NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
    stage_id             INTEGER REFERENCES workflow_stages(stage_id),
    performed_by         UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    action               approval_action_type NOT NULL,
    previous_status      request_status,
    new_status           request_status,
    amount_requested_snapshot NUMERIC(14,2),   -- request total at moment of action
    amount_approved      NUMERIC(14,2),
    rejection_reason     TEXT,
    comments             TEXT,
    signature_id         UUID REFERENCES digital_signatures(signature_id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX approval_actions_request_idx  ON approval_actions(request_id, created_at);
CREATE INDEX approval_actions_stage_idx    ON approval_actions(stage_id);
CREATE INDEX approval_actions_actor_idx    ON approval_actions(performed_by);

-- Targets for the composite foreign keys below. Both columns are already
-- unique on their own; these let a child row reference the pair.
ALTER TABLE approval_actions
    ADD CONSTRAINT approval_actions_id_request_uq UNIQUE (action_id, request_id);

ALTER TABLE request_items
    ADD CONSTRAINT request_items_id_request_uq UNIQUE (request_item_id, request_id);

-- Per-item decisions inside a single action, so partial approval is recorded
-- at both request-level (in approval_actions) and item-level (here).
--
-- request_id is carried here deliberately. Without it, nothing stops a
-- decision recorded against request A from pointing at a line item belonging
-- to request B. The two composite foreign keys below force the action and the
-- item to agree on which request they belong to.
CREATE TABLE approval_action_items (
    action_id           UUID NOT NULL,
    request_item_id     UUID NOT NULL,
    request_id          UUID NOT NULL,
    approved_quantity   NUMERIC(12,2) NOT NULL,
    approved_amount     NUMERIC(14,2) NOT NULL,
    item_decision       request_item_status NOT NULL,
    remarks             TEXT,
    PRIMARY KEY (action_id, request_item_id),
    FOREIGN KEY (action_id, request_id)
        REFERENCES approval_actions(action_id, request_id) ON DELETE CASCADE,
    FOREIGN KEY (request_item_id, request_id)
        REFERENCES request_items(request_item_id, request_id) ON DELETE CASCADE,
    CHECK (approved_quantity >= 0),
    CHECK (approved_amount   >= 0)
);

CREATE INDEX approval_action_items_item_idx    ON approval_action_items(request_item_id);
CREATE INDEX approval_action_items_request_idx ON approval_action_items(request_id);

-- Threaded comments (with visibility scope) and notifications.
-- Visibility rule: CDC comments shouldn't leak down to Purchase Committee / Head
-- by default; UP_CHAIN restricts to current stage and above.

CREATE TABLE comments (
    comment_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id         UUID NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
    author_user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    stage_id           INTEGER REFERENCES workflow_stages(stage_id),
    parent_comment_id  UUID REFERENCES comments(comment_id) ON DELETE CASCADE,
    body               TEXT NOT NULL,
    visibility         comment_visibility NOT NULL DEFAULT 'ALL',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX comments_request_idx ON comments(request_id, created_at);
CREATE INDEX comments_parent_idx  ON comments(parent_comment_id);

CREATE TABLE notifications (
    notification_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    request_id       UUID REFERENCES requests(request_id) ON DELETE CASCADE,
    issue_id         UUID,                              -- FK added in 08_non_financial.sql
    channel          notification_channel NOT NULL DEFAULT 'IN_APP',
    subject          TEXT NOT NULL,
    body             TEXT,
    status           notification_status NOT NULL DEFAULT 'PENDING',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at          TIMESTAMPTZ,
    read_at          TIMESTAMPTZ
);

CREATE INDEX notifications_user_idx    ON notifications(user_id, status);
CREATE INDEX notifications_request_idx ON notifications(request_id);

-- Audit log + attachment metadata. Files themselves live in object storage;
-- only the pointer + metadata is stored here.

CREATE TABLE attachments (
    attachment_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id      UUID REFERENCES requests(request_id) ON DELETE CASCADE,
    action_id       UUID REFERENCES approval_actions(action_id) ON DELETE SET NULL,
    issue_id        UUID,                                  -- FK added in 08_non_financial.sql
    file_name       TEXT NOT NULL,
    mime_type       TEXT,
    size_bytes      BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    storage_path    TEXT NOT NULL,                         -- key in S3/MinIO/local
    uploaded_by     UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX attachments_request_idx ON attachments(request_id);
CREATE INDEX attachments_action_idx  ON attachments(action_id);

-- Generic audit log for anything worth tracing beyond the domain-level
-- approval_actions (login, permission changes, master-data edits, etc.).
CREATE TABLE audit_logs (
    audit_id      BIGSERIAL PRIMARY KEY,
    entity_type   TEXT NOT NULL,          -- 'request', 'user', 'budget_head', ...
    entity_id     TEXT,                   -- store as text to accept any PK shape
    actor_user_id UUID REFERENCES users(user_id) ON DELETE SET NULL,
    action        TEXT NOT NULL,          -- 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', ...
    before_json   JSONB,
    after_json    JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX audit_logs_actor_idx  ON audit_logs(actor_user_id);
CREATE INDEX audit_logs_time_idx   ON audit_logs(created_at DESC);

-- Non-financial issues raised by faculty. Intentionally lightweight per the
-- requirements doc: free text + optional attachments, routed to Principal.

CREATE TABLE issues (
    issue_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_number        TEXT NOT NULL UNIQUE,      -- 'ISS-0007'
    raised_by           UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    assigned_to         UUID REFERENCES users(user_id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL,
    status              issue_status NOT NULL DEFAULT 'SUBMITTED',
    escalated_at        TIMESTAMPTZ,
    escalated_to        UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at         TIMESTAMPTZ
);

CREATE INDEX issues_status_idx     ON issues(status);
CREATE INDEX issues_raised_by_idx  ON issues(raised_by);
CREATE INDEX issues_assigned_idx   ON issues(assigned_to);

CREATE TABLE issue_events (
    event_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id     UUID NOT NULL REFERENCES issues(issue_id) ON DELETE CASCADE,
    actor_user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    action       TEXT NOT NULL,     -- 'CREATED', 'IN_REVIEW', 'ASSIGNED', 'ESCALATED', 'RESOLVED', 'COMMENT'
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX issue_events_issue_idx ON issue_events(issue_id, created_at);

-- Now that issues exists, wire up the deferred foreign keys.
ALTER TABLE notifications
    ADD CONSTRAINT notifications_issue_fk
    FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE;

ALTER TABLE attachments
    ADD CONSTRAINT attachments_issue_fk
    FOREIGN KEY (issue_id) REFERENCES issues(issue_id) ON DELETE CASCADE;

-- Inventory + purchase bills. Linked back to the request that procured them.

CREATE TABLE purchase_bills (
    bill_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id    UUID REFERENCES requests(request_id) ON DELETE SET NULL,
    bill_number   TEXT NOT NULL,
    vendor_name   TEXT,
    bill_date     DATE,
    bill_amount   NUMERIC(14,2) NOT NULL CHECK (bill_amount >= 0),
    attachment_id UUID REFERENCES attachments(attachment_id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (bill_number, vendor_name)
);

CREATE INDEX purchase_bills_request_idx ON purchase_bills(request_id);

CREATE TABLE inventory_items (
    inventory_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_item_id   INTEGER REFERENCES budget_items(budget_item_id) ON DELETE SET NULL,
    request_id       UUID REFERENCES requests(request_id) ON DELETE SET NULL,
    bill_id          UUID REFERENCES purchase_bills(bill_id) ON DELETE SET NULL,
    department_id    INTEGER REFERENCES departments(department_id),
    name             TEXT NOT NULL,
    quantity         NUMERIC(12,2) NOT NULL CHECK (quantity >= 0),
    unit             TEXT,
    condition        TEXT,                     -- 'NEW', 'GOOD', 'DAMAGED', ...
    location         TEXT,
    acquired_on      DATE,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX inventory_items_request_idx    ON inventory_items(request_id);
CREATE INDEX inventory_items_department_idx ON inventory_items(department_id);

-- Keep updated_at columns fresh automatically.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER requests_set_updated_at
    BEFORE UPDATE ON requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER issues_set_updated_at
    BEFORE UPDATE ON issues
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER inventory_items_set_updated_at
    BEFORE UPDATE ON inventory_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- requests.sanctioned_amount is derived: it is always the sum of what was
-- approved across the request's line items. Keeping it as a stored column
-- makes dashboards and reports cheap, but a stored derived value drifts the
-- moment anything writes an item without recomputing it. This trigger makes
-- that impossible â€” the total is maintained by the database, not the caller.
CREATE OR REPLACE FUNCTION fn_sync_sanctioned_amount()
RETURNS TRIGGER AS $$
DECLARE
    v_request_id UUID;
BEGIN
    v_request_id := COALESCE(NEW.request_id, OLD.request_id);

    UPDATE requests r
       SET sanctioned_amount = sub.total
      FROM (
            SELECT COALESCE(SUM(approved_amount), 0) AS total
            FROM request_items
            WHERE request_id = v_request_id
           ) sub
     WHERE r.request_id = v_request_id
       AND r.sanctioned_amount IS DISTINCT FROM sub.total;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER request_items_sync_sanctioned
    AFTER INSERT OR DELETE OR UPDATE OF approved_amount ON request_items
    FOR EACH ROW EXECUTE FUNCTION fn_sync_sanctioned_amount();

-- Reporting / dashboard views. Read-only convenience layer over base tables.
--
-- Every view is security_invoker. By default a Postgres view reads its base
-- tables with the privileges of the view's OWNER â€” here the superuser, which
-- bypasses Row-Level Security. Without this option any user querying a view
-- would see every request in the college, including other people's drafts.

-- Every open request with the age (days since submission).
CREATE OR REPLACE VIEW v_pending_requests
    WITH (security_invoker = true) AS
SELECT
    r.request_id,
    r.request_number,
    r.title,
    r.raised_by,
    u.full_name           AS raised_by_name,
    r.financial_year_id,
    fy.label              AS financial_year,
    r.budget_head_id,
    bh.name               AS budget_head,
    r.current_status,
    r.current_stage_id,
    ws.code               AS current_stage_code,
    ws.name               AS current_stage_name,
    r.tentative_total_cost,
    r.sanctioned_amount,
    r.submitted_at,
    EXTRACT(DAY FROM NOW() - COALESCE(r.submitted_at, r.created_at))::INT AS days_pending
FROM requests r
JOIN users u                    ON u.user_id = r.raised_by
LEFT JOIN financial_years fy    ON fy.financial_year_id = r.financial_year_id
LEFT JOIN budget_heads bh       ON bh.budget_head_id = r.budget_head_id
LEFT JOIN workflow_stages ws    ON ws.stage_id = r.current_stage_id
WHERE r.current_status NOT IN ('APPROVED','REJECTED','FULFILLED','CLOSED','CARRIED_FORWARD');

-- "Pending intelligence" â€” anything sitting untouched for more than 3 days.
CREATE OR REPLACE VIEW v_pending_gt_3_days
    WITH (security_invoker = true) AS
SELECT *
FROM v_pending_requests
WHERE days_pending > 3;

-- Dashboard counters by financial year.
CREATE OR REPLACE VIEW v_dashboard_by_fy
    WITH (security_invoker = true) AS
SELECT
    r.financial_year_id,
    fy.label AS financial_year,
    COUNT(*)                                                          AS total,
    COUNT(*) FILTER (WHERE r.current_status = 'APPROVED')             AS approved,
    COUNT(*) FILTER (WHERE r.current_status = 'REJECTED')             AS rejected,
    COUNT(*) FILTER (WHERE r.current_status = 'PARTIALLY_APPROVED')   AS partial,
    COUNT(*) FILTER (WHERE r.current_status = 'ESCALATED')            AS escalated,
    COUNT(*) FILTER (WHERE r.current_status IN (
        'SUBMITTED',
        'UNDER_PURCHASE_COMMITTEE_REVIEW',
        'UNDER_PRINCIPAL_REVIEW',
        'UNDER_CDC_REVIEW',
        'UNDER_FINAL_AUTHORITY_REVIEW'
    ))                                                                AS pending,
    COUNT(*) FILTER (WHERE r.current_status IN ('FULFILMENT_PENDING','FULFILLED')) AS fulfilment,
    COUNT(*) FILTER (WHERE r.current_status = 'CARRIED_FORWARD')      AS carried_forward
FROM requests r
LEFT JOIN financial_years fy ON fy.financial_year_id = r.financial_year_id
GROUP BY r.financial_year_id, fy.label;

-- Timeline for a single request: chronological approval actions.
CREATE OR REPLACE VIEW v_request_timeline
    WITH (security_invoker = true) AS
SELECT
    a.action_id,
    a.request_id,
    r.request_number,
    a.created_at,
    ws.code            AS stage_code,
    ws.name            AS stage_name,
    a.action,
    a.previous_status,
    a.new_status,
    a.amount_requested_snapshot,
    a.amount_approved,
    a.rejection_reason,
    a.comments,
    u.full_name        AS performed_by_name,
    a.signature_id
FROM approval_actions a
JOIN requests r              ON r.request_id = a.request_id
LEFT JOIN workflow_stages ws ON ws.stage_id = a.stage_id
JOIN users u                 ON u.user_id = a.performed_by
ORDER BY a.request_id, a.created_at;

-- Roll-up of item-level decisions for a request.
CREATE OR REPLACE VIEW v_request_items_summary
    WITH (security_invoker = true) AS
SELECT
    ri.request_id,
    COUNT(*)                                                       AS total_items,
    COUNT(*) FILTER (WHERE ri.item_status = 'APPROVED')            AS items_approved,
    COUNT(*) FILTER (WHERE ri.item_status = 'PARTIALLY_APPROVED')  AS items_partial,
    COUNT(*) FILTER (WHERE ri.item_status = 'REJECTED')            AS items_rejected,
    COUNT(*) FILTER (WHERE ri.item_status = 'PENDING')             AS items_pending,
    SUM(ri.estimated_total)  AS total_requested_amount,
    SUM(ri.approved_amount)  AS total_approved_amount
FROM request_items ri
GROUP BY ri.request_id;

-- Helper functions the app can call so complex writes are one round-trip
-- and stay consistent even if two users act concurrently.

-- Picks the workflow stage a request should enter, based on total amount.
CREATE OR REPLACE FUNCTION fn_route_stage(p_amount NUMERIC)
RETURNS INTEGER AS $$
    SELECT srr.stage_id
    FROM stage_routing_rules srr
    WHERE srr.min_amount <= p_amount
      AND (srr.max_amount IS NULL OR p_amount < srr.max_amount)
    ORDER BY srr.min_amount DESC
    LIMIT 1;
$$ LANGUAGE sql STABLE;

-- The "sitting at this stage" status for a given stage. Used by both
-- fn_submit_request and fn_record_action so the mapping lives in one place.
CREATE OR REPLACE FUNCTION fn_stage_status(p_code workflow_stage_code)
RETURNS request_status AS $$
    SELECT (CASE p_code
        WHEN 'PURCHASE_COMMITTEE' THEN 'UNDER_PURCHASE_COMMITTEE_REVIEW'
        WHEN 'PRINCIPAL'          THEN 'UNDER_PRINCIPAL_REVIEW'
        WHEN 'CDC'                THEN 'UNDER_CDC_REVIEW'
        WHEN 'FINAL_AUTHORITY'    THEN 'UNDER_FINAL_AUTHORITY_REVIEW'
    END)::request_status;
$$ LANGUAGE sql IMMUTABLE;

-- The stage directly above a given stage, or NULL if it is the top.
CREATE OR REPLACE FUNCTION fn_next_stage(p_stage_id INTEGER)
RETURNS INTEGER AS $$
    SELECT ws.stage_id
    FROM workflow_stages ws
    WHERE ws.sequence_no > (SELECT sequence_no FROM workflow_stages WHERE stage_id = p_stage_id)
    ORDER BY ws.sequence_no
    LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Moves a DRAFT request into the correct entry stage and stamps submitted_at.
CREATE OR REPLACE FUNCTION fn_submit_request(p_request_id UUID)
RETURNS VOID AS $$
DECLARE
    v_amount NUMERIC(14,2);
    v_stage  INTEGER;
    v_status request_status;
BEGIN
    SELECT tentative_total_cost, current_status
      INTO v_amount, v_status
    FROM requests
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Request % is not in DRAFT state (current=%)', p_request_id, v_status
            USING ERRCODE = 'SP011';
    END IF;

    v_stage := fn_route_stage(v_amount);
    IF v_stage IS NULL THEN
        RAISE EXCEPTION 'No routing rule matches amount %', v_amount
            USING ERRCODE = 'SP012';
    END IF;

    UPDATE requests
       SET current_status   = fn_stage_status((SELECT code FROM workflow_stages WHERE stage_id = v_stage)),
           current_stage_id = v_stage,
           submitted_at     = COALESCE(submitted_at, NOW())
     WHERE request_id = p_request_id;

    INSERT INTO approval_actions (request_id, stage_id, performed_by, action,
                                  previous_status, new_status,
                                  amount_requested_snapshot)
    SELECT p_request_id, v_stage, raised_by, 'SUBMIT',
           'DRAFT', current_status, tentative_total_cost
    FROM requests WHERE request_id = p_request_id;
END;
$$ LANGUAGE plpgsql;

-- Carries an unfinished request into the next financial year, preserving
-- the original row and pointing back to it. Nothing is overwritten.
CREATE OR REPLACE FUNCTION fn_carry_forward_request(
    p_request_id   UUID,
    p_new_fy_id    INTEGER,
    p_actor_id     UUID
) RETURNS UUID AS $$
DECLARE
    v_new_id UUID;
    v_src    requests%ROWTYPE;
BEGIN
    -- Same rule as fn_record_action: the recorded actor must be the session user.
    IF app_current_user_id() IS NOT NULL
       AND p_actor_id IS DISTINCT FROM app_current_user_id() THEN
        RAISE EXCEPTION 'Actor % does not match the authenticated user', p_actor_id
            USING ERRCODE = 'SP013';
    END IF;

    SELECT * INTO v_src FROM requests WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request % not found', p_request_id
            USING ERRCODE = 'SP001';
    END IF;

    -- Only unfinished work carries forward. A decided or already-moved request
    -- has nothing left to continue.
    IF v_src.current_status IN ('REJECTED','CLOSED','FULFILLED','CARRIED_FORWARD') THEN
        RAISE EXCEPTION 'Request % cannot be carried forward (status = %)',
            v_src.request_number, v_src.current_status
            USING ERRCODE = 'SP014';
    END IF;

    IF (SELECT start_date FROM financial_years WHERE financial_year_id = p_new_fy_id)
       <= (SELECT start_date FROM financial_years WHERE financial_year_id = v_src.financial_year_id) THEN
        RAISE EXCEPTION 'Target financial year must be later than the request''s current year'
            USING ERRCODE = 'SP015';
    END IF;

    INSERT INTO requests (
        request_number, raised_by, department_id, course_id,
        financial_year_id, budget_head_id, title, description,
        tentative_total_cost, current_status, current_stage_id,
        extra,
        carried_forward_from_request_id, carried_forward_from_fy_id
    )
    SELECT
        r.request_number || '-CF',
        r.raised_by, r.department_id, r.course_id,
        p_new_fy_id, r.budget_head_id, r.title, r.description,
        r.tentative_total_cost, r.current_status, r.current_stage_id,
        r.extra,
        r.request_id, r.financial_year_id
    FROM requests r WHERE r.request_id = p_request_id
    RETURNING request_id INTO v_new_id;

    -- Copy line items so they're editable in the new context.
    INSERT INTO request_items (
        request_id, budget_item_id, item_type_snapshot,
        requested_quantity, estimated_unit_cost, estimated_total,
        approved_quantity, approved_amount, item_status, remarks
    )
    SELECT v_new_id, budget_item_id, item_type_snapshot,
           requested_quantity, estimated_unit_cost, estimated_total,
           approved_quantity, approved_amount, item_status, remarks
    FROM request_items WHERE request_id = p_request_id;

    -- Mark the original as CARRIED_FORWARD.
    UPDATE requests
       SET current_status = 'CARRIED_FORWARD',
           closed_at      = NOW()
     WHERE request_id = p_request_id;

    INSERT INTO approval_actions (request_id, performed_by, action,
                                  previous_status, new_status,
                                  comments)
    VALUES (p_request_id, p_actor_id, 'CARRY_FORWARD',
            (SELECT current_status FROM requests WHERE request_id = v_new_id),
            'CARRIED_FORWARD',
            'Carried forward to request ' || v_new_id::text);

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;

-- fn_record_action â€” the single entry point for every approval decision.
--
-- One call does all of it atomically: authority check, signature, the
-- approval_actions row, per-item decisions, item status updates, the
-- recomputed request status, and the audit log entry. Callers should never
-- write approval_actions by hand â€” doing it in separate statements is how a
-- request ends up half-decided when something fails midway.
--
-- p_item_decisions is a JSON array, one object per line item being decided:
--   [{"request_item_id": "...", "approved_quantity": 2,
--     "approved_amount": 20000, "remarks": "optional"}]
--
-- Omitting it on an APPROVE approves every item in full. Omitting it on a
-- PARTIAL_APPROVE is an error â€” a partial approval has to say what was cut.

CREATE OR REPLACE FUNCTION fn_record_action(
    p_request_id        UUID,
    p_actor_id          UUID,
    p_action            approval_action_type,
    p_item_decisions    JSONB DEFAULT NULL,
    p_comments          TEXT  DEFAULT NULL,
    p_rejection_reason  TEXT  DEFAULT NULL,
    p_signature_hash    TEXT  DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_req          requests%ROWTYPE;
    v_stage_code   workflow_stage_code;
    v_is_final     BOOLEAN;
    v_next_stage   INTEGER;
    v_action_id    UUID;
    v_signature_id UUID;
    v_new_status   request_status;
    v_new_stage    INTEGER;
    v_total        INTEGER;
    v_approved     INTEGER;
    v_rejected     INTEGER;
    v_decided      INTEGER;
BEGIN
    -- The authority check below tests p_actor_id against the approver list. If
    -- that parameter could differ from the logged-in session, a requester could
    -- pass an approver's id and approve their own request â€” every RLS policy
    -- would pass, because they own the row. So when a session identity is set,
    -- the actor must be that identity. (No identity is set for maintenance run
    -- directly as a superuser, which RLS does not govern anyway.)
    IF app_current_user_id() IS NOT NULL
       AND p_actor_id IS DISTINCT FROM app_current_user_id() THEN
        RAISE EXCEPTION 'Actor % does not match the authenticated user', p_actor_id
            USING ERRCODE = 'SP013';
    END IF;

    -- Lock the request so two approvers acting at once can't interleave.
    SELECT * INTO v_req FROM requests WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        -- Under RLS, FOR UPDATE sees only rows the caller may UPDATE. A caller
        -- who can read the request but not act on it (an approver it has moved
        -- past, or the Principal reading a CDC request) lands here too. Tell
        -- them they lack authority rather than claiming the request is missing.
        IF EXISTS (SELECT 1 FROM requests WHERE request_id = p_request_id) THEN
            RAISE EXCEPTION 'User % is not an approver at the current stage of this request', p_actor_id
                USING ERRCODE = 'SP004';
        END IF;
        RAISE EXCEPTION 'Request % not found', p_request_id
            USING ERRCODE = 'SP001';
    END IF;

    IF v_req.current_stage_id IS NULL THEN
        RAISE EXCEPTION 'Request % is not at a review stage (status = %)',
            v_req.request_number, v_req.current_status
            USING ERRCODE = 'SP002';
    END IF;

    IF v_req.current_status IN ('APPROVED','REJECTED','FULFILLED','CLOSED','CARRIED_FORWARD') THEN
        RAISE EXCEPTION 'Request % is already closed (status = %)',
            v_req.request_number, v_req.current_status
            USING ERRCODE = 'SP003';
    END IF;

    SELECT code, is_final INTO v_stage_code, v_is_final
    FROM workflow_stages WHERE stage_id = v_req.current_stage_id;

    -- Authority: the actor must be a configured approver at the current stage.
    IF NOT EXISTS (
        SELECT 1 FROM stage_approvers
        WHERE stage_id = v_req.current_stage_id AND user_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'User % is not an approver at stage %', p_actor_id, v_stage_code
            USING ERRCODE = 'SP004';
    END IF;

    IF p_action NOT IN ('APPROVE','PARTIAL_APPROVE','REJECT','ESCALATE','RETURN','COMMENT') THEN
        RAISE EXCEPTION 'Action % cannot be taken at a review stage', p_action
            USING ERRCODE = 'SP005';
    END IF;

    IF p_action = 'ESCALATE' AND v_is_final THEN
        RAISE EXCEPTION 'Stage % is the final authority and cannot escalate', v_stage_code
            USING ERRCODE = 'SP006';
    END IF;

    IF p_action = 'REJECT' AND COALESCE(TRIM(p_rejection_reason), '') = '' THEN
        RAISE EXCEPTION 'A rejection requires a reason'
            USING ERRCODE = 'SP007';
    END IF;

    IF p_action = 'PARTIAL_APPROVE'
       AND (p_item_decisions IS NULL OR jsonb_array_length(p_item_decisions) = 0) THEN
        RAISE EXCEPTION 'A partial approval must specify item decisions'
            USING ERRCODE = 'SP008';
    END IF;

    IF p_signature_hash IS NOT NULL THEN
        INSERT INTO digital_signatures (user_id, signed_hash)
        VALUES (p_actor_id, p_signature_hash)
        RETURNING signature_id INTO v_signature_id;
    END IF;

    -- Work out where the request lands. APPROVE / PARTIAL_APPROVE are left
    -- NULL here and resolved from the item statuses further down.
    IF p_action = 'REJECT' THEN
        v_new_status := 'REJECTED';
        v_new_stage  := v_req.current_stage_id;

    ELSIF p_action = 'ESCALATE' THEN
        v_next_stage := fn_next_stage(v_req.current_stage_id);
        IF v_next_stage IS NULL THEN
            RAISE EXCEPTION 'No stage exists above %', v_stage_code
                USING ERRCODE = 'SP009';
        END IF;
        v_new_stage  := v_next_stage;
        v_new_status := fn_stage_status(
            (SELECT code FROM workflow_stages WHERE stage_id = v_next_stage));

    ELSIF p_action IN ('COMMENT','RETURN') THEN
        v_new_status := v_req.current_status;
        v_new_stage  := v_req.current_stage_id;

    ELSE
        v_new_status := NULL;
        v_new_stage  := v_req.current_stage_id;
    END IF;

    INSERT INTO approval_actions (
        request_id, stage_id, performed_by, action,
        previous_status, new_status, amount_requested_snapshot,
        rejection_reason, comments, signature_id)
    VALUES (
        p_request_id, v_req.current_stage_id, p_actor_id, p_action,
        v_req.current_status, v_new_status, v_req.tentative_total_cost,
        p_rejection_reason, p_comments, v_signature_id)
    RETURNING action_id INTO v_action_id;

    -- ---- item-level decisions -------------------------------------------

    IF p_item_decisions IS NOT NULL AND jsonb_array_length(p_item_decisions) > 0 THEN

        INSERT INTO approval_action_items (
            action_id, request_item_id, request_id,
            approved_quantity, approved_amount, item_decision, remarks)
        SELECT
            v_action_id,
            ri.request_item_id,
            p_request_id,
            (d->>'approved_quantity')::NUMERIC,
            (d->>'approved_amount')::NUMERIC,
            (CASE
                WHEN (d->>'approved_quantity')::NUMERIC = 0 THEN 'REJECTED'
                WHEN (d->>'approved_quantity')::NUMERIC >= ri.requested_quantity THEN 'APPROVED'
                ELSE 'PARTIALLY_APPROVED'
             END)::request_item_status,
            d->>'remarks'
        FROM jsonb_array_elements(p_item_decisions) d
        JOIN request_items ri
          ON ri.request_item_id = (d->>'request_item_id')::UUID
         AND ri.request_id      = p_request_id;

        GET DIAGNOSTICS v_decided = ROW_COUNT;
        IF v_decided <> jsonb_array_length(p_item_decisions) THEN
            RAISE EXCEPTION
                'Item decisions reference % line item(s) that do not belong to request %',
                jsonb_array_length(p_item_decisions) - v_decided, v_req.request_number
                USING ERRCODE = 'SP010';
        END IF;

        UPDATE request_items ri
           SET approved_quantity = aai.approved_quantity,
               approved_amount   = aai.approved_amount,
               item_status       = aai.item_decision,
               remarks           = COALESCE(aai.remarks, ri.remarks)
          FROM approval_action_items aai
         WHERE aai.action_id       = v_action_id
           AND aai.request_item_id = ri.request_item_id;

    ELSIF p_action = 'APPROVE' THEN
        -- Approve everything as requested.
        INSERT INTO approval_action_items (
            action_id, request_item_id, request_id,
            approved_quantity, approved_amount, item_decision)
        SELECT v_action_id, ri.request_item_id, p_request_id,
               ri.requested_quantity, ri.estimated_total, 'APPROVED'
        FROM request_items ri
        WHERE ri.request_id = p_request_id;

        UPDATE request_items
           SET approved_quantity = requested_quantity,
               approved_amount   = estimated_total,
               item_status       = 'APPROVED'
         WHERE request_id = p_request_id;
    END IF;

    -- ---- resolve the request-level status --------------------------------

    IF v_new_status IS NULL THEN
        SELECT count(*),
               count(*) FILTER (WHERE item_status = 'APPROVED'),
               count(*) FILTER (WHERE item_status = 'REJECTED')
          INTO v_total, v_approved, v_rejected
        FROM request_items WHERE request_id = p_request_id;

        v_new_status := CASE
            WHEN v_total = 0                              THEN 'APPROVED'
            WHEN v_rejected = v_total                     THEN 'REJECTED'
            WHEN v_approved = v_total                     THEN 'APPROVED'
            ELSE 'PARTIALLY_APPROVED'
        END::request_status;

        UPDATE approval_actions SET new_status = v_new_status WHERE action_id = v_action_id;
    END IF;

    UPDATE requests
       SET current_status   = v_new_status,
           current_stage_id = v_new_stage,
           closed_at        = CASE WHEN v_new_status = 'REJECTED' THEN NOW() ELSE closed_at END
     WHERE request_id = p_request_id;

    -- sanctioned_amount is maintained by trigger on request_items; copy the
    -- settled figure onto the action so the timeline shows what was granted.
    -- Only decisions that actually grant money carry an amount â€” an escalate
    -- or a comment leaves it NULL rather than recording a misleading zero.
    IF p_action IN ('APPROVE', 'PARTIAL_APPROVE') THEN
        UPDATE approval_actions a
           SET amount_approved = r.sanctioned_amount
          FROM requests r
         WHERE a.action_id = v_action_id
           AND r.request_id = p_request_id;
    END IF;

    INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
    VALUES ('request', p_request_id::TEXT, p_actor_id, p_action::TEXT,
            jsonb_build_object('status', v_req.current_status, 'stage_id', v_req.current_stage_id),
            jsonb_build_object('status', v_new_status,        'stage_id', v_new_stage));

    RETURN v_action_id;
END;
$$ LANGUAGE plpgsql;

-- Row-Level Security.
--
-- HOW THIS WORKS
-- The application connects as the `app_user` role and, at the start of every
-- request, tells Postgres who the logged-in person is:
--
--     SET LOCAL app.user_id = '<uuid of the authenticated user>';
--
-- Use SET LOCAL (transaction-scoped), never plain SET, or the value leaks to
-- the next request that reuses the pooled connection.
--
-- IMPORTANT: superusers and table owners bypass RLS. Connecting as `postgres`
-- sees everything regardless of the policies below â€” that is expected, and is
-- why the app must not use the postgres role.

-- ---------------------------------------------------------------------------
-- Application role
-- ---------------------------------------------------------------------------
-- Created without LOGIN deliberately: choose a password yourself rather than
-- having one committed to the repository.
--
--     ALTER ROLE app_user LOGIN PASSWORD '<your password>';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- WHY THESE ARE SECURITY DEFINER
-- A policy expression is itself subject to RLS. A helper that reads `requests`
-- or `approval_actions` while those tables' own policies call that same helper
-- recurses until the stack blows. SECURITY DEFINER makes these helpers read as
-- the (RLS-exempt) owner, which breaks the cycle. search_path is pinned so the
-- elevated body cannot be redirected at a shadowed table.
--
-- Each returns only a boolean, so nothing leaks beyond a visibility yes/no.

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::UUID;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_has_role(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.role_id = ur.role_id
        WHERE ur.user_id = app_current_user_id()
          AND r.code = p_code
    );
$$;

-- True when the user is a configured approver on a stage this request sits at
-- now, or passed through earlier (so approvers keep visibility after escalating).
CREATE OR REPLACE FUNCTION app_is_stage_participant(p_request_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM requests r
        JOIN stage_approvers sa ON sa.user_id = p_user_id
        WHERE r.request_id = p_request_id
          AND (
                sa.stage_id = r.current_stage_id
             OR EXISTS (
                    SELECT 1 FROM approval_actions aa
                    WHERE aa.request_id = r.request_id
                      AND aa.stage_id   = sa.stage_id
                )
          )
    );
$$;

CREATE OR REPLACE FUNCTION app_can_see_request(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        EXISTS (
            SELECT 1 FROM requests r
            WHERE r.request_id = p_request_id
              AND r.raised_by  = app_current_user_id()
        )
        OR app_is_stage_participant(p_request_id, app_current_user_id());
$$;

-- The Principal reads all college data (requirements Â§4), except drafts, which
-- stay private to their author until submitted. Kept separate from
-- app_can_see_request on purpose: that helper also gates WRITE policies, and
-- read-all must not quietly become edit-all.
CREATE OR REPLACE FUNCTION app_principal_can_read(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT app_has_role('PRINCIPAL')
       AND EXISTS (
            SELECT 1 FROM requests r
            WHERE r.request_id = p_request_id
              AND r.current_status <> 'DRAFT'
       );
$$;

-- Issue participants: raiser, assignee, escalation target, and the Principal.
CREATE OR REPLACE FUNCTION app_can_see_issue(p_issue_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT app_has_role('PRINCIPAL')
        OR EXISTS (
            SELECT 1 FROM issues i
            WHERE i.issue_id = p_issue_id
              AND app_current_user_id() IN (i.raised_by, i.assigned_to, i.escalated_to)
        );
$$;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Multiple permissive policies on a table are OR-ed together.

ALTER TABLE requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY requests_admin ON requests
    USING (app_has_role('ADMIN'))
    WITH CHECK (app_has_role('ADMIN'));

-- A requester sees and edits their own requests.
CREATE POLICY requests_own ON requests
    USING (raised_by = app_current_user_id())
    WITH CHECK (raised_by = app_current_user_id());

-- Approvers see requests currently at their stage, or that passed through it.
CREATE POLICY requests_approver ON requests
    FOR SELECT
    USING (app_is_stage_participant(request_id, app_current_user_id()));

-- The Principal reads every submitted request, not only those routed through
-- the Principal stage â€” a 5 lakh request goes straight to CDC and would
-- otherwise be invisible to the college's primary approver.
CREATE POLICY requests_principal_read ON requests
    FOR SELECT
    USING (app_has_role('PRINCIPAL') AND current_status <> 'DRAFT');

-- Approvers act through fn_record_action, which updates the request row.
--
-- USING: the approver must be staffed at the stage the request sits at NOW.
-- WITH CHECK: the updated row may sit at that stage or any stage above it.
-- The explicit WITH CHECK matters. Without one, Postgres re-applies USING to
-- the new row â€” and an escalation moves the request to a stage the escalating
-- approver is not staffed at, so every escalation was rejected.
CREATE POLICY requests_approver_update ON requests
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM stage_approvers sa
            WHERE sa.user_id = app_current_user_id()
              AND sa.stage_id = requests.current_stage_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM stage_approvers sa
            JOIN workflow_stages mine   ON mine.stage_id   = sa.stage_id
            JOIN workflow_stages target ON target.stage_id = requests.current_stage_id
            WHERE sa.user_id = app_current_user_id()
              AND target.sequence_no >= mine.sequence_no
        )
    );

-- Line items follow their parent request.
ALTER TABLE request_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY request_items_via_request ON request_items
    USING (app_has_role('ADMIN') OR app_can_see_request(request_id))
    WITH CHECK (app_has_role('ADMIN') OR app_can_see_request(request_id));

CREATE POLICY request_items_principal_read ON request_items
    FOR SELECT
    USING (app_principal_can_read(request_id));

-- The audit trail follows the request too.
ALTER TABLE approval_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_actions_via_request ON approval_actions
    USING (app_has_role('ADMIN') OR app_can_see_request(request_id))
    WITH CHECK (app_has_role('ADMIN') OR app_can_see_request(request_id));

CREATE POLICY approval_actions_principal_read ON approval_actions
    FOR SELECT
    USING (app_principal_can_read(request_id));

-- Comment visibility â€” the hierarchical rule from the design doc.
--   ALL         visible to anyone who can see the request
--   UP_CHAIN    visible to the authoring stage, every stage above it, and the
--               Principal. The design doc's own example: a CDC member's note
--               that grant budget is unavailable is visible to CDC and to the
--               Principal, but not to the Purchase Committee or the Head.
--   STAGE_ONLY  visible only to approvers on the authoring stage
-- The author always sees their own comment.
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY comments_visibility ON comments
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR author_user_id = app_current_user_id()
        OR (
            (app_can_see_request(request_id) OR app_principal_can_read(request_id))
            AND (
                visibility = 'ALL'
                OR (
                    visibility = 'UP_CHAIN'
                    AND (
                        app_has_role('PRINCIPAL')
                        OR EXISTS (
                            SELECT 1
                            FROM stage_approvers sa
                            JOIN workflow_stages viewer ON viewer.stage_id = sa.stage_id
                            JOIN workflow_stages author ON author.stage_id = comments.stage_id
                            WHERE sa.user_id = app_current_user_id()
                              AND viewer.sequence_no >= author.sequence_no
                        )
                    )
                )
                OR (
                    visibility = 'STAGE_ONLY'
                    AND EXISTS (
                        SELECT 1 FROM stage_approvers sa
                        WHERE sa.user_id = app_current_user_id()
                          AND sa.stage_id = comments.stage_id
                    )
                )
            )
        )
    );

-- You can only comment as yourself, and only on a request you can see.
CREATE POLICY comments_insert ON comments
    FOR INSERT
    WITH CHECK (
        author_user_id = app_current_user_id()
        AND (
            app_has_role('ADMIN')
            OR app_can_see_request(request_id)
            OR app_principal_can_read(request_id)
        )
    );

-- People see only their own notifications.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_own ON notifications
    USING (app_has_role('ADMIN') OR user_id = app_current_user_id())
    WITH CHECK (app_has_role('ADMIN') OR user_id = app_current_user_id());

-- Attachments follow their parent request or issue. Reading, adding and
-- removing are separate policies: being able to see a quotation must not
-- mean being able to delete it. There is no UPDATE policy â€” a stored file's
-- record is never edited, only added or (by its uploader) removed.
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY attachments_read ON attachments
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR uploaded_by = app_current_user_id()
        OR (request_id IS NOT NULL
            AND (app_can_see_request(request_id) OR app_principal_can_read(request_id)))
        OR (issue_id IS NOT NULL AND app_can_see_issue(issue_id))
    );

CREATE POLICY attachments_insert ON attachments
    FOR INSERT
    WITH CHECK (
        uploaded_by = app_current_user_id()
        AND (
            app_has_role('ADMIN')
            OR (request_id IS NOT NULL AND app_can_see_request(request_id))
            OR (issue_id   IS NOT NULL AND app_can_see_issue(issue_id))
        )
    );

CREATE POLICY attachments_delete ON attachments
    FOR DELETE
    USING (app_has_role('ADMIN') OR uploaded_by = app_current_user_id());

-- Non-financial issues: raiser, assignee, escalation target, Principal, Admin.
-- Split so the Principal and assignee can move an issue along (review,
-- assign, resolve) â€” previously only the raiser could update it, so the
-- Principal could see an issue but never resolve it. There is no DELETE
-- policy: issues are part of the record.
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY issues_read ON issues
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR app_current_user_id() IN (raised_by, assigned_to, escalated_to)
    );

CREATE POLICY issues_insert ON issues
    FOR INSERT
    WITH CHECK (app_has_role('ADMIN') OR raised_by = app_current_user_id());

CREATE POLICY issues_update ON issues
    FOR UPDATE
    USING (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR app_current_user_id() IN (raised_by, assigned_to, escalated_to)
    )
    WITH CHECK (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR app_current_user_id() IN (raised_by, assigned_to, escalated_to)
    );

-- The audit log is append-only for everyone; only Admin reads it back.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_admin_read ON audit_logs
    FOR SELECT USING (app_has_role('ADMIN'));

CREATE POLICY audit_logs_insert ON audit_logs
    FOR INSERT WITH CHECK (true);

-- Human-readable numbers for requests and issues.
--
-- Generated by the database from sequences, so two people submitting at the
-- same moment can never be handed the same number. An application that
-- counted existing rows and added one would race.
--
-- Callers that supply their own number (seed data, tests, carry-forward's
-- "-CF" suffix) still can; the default applies only when the column is omitted.

CREATE SEQUENCE IF NOT EXISTS request_number_seq;
CREATE SEQUENCE IF NOT EXISTS issue_number_seq;

GRANT USAGE, SELECT ON SEQUENCE request_number_seq TO app_user;
GRANT USAGE, SELECT ON SEQUENCE issue_number_seq   TO app_user;

-- lpad() truncates a value longer than the target width, so a plain
-- lpad(n, 4) would turn request 12345 into '1234' and collide with an
-- earlier number. The width grows with the value instead.
CREATE OR REPLACE FUNCTION fn_pad_number(p_n BIGINT, p_width INT)
RETURNS TEXT AS $$
    SELECT lpad(p_n::TEXT, GREATEST(p_width, length(p_n::TEXT)), '0');
$$ LANGUAGE sql IMMUTABLE;

-- REQ-2026-0001
CREATE OR REPLACE FUNCTION fn_next_request_number()
RETURNS TEXT AS $$
    SELECT 'REQ-' || to_char(NOW(), 'YYYY') || '-' || fn_pad_number(nextval('request_number_seq'), 4);
$$ LANGUAGE sql VOLATILE;

-- ISS-0001
CREATE OR REPLACE FUNCTION fn_next_issue_number()
RETURNS TEXT AS $$
    SELECT 'ISS-' || fn_pad_number(nextval('issue_number_seq'), 4);
$$ LANGUAGE sql VOLATILE;

ALTER TABLE requests ALTER COLUMN request_number SET DEFAULT fn_next_request_number();
ALTER TABLE issues   ALTER COLUMN issue_number   SET DEFAULT fn_next_issue_number();

-- Notifications, generated by the database when a request or issue changes.
--
-- WHY TRIGGERS, AND WHY SECURITY DEFINER
-- Notifying someone means inserting a row that belongs to THEM. RLS only lets
-- a user insert their own notifications, so a requester submitting a request
-- could never notify the approvers it now waits on. These trigger functions
-- run as their owner to write those rows. They cannot be called directly â€”
-- a trigger function only runs when its trigger fires â€” so there is no way
-- to use them to send arbitrary notifications.
--
-- Recipients come from roles and stage staffing, never hard-coded addresses,
-- as the design document requires. Only in-app notifications are created;
-- delivering email is left to a worker that reads PENDING EMAIL rows.

-- ---------------------------------------------------------------------------
-- Money, written the way the college writes it
-- ---------------------------------------------------------------------------
-- Indian digit grouping: the last three digits, then twos.
-- 650000.5 becomes â‚¹6,50,000.50, not â‚¹650,000.50. to_char() only knows
-- three-digit grouping, so the head of the number is grouped here.
CREATE OR REPLACE FUNCTION fn_inr(p_amount NUMERIC)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_sign TEXT := CASE WHEN p_amount < 0 THEN '-' ELSE '' END;
    v_text TEXT := to_char(round(abs(COALESCE(p_amount, 0)), 2), 'FM9999999999990.00');
    v_int  TEXT := split_part(v_text, '.', 1);
    v_frac TEXT := split_part(v_text, '.', 2);
    v_head TEXT;
BEGIN
    IF length(v_int) <= 3 THEN
        RETURN v_sign || 'â‚¹' || v_int || '.' || v_frac;
    END IF;
    -- Group everything before the final three digits in pairs, right to left.
    v_head := reverse(regexp_replace(reverse(left(v_int, length(v_int) - 3)),
                                     '(\d{2})(?=\d)', '\1,', 'g'));
    RETURN v_sign || 'â‚¹' || v_head || ',' || right(v_int, 3) || '.' || v_frac;
END;
$$;

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------
--   enters a review stage   -> every approver staffed at that stage
--   escalated upward        -> additionally the requester, so they know
--   approved / partially approved / rejected / carried forward -> the requester

CREATE OR REPLACE FUNCTION fn_notify_request_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stage_name TEXT;
    v_label      TEXT := lower(replace(NEW.current_status::TEXT, '_', ' '));
BEGIN
    IF left(NEW.current_status::TEXT, 6) = 'UNDER_' THEN
        SELECT name INTO v_stage_name
        FROM workflow_stages WHERE stage_id = NEW.current_stage_id;

        INSERT INTO notifications (user_id, request_id, subject, body)
        SELECT sa.user_id, NEW.request_id,
               'Request ' || NEW.request_number || ' awaits your review',
               NEW.title || ' is now with ' || v_stage_name || '.'
        FROM stage_approvers sa
        WHERE sa.stage_id = NEW.current_stage_id;

        IF left(OLD.current_status::TEXT, 6) = 'UNDER_' THEN
            INSERT INTO notifications (user_id, request_id, subject, body)
            VALUES (NEW.raised_by, NEW.request_id,
                    'Request ' || NEW.request_number || ' escalated',
                    'Forwarded to ' || v_stage_name || ' for review.');
        END IF;

    ELSIF NEW.current_status IN ('APPROVED','PARTIALLY_APPROVED','REJECTED','CARRIED_FORWARD') THEN
        INSERT INTO notifications (user_id, request_id, subject, body)
        VALUES (NEW.raised_by, NEW.request_id,
                'Request ' || NEW.request_number || ' ' || v_label,
                CASE
                    WHEN NEW.current_status IN ('APPROVED','PARTIALLY_APPROVED')
                        THEN 'Sanctioned ' || fn_inr(COALESCE(NEW.sanctioned_amount, 0))
                             || ' of ' || fn_inr(NEW.tentative_total_cost) || ' requested.'
                    ELSE NEW.title
                END);
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER requests_notify_status
    AFTER UPDATE OF current_status ON requests
    FOR EACH ROW
    WHEN (OLD.current_status IS DISTINCT FROM NEW.current_status)
    EXECUTE FUNCTION fn_notify_request_status();

-- ---------------------------------------------------------------------------
-- Non-financial issues
-- ---------------------------------------------------------------------------
--   raised              -> every Principal
--   status changes      -> the raiser
--   assigned            -> the new assignee
--   escalated to someone -> that person

CREATE OR REPLACE FUNCTION fn_notify_issue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        SELECT ur.user_id, NEW.issue_id,
               'New issue ' || NEW.issue_number, NEW.title
        FROM user_roles ur
        JOIN roles r ON r.role_id = ur.role_id
        WHERE r.code = 'PRINCIPAL'
          AND ur.user_id <> NEW.raised_by;
        RETURN NULL;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        VALUES (NEW.raised_by, NEW.issue_id,
                'Issue ' || NEW.issue_number || ' is now '
                    || lower(replace(NEW.status::TEXT, '_', ' ')),
                NEW.title);
    END IF;

    IF NEW.assigned_to IS NOT NULL
       AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        VALUES (NEW.assigned_to, NEW.issue_id,
                'Issue ' || NEW.issue_number || ' assigned to you', NEW.title);
    END IF;

    IF NEW.escalated_to IS NOT NULL
       AND NEW.escalated_to IS DISTINCT FROM OLD.escalated_to THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        VALUES (NEW.escalated_to, NEW.issue_id,
                'Issue ' || NEW.issue_number || ' escalated to you', NEW.title);
    END IF;

    RETURN NULL;
END;
$$;

CREATE TRIGGER issues_notify_insert
    AFTER INSERT ON issues
    FOR EACH ROW
    EXECUTE FUNCTION fn_notify_issue();

CREATE TRIGGER issues_notify_update
    AFTER UPDATE OF status, assigned_to, escalated_to ON issues
    FOR EACH ROW
    EXECUTE FUNCTION fn_notify_issue();

-- Migration bookkeeping.
--
-- A database built from these schema files already contains the effect of
-- every migration listed below, because each migration's change is mirrored
-- into the schema files. Recording them here means a fresh build knows it is
-- current, and nobody has to remember to run a baseline step by hand.
--
-- When you add a migration: mirror its change into the schema files AND add
-- its filename to this list. See db/migrations/README.md.

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (filename) VALUES
    ('20260902T180000_baseline.sql'),
    ('20260902T193000_add_sqlstate_error_codes.sql'),
    ('20260911T120000_backend_rls_fixes.sql'),
    ('20260912T090000_indian_number_format.sql')
ON CONFLICT (filename) DO NOTHING;

-- Seed minimum viable roles and the workflow stages.
-- Amount thresholds encode the routing described in the design doc:
--   < 50,000                 -> Purchase Committee
--   50,000 - < 5,00,000      -> Principal
--   >= 5,00,000              -> CDC (and can escalate to Final Authority)

INSERT INTO roles (code, name, description) VALUES
    ('HEAD',                 'Head of Department',    'Raises requisitions'),
    ('ACTIVITY_INCHARGE',    'Activity In-charge',    'Raises requisitions'),
    ('PURCHASE_COMMITTEE',   'Purchase Committee',    'Reviews requests below 50,000'),
    ('PRINCIPAL',            'Principal',             'Approval / escalation authority'),
    ('CDC_MEMBER',           'CDC Member',            'CDC review'),
    ('CDC_GRANT_MEMBER',     'CDC Grant Member',      'Grant-side CDC authority'),
    ('CDC_NON_GRANT_MEMBER', 'CDC Non-Grant Member',  'Non-grant CDC authority'),
    ('CHAIRMAN',             'Chairman',              'Final authority'),
    ('VICE_PRESIDENT',       'Vice President',        'Final authority'),
    ('ADMIN',                'Administrator',         'System administration')
ON CONFLICT (code) DO NOTHING;

INSERT INTO workflow_stages (code, name, sequence_no, is_final) VALUES
    ('PURCHASE_COMMITTEE', 'Purchase Committee', 1, FALSE),
    ('PRINCIPAL',          'Principal',          2, FALSE),
    ('CDC',                'CDC',                3, FALSE),
    ('FINAL_AUTHORITY',    'Chairman + VP',      4, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Amount-based routing rules. NULL max_amount = no upper bound.
INSERT INTO stage_routing_rules (stage_id, min_amount, max_amount)
SELECT stage_id, 0::NUMERIC,      50000::NUMERIC  FROM workflow_stages WHERE code = 'PURCHASE_COMMITTEE'
UNION ALL
SELECT stage_id, 50000::NUMERIC,  500000::NUMERIC FROM workflow_stages WHERE code = 'PRINCIPAL'
UNION ALL
SELECT stage_id, 500000::NUMERIC, NULL::NUMERIC   FROM workflow_stages WHERE code = 'CDC';

-- A minimal set of departments, financial years, and budgets so the app
-- has something to render against. Safe to run repeatedly.

INSERT INTO departments (code, name) VALUES
    ('CS',   'Computer Science'),
    ('CHEM', 'Chemistry'),
    ('PHY',  'Physics'),
    ('ADMIN','Administration')
ON CONFLICT (code) DO NOTHING;

INSERT INTO financial_years (label, start_date, end_date, is_active) VALUES
    ('2025-26', DATE '2025-04-01', DATE '2026-03-31', FALSE),
    ('2026-27', DATE '2026-04-01', DATE '2027-03-31', TRUE)
ON CONFLICT (label) DO NOTHING;

INSERT INTO budget_heads (code, name, head_type, description) VALUES
    ('LAB',    'Laboratory',         'CAPITAL', 'Lab equipment and supplies'),
    ('INFRA',  'Infrastructure',     'CAPITAL', 'Buildings and fixed assets'),
    ('IT',     'IT Equipment',       'CAPITAL', 'Computers, network, AV gear'),
    ('OFFICE', 'Office Expenses',    'REVENUE', 'Stationery, printing, utilities'),
    ('ACAD',   'Academic Activities','REVENUE', 'Seminars, workshops, teaching aids'),
    ('MAINT',  'Maintenance',        'REVENUE', 'Repairs and servicing'),
    ('STU',    'Student Activities', 'REVENUE', 'Events, clubs, competitions')
ON CONFLICT (code) DO NOTHING;

-- Sample budget items under a few heads.
INSERT INTO budget_items (budget_head_id, code, name, item_type, unit)
SELECT bh.budget_head_id, v.code, v.name, v.item_type::budget_item_type, v.unit
FROM (VALUES
    ('LAB',    'GLASS-01',  'Chemistry Glassware',      'CONSUMABLE', 'piece'),
    ('LAB',    'CHEM-01',   'Lab Chemicals',            'CONSUMABLE', 'litre'),
    ('IT',     'MIC-01',    'Wireless Microphone',      'CAPITAL',    'piece'),
    ('IT',     'SPK-01',    'Speaker',                  'CAPITAL',    'piece'),
    ('IT',     'HDMI-01',   'HDMI Cable',               'CONSUMABLE', 'piece'),
    ('IT',     'TRI-01',    'Tripod',                   'CAPITAL',    'piece'),
    ('OFFICE', 'CART-01',   'Printer Cartridge',        'CONSUMABLE', 'piece'),
    ('OFFICE', 'PAPER-01',  'A4 Paper Ream',            'CONSUMABLE', 'ream')
) AS v(head_code, code, name, item_type, unit)
JOIN budget_heads bh ON bh.code = v.head_code
ON CONFLICT (budget_head_id, code) DO NOTHING;

-- ===========================================================================
-- DEVELOPMENT SEED ONLY â€” DO NOT LOAD ON THE COLLEGE SERVER
-- ===========================================================================
-- Creates one account per role plus the stage_approvers wiring, so the
-- approval workflow can actually be exercised end to end locally.
--
-- Every account below shares the same throwaway password:
--
--     ChangeMe#2026
--
-- The hash is generated by pgcrypto at seed time, so nothing secret is stored
-- in this file. These accounts are still real logins â€” before deploying,
-- either skip this file entirely or reset every password.
-- ===========================================================================

INSERT INTO users (email, full_name, password_hash) VALUES
    ('head.cs@spcollege.edu',    'Dr. A. Deshpande (Head, CS)',   crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('incharge@spcollege.edu',   'S. Kulkarni (Activity In-charge)', crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('pc1@spcollege.edu',        'R. Joshi (Purchase Committee)', crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('pc2@spcollege.edu',        'M. Patil (Purchase Committee)', crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('principal@spcollege.edu',  'Dr. V. Rane (Principal)',       crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('cdc.grant@spcollege.edu',  'P. Shinde (CDC Grant)',         crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('cdc.nongrant@spcollege.edu','N. Gokhale (CDC Non-Grant)',   crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('chairman@spcollege.edu',   'Shri. K. Bhave (Chairman)',     crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('vp@spcollege.edu',         'Smt. L. Karve (Vice President)',crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('clerk@spcollege.edu',      'D. Sawant (Clerk)',             crypt('ChangeMe#2026', gen_salt('bf', 12))),
    ('admin@spcollege.edu',      'System Administrator',          crypt('ChangeMe#2026', gen_salt('bf', 12)))
ON CONFLICT (email) DO NOTHING;

-- Role assignments.
INSERT INTO user_roles (user_id, role_id)
SELECT u.user_id, r.role_id
FROM (VALUES
    ('head.cs@spcollege.edu',      'HEAD'),
    ('incharge@spcollege.edu',     'ACTIVITY_INCHARGE'),
    ('pc1@spcollege.edu',          'PURCHASE_COMMITTEE'),
    ('pc2@spcollege.edu',          'PURCHASE_COMMITTEE'),
    ('principal@spcollege.edu',    'PRINCIPAL'),
    ('cdc.grant@spcollege.edu',    'CDC_GRANT_MEMBER'),
    ('cdc.grant@spcollege.edu',    'CDC_MEMBER'),
    ('cdc.nongrant@spcollege.edu', 'CDC_NON_GRANT_MEMBER'),
    ('cdc.nongrant@spcollege.edu', 'CDC_MEMBER'),
    ('chairman@spcollege.edu',     'CHAIRMAN'),
    ('vp@spcollege.edu',           'VICE_PRESIDENT'),
    ('admin@spcollege.edu',        'ADMIN')
) AS v(email, role_code)
JOIN users u ON u.email = v.email
JOIN roles r ON r.code  = v.role_code
ON CONFLICT (user_id, role_id) DO NOTHING;

-- Stage staffing. This is the part that makes fn_record_action work: without
-- rows here, nobody has authority to decide anything at any stage.
INSERT INTO stage_approvers (stage_id, user_id, role_id)
SELECT ws.stage_id, u.user_id, r.role_id
FROM (VALUES
    ('PURCHASE_COMMITTEE', 'pc1@spcollege.edu',          'PURCHASE_COMMITTEE'),
    ('PURCHASE_COMMITTEE', 'pc2@spcollege.edu',          'PURCHASE_COMMITTEE'),
    ('PRINCIPAL',          'principal@spcollege.edu',    'PRINCIPAL'),
    ('CDC',                'cdc.grant@spcollege.edu',    'CDC_GRANT_MEMBER'),
    ('CDC',                'cdc.nongrant@spcollege.edu', 'CDC_NON_GRANT_MEMBER'),
    ('FINAL_AUTHORITY',    'chairman@spcollege.edu',     'CHAIRMAN'),
    ('FINAL_AUTHORITY',    'vp@spcollege.edu',           'VICE_PRESIDENT')
) AS v(stage_code, email, role_code)
JOIN workflow_stages ws ON ws.code = v.stage_code::workflow_stage_code
JOIN users u            ON u.email = v.email
JOIN roles r            ON r.code  = v.role_code
ON CONFLICT (stage_id, user_id) DO NOTHING;

-- Backend readiness: Row-Level Security fixes, numbering, notifications.
--
-- Found by running the workflow as app_user â€” the role the API connects as â€”
-- instead of as the postgres superuser, which bypasses RLS entirely and so
-- hid every one of these. Each was reproduced against a live database before
-- being fixed.
--
--   1. Views leaked every row. A view reads with its owner's privileges, and
--      the owner is the superuser. A Head querying v_pending_requests saw
--      another user's private draft. Views are now security_invoker.
--
--   2. Escalation always failed. requests_approver_update had no WITH CHECK,
--      so Postgres re-applied USING to the new row; an escalated request sits
--      at a stage the escalating approver is not staffed at. Added a WITH
--      CHECK permitting the same stage or any stage above.
--
--   3. Impersonation. fn_record_action checked the p_actor_id parameter, not
--      the session. A requester could pass an approver's id and approve their
--      own request. Now refused with SP013 when the two differ. Same guard on
--      fn_carry_forward_request, which also gains SP014 (status cannot carry
--      forward) and SP015 (target year must be later).
--
--   4. The Principal could not see requests that bypass the Principal stage â€”
--      anything of 5 lakh or more goes straight to CDC. Requirements give the
--      Principal read access to all college data; drafts stay private. Added
--      as SELECT-only policies, so reading everything is not editing anything.
--
--   5. UP_CHAIN comments were hidden from the Principal, the reverse of the
--      design document's own example. The Principal now sees them.
--
--   6. Comments could be inserted on any request whose id was known. Now
--      only on requests the author can see.
--
--   7. Attachments: seeing one allowed deleting it, and issue attachments were
--      invisible to everyone but the uploader. Split into read / insert /
--      delete policies; issue participants can read.
--
--   8. Issues: only the raiser could update, so the Principal could never
--      review, assign or resolve one. Split into read / insert / update.
--
--   9. No notification could be created â€” RLS lets users insert only their
--      own, so a submission could not notify approvers. Added SECURITY
--      DEFINER triggers that generate notifications on status changes.
--
--  10. request_number and issue_number now default from sequences, so
--      concurrent submissions cannot be handed the same number.
--
-- Safe on a database holding live data: no data is changed, only views,
-- functions, policies, sequences, defaults and triggers.

BEGIN;

-- 1. views -------------------------------------------------------------------
ALTER VIEW v_pending_requests SET (security_invoker = true);
ALTER VIEW v_pending_gt_3_days SET (security_invoker = true);
ALTER VIEW v_dashboard_by_fy SET (security_invoker = true);
ALTER VIEW v_request_timeline SET (security_invoker = true);
ALTER VIEW v_request_items_summary SET (security_invoker = true);

-- 3. actor guards ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_record_action(
    p_request_id        UUID,
    p_actor_id          UUID,
    p_action            approval_action_type,
    p_item_decisions    JSONB DEFAULT NULL,
    p_comments          TEXT  DEFAULT NULL,
    p_rejection_reason  TEXT  DEFAULT NULL,
    p_signature_hash    TEXT  DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_req          requests%ROWTYPE;
    v_stage_code   workflow_stage_code;
    v_is_final     BOOLEAN;
    v_next_stage   INTEGER;
    v_action_id    UUID;
    v_signature_id UUID;
    v_new_status   request_status;
    v_new_stage    INTEGER;
    v_total        INTEGER;
    v_approved     INTEGER;
    v_rejected     INTEGER;
    v_decided      INTEGER;
BEGIN
    -- The authority check below tests p_actor_id against the approver list. If
    -- that parameter could differ from the logged-in session, a requester could
    -- pass an approver's id and approve their own request â€” every RLS policy
    -- would pass, because they own the row. So when a session identity is set,
    -- the actor must be that identity. (No identity is set for maintenance run
    -- directly as a superuser, which RLS does not govern anyway.)
    IF app_current_user_id() IS NOT NULL
       AND p_actor_id IS DISTINCT FROM app_current_user_id() THEN
        RAISE EXCEPTION 'Actor % does not match the authenticated user', p_actor_id
            USING ERRCODE = 'SP013';
    END IF;

    -- Lock the request so two approvers acting at once can't interleave.
    SELECT * INTO v_req FROM requests WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        -- Under RLS, FOR UPDATE sees only rows the caller may UPDATE. A caller
        -- who can read the request but not act on it (an approver it has moved
        -- past, or the Principal reading a CDC request) lands here too. Tell
        -- them they lack authority rather than claiming the request is missing.
        IF EXISTS (SELECT 1 FROM requests WHERE request_id = p_request_id) THEN
            RAISE EXCEPTION 'User % is not an approver at the current stage of this request', p_actor_id
                USING ERRCODE = 'SP004';
        END IF;
        RAISE EXCEPTION 'Request % not found', p_request_id
            USING ERRCODE = 'SP001';
    END IF;

    IF v_req.current_stage_id IS NULL THEN
        RAISE EXCEPTION 'Request % is not at a review stage (status = %)',
            v_req.request_number, v_req.current_status
            USING ERRCODE = 'SP002';
    END IF;

    IF v_req.current_status IN ('APPROVED','REJECTED','FULFILLED','CLOSED','CARRIED_FORWARD') THEN
        RAISE EXCEPTION 'Request % is already closed (status = %)',
            v_req.request_number, v_req.current_status
            USING ERRCODE = 'SP003';
    END IF;

    SELECT code, is_final INTO v_stage_code, v_is_final
    FROM workflow_stages WHERE stage_id = v_req.current_stage_id;

    -- Authority: the actor must be a configured approver at the current stage.
    IF NOT EXISTS (
        SELECT 1 FROM stage_approvers
        WHERE stage_id = v_req.current_stage_id AND user_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'User % is not an approver at stage %', p_actor_id, v_stage_code
            USING ERRCODE = 'SP004';
    END IF;

    IF p_action NOT IN ('APPROVE','PARTIAL_APPROVE','REJECT','ESCALATE','RETURN','COMMENT') THEN
        RAISE EXCEPTION 'Action % cannot be taken at a review stage', p_action
            USING ERRCODE = 'SP005';
    END IF;

    IF p_action = 'ESCALATE' AND v_is_final THEN
        RAISE EXCEPTION 'Stage % is the final authority and cannot escalate', v_stage_code
            USING ERRCODE = 'SP006';
    END IF;

    IF p_action = 'REJECT' AND COALESCE(TRIM(p_rejection_reason), '') = '' THEN
        RAISE EXCEPTION 'A rejection requires a reason'
            USING ERRCODE = 'SP007';
    END IF;

    IF p_action = 'PARTIAL_APPROVE'
       AND (p_item_decisions IS NULL OR jsonb_array_length(p_item_decisions) = 0) THEN
        RAISE EXCEPTION 'A partial approval must specify item decisions'
            USING ERRCODE = 'SP008';
    END IF;

    IF p_signature_hash IS NOT NULL THEN
        INSERT INTO digital_signatures (user_id, signed_hash)
        VALUES (p_actor_id, p_signature_hash)
        RETURNING signature_id INTO v_signature_id;
    END IF;

    -- Work out where the request lands. APPROVE / PARTIAL_APPROVE are left
    -- NULL here and resolved from the item statuses further down.
    IF p_action = 'REJECT' THEN
        v_new_status := 'REJECTED';
        v_new_stage  := v_req.current_stage_id;

    ELSIF p_action = 'ESCALATE' THEN
        v_next_stage := fn_next_stage(v_req.current_stage_id);
        IF v_next_stage IS NULL THEN
            RAISE EXCEPTION 'No stage exists above %', v_stage_code
                USING ERRCODE = 'SP009';
        END IF;
        v_new_stage  := v_next_stage;
        v_new_status := fn_stage_status(
            (SELECT code FROM workflow_stages WHERE stage_id = v_next_stage));

    ELSIF p_action IN ('COMMENT','RETURN') THEN
        v_new_status := v_req.current_status;
        v_new_stage  := v_req.current_stage_id;

    ELSE
        v_new_status := NULL;
        v_new_stage  := v_req.current_stage_id;
    END IF;

    INSERT INTO approval_actions (
        request_id, stage_id, performed_by, action,
        previous_status, new_status, amount_requested_snapshot,
        rejection_reason, comments, signature_id)
    VALUES (
        p_request_id, v_req.current_stage_id, p_actor_id, p_action,
        v_req.current_status, v_new_status, v_req.tentative_total_cost,
        p_rejection_reason, p_comments, v_signature_id)
    RETURNING action_id INTO v_action_id;

    -- ---- item-level decisions -------------------------------------------

    IF p_item_decisions IS NOT NULL AND jsonb_array_length(p_item_decisions) > 0 THEN

        INSERT INTO approval_action_items (
            action_id, request_item_id, request_id,
            approved_quantity, approved_amount, item_decision, remarks)
        SELECT
            v_action_id,
            ri.request_item_id,
            p_request_id,
            (d->>'approved_quantity')::NUMERIC,
            (d->>'approved_amount')::NUMERIC,
            (CASE
                WHEN (d->>'approved_quantity')::NUMERIC = 0 THEN 'REJECTED'
                WHEN (d->>'approved_quantity')::NUMERIC >= ri.requested_quantity THEN 'APPROVED'
                ELSE 'PARTIALLY_APPROVED'
             END)::request_item_status,
            d->>'remarks'
        FROM jsonb_array_elements(p_item_decisions) d
        JOIN request_items ri
          ON ri.request_item_id = (d->>'request_item_id')::UUID
         AND ri.request_id      = p_request_id;

        GET DIAGNOSTICS v_decided = ROW_COUNT;
        IF v_decided <> jsonb_array_length(p_item_decisions) THEN
            RAISE EXCEPTION
                'Item decisions reference % line item(s) that do not belong to request %',
                jsonb_array_length(p_item_decisions) - v_decided, v_req.request_number
                USING ERRCODE = 'SP010';
        END IF;

        UPDATE request_items ri
           SET approved_quantity = aai.approved_quantity,
               approved_amount   = aai.approved_amount,
               item_status       = aai.item_decision,
               remarks           = COALESCE(aai.remarks, ri.remarks)
          FROM approval_action_items aai
         WHERE aai.action_id       = v_action_id
           AND aai.request_item_id = ri.request_item_id;

    ELSIF p_action = 'APPROVE' THEN
        -- Approve everything as requested.
        INSERT INTO approval_action_items (
            action_id, request_item_id, request_id,
            approved_quantity, approved_amount, item_decision)
        SELECT v_action_id, ri.request_item_id, p_request_id,
               ri.requested_quantity, ri.estimated_total, 'APPROVED'
        FROM request_items ri
        WHERE ri.request_id = p_request_id;

        UPDATE request_items
           SET approved_quantity = requested_quantity,
               approved_amount   = estimated_total,
               item_status       = 'APPROVED'
         WHERE request_id = p_request_id;
    END IF;

    -- ---- resolve the request-level status --------------------------------

    IF v_new_status IS NULL THEN
        SELECT count(*),
               count(*) FILTER (WHERE item_status = 'APPROVED'),
               count(*) FILTER (WHERE item_status = 'REJECTED')
          INTO v_total, v_approved, v_rejected
        FROM request_items WHERE request_id = p_request_id;

        v_new_status := CASE
            WHEN v_total = 0                              THEN 'APPROVED'
            WHEN v_rejected = v_total                     THEN 'REJECTED'
            WHEN v_approved = v_total                     THEN 'APPROVED'
            ELSE 'PARTIALLY_APPROVED'
        END::request_status;

        UPDATE approval_actions SET new_status = v_new_status WHERE action_id = v_action_id;
    END IF;

    UPDATE requests
       SET current_status   = v_new_status,
           current_stage_id = v_new_stage,
           closed_at        = CASE WHEN v_new_status = 'REJECTED' THEN NOW() ELSE closed_at END
     WHERE request_id = p_request_id;

    -- sanctioned_amount is maintained by trigger on request_items; copy the
    -- settled figure onto the action so the timeline shows what was granted.
    -- Only decisions that actually grant money carry an amount â€” an escalate
    -- or a comment leaves it NULL rather than recording a misleading zero.
    IF p_action IN ('APPROVE', 'PARTIAL_APPROVE') THEN
        UPDATE approval_actions a
           SET amount_approved = r.sanctioned_amount
          FROM requests r
         WHERE a.action_id = v_action_id
           AND r.request_id = p_request_id;
    END IF;

    INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
    VALUES ('request', p_request_id::TEXT, p_actor_id, p_action::TEXT,
            jsonb_build_object('status', v_req.current_status, 'stage_id', v_req.current_stage_id),
            jsonb_build_object('status', v_new_status,        'stage_id', v_new_stage));

    RETURN v_action_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_carry_forward_request(
    p_request_id   UUID,
    p_new_fy_id    INTEGER,
    p_actor_id     UUID
) RETURNS UUID AS $$
DECLARE
    v_new_id UUID;
    v_src    requests%ROWTYPE;
BEGIN
    -- Same rule as fn_record_action: the recorded actor must be the session user.
    IF app_current_user_id() IS NOT NULL
       AND p_actor_id IS DISTINCT FROM app_current_user_id() THEN
        RAISE EXCEPTION 'Actor % does not match the authenticated user', p_actor_id
            USING ERRCODE = 'SP013';
    END IF;

    SELECT * INTO v_src FROM requests WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request % not found', p_request_id
            USING ERRCODE = 'SP001';
    END IF;

    -- Only unfinished work carries forward. A decided or already-moved request
    -- has nothing left to continue.
    IF v_src.current_status IN ('REJECTED','CLOSED','FULFILLED','CARRIED_FORWARD') THEN
        RAISE EXCEPTION 'Request % cannot be carried forward (status = %)',
            v_src.request_number, v_src.current_status
            USING ERRCODE = 'SP014';
    END IF;

    IF (SELECT start_date FROM financial_years WHERE financial_year_id = p_new_fy_id)
       <= (SELECT start_date FROM financial_years WHERE financial_year_id = v_src.financial_year_id) THEN
        RAISE EXCEPTION 'Target financial year must be later than the request''s current year'
            USING ERRCODE = 'SP015';
    END IF;

    INSERT INTO requests (
        request_number, raised_by, department_id, course_id,
        financial_year_id, budget_head_id, title, description,
        tentative_total_cost, current_status, current_stage_id,
        extra,
        carried_forward_from_request_id, carried_forward_from_fy_id
    )
    SELECT
        r.request_number || '-CF',
        r.raised_by, r.department_id, r.course_id,
        p_new_fy_id, r.budget_head_id, r.title, r.description,
        r.tentative_total_cost, r.current_status, r.current_stage_id,
        r.extra,
        r.request_id, r.financial_year_id
    FROM requests r WHERE r.request_id = p_request_id
    RETURNING request_id INTO v_new_id;

    -- Copy line items so they're editable in the new context.
    INSERT INTO request_items (
        request_id, budget_item_id, item_type_snapshot,
        requested_quantity, estimated_unit_cost, estimated_total,
        approved_quantity, approved_amount, item_status, remarks
    )
    SELECT v_new_id, budget_item_id, item_type_snapshot,
           requested_quantity, estimated_unit_cost, estimated_total,
           approved_quantity, approved_amount, item_status, remarks
    FROM request_items WHERE request_id = p_request_id;

    -- Mark the original as CARRIED_FORWARD.
    UPDATE requests
       SET current_status = 'CARRIED_FORWARD',
           closed_at      = NOW()
     WHERE request_id = p_request_id;

    INSERT INTO approval_actions (request_id, performed_by, action,
                                  previous_status, new_status,
                                  comments)
    VALUES (p_request_id, p_actor_id, 'CARRY_FORWARD',
            (SELECT current_status FROM requests WHERE request_id = v_new_id),
            'CARRIED_FORWARD',
            'Carried forward to request ' || v_new_id::text);

    RETURN v_new_id;
END;
$$ LANGUAGE plpgsql;

-- helpers --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_principal_can_read(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT app_has_role('PRINCIPAL')
       AND EXISTS (
            SELECT 1 FROM requests r
            WHERE r.request_id = p_request_id
              AND r.current_status <> 'DRAFT'
       );
$$;

CREATE OR REPLACE FUNCTION app_can_see_issue(p_issue_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT app_has_role('PRINCIPAL')
        OR EXISTS (
            SELECT 1 FROM issues i
            WHERE i.issue_id = p_issue_id
              AND app_current_user_id() IN (i.raised_by, i.assigned_to, i.escalated_to)
        );
$$;

-- 2, 4 requests --------------------------------------------------------------
DROP POLICY IF EXISTS requests_principal_read ON requests;
CREATE POLICY requests_principal_read ON requests
    FOR SELECT
    USING (app_has_role('PRINCIPAL') AND current_status <> 'DRAFT');

DROP POLICY IF EXISTS requests_approver_update ON requests;
CREATE POLICY requests_approver_update ON requests
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM stage_approvers sa
            WHERE sa.user_id = app_current_user_id()
              AND sa.stage_id = requests.current_stage_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM stage_approvers sa
            JOIN workflow_stages mine   ON mine.stage_id   = sa.stage_id
            JOIN workflow_stages target ON target.stage_id = requests.current_stage_id
            WHERE sa.user_id = app_current_user_id()
              AND target.sequence_no >= mine.sequence_no
        )
    );

DROP POLICY IF EXISTS request_items_principal_read ON request_items;
CREATE POLICY request_items_principal_read ON request_items
    FOR SELECT
    USING (app_principal_can_read(request_id));

DROP POLICY IF EXISTS approval_actions_principal_read ON approval_actions;
CREATE POLICY approval_actions_principal_read ON approval_actions
    FOR SELECT
    USING (app_principal_can_read(request_id));

-- 5, 6 comments --------------------------------------------------------------
DROP POLICY IF EXISTS comments_visibility ON comments;
CREATE POLICY comments_visibility ON comments
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR author_user_id = app_current_user_id()
        OR (
            (app_can_see_request(request_id) OR app_principal_can_read(request_id))
            AND (
                visibility = 'ALL'
                OR (
                    visibility = 'UP_CHAIN'
                    AND (
                        app_has_role('PRINCIPAL')
                        OR EXISTS (
                            SELECT 1
                            FROM stage_approvers sa
                            JOIN workflow_stages viewer ON viewer.stage_id = sa.stage_id
                            JOIN workflow_stages author ON author.stage_id = comments.stage_id
                            WHERE sa.user_id = app_current_user_id()
                              AND viewer.sequence_no >= author.sequence_no
                        )
                    )
                )
                OR (
                    visibility = 'STAGE_ONLY'
                    AND EXISTS (
                        SELECT 1 FROM stage_approvers sa
                        WHERE sa.user_id = app_current_user_id()
                          AND sa.stage_id = comments.stage_id
                    )
                )
            )
        )
    );

DROP POLICY IF EXISTS comments_insert ON comments;
CREATE POLICY comments_insert ON comments
    FOR INSERT
    WITH CHECK (
        author_user_id = app_current_user_id()
        AND (
            app_has_role('ADMIN')
            OR app_can_see_request(request_id)
            OR app_principal_can_read(request_id)
        )
    );

-- 7 attachments --------------------------------------------------------------
DROP POLICY IF EXISTS attachments_via_request ON attachments;

DROP POLICY IF EXISTS attachments_read ON attachments;
CREATE POLICY attachments_read ON attachments
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR uploaded_by = app_current_user_id()
        OR (request_id IS NOT NULL
            AND (app_can_see_request(request_id) OR app_principal_can_read(request_id)))
        OR (issue_id IS NOT NULL AND app_can_see_issue(issue_id))
    );

DROP POLICY IF EXISTS attachments_insert ON attachments;
CREATE POLICY attachments_insert ON attachments
    FOR INSERT
    WITH CHECK (
        uploaded_by = app_current_user_id()
        AND (
            app_has_role('ADMIN')
            OR (request_id IS NOT NULL AND app_can_see_request(request_id))
            OR (issue_id   IS NOT NULL AND app_can_see_issue(issue_id))
        )
    );

DROP POLICY IF EXISTS attachments_delete ON attachments;
CREATE POLICY attachments_delete ON attachments
    FOR DELETE
    USING (app_has_role('ADMIN') OR uploaded_by = app_current_user_id());

-- 8 issues -------------------------------------------------------------------
DROP POLICY IF EXISTS issues_participants ON issues;

DROP POLICY IF EXISTS issues_read ON issues;
CREATE POLICY issues_read ON issues
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR app_current_user_id() IN (raised_by, assigned_to, escalated_to)
    );

DROP POLICY IF EXISTS issues_insert ON issues;
CREATE POLICY issues_insert ON issues
    FOR INSERT
    WITH CHECK (app_has_role('ADMIN') OR raised_by = app_current_user_id());

DROP POLICY IF EXISTS issues_update ON issues;
CREATE POLICY issues_update ON issues
    FOR UPDATE
    USING (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR app_current_user_id() IN (raised_by, assigned_to, escalated_to)
    )
    WITH CHECK (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR app_current_user_id() IN (raised_by, assigned_to, escalated_to)
    );

-- 10 numbering ---------------------------------------------------------------
-- Human-readable numbers for requests and issues.
--
-- Generated by the database from sequences, so two people submitting at the
-- same moment can never be handed the same number. An application that
-- counted existing rows and added one would race.
--
-- Callers that supply their own number (seed data, tests, carry-forward's
-- "-CF" suffix) still can; the default applies only when the column is omitted.

CREATE SEQUENCE IF NOT EXISTS request_number_seq;
CREATE SEQUENCE IF NOT EXISTS issue_number_seq;

GRANT USAGE, SELECT ON SEQUENCE request_number_seq TO app_user;
GRANT USAGE, SELECT ON SEQUENCE issue_number_seq   TO app_user;

-- lpad() truncates a value longer than the target width, so a plain
-- lpad(n, 4) would turn request 12345 into '1234' and collide with an
-- earlier number. The width grows with the value instead.
CREATE OR REPLACE FUNCTION fn_pad_number(p_n BIGINT, p_width INT)
RETURNS TEXT AS $$
    SELECT lpad(p_n::TEXT, GREATEST(p_width, length(p_n::TEXT)), '0');
$$ LANGUAGE sql IMMUTABLE;

-- REQ-2026-0001
CREATE OR REPLACE FUNCTION fn_next_request_number()
RETURNS TEXT AS $$
    SELECT 'REQ-' || to_char(NOW(), 'YYYY') || '-' || fn_pad_number(nextval('request_number_seq'), 4);
$$ LANGUAGE sql VOLATILE;

-- ISS-0001
CREATE OR REPLACE FUNCTION fn_next_issue_number()
RETURNS TEXT AS $$
    SELECT 'ISS-' || fn_pad_number(nextval('issue_number_seq'), 4);
$$ LANGUAGE sql VOLATILE;

ALTER TABLE requests ALTER COLUMN request_number SET DEFAULT fn_next_request_number();
ALTER TABLE issues   ALTER COLUMN issue_number   SET DEFAULT fn_next_issue_number();

-- 9 notifications ------------------------------------------------------------
-- Notifications, generated by the database when a request or issue changes.
--
-- WHY TRIGGERS, AND WHY SECURITY DEFINER
-- Notifying someone means inserting a row that belongs to THEM. RLS only lets
-- a user insert their own notifications, so a requester submitting a request
-- could never notify the approvers it now waits on. These trigger functions
-- run as their owner to write those rows. They cannot be called directly â€”
-- a trigger function only runs when its trigger fires â€” so there is no way
-- to use them to send arbitrary notifications.
--
-- Recipients come from roles and stage staffing, never hard-coded addresses,
-- as the design document requires. Only in-app notifications are created;
-- delivering email is left to a worker that reads PENDING EMAIL rows.

-- ---------------------------------------------------------------------------
-- Requests
-- ---------------------------------------------------------------------------
--   enters a review stage   -> every approver staffed at that stage
--   escalated upward        -> additionally the requester, so they know
--   approved / partially approved / rejected / carried forward -> the requester

CREATE OR REPLACE FUNCTION fn_notify_request_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stage_name TEXT;
    v_label      TEXT := lower(replace(NEW.current_status::TEXT, '_', ' '));
BEGIN
    IF left(NEW.current_status::TEXT, 6) = 'UNDER_' THEN
        SELECT name INTO v_stage_name
        FROM workflow_stages WHERE stage_id = NEW.current_stage_id;

        INSERT INTO notifications (user_id, request_id, subject, body)
        SELECT sa.user_id, NEW.request_id,
               'Request ' || NEW.request_number || ' awaits your review',
               NEW.title || ' is now with ' || v_stage_name || '.'
        FROM stage_approvers sa
        WHERE sa.stage_id = NEW.current_stage_id;

        IF left(OLD.current_status::TEXT, 6) = 'UNDER_' THEN
            INSERT INTO notifications (user_id, request_id, subject, body)
            VALUES (NEW.raised_by, NEW.request_id,
                    'Request ' || NEW.request_number || ' escalated',
                    'Forwarded to ' || v_stage_name || ' for review.');
        END IF;

    ELSIF NEW.current_status IN ('APPROVED','PARTIALLY_APPROVED','REJECTED','CARRIED_FORWARD') THEN
        INSERT INTO notifications (user_id, request_id, subject, body)
        VALUES (NEW.raised_by, NEW.request_id,
                'Request ' || NEW.request_number || ' ' || v_label,
                CASE
                    WHEN NEW.current_status IN ('APPROVED','PARTIALLY_APPROVED')
                        THEN 'Sanctioned amount: ' || COALESCE(NEW.sanctioned_amount, 0)::TEXT
                             || ' of ' || NEW.tentative_total_cost::TEXT || ' requested.'
                    ELSE NEW.title
                END);
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS requests_notify_status ON requests;
CREATE TRIGGER requests_notify_status
    AFTER UPDATE OF current_status ON requests
    FOR EACH ROW
    WHEN (OLD.current_status IS DISTINCT FROM NEW.current_status)
    EXECUTE FUNCTION fn_notify_request_status();

-- ---------------------------------------------------------------------------
-- Non-financial issues
-- ---------------------------------------------------------------------------
--   raised              -> every Principal
--   status changes      -> the raiser
--   assigned            -> the new assignee
--   escalated to someone -> that person

CREATE OR REPLACE FUNCTION fn_notify_issue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        SELECT ur.user_id, NEW.issue_id,
               'New issue ' || NEW.issue_number, NEW.title
        FROM user_roles ur
        JOIN roles r ON r.role_id = ur.role_id
        WHERE r.code = 'PRINCIPAL'
          AND ur.user_id <> NEW.raised_by;
        RETURN NULL;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        VALUES (NEW.raised_by, NEW.issue_id,
                'Issue ' || NEW.issue_number || ' is now '
                    || lower(replace(NEW.status::TEXT, '_', ' ')),
                NEW.title);
    END IF;

    IF NEW.assigned_to IS NOT NULL
       AND NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        VALUES (NEW.assigned_to, NEW.issue_id,
                'Issue ' || NEW.issue_number || ' assigned to you', NEW.title);
    END IF;

    IF NEW.escalated_to IS NOT NULL
       AND NEW.escalated_to IS DISTINCT FROM OLD.escalated_to THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        VALUES (NEW.escalated_to, NEW.issue_id,
                'Issue ' || NEW.issue_number || ' escalated to you', NEW.title);
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS issues_notify_insert ON issues;
CREATE TRIGGER issues_notify_insert
    AFTER INSERT ON issues
    FOR EACH ROW
    EXECUTE FUNCTION fn_notify_issue();

DROP TRIGGER IF EXISTS issues_notify_update ON issues;
CREATE TRIGGER issues_notify_update
    AFTER UPDATE OF status, assigned_to, escalated_to ON issues
    FOR EACH ROW
    EXECUTE FUNCTION fn_notify_issue();

-- Databases built before 17_schema_migrations.sql existed may lack the table.
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (filename)
VALUES ('20260911T120000_backend_rls_fixes.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

-- Indian number formatting in notifications.
--
-- Notifications announced amounts as raw numbers ("Sanctioned amount:
-- 300000.00 of 650000.00 requested"). fn_inr writes them the way the college
-- does, grouping the last three digits and then twos, which to_char cannot do.
-- The email templates will need the same function.

BEGIN;

CREATE OR REPLACE FUNCTION fn_inr(p_amount NUMERIC)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    v_sign TEXT := CASE WHEN p_amount < 0 THEN '-' ELSE '' END;
    v_text TEXT := to_char(round(abs(COALESCE(p_amount, 0)), 2), 'FM9999999999990.00');
    v_int  TEXT := split_part(v_text, '.', 1);
    v_frac TEXT := split_part(v_text, '.', 2);
    v_head TEXT;
BEGIN
    IF length(v_int) <= 3 THEN
        RETURN v_sign || 'â‚¹' || v_int || '.' || v_frac;
    END IF;
    -- Group everything before the final three digits in pairs, right to left.
    v_head := reverse(regexp_replace(reverse(left(v_int, length(v_int) - 3)),
                                     '(\d{2})(?=\d)', '\1,', 'g'));
    RETURN v_sign || 'â‚¹' || v_head || ',' || right(v_int, 3) || '.' || v_frac;
END;
$$;

CREATE OR REPLACE FUNCTION fn_notify_request_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stage_name TEXT;
    v_label      TEXT := lower(replace(NEW.current_status::TEXT, '_', ' '));
BEGIN
    IF left(NEW.current_status::TEXT, 6) = 'UNDER_' THEN
        SELECT name INTO v_stage_name
        FROM workflow_stages WHERE stage_id = NEW.current_stage_id;

        INSERT INTO notifications (user_id, request_id, subject, body)
        SELECT sa.user_id, NEW.request_id,
               'Request ' || NEW.request_number || ' awaits your review',
               NEW.title || ' is now with ' || v_stage_name || '.'
        FROM stage_approvers sa
        WHERE sa.stage_id = NEW.current_stage_id;

        IF left(OLD.current_status::TEXT, 6) = 'UNDER_' THEN
            INSERT INTO notifications (user_id, request_id, subject, body)
            VALUES (NEW.raised_by, NEW.request_id,
                    'Request ' || NEW.request_number || ' escalated',
                    'Forwarded to ' || v_stage_name || ' for review.');
        ELSIF OLD.current_status = 'AWAITING_RESUBMISSION' THEN
            INSERT INTO notifications (user_id, request_id, subject, body)
            VALUES (NEW.raised_by, NEW.request_id,
                    'Request ' || NEW.request_number || ' resubmitted',
                    'Resubmitted to ' || v_stage_name || ' for review.');
        END IF;

    ELSIF NEW.current_status = 'AWAITING_RESUBMISSION' THEN
        INSERT INTO notifications (user_id, request_id, subject, body)
        VALUES (NEW.raised_by, NEW.request_id,
                'Request ' || NEW.request_number || ' returned for correction',
                'Sent back for correction. Please review remarks and resubmit.');

    ELSIF NEW.current_status IN ('APPROVED','PARTIALLY_APPROVED','REJECTED','CARRIED_FORWARD') THEN
        INSERT INTO notifications (user_id, request_id, subject, body)
        VALUES (NEW.raised_by, NEW.request_id,
                'Request ' || NEW.request_number || ' ' || v_label,
                CASE
                    WHEN NEW.current_status IN ('APPROVED','PARTIALLY_APPROVED')
                        THEN 'Sanctioned ' || fn_inr(COALESCE(NEW.sanctioned_amount, 0))
                             || ' of ' || fn_inr(NEW.tentative_total_cost) || ' requested.'
                    ELSE NEW.title
                END);
    END IF;

    RETURN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (filename)
VALUES ('20260912T090000_indian_number_format.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;

