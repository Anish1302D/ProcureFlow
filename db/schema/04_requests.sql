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
    current_version_number INTEGER NOT NULL DEFAULT 1,
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
    recommended_quantity NUMERIC(12,2) DEFAULT NULL,
    recommended_amount   NUMERIC(14,2) DEFAULT NULL,
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

CREATE TABLE correction_requests (
    correction_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id               UUID NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
    requested_by             UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    requested_at_stage_id    INTEGER NOT NULL REFERENCES workflow_stages(stage_id),
    previous_status          request_status NOT NULL,
    reason                   TEXT NOT NULL,
    fields_to_correct        JSONB DEFAULT '[]'::jsonb,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at              TIMESTAMPTZ,
    resolved_by_version      INTEGER
);

CREATE INDEX correction_requests_request_idx ON correction_requests(request_id);

CREATE TABLE request_versions (
    version_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id              UUID NOT NULL REFERENCES requests(request_id) ON DELETE CASCADE,
    version_number          INTEGER NOT NULL,
    title                   TEXT NOT NULL,
    description             TEXT,
    department_id           INTEGER REFERENCES departments(department_id),
    course_id               INTEGER REFERENCES courses(course_id),
    financial_year_id       INTEGER NOT NULL REFERENCES financial_years(financial_year_id),
    budget_head_id          INTEGER NOT NULL REFERENCES budget_heads(budget_head_id),
    tentative_total_cost    NUMERIC(14,2) NOT NULL,
    extra                   JSONB NOT NULL DEFAULT '{}'::jsonb,
    items_snapshot          JSONB NOT NULL,
    documents_snapshot      JSONB NOT NULL DEFAULT '[]'::jsonb,
    submitted_by            UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    submitted_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    correction_id           UUID REFERENCES correction_requests(correction_id),
    UNIQUE(request_id, version_number)
);

CREATE INDEX request_versions_request_idx ON request_versions(request_id, version_number);
