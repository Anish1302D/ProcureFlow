-- Master data: users, roles, org structure, budgets, financial years.
-- These tables are seeded once and change rarely.

CREATE TABLE roles (
    role_id      SERIAL PRIMARY KEY,
    code         TEXT NOT NULL UNIQUE,          -- e.g. 'PRINCIPAL', 'CDC_GRANT_MEMBER'
    name         TEXT NOT NULL,
    description  TEXT
);

CREATE TABLE departments (
    department_id SERIAL PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    funding_type  course_funding_type NOT NULL DEFAULT 'GRANT'
);

CREATE TABLE users (
    user_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          CITEXT NOT NULL UNIQUE,
    full_name      TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    employee_id    TEXT UNIQUE,
    department_id  INTEGER REFERENCES departments(department_id) ON DELETE SET NULL,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    token_version  INTEGER NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Invitation and account history.
    invited_by          UUID REFERENCES users(user_id) ON DELETE SET NULL,
    invited_at          TIMESTAMPTZ,
    activated_at        TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    -- Sign-in lockout, kept in the database so it survives restarts.
    failed_login_count  INTEGER NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ
);

CREATE TABLE user_roles (
    user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_id    INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role_id)
);

-- One-time links emailed to a person: invitations, password resets and email
-- changes. Only the SHA-256 hash of the link's token is stored; the token
-- itself exists only in the email. A link is bound to the address it was sent
-- to, and a newer link of the same purpose revokes the older one.
CREATE TABLE account_setup_tokens (
    token_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash     TEXT NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    used_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    purpose        TEXT NOT NULL DEFAULT 'INVITE'
                   CHECK (purpose IN ('INVITE', 'PASSWORD_RESET', 'EMAIL_CHANGE')),
    sent_to_email  CITEXT,
    new_email      CITEXT,
    requested_ip   TEXT,
    revoked_at     TIMESTAMPTZ
);

CREATE INDEX account_setup_tokens_user_idx ON account_setup_tokens(user_id);
CREATE INDEX account_setup_tokens_hash_idx ON account_setup_tokens(token_hash);
CREATE UNIQUE INDEX account_setup_tokens_one_live
    ON account_setup_tokens(user_id, purpose)
    WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE courses (
    course_id      SERIAL PRIMARY KEY,
    department_id  INTEGER NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT,
    code           TEXT NOT NULL,
    name           TEXT NOT NULL,
    -- Whether the course is government-aided. It decides which side of CDC a
    -- request belongs to, so it is recorded on the course itself.
    funding_type   course_funding_type NOT NULL DEFAULT 'GRANT',
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

CREATE TABLE system_configurations (
    config_id    SERIAL PRIMARY KEY,
    key          TEXT NOT NULL UNIQUE,
    value        JSONB NOT NULL,
    description  TEXT,
    category     TEXT NOT NULL DEFAULT 'general',
    is_secret    BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   UUID REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX system_configurations_category_idx ON system_configurations(category);
