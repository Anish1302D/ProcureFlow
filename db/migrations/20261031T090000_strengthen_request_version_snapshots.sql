-- Strengthen request version snapshots and workflow action version tracking.
--
-- Adds documents_snapshot to request_versions to freeze attached files at the
-- time of initial submission and each resubmission.
-- Adds request_version_number to approval_actions to associate every review
-- decision with the specific request version it evaluated.

ALTER TABLE request_versions
    ADD COLUMN IF NOT EXISTS documents_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE approval_actions
    ADD COLUMN IF NOT EXISTS request_version_number INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS approval_actions_version_idx
    ON approval_actions(request_id, request_version_number);

-- Update fn_submit_request to enrich items_snapshot, capture documents_snapshot,
-- and stamp request_version_number on the SUBMIT action.
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
    v_docs_json  JSONB;
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

    -- Freeze active document attachments
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
                'request_version_number', 1
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
        tentative_total_cost, extra, items_snapshot, documents_snapshot, submitted_by
    ) VALUES (
        p_request_id, 1, v_req.title, v_req.description,
        v_req.department_id, v_req.course_id, v_req.financial_year_id, v_req.budget_head_id,
        v_req.tentative_total_cost, v_req.extra, COALESCE(v_items_json, '[]'::jsonb), v_docs_json, v_req.raised_by
    )
    ON CONFLICT (request_id, version_number) DO NOTHING;

    INSERT INTO approval_actions (request_id, stage_id, performed_by, role_id, action,
                                  previous_status, new_status,
                                  amount_requested_snapshot, request_version_number)
    SELECT p_request_id, v_stage, raised_by, v_raiser_role_id, 'SUBMIT',
           'DRAFT', v_status, tentative_total_cost, 1
    FROM requests WHERE request_id = p_request_id;

    INSERT INTO audit_logs (entity_type, entity_id, actor_user_id, action, before_json, after_json)
    VALUES ('request', p_request_id::TEXT, v_req.raised_by, 'SUBMIT',
            jsonb_build_object('status', 'DRAFT', 'version', 1),
            jsonb_build_object('status', v_status, 'version', 1, 'stage_id', v_stage, 'amount', v_req.tentative_total_cost));
END;
$$;

