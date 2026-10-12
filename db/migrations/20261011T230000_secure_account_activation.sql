-- ---------------------------------------------------------------------------
-- Migration: Secure Account Activation & Setup Tokens
-- ---------------------------------------------------------------------------
-- Replaces administrator-entered permanent passwords with single-use,
-- cryptographically hashed, short-lived account setup tokens.
--
-- Security properties:
-- 1. Raw tokens are never stored in the database — only SHA-256 hashes.
-- 2. Tokens are strictly single-use (tracked via used_at).
-- 3. Tokens expire automatically after 24 hours.
-- 4. Accounts remain unactivated (is_active = FALSE) until the invited
--    institutional member completes password setup.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS account_setup_tokens (
    token_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash     TEXT NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    used_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS account_setup_tokens_user_idx ON account_setup_tokens(user_id);
CREATE INDEX IF NOT EXISTS account_setup_tokens_hash_idx ON account_setup_tokens(token_hash);

-- Enable Row Level Security (admin-only / system-only access)
ALTER TABLE account_setup_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_setup_tokens_admin ON account_setup_tokens;
CREATE POLICY account_setup_tokens_admin ON account_setup_tokens
    FOR ALL
    TO app_user
    USING (app_is_admin() OR app_current_user_id() = user_id)
    WITH CHECK (app_is_admin());

-- Register migration
INSERT INTO schema_migrations (filename)
VALUES ('20261011T230000_secure_account_activation.sql')
ON CONFLICT (filename) DO NOTHING;
