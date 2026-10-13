-- Migration: 20261011T200000_config_driven_system.sql
-- Description: Persistent, validated configuration-driven system for approval thresholds,
-- institutional stage assignments, CDC member composition, and feature flags.

-- 1. Create system_configurations table for persistent business configuration
CREATE TABLE IF NOT EXISTS system_configurations (
    config_id    SERIAL PRIMARY KEY,
    key          TEXT NOT NULL UNIQUE,
    value        JSONB NOT NULL,
    description  TEXT,
    category     TEXT NOT NULL DEFAULT 'general',
    is_secret    BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   UUID REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS system_configurations_category_idx ON system_configurations(category);

-- 2. Add member classification to stage_approvers for CDC composition (teaching vs non-teaching)
ALTER TABLE stage_approvers ADD COLUMN IF NOT EXISTS member_classification TEXT DEFAULT 'TEACHING';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_member_classification'
    ) THEN
        ALTER TABLE stage_approvers ADD CONSTRAINT chk_member_classification
            CHECK (member_classification IS NULL OR member_classification IN ('TEACHING', 'NON_TEACHING'));
    END IF;
END $$;

-- 3. Update Vice President label to Vice Chairman per institutional requirement
UPDATE roles SET name = 'Vice Chairman' WHERE code = 'VICE_PRESIDENT';
UPDATE workflow_stages SET name = 'Chairman & Vice Chairman' WHERE code = 'FINAL_AUTHORITY';

-- 4. Seed initial default non-secret business configurations
INSERT INTO system_configurations (key, value, description, category, is_secret) VALUES
    ('workflow.threshold.principal_max', '50000'::jsonb, 'Maximum request amount decided finally by Principal (₹50,000). Requests above this escalate.', 'approval_workflow', FALSE),
    ('workflow.threshold.cdc_max', '500000'::jsonb, 'Maximum request amount decided by CDC (₹5,00,000). Requests above this escalate to Chairman.', 'approval_workflow', FALSE),
    ('self_registration.enabled', 'false'::jsonb, 'Whether public user self-registration is enabled. Default false.', 'feature_flags', FALSE),
    ('roles.vice_chairman.title', '"Vice Chairman"'::jsonb, 'Institutional title for Vice Chairman role', 'institutional', FALSE),
    ('cdc.teaching_members_limit', '3'::jsonb, 'Maximum number of teaching faculty members on the College Development Committee', 'institutional', FALSE),
    ('cdc.non_teaching_members_limit', '1'::jsonb, 'Maximum number of non-teaching staff members on the College Development Committee', 'institutional', FALSE),
    ('budget.warn_utilization_percent', '85'::jsonb, 'Budget utilization threshold percentage at which warnings are displayed', 'budget', FALSE),
    ('institution.name', '"S.P. College"'::jsonb, 'Official institution name', 'institutional', FALSE),
    ('institution.system_name', '"College Procurement & Approval Workflow System"'::jsonb, 'Institutional workflow system title', 'institutional', FALSE),
    ('institution.support_email', '"support@spcollege.edu.in"'::jsonb, 'Institutional system support email address', 'institutional', FALSE)
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    category = EXCLUDED.category,
    is_secret = EXCLUDED.is_secret,
    updated_at = NOW();

-- 5. Helper SQL functions for querying configuration values in SQL triggers/functions
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

-- 6. Update fn_record_action to dynamically consult workflow threshold configuration
CREATE OR REPLACE FUNCTION fn_record_action(
    p_request_id       UUID,
    p_actor_id         UUID,
    p_action           approval_action_type,
    p_comments         TEXT                  DEFAULT NULL,
    p_rejection_reason TEXT                  DEFAULT NULL,
    p_signature_hash   TEXT                  DEFAULT NULL,
    p_item_decisions   JSONB                 DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_req                  requests%ROWTYPE;
    v_stage_code           workflow_stage_code;
    v_is_final             BOOLEAN;
    v_new_stage            INTEGER;
    v_new_status           request_status;
    v_action_id            BIGINT;
    v_signature_id         BIGINT;
    v_principal_stage_id   INTEGER;
    v_cdc_stage_id         INTEGER;
    v_final_stage_id       INTEGER;
    v_total                INTEGER;
    v_approved             INTEGER;
    v_rejected             INTEGER;
    v_item                 RECORD;
    v_req_funding          course_funding_type;
    v_actor_funding_role   TEXT;
    v_principal_max        NUMERIC;
    v_cdc_max              NUMERIC;
BEGIN
    SELECT * INTO v_req FROM requests WHERE request_id = p_request_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request % does not exist', p_request_id
            USING ERRCODE = 'SP002';
    END IF;

    IF v_req.current_status NOT IN (
        'UNDER_PURCHASE_COMMITTEE_REVIEW',
        'UNDER_PRINCIPAL_REVIEW',
        'UNDER_CDC_REVIEW',
        'UNDER_FINAL_AUTHORITY_REVIEW'
    ) THEN
        RAISE EXCEPTION 'Request % is not awaiting review (current status: %)',
            p_request_id, v_req.current_status
            USING ERRCODE = 'SP003';
    END IF;

    SELECT code, is_final
      INTO v_stage_code, v_is_final
      FROM workflow_stages
     WHERE stage_id = v_req.current_stage_id;

    IF NOT EXISTS (
        SELECT 1 FROM stage_approvers
         WHERE stage_id = v_req.current_stage_id
    ) THEN
        RAISE EXCEPTION 'Stage % is unstaffed', v_stage_code
            USING ERRCODE = 'SP004';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM stage_approvers
         WHERE stage_id = v_req.current_stage_id
           AND user_id  = p_actor_id
    ) THEN
        RAISE EXCEPTION 'User % is not authorized to act at stage %', p_actor_id, v_stage_code
            USING ERRCODE = 'SP001';
    END IF;

    -- CDC funding-type separation check
    IF v_stage_code = 'CDC' THEN
        v_req_funding := app_request_funding_type(p_request_id);

        SELECT r.code INTO v_actor_funding_role
          FROM stage_approvers sa
          JOIN roles r ON r.role_id = sa.role_id
         WHERE sa.stage_id = v_req.current_stage_id
           AND sa.user_id  = p_actor_id
           AND r.code IN ('CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER')
         LIMIT 1;

        IF v_actor_funding_role = 'CDC_GRANT_MEMBER' AND v_req_funding <> 'GRANT' THEN
            RAISE EXCEPTION 'CDC Grant Member cannot act on a Non-Grant request'
                USING ERRCODE = 'SP001';
        END IF;

        IF v_actor_funding_role = 'CDC_NON_GRANT_MEMBER' AND v_req_funding <> 'NON_GRANT' THEN
            RAISE EXCEPTION 'CDC Non-Grant Member cannot act on a Grant request'
                USING ERRCODE = 'SP001';
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

    SELECT stage_id INTO v_principal_stage_id FROM workflow_stages WHERE code = 'PRINCIPAL';
    SELECT stage_id INTO v_cdc_stage_id       FROM workflow_stages WHERE code = 'CDC';
    SELECT stage_id INTO v_final_stage_id     FROM workflow_stages WHERE code = 'FINAL_AUTHORITY';

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
        v_new_stage  := NULL;
    END IF;

    INSERT INTO approval_actions (
        request_id, stage_id, performed_by, action,
        comments, rejection_reason, signature_id,
        new_status, new_stage_id
    ) VALUES (
        p_request_id, v_req.current_stage_id, p_actor_id, p_action,
        p_comments, p_rejection_reason, v_signature_id,
        v_new_status, v_new_stage
    ) RETURNING action_id INTO v_action_id;

    -- Apply line item decisions
    IF p_action = 'PARTIAL_APPROVE' THEN
        FOR v_item IN
            SELECT (val->>'item_id')::UUID             AS item_id,
                   (val->>'approved_quantity')::INTEGER AS approved_quantity,
                   (val->>'approved_amount')::NUMERIC   AS approved_amount,
                   (val->>'decision')::item_status_type AS decision,
                   (val->>'remarks')::TEXT              AS remarks
              FROM jsonb_array_elements(p_item_decisions) AS val
        LOOP
            INSERT INTO approval_action_items (
                action_id, item_id, decision,
                approved_quantity, approved_amount, remarks
            ) VALUES (
                v_action_id, v_item.item_id, v_item.decision,
                v_item.approved_quantity, v_item.approved_amount, v_item.remarks
            );

            UPDATE request_items
               SET approved_quantity = v_item.approved_quantity,
                   approved_amount   = v_item.approved_amount,
                   item_status       = v_item.decision
             WHERE item_id = v_item.item_id
               AND request_id = p_request_id;
        END LOOP;

    ELSIF p_action = 'REJECT' THEN
        UPDATE request_items
           SET approved_quantity = 0,
               approved_amount   = 0,
               item_status       = 'REJECTED'
         WHERE request_id = p_request_id;

    ELSIF p_action = 'APPROVE' THEN
        INSERT INTO approval_action_items (
            action_id, item_id, decision,
            approved_quantity, approved_amount
        )
        SELECT v_action_id, item_id, 'APPROVED',
               requested_quantity, estimated_total
          FROM request_items
         WHERE request_id = p_request_id;

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
        IF EXISTS (
            SELECT 1 FROM approval_actions aa
            JOIN stage_approvers sa ON sa.user_id = aa.performed_by AND sa.stage_id = v_final_stage_id
            JOIN roles r ON r.role_id = sa.role_id
            WHERE aa.request_id = p_request_id
              AND aa.stage_id   = v_final_stage_id
              AND aa.action IN ('APPROVE', 'PARTIAL_APPROVE')
              AND r.code = 'CHAIRMAN'
        ) THEN
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
        END IF;

    ELSIF v_stage_code = 'PRINCIPAL' AND p_action IN ('APPROVE', 'PARTIAL_APPROVE') THEN
        v_new_status := CASE
            WHEN p_action = 'APPROVE' THEN 'APPROVED'
            ELSE 'PARTIALLY_APPROVED'
        END::request_status;
        v_new_stage := v_principal_stage_id;
        UPDATE approval_actions SET new_status = v_new_status WHERE action_id = v_action_id;
    END IF;

    UPDATE requests
       SET current_stage_id = v_new_stage,
           current_status   = v_new_status,
           sanctioned_amount = CASE
               WHEN v_new_status IN ('APPROVED', 'PARTIALLY_APPROVED') THEN
                   (SELECT COALESCE(SUM(approved_amount), 0) FROM request_items WHERE request_id = p_request_id)
               ELSE sanctioned_amount
           END,
           updated_at = NOW()
     WHERE request_id = p_request_id;

    RETURN jsonb_build_object(
        'action_id',   v_action_id,
        'new_status',  v_new_status,
        'new_stage_id', v_new_stage
    );
END;
$$;

-- 7. Update RLS policy to use app_get_config_numeric for Principal decision boundary
DROP POLICY IF EXISTS requests_stage_approver_pending ON requests;

CREATE POLICY requests_stage_approver_pending ON requests
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR (
            current_status IN (
                'UNDER_PURCHASE_COMMITTEE_REVIEW',
                'UNDER_PRINCIPAL_REVIEW',
                'UNDER_CDC_REVIEW',
                'UNDER_FINAL_AUTHORITY_REVIEW'
            )
            AND app_is_stage_participant(request_id, app_current_user_id())
        )
        OR (
            current_status IN ('APPROVED', 'PARTIALLY_APPROVED')
            AND app_is_stage_participant(request_id, app_current_user_id())
        )
        AND NOT (
            requests.current_status IN ('APPROVED', 'PARTIALLY_APPROVED')
            AND EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
                WHERE sa.user_id = app_current_user_id()
                  AND ws.code = 'PURCHASE_COMMITTEE'
            )
        )
        AND NOT (
            requests.current_status IN ('APPROVED', 'PARTIALLY_APPROVED')
            AND requests.tentative_total_cost > app_get_config_numeric('workflow.threshold.principal_max', 50000)
            AND EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
                WHERE sa.user_id = app_current_user_id()
                  AND ws.code = 'PRINCIPAL'
            )
        )
    );

-- 8. Enable Row-Level Security and permissions on system_configurations
ALTER TABLE system_configurations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_configurations_read ON system_configurations;
CREATE POLICY system_configurations_read ON system_configurations
    FOR SELECT
    USING (NOT is_secret OR app_has_role('ADMIN'));

DROP POLICY IF EXISTS system_configurations_admin_write ON system_configurations;
CREATE POLICY system_configurations_admin_write ON system_configurations
    FOR ALL
    USING (app_has_role('ADMIN'))
    WITH CHECK (app_has_role('ADMIN'));

GRANT SELECT, INSERT, UPDATE, DELETE ON system_configurations TO app_user;
GRANT USAGE, SELECT ON SEQUENCE system_configurations_config_id_seq TO app_user;

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (filename)
VALUES ('20261011T200000_config_driven_system.sql')
ON CONFLICT (filename) DO NOTHING;
