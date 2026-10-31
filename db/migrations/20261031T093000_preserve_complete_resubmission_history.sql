-- Preserve complete resubmission history with document snapshots, enriched line items,
-- version attribution in approval_actions, and audit_logs tracking.

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
    v_docs_json     JSONB;
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

    -- Freeze line items with enriched names, codes, units, and amounts
    SELECT jsonb_agg(
        jsonb_build_object(
            'request_item_id', ri.request_item_id,
            'budget_item_id', ri.budget_item_id,
            'item_name', bi.name,
            'item_code', bi.code,
            'unit', bi.unit,
            'item_type_snapshot', ri.item_type_snapshot,
            'requested_quantity', ri.requested_quantity,
            'estimated_unit_cost', ri.estimated_unit_cost,
            'estimated_total', ri.estimated_total,
            'remarks', ri.remarks
        )
    ) INTO v_items_json
    FROM request_items ri
    JOIN budget_items bi ON bi.budget_item_id = ri.budget_item_id
    WHERE ri.request_id = p_request_id;

    -- Update any attachments uploaded during resubmission preparation to the new version iteration
    UPDATE attachments
       SET request_version_number = v_new_version
     WHERE request_id = p_request_id
       AND superseded_by_id IS NULL
       AND uploaded_at > v_req.updated_at;

    -- Freeze all currently active attachments for this version
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'attachment_id', a.attachment_id,
                'file_name', a.file_name,
                'mime_type', a.mime_type,
                'size_bytes', a.size_bytes,
                'storage_path', a.storage_path,
                'storage_backend', a.storage_backend,
                'uploaded_by', a.uploaded_by,
                'uploaded_at', a.uploaded_at,
                'version_number', a.version_number,
                'request_version_number', a.request_version_number
            )
        ),
        '[]'::jsonb
    ) INTO v_docs_json
    FROM attachments a
    WHERE a.request_id = p_request_id
      AND a.superseded_by_id IS NULL;

    INSERT INTO request_versions (
        request_id, version_number, title, description,
        department_id, course_id, financial_year_id, budget_head_id,
        tentative_total_cost, extra, items_snapshot, documents_snapshot, submitted_by, correction_id
    ) VALUES (
        p_request_id, v_new_version, v_req.title, v_req.description,
        v_req.department_id, v_req.course_id, v_req.financial_year_id, v_req.budget_head_id,
        v_req.tentative_total_cost, v_req.extra, COALESCE(v_items_json, '[]'::jsonb), v_docs_json, p_actor_id, v_corr_id
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
        previous_status, new_status, amount_requested_snapshot, comments, signature_id, request_version_number
    ) VALUES (
        p_request_id, v_target_stage, p_actor_id, v_actor_role_id, 'RESUBMIT',
        'AWAITING_RESUBMISSION', v_target_status, v_req.tentative_total_cost, p_comments, v_signature_id, v_new_version
    );

    INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
    VALUES ('request', p_request_id::TEXT, p_actor_id, 'RESUBMIT',
            jsonb_build_object('status', 'AWAITING_RESUBMISSION', 'version', v_req.current_version_number),
            jsonb_build_object('status', v_target_status, 'version', v_new_version, 'stage_id', v_target_stage, 'amount', v_req.tentative_total_cost));

    RETURN v_new_version;
END;
$$;
