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
    role_id              INTEGER REFERENCES roles(role_id) ON DELETE SET NULL,
    action               approval_action_type NOT NULL,
    previous_status      request_status,
    new_status           request_status,
    amount_requested_snapshot NUMERIC(14,2),   -- request total at moment of action
    amount_approved      NUMERIC(14,2),
    rejection_reason     TEXT,
    comments             TEXT,
    signature_id         UUID REFERENCES digital_signatures(signature_id),
    request_version_number INTEGER NOT NULL DEFAULT 1,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX approval_actions_request_idx  ON approval_actions(request_id, created_at);
CREATE INDEX approval_actions_stage_idx    ON approval_actions(stage_id);
CREATE INDEX approval_actions_actor_idx    ON approval_actions(performed_by);
CREATE INDEX approval_actions_role_idx     ON approval_actions(role_id);

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
    recommended_quantity NUMERIC(12,2) DEFAULT NULL,
    recommended_amount  NUMERIC(14,2) DEFAULT NULL,
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
