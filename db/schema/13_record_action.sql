-- fn_record_action — the single entry point for every approval decision.
--
-- One call does all of it atomically: authority check, signature, the
-- approval_actions row, per-item decisions, item status updates, the
-- recomputed request status, and the audit log entry. Callers should never
-- write approval_actions by hand — doing it in separate statements is how a
-- request ends up half-decided when something fails midway.
--
-- p_item_decisions is a JSON array, one object per line item being decided:
--   [{"request_item_id": "...", "approved_quantity": 2,
--     "approved_amount": 20000, "remarks": "optional"}]
--
-- Omitting it on an APPROVE approves every item in full. Omitting it on a
-- PARTIAL_APPROVE is an error — a partial approval has to say what was cut.

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
    v_cdc_count          INTEGER;
    v_final_count        INTEGER;
    v_principal_max      NUMERIC;
    v_cdc_max            NUMERIC;
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

    SELECT stage_id INTO v_principal_stage_id FROM workflow_stages WHERE code = 'PRINCIPAL';
    SELECT stage_id INTO v_cdc_stage_id       FROM workflow_stages WHERE code = 'CDC';
    SELECT stage_id INTO v_final_stage_id     FROM workflow_stages WHERE code = 'FINAL_AUTHORITY';

    -- Authority check
    IF NOT EXISTS (
        SELECT 1 FROM stage_approvers
        WHERE stage_id = v_req.current_stage_id AND user_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'User % is not an approver at stage %', p_actor_id, v_stage_code
            USING ERRCODE = 'SP004';
    END IF;

    -- CDC Grant vs Non-Grant role check
    IF v_stage_code = 'CDC' THEN
        IF app_request_funding_type(p_request_id) = 'GRANT' AND NOT (
            EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN roles ro ON ro.role_id = sa.role_id
                WHERE sa.stage_id = v_req.current_stage_id AND sa.user_id = p_actor_id
                  AND ro.code = 'CDC_GRANT_MEMBER'
            ) OR app_has_role('ADMIN')
        ) THEN
            RAISE EXCEPTION 'Only CDC Grant Member can decide requests for Grant departments'
                USING ERRCODE = 'SP004';
        ELSIF app_request_funding_type(p_request_id) = 'NON_GRANT' AND NOT (
            EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN roles ro ON ro.role_id = sa.role_id
                WHERE sa.stage_id = v_req.current_stage_id AND sa.user_id = p_actor_id
                  AND ro.code = 'CDC_NON_GRANT_MEMBER'
            ) OR app_has_role('ADMIN')
        ) THEN
            RAISE EXCEPTION 'Only CDC Non-Grant Member can decide requests for Non-Grant departments'
                USING ERRCODE = 'SP004';
        END IF;
    END IF;

    -- Load dynamic thresholds from authoritative configuration
    v_principal_max := app_get_config_numeric('workflow.threshold.principal_max', 50000);
    v_cdc_max       := app_get_config_numeric('workflow.threshold.cdc_max', 500000);

    -- Specific Stage Restrictions
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
        v_new_status := 'UNDER_PRINCIPAL_REVIEW';

    ELSIF v_stage_code = 'PRINCIPAL' AND p_action = 'ESCALATE' THEN
        IF v_req.tentative_total_cost <= v_cdc_max THEN
            v_new_stage  := v_cdc_stage_id;
            v_new_status := 'UNDER_CDC_REVIEW';
        ELSE
            v_new_stage  := v_final_stage_id;
            v_new_status := 'UNDER_FINAL_AUTHORITY_REVIEW';
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
        request_id, stage_id, performed_by, action,
        previous_status, new_status, amount_requested_snapshot,
        rejection_reason, comments, signature_id)
    VALUES (
        p_request_id, v_req.current_stage_id, p_actor_id, p_action,
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
