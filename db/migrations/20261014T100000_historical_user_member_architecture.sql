BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Users: Add employee/member identifier
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id TEXT;

-- Enforce uniqueness of non-null employee_id values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_employee_id_key'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_employee_id_key UNIQUE (employee_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_employee_id_idx ON users(employee_id);

-- ---------------------------------------------------------------------------
-- 2. Approval Actions: Add role_id to capture the exact role held at action time
-- ---------------------------------------------------------------------------
ALTER TABLE approval_actions ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(role_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS approval_actions_role_idx ON approval_actions(role_id);

-- ---------------------------------------------------------------------------
-- 3. Role Appointments / Tenure History Table
-- Supports multiple people occupying the same role over time without overwriting.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_appointments (
    appointment_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role_id               INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    department_id         INTEGER REFERENCES departments(department_id) ON DELETE SET NULL,
    stage_id              INTEGER REFERENCES workflow_stages(stage_id) ON DELETE SET NULL,
    member_classification TEXT CHECK (member_classification IS NULL OR member_classification IN ('TEACHING', 'NON_TEACHING')),
    start_date            DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date              DATE,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    appointment_order_no  TEXT,
    remarks               TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS role_appointments_user_idx   ON role_appointments(user_id);
CREATE INDEX IF NOT EXISTS role_appointments_role_idx   ON role_appointments(role_id);
CREATE INDEX IF NOT EXISTS role_appointments_active_idx ON role_appointments(role_id, is_active);
CREATE INDEX IF NOT EXISTS role_appointments_dept_idx   ON role_appointments(department_id);
CREATE INDEX IF NOT EXISTS role_appointments_stage_idx  ON role_appointments(stage_id);

-- ---------------------------------------------------------------------------
-- 4. Backfill role_id on approval_actions from stage_approvers or user_roles
-- ---------------------------------------------------------------------------
UPDATE approval_actions aa
   SET role_id = sa.role_id
  FROM stage_approvers sa
 WHERE aa.role_id IS NULL
   AND aa.stage_id IS NOT NULL
   AND sa.stage_id = aa.stage_id
   AND sa.user_id  = aa.performed_by;

UPDATE approval_actions aa
   SET role_id = (SELECT role_id FROM roles WHERE code = 'PURCHASE_COMMITTEE')
 WHERE aa.role_id IS NULL
   AND aa.stage_id = (SELECT stage_id FROM workflow_stages WHERE code = 'PURCHASE_COMMITTEE');

UPDATE approval_actions aa
   SET role_id = (SELECT role_id FROM roles WHERE code = 'PRINCIPAL')
 WHERE aa.role_id IS NULL
   AND aa.stage_id = (SELECT stage_id FROM workflow_stages WHERE code = 'PRINCIPAL');

UPDATE approval_actions aa
   SET role_id = (
       SELECT ur.role_id
         FROM user_roles ur
         JOIN roles ro ON ro.role_id = ur.role_id
        WHERE ur.user_id = aa.performed_by
          AND ro.code IN ('CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER', 'CDC_MEMBER')
        LIMIT 1
   )
 WHERE aa.role_id IS NULL
   AND aa.stage_id = (SELECT stage_id FROM workflow_stages WHERE code = 'CDC');

UPDATE approval_actions aa
   SET role_id = (
       SELECT ur.role_id
         FROM user_roles ur
         JOIN roles ro ON ro.role_id = ur.role_id
        WHERE ur.user_id = aa.performed_by
          AND ro.code IN ('CHAIRMAN', 'VICE_PRESIDENT')
        LIMIT 1
   )
 WHERE aa.role_id IS NULL
   AND aa.stage_id = (SELECT stage_id FROM workflow_stages WHERE code = 'FINAL_AUTHORITY');

UPDATE approval_actions aa
   SET role_id = (
       SELECT ur.role_id
         FROM user_roles ur
         JOIN roles ro ON ro.role_id = ur.role_id
        WHERE ur.user_id = aa.performed_by
          AND ro.code IN ('HEAD', 'ACTIVITY_INCHARGE')
        LIMIT 1
   )
 WHERE aa.role_id IS NULL
   AND aa.action IN ('SUBMIT', 'RESUBMIT');

-- Fallback for any remaining unassigned approval action
UPDATE approval_actions aa
   SET role_id = (
       SELECT ur.role_id
         FROM user_roles ur
        WHERE ur.user_id = aa.performed_by
        LIMIT 1
   )
 WHERE aa.role_id IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Backfill initial role_appointments from existing user_roles and stage_approvers
-- ---------------------------------------------------------------------------
INSERT INTO role_appointments (user_id, role_id, department_id, stage_id, member_classification, start_date, is_active, remarks)
SELECT ur.user_id,
       ur.role_id,
       u.department_id,
       sa.stage_id,
       sa.member_classification,
       COALESCE(u.created_at::date, CURRENT_DATE),
       u.is_active,
       'Initial institutional role appointment'
  FROM user_roles ur
  JOIN users u ON u.user_id = ur.user_id
  LEFT JOIN stage_approvers sa ON sa.user_id = ur.user_id AND sa.role_id = ur.role_id
 WHERE NOT EXISTS (
     SELECT 1 FROM role_appointments ra
      WHERE ra.user_id = ur.user_id
        AND ra.role_id = ur.role_id
        AND (ra.stage_id IS NOT DISTINCT FROM sa.stage_id)
 );

-- ---------------------------------------------------------------------------
-- 6. Update v_request_timeline to reflect actual historical actor and role
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS v_request_timeline;
CREATE OR REPLACE VIEW v_request_timeline
    WITH (security_invoker = true) AS
SELECT
    a.action_id,
    a.request_id,
    r.request_number,
    a.created_at,
    ws.code            AS stage_code,
    ws.name            AS stage_name,
    a.action,
    a.previous_status,
    a.new_status,
    a.amount_requested_snapshot,
    a.amount_approved,
    a.rejection_reason,
    a.comments,
    u.full_name        AS performed_by_name,
    u.email            AS performed_by_email,
    u.employee_id      AS performed_by_employee_id,
    a.role_id,
    ro.code            AS role_code,
    ro.name            AS role_name,
    a.signature_id
FROM approval_actions a
JOIN requests r              ON r.request_id = a.request_id
LEFT JOIN workflow_stages ws ON ws.stage_id = a.stage_id
JOIN users u                 ON u.user_id = a.performed_by
LEFT JOIN roles ro           ON ro.role_id = a.role_id
ORDER BY a.request_id, a.created_at;

-- ---------------------------------------------------------------------------
-- 7. Update fn_record_action to store actual role_id on action creation
-- ---------------------------------------------------------------------------
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

    -- Resolve the actor's actual role at this stage
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

    -- CDC Grant vs Non-Grant role check
    IF v_stage_code = 'CDC' THEN
        IF app_request_funding_type(p_request_id) = 'GRANT' AND NOT (
            EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN roles ro ON ro.role_id = sa.role_id
                WHERE sa.stage_id = v_req.current_stage_id AND sa.user_id = p_actor_id
                  AND ro.code IN ('CDC_GRANT_MEMBER', 'CDC_MEMBER')
            ) OR app_has_role('ADMIN')
        ) THEN
            RAISE EXCEPTION 'Only CDC Grant Member can decide requests for Grant departments'
                USING ERRCODE = 'SP004';
        ELSIF app_request_funding_type(p_request_id) = 'NON_GRANT' AND NOT (
            EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN roles ro ON ro.role_id = sa.role_id
                WHERE sa.stage_id = v_req.current_stage_id AND sa.user_id = p_actor_id
                  AND ro.code IN ('CDC_NON_GRANT_MEMBER', 'CDC_MEMBER')
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

-- ---------------------------------------------------------------------------
-- 8. Update fn_submit_request and fn_resubmit_request to capture actor role_id
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 9. Row-Level Security for role_appointments
-- ---------------------------------------------------------------------------
ALTER TABLE role_appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_appointments_read ON role_appointments;
CREATE POLICY role_appointments_read ON role_appointments
    FOR SELECT
    USING (true);

DROP POLICY IF EXISTS role_appointments_admin ON role_appointments;
CREATE POLICY role_appointments_admin ON role_appointments
    FOR ALL
    USING (app_has_role('ADMIN'))
    WITH CHECK (app_has_role('ADMIN'));

GRANT SELECT, INSERT, UPDATE, DELETE ON role_appointments TO app_user;

-- ---------------------------------------------------------------------------
-- 10. Register migration in schema_migrations
-- ---------------------------------------------------------------------------
INSERT INTO schema_migrations (filename)
VALUES ('20261014T100000_historical_user_member_architecture.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
