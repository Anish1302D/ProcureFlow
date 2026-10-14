-- Helper functions the app can call so complex writes are one round-trip
-- and stay consistent even if two users act concurrently.

-- Helper functions for querying dynamic configuration values in SQL
CREATE OR REPLACE FUNCTION app_get_config_numeric(p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT (value#>>'{}')::NUMERIC FROM system_configurations WHERE key = p_key),
        p_default
    );
$$;

CREATE OR REPLACE FUNCTION app_get_config_bool(p_key TEXT, p_default BOOLEAN)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT (value#>>'{}')::BOOLEAN FROM system_configurations WHERE key = p_key),
        p_default
    );
$$;

-- Picks the workflow stage a request should enter (Purchase Committee for validity review).
CREATE OR REPLACE FUNCTION fn_route_stage(p_amount NUMERIC)
RETURNS INTEGER AS $$
    SELECT stage_id FROM workflow_stages WHERE code = 'PURCHASE_COMMITTEE';
$$ LANGUAGE sql STABLE;

-- Database-level trigger to enforce stage progression rules
CREATE OR REPLACE FUNCTION fn_enforce_stage_progression()
RETURNS TRIGGER AS $$
DECLARE
    v_principal_stage_id INTEGER;
    v_cdc_stage_id       INTEGER;
    v_final_stage_id     INTEGER;
BEGIN
    SELECT stage_id INTO v_principal_stage_id FROM workflow_stages WHERE code = 'PRINCIPAL';
    SELECT stage_id INTO v_cdc_stage_id       FROM workflow_stages WHERE code = 'CDC';
    SELECT stage_id INTO v_final_stage_id     FROM workflow_stages WHERE code = 'FINAL_AUTHORITY';

    -- Request in AWAITING_RESUBMISSION status cannot be advanced except by resubmission
    IF OLD.current_status = 'AWAITING_RESUBMISSION'
       AND NEW.current_status NOT IN ('AWAITING_RESUBMISSION', 'UNDER_PURCHASE_COMMITTEE_REVIEW', 'UNDER_PRINCIPAL_REVIEW', 'UNDER_CDC_REVIEW', 'UNDER_FINAL_AUTHORITY_REVIEW') THEN
        RAISE EXCEPTION 'Request in AWAITING_RESUBMISSION status cannot be advanced except by resubmission'
            USING ERRCODE = 'SP017';
    END IF;

    -- Cannot enter CDC or FINAL_AUTHORITY without a prior Principal approval
    -- action. A carried-forward copy inherits the stage it left off at, and
    -- its history lives on the request it came from, so that is where the
    -- Principal's decision is looked for.
    IF NEW.current_stage_id IN (v_cdc_stage_id, v_final_stage_id)
       AND (OLD.current_stage_id IS NULL OR OLD.current_stage_id <> NEW.current_stage_id) THEN
        IF NOT EXISTS (
            SELECT 1 FROM approval_actions
            WHERE request_id = COALESCE(NEW.carried_forward_from_request_id, NEW.request_id)
              AND stage_id   = v_principal_stage_id
              AND action IN ('APPROVE', 'PARTIAL_APPROVE', 'ESCALATE', 'FORWARD', 'RETURN')
        ) THEN
            RAISE EXCEPTION 'Request cannot advance to stage % without a prior Principal stage approval action',
                (SELECT code FROM workflow_stages WHERE stage_id = NEW.current_stage_id)
                USING ERRCODE = 'SP016';
        END IF;
    END IF;

    -- Cannot jump from PURCHASE_COMMITTEE directly to CDC or FINAL_AUTHORITY
    IF NEW.current_stage_id IN (v_cdc_stage_id, v_final_stage_id)
       AND OLD.current_stage_id = (SELECT stage_id FROM workflow_stages WHERE code = 'PURCHASE_COMMITTEE') THEN
        RAISE EXCEPTION 'Request cannot skip the Principal stage'
            USING ERRCODE = 'SP016';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_stage_progression ON requests;
CREATE TRIGGER trg_enforce_stage_progression
    BEFORE INSERT OR UPDATE OF current_stage_id ON requests
    FOR EACH ROW
    EXECUTE FUNCTION fn_enforce_stage_progression();

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
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_amount NUMERIC(14,2);
    v_stage  INTEGER;
    v_status request_status;
    v_req    requests%ROWTYPE;
    v_items_json JSONB;
    v_raiser_role_id INTEGER;
BEGIN
    SELECT * INTO v_req
    FROM requests
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF v_req.request_id IS NULL THEN
        RAISE EXCEPTION 'Request % not found', p_request_id
            USING ERRCODE = 'SP001';
    END IF;

    IF v_req.current_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Request % is not in DRAFT state (current=%)', p_request_id, v_req.current_status
            USING ERRCODE = 'SP011';
    END IF;

    v_amount := v_req.tentative_total_cost;
    v_stage := fn_route_stage(v_amount);
    IF v_stage IS NULL THEN
        RAISE EXCEPTION 'No routing rule matches amount %', v_amount
            USING ERRCODE = 'SP012';
    END IF;

    v_status := fn_stage_status((SELECT code FROM workflow_stages WHERE stage_id = v_stage));

    -- Determine raiser's active role
    SELECT ur.role_id INTO v_raiser_role_id
      FROM user_roles ur
      JOIN roles r ON r.role_id = ur.role_id
     WHERE ur.user_id = v_req.raised_by
       AND r.code IN ('HEAD', 'ACTIVITY_INCHARGE')
     LIMIT 1;

    IF v_raiser_role_id IS NULL THEN
        SELECT ur.role_id INTO v_raiser_role_id
          FROM user_roles ur
         WHERE ur.user_id = v_req.raised_by
         LIMIT 1;
    END IF;

    UPDATE requests
       SET current_status   = v_status,
           current_stage_id = v_stage,
           current_version_number = 1,
           submitted_at     = COALESCE(submitted_at, NOW())
     WHERE request_id = p_request_id;

    SELECT jsonb_agg(
        jsonb_build_object(
            'request_item_id', request_item_id,
            'budget_item_id', budget_item_id,
            'item_type_snapshot', item_type_snapshot,
            'requested_quantity', requested_quantity,
            'estimated_unit_cost', estimated_unit_cost,
            'estimated_total', estimated_total,
            'remarks', remarks
        )
    ) INTO v_items_json
    FROM request_items
    WHERE request_id = p_request_id;

    INSERT INTO request_versions (
        request_id, version_number, title, description,
        department_id, course_id, financial_year_id, budget_head_id,
        tentative_total_cost, extra, items_snapshot, submitted_by
    ) VALUES (
        p_request_id, 1, v_req.title, v_req.description,
        v_req.department_id, v_req.course_id, v_req.financial_year_id, v_req.budget_head_id,
        v_req.tentative_total_cost, v_req.extra, COALESCE(v_items_json, '[]'::jsonb), v_req.raised_by
    )
    ON CONFLICT (request_id, version_number) DO NOTHING;

    INSERT INTO approval_actions (request_id, stage_id, performed_by, role_id, action,
                                  previous_status, new_status,
                                  amount_requested_snapshot)
    SELECT p_request_id, v_stage, raised_by, v_raiser_role_id, 'SUBMIT',
           'DRAFT', v_status, tentative_total_cost
    FROM requests WHERE request_id = p_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_resubmit_request(
    p_request_id     UUID,
    p_actor_id       UUID,
    p_comments       TEXT DEFAULT NULL,
    p_signature_hash TEXT DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_req           requests%ROWTYPE;
    v_new_version   INTEGER;
    v_corr_id       UUID;
    v_items_json    JSONB;
    v_target_stage  INTEGER;
    v_target_status request_status;
    v_signature_id  UUID;
    v_actor_role_id INTEGER;
BEGIN
    IF app_current_user_id() IS NOT NULL
       AND p_actor_id IS DISTINCT FROM app_current_user_id() THEN
        RAISE EXCEPTION 'Actor % does not match the authenticated user', p_actor_id
            USING ERRCODE = 'SP013';
    END IF;

    SELECT * INTO v_req FROM requests WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request % not found', p_request_id
            USING ERRCODE = 'SP001';
    END IF;

    IF v_req.raised_by IS DISTINCT FROM p_actor_id THEN
        RAISE EXCEPTION 'User % is not the raiser of request %', p_actor_id, v_req.request_number
            USING ERRCODE = 'SP004';
    END IF;

    IF v_req.current_status <> 'AWAITING_RESUBMISSION' THEN
        RAISE EXCEPTION 'Request % is not in AWAITING_RESUBMISSION state (current=%)',
            v_req.request_number, v_req.current_status
            USING ERRCODE = 'SP018';
    END IF;

    SELECT ur.role_id INTO v_actor_role_id
      FROM user_roles ur
      JOIN roles r ON r.role_id = ur.role_id
     WHERE ur.user_id = p_actor_id
       AND r.code IN ('HEAD', 'ACTIVITY_INCHARGE')
     LIMIT 1;

    IF v_actor_role_id IS NULL THEN
        SELECT ur.role_id INTO v_actor_role_id
          FROM user_roles ur
         WHERE ur.user_id = p_actor_id
         LIMIT 1;
    END IF;

    v_new_version := COALESCE(v_req.current_version_number, 1) + 1;

    SELECT correction_id INTO v_corr_id
    FROM correction_requests
    WHERE request_id = p_request_id AND resolved_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_corr_id IS NOT NULL THEN
        UPDATE correction_requests
           SET resolved_at = NOW(),
               resolved_by_version = v_new_version
         WHERE correction_id = v_corr_id;
    END IF;

    SELECT COALESCE(SUM(estimated_total), 0) INTO v_req.tentative_total_cost
    FROM request_items WHERE request_id = p_request_id;

    SELECT jsonb_agg(
        jsonb_build_object(
            'request_item_id', request_item_id,
            'budget_item_id', budget_item_id,
            'item_type_snapshot', item_type_snapshot,
            'requested_quantity', requested_quantity,
            'estimated_unit_cost', estimated_unit_cost,
            'estimated_total', estimated_total,
            'remarks', remarks
        )
    ) INTO v_items_json
    FROM request_items
    WHERE request_id = p_request_id;

    INSERT INTO request_versions (
        request_id, version_number, title, description,
        department_id, course_id, financial_year_id, budget_head_id,
        tentative_total_cost, extra, items_snapshot, submitted_by, correction_id
    ) VALUES (
        p_request_id, v_new_version, v_req.title, v_req.description,
        v_req.department_id, v_req.course_id, v_req.financial_year_id, v_req.budget_head_id,
        v_req.tentative_total_cost, v_req.extra, COALESCE(v_items_json, '[]'::jsonb), p_actor_id, v_corr_id
    );

    v_target_stage  := v_req.current_stage_id;
    v_target_status := fn_stage_status((SELECT code FROM workflow_stages WHERE stage_id = v_target_stage));

    UPDATE requests
       SET current_version_number = v_new_version,
           tentative_total_cost   = v_req.tentative_total_cost,
           current_status         = v_target_status,
           updated_at             = NOW()
     WHERE request_id = p_request_id;

    IF p_signature_hash IS NOT NULL THEN
        INSERT INTO digital_signatures (user_id, signed_hash)
        VALUES (p_actor_id, p_signature_hash)
        RETURNING signature_id INTO v_signature_id;
    END IF;

    INSERT INTO approval_actions (
        request_id, stage_id, performed_by, role_id, action,
        previous_status, new_status, amount_requested_snapshot, comments, signature_id
    ) VALUES (
        p_request_id, v_target_stage, p_actor_id, v_actor_role_id, 'RESUBMIT',
        'AWAITING_RESUBMISSION', v_target_status, v_req.tentative_total_cost, p_comments, v_signature_id
    );

    RETURN v_new_version;
END;
$$;

CREATE OR REPLACE FUNCTION fn_supersede_attachment(
    p_old_attachment_id   UUID,
    p_file_name           TEXT,
    p_mime_type           TEXT,
    p_size_bytes          BIGINT,
    p_storage_path        TEXT,
    p_storage_backend     TEXT,
    p_uploaded_by         UUID,
    p_replacement_reason  TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_old         attachments%ROWTYPE;
    v_new_id      UUID;
    v_req_v       INTEGER;
    v_req_status  request_status;
BEGIN
    -- SECURITY DEFINER: this function runs with the owner's rights, so RLS
    -- does not protect the rows it touches and every check has to be made
    -- here. Without them any signed-in user could replace any document on any
    -- request in the college.
    IF app_current_user_id() IS NOT NULL
       AND p_uploaded_by IS DISTINCT FROM app_current_user_id() THEN
        RAISE EXCEPTION 'Actor % does not match the authenticated user', p_uploaded_by
            USING ERRCODE = 'SP013';
    END IF;

    SELECT * INTO v_old FROM attachments WHERE attachment_id = p_old_attachment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attachment % not found', p_old_attachment_id
            USING ERRCODE = 'SP001';
    END IF;

    -- The same reach the attachments_insert policy grants.
    IF app_current_user_id() IS NOT NULL AND NOT (
        app_has_role('ADMIN')
        OR v_old.uploaded_by = app_current_user_id()
        OR (v_old.request_id IS NOT NULL AND app_can_see_request(v_old.request_id))
        OR (v_old.issue_id   IS NOT NULL AND app_can_see_issue(v_old.issue_id))
        OR (v_old.budget_provision_id IS NOT NULL AND app_has_role('HEAD') AND EXISTS (
            SELECT 1 FROM budget_provisions bp
             WHERE bp.budget_provision_id = v_old.budget_provision_id
               AND bp.department_id = (SELECT department_id FROM users WHERE user_id = app_current_user_id())
        ))
    ) THEN
        RAISE EXCEPTION 'User % may not replace attachment %', app_current_user_id(), p_old_attachment_id
            USING ERRCODE = 'SP004';
    END IF;

    IF v_old.request_id IS NOT NULL THEN
        SELECT current_version_number, current_status INTO v_req_v, v_req_status
          FROM requests WHERE request_id = v_old.request_id;

        -- Once a request is closed its documents are part of the record.
        IF v_req_status IN ('CLOSED', 'CARRIED_FORWARD') THEN
            RAISE EXCEPTION 'Request is closed; its documents cannot be replaced'
                USING ERRCODE = 'SP003';
        END IF;
    END IF;

    INSERT INTO attachments (
        request_id, issue_id, budget_provision_id, file_name, mime_type, size_bytes,
        storage_path, storage_backend, uploaded_by, version_number,
        request_version_number, replacement_reason
    ) VALUES (
        v_old.request_id, v_old.issue_id, v_old.budget_provision_id, p_file_name, p_mime_type, p_size_bytes,
        p_storage_path, COALESCE(p_storage_backend, 'local'), p_uploaded_by,
        v_old.version_number + 1, COALESCE(v_req_v, v_old.request_version_number, 1), p_replacement_reason
    ) RETURNING attachment_id INTO v_new_id;

    UPDATE attachments
       SET superseded_by_id = v_new_id
     WHERE attachment_id = p_old_attachment_id;

    RETURN v_new_id;
END;
$$;

-- Helper function for request-review context
CREATE OR REPLACE FUNCTION fn_get_department_budget_context(
    p_department_id     INTEGER,
    p_financial_year_id INTEGER,
    p_budget_head_id    INTEGER DEFAULT NULL
) RETURNS TABLE (
    budget_provision_id UUID,
    allocated_amount    NUMERIC(14,2),
    utilized_amount     NUMERIC(14,2),
    committed_amount    NUMERIC(14,2),
    remaining_amount    NUMERIC(14,2),
    available_amount    NUMERIC(14,2)
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT
        v.budget_provision_id,
        v.allocated_amount,
        v.utilized_amount,
        v.committed_amount,
        v.remaining_amount,
        v.available_amount
    FROM v_department_budget_summary v
    WHERE v.department_id = p_department_id
      AND v.financial_year_id = p_financial_year_id
      AND (p_budget_head_id IS NULL OR v.budget_head_id = p_budget_head_id OR v.budget_head_id IS NULL)
    ORDER BY v.budget_head_id NULLS LAST
    LIMIT 1;
$$;

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
