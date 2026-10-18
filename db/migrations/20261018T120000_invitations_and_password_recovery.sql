-- Migration: 20261018T120000_invitations_and_password_recovery.sql
-- Description: Email invitations, password reset links, confirmed email
-- changes and database-backed sign-in lockout.
--
-- * One-time links (account_setup_tokens) gain a purpose — INVITE,
--   PASSWORD_RESET or EMAIL_CHANGE — the address they were sent to, a revoke
--   marker and the requester's IP; at most one live link per person per purpose.
-- * users gain invitation/activation history and lockout counters.
-- * Invitation functions accept only live invitation links; new definer
--   functions issue, verify and use reset and email-change links.
-- * The retired self_registration.enabled setting is removed.
--
-- Mirrored in db/schema/02_master_data.sql and db/schema/12_functions.sql.

BEGIN;

-- ── users: invitation history and lockout ──────────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS invited_by          UUID REFERENCES users(user_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS invited_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS activated_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS failed_login_count  INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until        TIMESTAMPTZ;

-- Accounts that already have a real password have been activated.
UPDATE users
   SET activated_at = created_at
 WHERE activated_at IS NULL
   AND password_hash NOT LIKE '$2a$12$unusable.placeholder%';

-- ── one-time links: purpose and binding ───────────────────────────────────
ALTER TABLE account_setup_tokens
    ADD COLUMN IF NOT EXISTS purpose       TEXT NOT NULL DEFAULT 'INVITE'
                                           CHECK (purpose IN ('INVITE', 'PASSWORD_RESET', 'EMAIL_CHANGE')),
    ADD COLUMN IF NOT EXISTS sent_to_email CITEXT,
    ADD COLUMN IF NOT EXISTS new_email     CITEXT,
    ADD COLUMN IF NOT EXISTS requested_ip  TEXT,
    ADD COLUMN IF NOT EXISTS revoked_at    TIMESTAMPTZ;

-- Keep only the newest live link per person and purpose before the rule below.
UPDATE account_setup_tokens t
   SET revoked_at = NOW()
 WHERE t.used_at IS NULL
   AND t.revoked_at IS NULL
   AND EXISTS (
        SELECT 1 FROM account_setup_tokens newer
         WHERE newer.user_id = t.user_id
           AND newer.purpose = t.purpose
           AND newer.used_at IS NULL
           AND newer.revoked_at IS NULL
           AND (newer.created_at, newer.token_id) > (t.created_at, t.token_id));

CREATE UNIQUE INDEX IF NOT EXISTS account_setup_tokens_one_live
    ON account_setup_tokens(user_id, purpose)
    WHERE used_at IS NULL AND revoked_at IS NULL;

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
    SELECT t.token_id, t.user_id, t.expires_at, t.used_at, t.revoked_at, t.sent_to_email,
           u.email, u.full_name, u.is_active
      INTO v_token
      FROM account_setup_tokens t
      JOIN users u ON u.user_id = t.user_id
     WHERE t.token_hash = p_token_hash
       AND t.purpose = 'INVITE';

    -- Unknown, or sent to an address the account no longer has.
    IF NOT FOUND OR (v_token.sent_to_email IS NOT NULL AND v_token.sent_to_email <> v_token.email) THEN
        RETURN QUERY SELECT 'INVALID'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT;
        RETURN;
    END IF;

    IF v_token.revoked_at IS NOT NULL THEN
        RETURN QUERY SELECT 'REVOKED'::TEXT, v_token.user_id, v_token.email::TEXT, v_token.full_name;
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

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
    END IF;
END
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
    SELECT t.token_id, t.user_id, t.expires_at, t.used_at, t.revoked_at, t.sent_to_email, u.email
      INTO v_token
      FROM account_setup_tokens t
      JOIN users u ON u.user_id = t.user_id
     WHERE t.token_hash = p_token_hash
       AND t.purpose = 'INVITE'
       FOR UPDATE OF t;

    IF NOT FOUND OR (v_token.sent_to_email IS NOT NULL AND v_token.sent_to_email <> v_token.email) THEN
        RAISE EXCEPTION 'Setup token is invalid or unknown'
            USING ERRCODE = 'ST001';
    END IF;

    IF v_token.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Setup token was revoked'
            USING ERRCODE = 'ST004';
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
           activated_at = COALESCE(activated_at, NOW()),
           password_changed_at = NOW(),
           failed_login_count = 0,
           locked_until = NULL,
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

-- ---------------------------------------------------------------------------
-- Password reset links
-- ---------------------------------------------------------------------------
-- Anyone may ask for a reset link, signed in or not, so issuing runs here with
-- the definer's rights instead of opening the token table to everyone. Only
-- an active account gets a link; the caller learns nothing either way (the
-- API answers the same whatever this returns). A new link revokes the last.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_issue_password_reset(
    p_email TEXT,
    p_token_hash TEXT,
    p_ttl_minutes INTEGER,
    p_ip TEXT
)
RETURNS TABLE (user_id UUID, email TEXT, full_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
    v_user RECORD;
BEGIN
    IF p_ttl_minutes IS NULL OR p_ttl_minutes < 10 OR p_ttl_minutes > 1440 THEN
        RAISE EXCEPTION 'Reset link lifetime must be between 10 and 1440 minutes'
            USING ERRCODE = 'ST010';
    END IF;

    SELECT u.user_id, u.email, u.full_name INTO v_user
      FROM users u
     WHERE u.email = p_email AND u.is_active;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE account_setup_tokens
       SET revoked_at = NOW()
     WHERE account_setup_tokens.user_id = v_user.user_id
       AND account_setup_tokens.purpose = 'PASSWORD_RESET'
       AND account_setup_tokens.used_at IS NULL
       AND account_setup_tokens.revoked_at IS NULL;

    INSERT INTO account_setup_tokens (user_id, token_hash, expires_at, purpose, sent_to_email, requested_ip)
    VALUES (v_user.user_id, p_token_hash, NOW() + make_interval(mins => p_ttl_minutes),
            'PASSWORD_RESET', v_user.email, p_ip);

    INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
    VALUES ('user', v_user.user_id::TEXT, NULL, 'PASSWORD_RESET_REQUESTED', jsonb_build_object('ip', p_ip));

    RETURN QUERY SELECT v_user.user_id, v_user.email::TEXT, v_user.full_name;
END;
$$;

REVOKE ALL ON FUNCTION fn_issue_password_reset(TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_issue_password_reset(TEXT, TEXT, INTEGER, TEXT) TO app_user;

-- Whether a reset link can still be used, without using it.
CREATE OR REPLACE FUNCTION fn_verify_password_reset(p_token_hash TEXT)
RETURNS TABLE (status TEXT, user_id UUID, email TEXT, full_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v RECORD;
BEGIN
    SELECT t.user_id, t.expires_at, t.used_at, t.revoked_at, t.sent_to_email,
           u.email, u.full_name, u.is_active
      INTO v
      FROM account_setup_tokens t
      JOIN users u ON u.user_id = t.user_id
     WHERE t.token_hash = p_token_hash
       AND t.purpose = 'PASSWORD_RESET';

    -- Unknown, the account was deactivated, or its email changed since.
    IF NOT FOUND OR NOT v.is_active OR v.sent_to_email IS DISTINCT FROM v.email THEN
        RETURN QUERY SELECT 'INVALID'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT;
    ELSIF v.revoked_at IS NOT NULL THEN
        RETURN QUERY SELECT 'REVOKED'::TEXT, v.user_id, v.email::TEXT, v.full_name;
    ELSIF v.used_at IS NOT NULL THEN
        RETURN QUERY SELECT 'ALREADY_USED'::TEXT, v.user_id, v.email::TEXT, v.full_name;
    ELSIF v.expires_at < NOW() THEN
        RETURN QUERY SELECT 'EXPIRED'::TEXT, v.user_id, v.email::TEXT, v.full_name;
    ELSE
        RETURN QUERY SELECT 'VALID'::TEXT, v.user_id, v.email::TEXT, v.full_name;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION fn_verify_password_reset(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_verify_password_reset(TEXT) TO app_user;

-- Uses a reset link: sets the new password, signs out every session (the
-- token_version bump), clears any lockout, and records it — atomically, with
-- the link row locked so it can be used only once.
CREATE OR REPLACE FUNCTION fn_consume_password_reset(
    p_token_hash TEXT,
    p_password_hash TEXT,
    p_ip TEXT
)
RETURNS TABLE (user_id UUID, token_version INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v RECORD;
    v_new_version INTEGER;
BEGIN
    SELECT t.token_id, t.user_id, t.expires_at, t.used_at, t.revoked_at, t.sent_to_email,
           u.email, u.is_active
      INTO v
      FROM account_setup_tokens t
      JOIN users u ON u.user_id = t.user_id
     WHERE t.token_hash = p_token_hash
       AND t.purpose = 'PASSWORD_RESET'
       FOR UPDATE OF t;

    IF NOT FOUND OR NOT v.is_active OR v.sent_to_email IS DISTINCT FROM v.email THEN
        RAISE EXCEPTION 'Reset link is invalid or unknown' USING ERRCODE = 'ST001';
    END IF;
    IF v.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Reset link was replaced by a newer one' USING ERRCODE = 'ST004';
    END IF;
    IF v.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'Reset link has already been used' USING ERRCODE = 'ST002';
    END IF;
    IF v.expires_at < NOW() THEN
        RAISE EXCEPTION 'Reset link has expired' USING ERRCODE = 'ST003';
    END IF;

    UPDATE account_setup_tokens SET used_at = NOW() WHERE token_id = v.token_id;

    UPDATE users
       SET password_hash = p_password_hash,
           token_version = COALESCE(token_version, 1) + 1,
           password_changed_at = NOW(),
           failed_login_count = 0,
           locked_until = NULL,
           updated_at = NOW()
     WHERE users.user_id = v.user_id
 RETURNING COALESCE(users.token_version, 1) INTO v_new_version;

    INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, after_json)
    VALUES ('user', v.user_id::TEXT, v.user_id, 'PASSWORD_RESET_COMPLETED', jsonb_build_object('ip', p_ip));

    RETURN QUERY SELECT v.user_id, v_new_version;
END;
$$;

REVOKE ALL ON FUNCTION fn_consume_password_reset(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_consume_password_reset(TEXT, TEXT, TEXT) TO app_user;

-- ---------------------------------------------------------------------------
-- Email change confirmation
-- ---------------------------------------------------------------------------
-- An account's email is how its owner proves who they are, so it changes only
-- when the new address confirms. Until then reset links still go to the old
-- address; confirming revokes every link sent to the old one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_verify_email_change(p_token_hash TEXT)
RETURNS TABLE (status TEXT, user_id UUID, email TEXT, full_name TEXT, new_email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v RECORD;
BEGIN
    SELECT t.user_id, t.expires_at, t.used_at, t.revoked_at, t.new_email, t.sent_to_email,
           u.email, u.full_name
      INTO v
      FROM account_setup_tokens t
      JOIN users u ON u.user_id = t.user_id
     WHERE t.token_hash = p_token_hash
       AND t.purpose = 'EMAIL_CHANGE';

    IF NOT FOUND OR v.new_email IS NULL OR v.sent_to_email IS DISTINCT FROM v.new_email THEN
        RETURN QUERY SELECT 'INVALID'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, NULL::TEXT;
    ELSIF v.revoked_at IS NOT NULL THEN
        RETURN QUERY SELECT 'REVOKED'::TEXT, v.user_id, v.email::TEXT, v.full_name, v.new_email::TEXT;
    ELSIF v.used_at IS NOT NULL THEN
        RETURN QUERY SELECT 'ALREADY_USED'::TEXT, v.user_id, v.email::TEXT, v.full_name, v.new_email::TEXT;
    ELSIF v.expires_at < NOW() THEN
        RETURN QUERY SELECT 'EXPIRED'::TEXT, v.user_id, v.email::TEXT, v.full_name, v.new_email::TEXT;
    ELSE
        RETURN QUERY SELECT 'VALID'::TEXT, v.user_id, v.email::TEXT, v.full_name, v.new_email::TEXT;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION fn_verify_email_change(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_verify_email_change(TEXT) TO app_user;

CREATE OR REPLACE FUNCTION fn_consume_email_change(p_token_hash TEXT, p_ip TEXT)
RETURNS TABLE (user_id UUID, old_email TEXT, new_email TEXT, token_version INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v RECORD;
    v_new_version INTEGER;
BEGIN
    SELECT t.token_id, t.user_id, t.expires_at, t.used_at, t.revoked_at, t.new_email, t.sent_to_email,
           u.email
      INTO v
      FROM account_setup_tokens t
      JOIN users u ON u.user_id = t.user_id
     WHERE t.token_hash = p_token_hash
       AND t.purpose = 'EMAIL_CHANGE'
       FOR UPDATE OF t;

    IF NOT FOUND OR v.new_email IS NULL OR v.sent_to_email IS DISTINCT FROM v.new_email THEN
        RAISE EXCEPTION 'Confirmation link is invalid or unknown' USING ERRCODE = 'ST001';
    END IF;
    IF v.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Confirmation link was replaced by a newer one' USING ERRCODE = 'ST004';
    END IF;
    IF v.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'Confirmation link has already been used' USING ERRCODE = 'ST002';
    END IF;
    IF v.expires_at < NOW() THEN
        RAISE EXCEPTION 'Confirmation link has expired' USING ERRCODE = 'ST003';
    END IF;
    IF EXISTS (SELECT 1 FROM users o WHERE o.email = v.new_email AND o.user_id <> v.user_id) THEN
        RAISE EXCEPTION 'Another account already uses that email address' USING ERRCODE = 'ST005';
    END IF;

    UPDATE account_setup_tokens SET used_at = NOW() WHERE token_id = v.token_id;

    -- Links sent to the old address must not keep working.
    UPDATE account_setup_tokens
       SET revoked_at = NOW()
     WHERE account_setup_tokens.user_id = v.user_id
       AND account_setup_tokens.token_id <> v.token_id
       AND account_setup_tokens.used_at IS NULL
       AND account_setup_tokens.revoked_at IS NULL;

    UPDATE users
       SET email = v.new_email,
           token_version = COALESCE(token_version, 1) + 1,
           updated_at = NOW()
     WHERE users.user_id = v.user_id
 RETURNING COALESCE(users.token_version, 1) INTO v_new_version;

    INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
    VALUES ('user', v.user_id::TEXT, v.user_id, 'EMAIL_CHANGED',
            jsonb_build_object('email', v.email::TEXT),
            jsonb_build_object('email', v.new_email::TEXT, 'ip', p_ip));

    RETURN QUERY SELECT v.user_id, v.email::TEXT, v.new_email::TEXT, v_new_version;
END;
$$;

REVOKE ALL ON FUNCTION fn_consume_email_change(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_consume_email_change(TEXT, TEXT) TO app_user;

-- ── retired setting ───────────────────────────────────────────────────────
DELETE FROM system_configurations WHERE key = 'self_registration.enabled';

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO schema_migrations (filename) VALUES ('20261018T120000_invitations_and_password_recovery.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
