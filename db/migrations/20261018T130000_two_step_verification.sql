-- Migration: 20261018T130000_two_step_verification.sql
-- Description: 2-step verification (authenticator app codes) with one-time
-- recovery codes. Required for the roles in auth.mfa_required_roles
-- (default: ADMIN).
--
-- Authenticator secrets are stored AES-256-GCM encrypted with
-- MFA_ENCRYPTION_KEY, which lives only in the server environment; recovery
-- codes only as HMAC-SHA256 keyed with it. Set MFA_ENCRYPTION_KEY before
-- deploying the code that uses these columns.
--
-- Mirrored in db/schema/02_master_data.sql.

BEGIN;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS mfa_secret_enc         TEXT,
    ADD COLUMN IF NOT EXISTS mfa_pending_secret_enc TEXT,
    ADD COLUMN IF NOT EXISTS mfa_enabled_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS mfa_last_step          BIGINT;

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
    code_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    code_hash  TEXT NOT NULL,
    used_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, code_hash)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes TO app_user;

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations (filename) VALUES ('20261018T130000_two_step_verification.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
