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
    stage_id              INTEGER NOT NULL REFERENCES workflow_stages(stage_id) ON DELETE CASCADE,
    user_id               UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_id               INTEGER REFERENCES roles(role_id),
    member_classification TEXT DEFAULT 'TEACHING' CHECK (member_classification IS NULL OR member_classification IN ('TEACHING', 'NON_TEACHING')),
    PRIMARY KEY (stage_id, user_id)
);

CREATE INDEX stage_approvers_user_idx ON stage_approvers(user_id);
