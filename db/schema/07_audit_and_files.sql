-- Audit log + attachment metadata. Files themselves live in object storage;
-- only the pointer + metadata is stored here.

CREATE TABLE attachments (
    attachment_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id             UUID REFERENCES requests(request_id) ON DELETE CASCADE,
    action_id              UUID REFERENCES approval_actions(action_id) ON DELETE SET NULL,
    issue_id               UUID,                                  -- FK added in 08_non_financial.sql
    budget_provision_id    UUID,                                  -- FK added in 08_non_financial.sql / migration
    file_name              TEXT NOT NULL,
    original_file_name     TEXT,
    mime_type              TEXT,
    size_bytes             BIGINT CHECK (size_bytes IS NULL OR size_bytes >= 0),
    sha256_hash            TEXT,
    storage_path           TEXT NOT NULL,                         -- key in S3/MinIO/local
    storage_backend        TEXT NOT NULL DEFAULT 'local',
    uploaded_by            UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    uploaded_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    version_number         INTEGER NOT NULL DEFAULT 1,
    superseded_by_id       UUID REFERENCES attachments(attachment_id) ON DELETE SET NULL,
    request_version_number INTEGER DEFAULT 1,
    replacement_reason     TEXT
);

CREATE INDEX attachments_request_idx          ON attachments(request_id);
CREATE INDEX attachments_action_idx           ON attachments(action_id);
CREATE INDEX attachments_superseded_idx       ON attachments(superseded_by_id);
CREATE INDEX attachments_budget_provision_idx ON attachments(budget_provision_id);
CREATE INDEX attachments_sha256_idx           ON attachments(sha256_hash);

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
