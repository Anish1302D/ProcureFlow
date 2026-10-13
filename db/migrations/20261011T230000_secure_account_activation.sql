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
    USING (app_has_role('ADMIN'))
    WITH CHECK (app_has_role('ADMIN'));

GRANT SELECT, INSERT, UPDATE, DELETE ON account_setup_tokens TO app_user;


-- ---------------------------------------------------------------------------
-- Function: fn_verify_account_setup_token
-- ---------------------------------------------------------------------------
-- Secure, narrowly scoped public verification for unauthenticated recipients.
-- Does NOT grant table-level SELECT access to app_user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_verify_account_setup_token(p_token_hash TEXT)
RETURNS TABLE (
    status TEXT,
    user_id UUID,
    email TEXT,
    full_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_token RECORD;
BEGIN
    SELECT t.token_id, t.user_id, t.expires_at, t.used_at,
           u.email, u.full_name, u.is_active
      INTO v_token
      FROM account_setup_tokens t
      JOIN users u ON u.user_id = t.user_id
     WHERE t.token_hash = p_token_hash;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 'INVALID'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    IF v_token.used_at IS NOT NULL THEN
        RETURN QUERY SELECT 'ALREADY_USED'::TEXT, v_token.user_id, v_token.email, v_token.full_name;
        RETURN;
    END IF;

    IF v_token.expires_at < NOW() THEN
        RETURN QUERY SELECT 'EXPIRED'::TEXT, v_token.user_id, v_token.email, v_token.full_name;
        RETURN;
    END IF;

    RETURN QUERY SELECT 'VALID'::TEXT, v_token.user_id, v_token.email, v_token.full_name;
END;
$$;

REVOKE ALL ON FUNCTION fn_verify_account_setup_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_verify_account_setup_token(TEXT) TO app_user;

-- ---------------------------------------------------------------------------
-- Function: fn_consume_account_setup_token
-- ---------------------------------------------------------------------------
-- Atomically consumes the token, sets the bcrypt password hash, activates
-- the user account, increments token_version (session security), and writes
-- the audit log in a single transaction with row-level locking (FOR UPDATE).
-- Serializes concurrent requests on the same token to prevent race conditions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_consume_account_setup_token(
    p_token_hash TEXT,
    p_password_hash TEXT,
    p_ip TEXT
)
RETURNS TABLE (
    user_id UUID,
    token_version INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_token RECORD;
    v_new_version INTEGER;
BEGIN
    -- Acquire exclusive row lock on the token row to serialize concurrent setup attempts.
    -- Any simultaneous request blocks here and subsequently sees used_at IS NOT NULL.
    SELECT t.token_id, t.user_id, t.expires_at, t.used_at
      INTO v_token
      FROM account_setup_tokens t
     WHERE t.token_hash = p_token_hash
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Setup token is invalid or unknown'
            USING ERRCODE = 'ST001';
    END IF;

    IF v_token.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'Setup token has already been used'
            USING ERRCODE = 'ST002';
    END IF;

    IF v_token.expires_at < NOW() THEN
        RAISE EXCEPTION 'Setup token has expired'
            USING ERRCODE = 'ST003';
    END IF;

    -- Mark token as used atomically
    UPDATE account_setup_tokens
       SET used_at = NOW()
     WHERE token_id = v_token.token_id;

    -- Set password, activate user, increment token_version for clean session state
    UPDATE users
       SET password_hash = p_password_hash,
           is_active = TRUE,
           token_version = COALESCE(token_version, 1) + 1,
           updated_at = NOW()
     WHERE users.user_id = v_token.user_id
 RETURNING COALESCE(users.token_version, 1) INTO v_new_version;

    -- Record immutable audit log entry in the same transaction
    INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
    VALUES (
        'user',
        v_token.user_id::TEXT,
        v_token.user_id,
        'ACCOUNT_ACTIVATED',
        jsonb_build_object('ip', p_ip)
    );

    RETURN QUERY SELECT v_token.user_id, v_new_version;
END;
$$;

REVOKE ALL ON FUNCTION fn_consume_account_setup_token(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_consume_account_setup_token(TEXT, TEXT, TEXT) TO app_user;

-- Register migration
INSERT INTO schema_migrations (filename)
VALUES ('20261011T230000_secure_account_activation.sql')
ON CONFLICT (filename) DO NOTHING;
