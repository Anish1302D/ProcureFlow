-- Migration: 20261015T100000_workflow_engine_enhancements.sql
-- Description: Configuration-driven approval routing, stage progression enforcement,
-- and multi-member CDC independent decision attribution.

-- 1. Helper function for querying text configuration values
CREATE OR REPLACE FUNCTION app_get_config_text(p_key TEXT, p_default TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT (value#>>'{}') FROM system_configurations WHERE key = p_key),
        p_default
    );
$$;

-- 2. Seed initial workflow routing stage configurations
INSERT INTO system_configurations (key, value, description, category, is_secret) VALUES
    ('workflow.stage.entry', '"PURCHASE_COMMITTEE"'::jsonb, 'Stage code where new requests enter for initial verification', 'approval_workflow', FALSE),
    ('workflow.stage.principal', '"PRINCIPAL"'::jsonb, 'Stage code for the Principal approval gate', 'approval_workflow', FALSE),
    ('workflow.stage.intermediate', '"CDC"'::jsonb, 'Stage code for College Development Committee intermediate authority', 'approval_workflow', FALSE),
    ('workflow.stage.final_authority', '"FINAL_AUTHORITY"'::jsonb, 'Stage code for the final governing authority', 'approval_workflow', FALSE),
    ('workflow.authority.final_role', '"CHAIRMAN"'::jsonb, 'Role code authorized for final sanction', 'approval_workflow', FALSE)
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_secret = EXCLUDED.is_secret,
    updated_at = NOW();

-- 3. Make fn_route_stage configuration-driven via stage_routing_rules & system_configurations
CREATE OR REPLACE FUNCTION fn_route_stage(p_amount NUMERIC)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        (SELECT stage_id
           FROM stage_routing_rules
          WHERE p_amount >= min_amount
            AND (max_amount IS NULL OR p_amount < max_amount)
          ORDER BY min_amount ASC
          LIMIT 1),
        (SELECT stage_id
           FROM workflow_stages
          WHERE code = app_get_config_text('workflow.stage.entry', 'PURCHASE_COMMITTEE')::workflow_stage_code),
        (SELECT stage_id FROM workflow_stages WHERE code = 'PURCHASE_COMMITTEE')
    );
$$;

-- 4. Update fn_enforce_stage_progression to enforce mandatory stages and configuration-driven checks
CREATE OR REPLACE FUNCTION fn_enforce_stage_progression()
RETURNS TRIGGER AS $$
DECLARE
    v_entry_stage_code   TEXT;
    v_principal_code     TEXT;
    v_cdc_code           TEXT;
    v_final_code         TEXT;
    v_entry_stage_id     INTEGER;
    v_principal_stage_id INTEGER;
    v_cdc_stage_id       INTEGER;
    v_final_stage_id     INTEGER;
BEGIN
    v_entry_stage_code := app_get_config_text('workflow.stage.entry', 'PURCHASE_COMMITTEE');
    v_principal_code   := app_get_config_text('workflow.stage.principal', 'PRINCIPAL');
    v_cdc_code         := app_get_config_text('workflow.stage.intermediate', 'CDC');
    v_final_code       := app_get_config_text('workflow.stage.final_authority', 'FINAL_AUTHORITY');

    SELECT stage_id INTO v_entry_stage_id     FROM workflow_stages WHERE code = v_entry_stage_code::workflow_stage_code;
    SELECT stage_id INTO v_principal_stage_id FROM workflow_stages WHERE code = v_principal_code::workflow_stage_code;
    SELECT stage_id INTO v_cdc_stage_id       FROM workflow_stages WHERE code = v_cdc_code::workflow_stage_code;
    SELECT stage_id INTO v_final_stage_id     FROM workflow_stages WHERE code = v_final_code::workflow_stage_code;

    IF v_entry_stage_id IS NULL THEN
        SELECT stage_id INTO v_entry_stage_id FROM workflow_stages WHERE code = 'PURCHASE_COMMITTEE';
    END IF;
    IF v_principal_stage_id IS NULL THEN
        SELECT stage_id INTO v_principal_stage_id FROM workflow_stages WHERE code = 'PRINCIPAL';
    END IF;
    IF v_cdc_stage_id IS NULL THEN
        SELECT stage_id INTO v_cdc_stage_id FROM workflow_stages WHERE code = 'CDC';
    END IF;
    IF v_final_stage_id IS NULL THEN
        SELECT stage_id INTO v_final_stage_id FROM workflow_stages WHERE code = 'FINAL_AUTHORITY';
    END IF;

    -- Request in AWAITING_RESUBMISSION status cannot be advanced except by resubmission
    IF OLD.current_status = 'AWAITING_RESUBMISSION'
       AND NEW.current_status NOT IN ('AWAITING_RESUBMISSION', 'UNDER_PURCHASE_COMMITTEE_REVIEW', 'UNDER_PRINCIPAL_REVIEW', 'UNDER_CDC_REVIEW', 'UNDER_FINAL_AUTHORITY_REVIEW') THEN
        RAISE EXCEPTION 'Request in AWAITING_RESUBMISSION status cannot be advanced except by resubmission'
            USING ERRCODE = 'SP017';
    END IF;

    -- Cannot enter CDC or FINAL_AUTHORITY without a prior Principal approval action.
    -- Carried forward requests inherit the stage they left off at.
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

    -- Cannot jump from entry stage directly to CDC or FINAL_AUTHORITY
    IF NEW.current_stage_id IN (v_cdc_stage_id, v_final_stage_id)
       AND OLD.current_stage_id = v_entry_stage_id THEN
        RAISE EXCEPTION 'Request cannot skip the Principal stage'
            USING ERRCODE = 'SP016';
    END IF;

    -- Cannot jump from DRAFT (or initial state) straight to PRINCIPAL skipping Purchase Committee
    IF (OLD.current_stage_id IS NULL OR OLD.current_status = 'DRAFT')
       AND NEW.current_stage_id = v_principal_stage_id
       AND NEW.carried_forward_from_request_id IS NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM approval_actions
            WHERE request_id = NEW.request_id
              AND stage_id = v_entry_stage_id
        ) THEN
            RAISE EXCEPTION 'Request cannot skip the % stage', v_entry_stage_code
                USING ERRCODE = 'SP016';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Update fn_record_action with configuration-driven routing and strict multi-member CDC support
CREATE OR REPLACE FUNCTION fn_record_action(
    p_request_id        UUID,
    p_actor_id          UUID,
    p_action            approval_action_type,
    p_item_decisions    JSONB DEFAULT NULL,
    p_comments          TEXT  DEFAULT NULL,
    p_rejection_reason  TEXT  DEFAULT NULL,
    p_signature_hash    TEXT  DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_req                requests%ROWTYPE;
    v_stage_code         workflow_stage_code;
    v_is_final           BOOLEAN;
    v_action_id          UUID;
    v_signature_id       UUID;
    v_new_status         request_status;
    v_new_stage          INTEGER;
    v_total              INTEGER;
    v_approved           INTEGER;
    v_rejected           INTEGER;
    v_decided            INTEGER;
    v_principal_stage_id INTEGER;
    v_cdc_stage_id       INTEGER;
    v_final_stage_id     INTEGER;
    v_principal_max      NUMERIC;
    v_cdc_max            NUMERIC;
    v_actor_role_id      INTEGER;
BEGIN
    IF app_current_user_id() IS NOT NULL
       AND p_actor_id IS DISTINCT FROM app_current_user_id() THEN
        RAISE EXCEPTION 'Actor % does not match the authenticated user', p_actor_id
            USING ERRCODE = 'SP013';
    END IF;

    SELECT * INTO v_req FROM requests WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM requests WHERE request_id = p_request_id) THEN
            RAISE EXCEPTION 'User % is not an approver at the current stage of this request', p_actor_id
                USING ERRCODE = 'SP004';
        END IF;
        RAISE EXCEPTION 'Request % not found', p_request_id
            USING ERRCODE = 'SP001';
    END IF;

    IF v_req.current_stage_id IS NULL THEN
        RAISE EXCEPTION 'Request % is not at a review stage (status = %)',
            v_req.request_number, v_req.current_status
            USING ERRCODE = 'SP002';
    END IF;

    IF v_req.current_status IN ('APPROVED','REJECTED','FULFILLED','CLOSED','CARRIED_FORWARD') THEN
        RAISE EXCEPTION 'Request % is already closed (status = %)',
            v_req.request_number, v_req.current_status
            USING ERRCODE = 'SP003';
    END IF;

    IF v_req.current_status = 'AWAITING_RESUBMISSION' THEN
        RAISE EXCEPTION 'Request % is awaiting resubmission by the requester', v_req.request_number
            USING ERRCODE = 'SP017';
    END IF;

    SELECT code, is_final INTO v_stage_code, v_is_final
    FROM workflow_stages WHERE stage_id = v_req.current_stage_id;

    -- Load dynamic thresholds from authoritative configuration
    v_principal_max := app_get_config_numeric('workflow.threshold.principal_max', 50000);
    v_cdc_max       := app_get_config_numeric('workflow.threshold.cdc_max', 500000);

    -- Load dynamic stage routing targets from configuration
    SELECT stage_id INTO v_principal_stage_id
      FROM workflow_stages
     WHERE code = app_get_config_text('workflow.stage.principal', 'PRINCIPAL')::workflow_stage_code;
    IF v_principal_stage_id IS NULL THEN
        SELECT stage_id INTO v_principal_stage_id FROM workflow_stages WHERE code = 'PRINCIPAL';
    END IF;

    SELECT stage_id INTO v_cdc_stage_id
      FROM workflow_stages
     WHERE code = app_get_config_text('workflow.stage.intermediate', 'CDC')::workflow_stage_code;
    IF v_cdc_stage_id IS NULL THEN
        SELECT stage_id INTO v_cdc_stage_id FROM workflow_stages WHERE code = 'CDC';
    END IF;

    SELECT stage_id INTO v_final_stage_id
      FROM workflow_stages
     WHERE code = app_get_config_text('workflow.stage.final_authority', 'FINAL_AUTHORITY')::workflow_stage_code;
    IF v_final_stage_id IS NULL THEN
        SELECT stage_id INTO v_final_stage_id FROM workflow_stages WHERE code = 'FINAL_AUTHORITY';
    END IF;

    -- Authority check: actor must be currently seated at this stage
    IF NOT EXISTS (
        SELECT 1 FROM stage_approvers
        WHERE stage_id = v_req.current_stage_id AND user_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'User % is not an approver at stage %', p_actor_id, v_stage_code
            USING ERRCODE = 'SP004';
    END IF;

    -- Resolve actor's historical role identity for precise attribution
    SELECT sa.role_id INTO v_actor_role_id
      FROM stage_approvers sa
     WHERE sa.stage_id = v_req.current_stage_id
       AND sa.user_id  = p_actor_id
     LIMIT 1;

    IF v_actor_role_id IS NULL THEN
        SELECT ra.role_id INTO v_actor_role_id
          FROM role_appointments ra
         WHERE ra.user_id = p_actor_id
           AND (ra.stage_id = v_req.current_stage_id OR ra.stage_id IS NULL)
           AND ra.is_active
         LIMIT 1;
    END IF;

    IF v_actor_role_id IS NULL THEN
        SELECT ur.role_id INTO v_actor_role_id
          FROM user_roles ur
         WHERE ur.user_id = p_actor_id
         LIMIT 1;
    END IF;

    -- CDC Member classification check (Teaching for Grant, Non-Teaching for Non-Grant)
    IF v_stage_code = 'CDC' THEN
        IF app_request_funding_type(p_request_id) = 'GRANT' AND NOT (
            EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN roles ro ON ro.role_id = sa.role_id
                WHERE sa.stage_id = v_req.current_stage_id AND sa.user_id = p_actor_id
                  AND (
                      ro.code = 'CDC_GRANT_MEMBER'
                      OR (ro.code = 'CDC_MEMBER' AND COALESCE(sa.member_classification, 'TEACHING') = 'TEACHING')
                  )
            ) OR app_has_role('ADMIN')
        ) THEN
            RAISE EXCEPTION 'Only CDC Grant Member can decide requests for Grant departments'
                USING ERRCODE = 'SP004';
        ELSIF app_request_funding_type(p_request_id) = 'NON_GRANT' AND NOT (
            EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN roles ro ON ro.role_id = sa.role_id
                WHERE sa.stage_id = v_req.current_stage_id AND sa.user_id = p_actor_id
                  AND (
                      ro.code = 'CDC_NON_GRANT_MEMBER'
                      OR (ro.code = 'CDC_MEMBER' AND sa.member_classification = 'NON_TEACHING')
                  )
            ) OR app_has_role('ADMIN')
        ) THEN
            RAISE EXCEPTION 'Only CDC Non-Grant Member can decide requests for Non-Grant departments'
                USING ERRCODE = 'SP004';
        END IF;
    END IF;

    -- Stage-specific action restrictions
    IF v_stage_code = 'PURCHASE_COMMITTEE' AND p_action IN ('APPROVE', 'PARTIAL_APPROVE') THEN
        RAISE EXCEPTION 'Purchase Committee performs validity review only and cannot approve requests'
            USING ERRCODE = 'SP005';
    END IF;

    IF v_stage_code = 'PRINCIPAL' AND p_action IN ('APPROVE', 'PARTIAL_APPROVE') AND v_req.tentative_total_cost > v_principal_max THEN
        RAISE EXCEPTION 'Principal cannot final-approve requests exceeding ₹%', v_principal_max
            USING ERRCODE = 'SP005';
    END IF;

    IF v_stage_code = 'PRINCIPAL' AND p_action = 'ESCALATE' AND v_req.tentative_total_cost <= v_principal_max THEN
        RAISE EXCEPTION 'Requests up to ₹% must be decided by the Principal and cannot be escalated', v_principal_max
            USING ERRCODE = 'SP005';
    END IF;

    IF v_stage_code = 'CDC' AND p_action IN ('APPROVE', 'PARTIAL_APPROVE', 'REJECT') AND v_req.tentative_total_cost > v_cdc_max THEN
        RAISE EXCEPTION 'CDC cannot decide requests exceeding ₹%; Chairman and Vice Chairman hold the final authority', v_cdc_max
            USING ERRCODE = 'SP005';
    END IF;

    IF v_stage_code = 'CDC' AND p_action = 'ESCALATE' THEN
        RAISE EXCEPTION 'CDC holds the decision at this amount and cannot escalate'
            USING ERRCODE = 'SP005';
    END IF;

    IF p_action NOT IN ('APPROVE','PARTIAL_APPROVE','REJECT','ESCALATE','RETURN','COMMENT') THEN
        RAISE EXCEPTION 'Action % cannot be taken at a review stage', p_action
            USING ERRCODE = 'SP005';
    END IF;

    IF p_action = 'ESCALATE' AND v_is_final THEN
        RAISE EXCEPTION 'Stage % is the final authority and cannot escalate', v_stage_code
            USING ERRCODE = 'SP006';
    END IF;

    IF p_action = 'REJECT' AND COALESCE(TRIM(p_rejection_reason), '') = '' THEN
        RAISE EXCEPTION 'A rejection requires a reason'
            USING ERRCODE = 'SP007';
    END IF;

    IF p_action = 'RETURN' AND v_stage_code NOT IN ('PURCHASE_COMMITTEE', 'PRINCIPAL') THEN
        RAISE EXCEPTION 'Only Purchase Committee and Principal can return a request for correction'
            USING ERRCODE = 'SP005';
    END IF;

    IF p_action = 'RETURN' AND COALESCE(TRIM(p_comments), TRIM(p_rejection_reason), '') = '' THEN
        RAISE EXCEPTION 'A return for correction requires a reason or comments'
            USING ERRCODE = 'SP007';
    END IF;

    IF p_action = 'PARTIAL_APPROVE'
       AND (p_item_decisions IS NULL OR jsonb_array_length(p_item_decisions) = 0) THEN
        RAISE EXCEPTION 'A partial approval must specify item decisions'
            USING ERRCODE = 'SP008';
    END IF;

    IF p_signature_hash IS NOT NULL THEN
        INSERT INTO digital_signatures (user_id, signed_hash)
        VALUES (p_actor_id, p_signature_hash)
        RETURNING signature_id INTO v_signature_id;
    END IF;

    -- Determine new stage and status
    IF p_action = 'REJECT' THEN
        v_new_status := 'REJECTED';
        v_new_stage  := v_req.current_stage_id;

    ELSIF p_action = 'RETURN' THEN
        v_new_status := 'AWAITING_RESUBMISSION';
        v_new_stage  := v_req.current_stage_id;

    ELSIF p_action = 'COMMENT' THEN
        v_new_status := v_req.current_status;
        v_new_stage  := v_req.current_stage_id;

    ELSIF v_stage_code = 'PURCHASE_COMMITTEE' AND p_action = 'ESCALATE' THEN
        v_new_stage  := v_principal_stage_id;
        v_new_status := fn_stage_status((SELECT code FROM workflow_stages WHERE stage_id = v_principal_stage_id));

    ELSIF v_stage_code = 'PRINCIPAL' AND p_action = 'ESCALATE' THEN
        IF v_req.tentative_total_cost <= v_cdc_max THEN
            v_new_stage  := v_cdc_stage_id;
            v_new_status := fn_stage_status((SELECT code FROM workflow_stages WHERE stage_id = v_cdc_stage_id));
        ELSE
            v_new_stage  := v_final_stage_id;
            v_new_status := fn_stage_status((SELECT code FROM workflow_stages WHERE stage_id = v_final_stage_id));
        END IF;

    ELSIF v_stage_code = 'CDC' AND p_action IN ('APPROVE', 'PARTIAL_APPROVE', 'ESCALATE') THEN
        v_new_stage  := v_cdc_stage_id;
        v_new_status := 'UNDER_CDC_REVIEW';

    ELSIF v_stage_code = 'FINAL_AUTHORITY' AND p_action IN ('APPROVE', 'PARTIAL_APPROVE') THEN
        v_new_stage  := v_final_stage_id;
        v_new_status := 'UNDER_FINAL_AUTHORITY_REVIEW';

    ELSE
        v_new_status := NULL;
        v_new_stage  := v_req.current_stage_id;
    END IF;

    INSERT INTO approval_actions (
        request_id, stage_id, performed_by, role_id, action,
        previous_status, new_status, amount_requested_snapshot,
        rejection_reason, comments, signature_id)
    VALUES (
        p_request_id, v_req.current_stage_id, p_actor_id, v_actor_role_id, p_action,
        v_req.current_status, v_new_status, v_req.tentative_total_cost,
        p_rejection_reason, p_comments, v_signature_id)
    RETURNING action_id INTO v_action_id;

    IF p_action = 'RETURN' THEN
        INSERT INTO correction_requests (
            request_id, requested_by, requested_at_stage_id,
            previous_status, reason, fields_to_correct
        ) VALUES (
            p_request_id, p_actor_id, v_req.current_stage_id,
            v_req.current_status, COALESCE(p_comments, p_rejection_reason, 'Correction requested'),
            '[]'::jsonb
        );
    END IF;

    -- Item-level decisions
    IF p_item_decisions IS NOT NULL AND jsonb_array_length(p_item_decisions) > 0 THEN
        INSERT INTO approval_action_items (
            action_id, request_item_id, request_id,
            approved_quantity, approved_amount, item_decision, remarks)
        SELECT
            v_action_id, ri.request_item_id, p_request_id,
            (d->>'approved_quantity')::NUMERIC,
            (d->>'approved_amount')::NUMERIC,
            (CASE
                WHEN (d->>'approved_quantity')::NUMERIC = 0 THEN 'REJECTED'
                WHEN (d->>'approved_quantity')::NUMERIC >= ri.requested_quantity THEN 'APPROVED'
                ELSE 'PARTIALLY_APPROVED'
             END)::request_item_status,
            d->>'remarks'
        FROM jsonb_array_elements(p_item_decisions) d
        JOIN request_items ri
          ON ri.request_item_id = (d->>'request_item_id')::UUID
         AND ri.request_id      = p_request_id;

        GET DIAGNOSTICS v_decided = ROW_COUNT;
        IF v_decided <> jsonb_array_length(p_item_decisions) THEN
            RAISE EXCEPTION
                'Item decisions reference % line item(s) that do not belong to request %',
                jsonb_array_length(p_item_decisions) - v_decided, v_req.request_number
                USING ERRCODE = 'SP010';
        END IF;

        UPDATE request_items ri
           SET approved_quantity = aai.approved_quantity,
               approved_amount   = aai.approved_amount,
               item_status       = aai.item_decision,
               remarks           = COALESCE(aai.remarks, ri.remarks)
          FROM approval_action_items aai
         WHERE aai.action_id       = v_action_id
           AND aai.request_item_id = ri.request_item_id;

    ELSIF p_action = 'APPROVE' THEN
        INSERT INTO approval_action_items (
            action_id, request_item_id, request_id,
            approved_quantity, approved_amount, item_decision)
        SELECT v_action_id, ri.request_item_id, p_request_id,
               ri.requested_quantity, ri.estimated_total, 'APPROVED'
        FROM request_items ri
        WHERE ri.request_id = p_request_id;

        UPDATE request_items
           SET approved_quantity = requested_quantity,
               approved_amount   = estimated_total,
               item_status       = 'APPROVED'
         WHERE request_id = p_request_id;
    END IF;

    -- Evaluate multi-approver completion for CDC and Final Authority
    IF v_stage_code = 'CDC' AND p_action IN ('APPROVE', 'PARTIAL_APPROVE', 'ESCALATE') THEN
        IF v_req.tentative_total_cost <= v_cdc_max THEN
            SELECT count(*),
                   count(*) FILTER (WHERE item_status = 'APPROVED'),
                   count(*) FILTER (WHERE item_status = 'REJECTED')
              INTO v_total, v_approved, v_rejected
            FROM request_items WHERE request_id = p_request_id;

            v_new_status := CASE
                WHEN v_total = 0 THEN 'APPROVED'
                WHEN v_rejected = v_total THEN 'REJECTED'
                WHEN v_approved = v_total THEN 'APPROVED'
                ELSE 'PARTIALLY_APPROVED'
            END::request_status;
            v_new_stage := v_cdc_stage_id;
        ELSE
            v_new_stage := v_final_stage_id;
            v_new_status := 'UNDER_FINAL_AUTHORITY_REVIEW';
        END IF;
        UPDATE approval_actions SET new_status = v_new_status WHERE action_id = v_action_id;

    ELSIF v_stage_code = 'FINAL_AUTHORITY' AND p_action IN ('APPROVE', 'PARTIAL_APPROVE') THEN
        SELECT count(*),
               count(*) FILTER (WHERE item_status = 'APPROVED'),
               count(*) FILTER (WHERE item_status = 'REJECTED')
          INTO v_total, v_approved, v_rejected
        FROM request_items WHERE request_id = p_request_id;

        v_new_status := CASE
            WHEN v_total = 0 THEN 'APPROVED'
            WHEN v_rejected = v_total THEN 'REJECTED'
            WHEN v_approved = v_total THEN 'APPROVED'
            ELSE 'PARTIALLY_APPROVED'
        END::request_status;
        v_new_stage := v_final_stage_id;
        UPDATE approval_actions SET new_status = v_new_status WHERE action_id = v_action_id;

    ELSIF v_new_status IS NULL THEN
        SELECT count(*),
               count(*) FILTER (WHERE item_status = 'APPROVED'),
               count(*) FILTER (WHERE item_status = 'REJECTED')
          INTO v_total, v_approved, v_rejected
        FROM request_items WHERE request_id = p_request_id;

        v_new_status := CASE
            WHEN v_total = 0                              THEN 'APPROVED'
            WHEN v_rejected = v_total                     THEN 'REJECTED'
            WHEN v_approved = v_total                     THEN 'APPROVED'
            ELSE 'PARTIALLY_APPROVED'
        END::request_status;

        UPDATE approval_actions SET new_status = v_new_status WHERE action_id = v_action_id;
    END IF;

    UPDATE requests
       SET current_status   = v_new_status,
           current_stage_id = v_new_stage,
           closed_at        = CASE WHEN v_new_status IN ('REJECTED', 'APPROVED', 'PARTIALLY_APPROVED') THEN NOW() ELSE closed_at END
     WHERE request_id = p_request_id;

    IF p_action IN ('APPROVE', 'PARTIAL_APPROVE') THEN
        UPDATE approval_actions a
           SET amount_approved = r.sanctioned_amount
          FROM requests r
         WHERE a.action_id = v_action_id
           AND r.request_id = p_request_id;
    END IF;

    INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
    VALUES ('request', p_request_id::TEXT, p_actor_id, p_action::TEXT,
            jsonb_build_object('status', v_req.current_status, 'stage_id', v_req.current_stage_id),
            jsonb_build_object('status', v_new_status,        'stage_id', v_new_stage));

    RETURN v_action_id;
END;
$$ LANGUAGE plpgsql;

-- 6. Update app_is_stage_participant in RLS to align CDC multi-member classifications
CREATE OR REPLACE FUNCTION app_is_stage_participant(p_request_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM requests r
        JOIN stage_approvers sa ON sa.user_id = p_user_id
        JOIN roles ro ON ro.role_id = sa.role_id
        WHERE r.request_id = p_request_id
          AND (
                sa.stage_id = r.current_stage_id
             OR EXISTS (
                    SELECT 1 FROM approval_actions aa
                    WHERE aa.request_id = r.request_id
                      AND aa.stage_id   = sa.stage_id
                )
          )
          AND (
                -- Non-CDC stages
                (SELECT code FROM workflow_stages ws WHERE ws.stage_id = sa.stage_id) <> 'CDC'
                -- CDC stages: Teaching classification / CDC_GRANT_MEMBER only for Grant funding
             OR (app_request_funding_type(r.request_id) = 'GRANT' AND (
                    ro.code = 'CDC_GRANT_MEMBER'
                    OR (ro.code = 'CDC_MEMBER' AND COALESCE(sa.member_classification, 'TEACHING') = 'TEACHING')
                ))
                -- CDC stages: Non-Teaching classification / CDC_NON_GRANT_MEMBER only for Non-Grant funding
             OR (app_request_funding_type(r.request_id) = 'NON_GRANT' AND (
                    ro.code = 'CDC_NON_GRANT_MEMBER'
                    OR (ro.code = 'CDC_MEMBER' AND sa.member_classification = 'NON_TEACHING')
                ))
          )
    )
    OR EXISTS (
        SELECT 1 FROM approval_actions aa
        WHERE aa.request_id = p_request_id
          AND aa.performed_by = p_user_id
    );
$$;

-- Enforce positive amount on submission
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
    IF v_amount <= 0 THEN
        RAISE EXCEPTION 'Request % total cost must be greater than zero', p_request_id
            USING ERRCODE = 'SP012';
    END IF;

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

