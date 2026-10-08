-- Add explicit SQLSTATE codes to the workflow functions.
--
-- WHY
-- These functions previously raised errors with plain messages, so an API
-- wanting to map "not an approver" to HTTP 403 had to match on English text.
-- That breaks the moment a message is reworded or translated. Every RAISE now
-- carries a stable code the caller can switch on via err.code.
--
-- Class "SP" is safe to claim: the SQL standard reserves classes beginning
-- 0-4 and A-H for itself and leaves 5-9 and I-Z to implementations.
--
--   SP001  request not found                      -> 404
--   SP002  request not at a review stage          -> 409
--   SP003  request already closed                 -> 409
--   SP004  actor is not an approver at this stage -> 403
--   SP005  action not valid at a review stage     -> 422
--   SP006  final authority cannot escalate        -> 422
--   SP007  rejection requires a reason            -> 422
--   SP008  partial approval requires item decisions -> 422
--   SP009  no stage exists above the current one  -> 409
--   SP010  item decisions reference foreign items -> 422
--   SP011  request is not in DRAFT                -> 409
--   SP012  no routing rule matches the amount     -> 422
--
-- Behaviour is otherwise unchanged: same signatures, same logic, same
-- messages. Only the error codes are new, so this is safe to apply to a
-- database already holding live requests.

BEGIN;

CREATE OR REPLACE FUNCTION fn_submit_request(p_request_id UUID)
RETURNS VOID AS $$
DECLARE
    v_amount NUMERIC(14,2);
    v_stage  INTEGER;
    v_status request_status;
BEGIN
    SELECT tentative_total_cost, current_status
      INTO v_amount, v_status
    FROM requests
    WHERE request_id = p_request_id
    FOR UPDATE;

    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Request % is not in DRAFT state (current=%)', p_request_id, v_status
            USING ERRCODE = 'SP011';
    END IF;

    v_stage := fn_route_stage(v_amount);
    IF v_stage IS NULL THEN
        RAISE EXCEPTION 'No routing rule matches amount %', v_amount
            USING ERRCODE = 'SP012';
    END IF;

    UPDATE requests
       SET current_status   = fn_stage_status((SELECT code FROM workflow_stages WHERE stage_id = v_stage)),
           current_stage_id = v_stage,
           submitted_at     = COALESCE(submitted_at, NOW())
     WHERE request_id = p_request_id;

    INSERT INTO approval_actions (request_id, stage_id, performed_by, action,
                                  previous_status, new_status,
                                  amount_requested_snapshot)
    SELECT p_request_id, v_stage, raised_by, 'SUBMIT',
           'DRAFT', current_status, tentative_total_cost
    FROM requests WHERE request_id = p_request_id;
END;
$$ LANGUAGE plpgsql;

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
    v_req          requests%ROWTYPE;
    v_stage_code   workflow_stage_code;
    v_is_final     BOOLEAN;
    v_next_stage   INTEGER;
    v_action_id    UUID;
    v_signature_id UUID;
    v_new_status   request_status;
    v_new_stage    INTEGER;
    v_total        INTEGER;
    v_approved     INTEGER;
    v_rejected     INTEGER;
    v_decided      INTEGER;
BEGIN
    -- Lock the request so two approvers acting at once can't interleave.
    SELECT * INTO v_req FROM requests WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
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

    SELECT code, is_final INTO v_stage_code, v_is_final
    FROM workflow_stages WHERE stage_id = v_req.current_stage_id;

    -- Authority: the actor must be a configured approver at the current stage.
    IF NOT EXISTS (
        SELECT 1 FROM stage_approvers
        WHERE stage_id = v_req.current_stage_id AND user_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'User % is not an approver at stage %', p_actor_id, v_stage_code
            USING ERRCODE = 'SP004';
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

    -- Work out where the request lands. APPROVE / PARTIAL_APPROVE are left
    -- NULL here and resolved from the item statuses further down.
    IF p_action = 'REJECT' THEN
        v_new_status := 'REJECTED';
        v_new_stage  := v_req.current_stage_id;

    ELSIF p_action = 'ESCALATE' THEN
        v_next_stage := fn_next_stage(v_req.current_stage_id);
        IF v_next_stage IS NULL THEN
            RAISE EXCEPTION 'No stage exists above %', v_stage_code
                USING ERRCODE = 'SP009';
        END IF;
        v_new_stage  := v_next_stage;
        v_new_status := fn_stage_status(
            (SELECT code FROM workflow_stages WHERE stage_id = v_next_stage));

    ELSIF p_action IN ('COMMENT','RETURN') THEN
        v_new_status := v_req.current_status;
        v_new_stage  := v_req.current_stage_id;

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

    -- ---- item-level decisions -------------------------------------------

    IF p_item_decisions IS NOT NULL AND jsonb_array_length(p_item_decisions) > 0 THEN

        INSERT INTO approval_action_items (
            action_id, request_item_id, request_id,
            approved_quantity, approved_amount, item_decision, remarks)
        SELECT
            v_action_id,
            ri.request_item_id,
            p_request_id,
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
        -- Approve everything as requested.
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

    -- ---- resolve the request-level status --------------------------------

    IF v_new_status IS NULL THEN
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
           closed_at        = CASE WHEN v_new_status = 'REJECTED' THEN NOW() ELSE closed_at END
     WHERE request_id = p_request_id;

    -- sanctioned_amount is maintained by trigger on request_items; copy the
    -- settled figure onto the action so the timeline shows what was granted.
    -- Only decisions that actually grant money carry an amount — an escalate
    -- or a comment leaves it NULL rather than recording a misleading zero.
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

INSERT INTO schema_migrations (filename)
VALUES ('20260902T193000_add_sqlstate_error_codes.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
