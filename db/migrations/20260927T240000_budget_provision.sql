-- Migration: Budget Provision Schema, Computed Views, PDF Attachments, and RLS
-- Timestamp: 20260927T240000

-- 1. Add department_id to users table for departmental association
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(department_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_department_idx ON users(department_id);

-- 2. Create budget_provisions table
CREATE TABLE IF NOT EXISTS budget_provisions (
    budget_provision_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id       INTEGER NOT NULL REFERENCES departments(department_id) ON DELETE RESTRICT,
    financial_year_id   INTEGER NOT NULL REFERENCES financial_years(financial_year_id) ON DELETE RESTRICT,
    budget_head_id      INTEGER REFERENCES budget_heads(budget_head_id) ON DELETE RESTRICT,
    allocated_amount    NUMERIC(14,2) NOT NULL CHECK (allocated_amount >= 0),
    remarks             TEXT,
    created_by          UUID NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint ensuring 1 provision per department + FY + budget head (or overall if head is null)
CREATE UNIQUE INDEX IF NOT EXISTS budget_provisions_dept_fy_head_uq
    ON budget_provisions (department_id, financial_year_id, COALESCE(budget_head_id, -1));

CREATE INDEX IF NOT EXISTS budget_provisions_dept_idx ON budget_provisions(department_id);
CREATE INDEX IF NOT EXISTS budget_provisions_fy_idx   ON budget_provisions(financial_year_id);

-- 3. Add budget_provision_id link to attachments
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS budget_provision_id UUID REFERENCES budget_provisions(budget_provision_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS attachments_budget_provision_idx ON attachments(budget_provision_id);

-- 4. Update fn_supersede_attachment to preserve budget_provision_id
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
BEGIN
    SELECT * INTO v_old FROM attachments WHERE attachment_id = p_old_attachment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attachment % not found', p_old_attachment_id
            USING ERRCODE = 'SP001';
    END IF;

    IF v_old.request_id IS NOT NULL THEN
        SELECT current_version_number INTO v_req_v FROM requests WHERE request_id = v_old.request_id;
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

-- 5. Create computed reporting view v_department_budget_summary
CREATE OR REPLACE VIEW v_department_budget_summary
    WITH (security_invoker = true) AS
SELECT
    bp.budget_provision_id,
    bp.department_id,
    d.code AS department_code,
    d.name AS department_name,
    bp.financial_year_id,
    fy.label AS financial_year,
    bp.budget_head_id,
    bh.code AS budget_head_code,
    bh.name AS budget_head_name,
    bp.allocated_amount,
    COALESCE(req_stats.utilized_amount, 0)   AS utilized_amount,
    COALESCE(req_stats.committed_amount, 0)  AS committed_amount,
    (bp.allocated_amount - (COALESCE(req_stats.utilized_amount, 0) + COALESCE(req_stats.committed_amount, 0))) AS remaining_amount,
    (bp.allocated_amount - COALESCE(req_stats.utilized_amount, 0)) AS available_amount,
    bp.remarks,
    bp.created_by,
    bp.created_at,
    bp.updated_at
FROM budget_provisions bp
JOIN departments d ON d.department_id = bp.department_id
JOIN financial_years fy ON fy.financial_year_id = bp.financial_year_id
LEFT JOIN budget_heads bh ON bh.budget_head_id = bp.budget_head_id
LEFT JOIN LATERAL (
    SELECT
        SUM(CASE WHEN r.current_status IN ('APPROVED', 'PARTIALLY_APPROVED', 'FULFILMENT_PENDING', 'FULFILLED')
                 THEN COALESCE(r.sanctioned_amount, r.tentative_total_cost) ELSE 0 END) AS utilized_amount,
        SUM(CASE WHEN r.current_status IN ('SUBMITTED', 'UNDER_PURCHASE_COMMITTEE_REVIEW', 'UNDER_PRINCIPAL_REVIEW', 'UNDER_CDC_REVIEW', 'UNDER_FINAL_AUTHORITY_REVIEW', 'AWAITING_RESUBMISSION')
                 THEN r.tentative_total_cost ELSE 0 END) AS committed_amount
    FROM requests r
    WHERE r.department_id = bp.department_id
      AND r.financial_year_id = bp.financial_year_id
      AND (bp.budget_head_id IS NULL OR r.budget_head_id = bp.budget_head_id)
) req_stats ON true;

-- 6. Helper function for request-review context
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

-- 7. Row-Level Security Policies
ALTER TABLE budget_provisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budget_provisions_read ON budget_provisions;
CREATE POLICY budget_provisions_read ON budget_provisions FOR SELECT USING (
    app_has_role('ADMIN')
    OR app_has_role('PRINCIPAL')
    OR app_has_role('PURCHASE_COMMITTEE')
    OR app_has_role('CDC_GRANT_MEMBER')
    OR app_has_role('CDC_NON_GRANT_MEMBER')
    OR app_has_role('CHAIRMAN')
    OR app_has_role('VICE_PRESIDENT')
    OR (
        department_id = (SELECT department_id FROM users WHERE user_id = app_current_user_id())
    )
    OR created_by = app_current_user_id()
);

DROP POLICY IF EXISTS budget_provisions_write ON budget_provisions;
CREATE POLICY budget_provisions_write ON budget_provisions FOR ALL USING (
    app_has_role('ADMIN')
    OR (
        app_has_role('HEAD')
        AND department_id = (SELECT department_id FROM users WHERE user_id = app_current_user_id())
    )
) WITH CHECK (
    app_has_role('ADMIN')
    OR (
        app_has_role('HEAD')
        AND department_id = (SELECT department_id FROM users WHERE user_id = app_current_user_id())
    )
);

-- Update attachments RLS policies for budget_provision attachments
DROP POLICY IF EXISTS attachments_read ON attachments;
CREATE POLICY attachments_read ON attachments FOR SELECT USING (
    app_has_role('ADMIN')
    OR uploaded_by = app_current_user_id()
    OR (request_id IS NOT NULL AND (app_can_see_request(request_id) OR app_principal_can_read(request_id)))
    OR (issue_id IS NOT NULL AND (
        app_has_role('ADMIN') OR app_has_role('PRINCIPAL') OR uploaded_by = app_current_user_id()
    ))
    OR (budget_provision_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM budget_provisions bp WHERE bp.budget_provision_id = attachments.budget_provision_id
    ))
);

DROP POLICY IF EXISTS attachments_insert ON attachments;
CREATE POLICY attachments_insert ON attachments FOR INSERT WITH CHECK (
    uploaded_by = app_current_user_id()
    AND (
        app_has_role('ADMIN')
        OR (request_id IS NOT NULL AND (app_can_see_request(request_id) OR app_principal_can_read(request_id)))
        OR issue_id IS NOT NULL
        OR (budget_provision_id IS NOT NULL AND (
            app_has_role('ADMIN')
            OR (app_has_role('HEAD') AND EXISTS (
                SELECT 1 FROM budget_provisions bp
                WHERE bp.budget_provision_id = attachments.budget_provision_id
                  AND (bp.department_id = (SELECT department_id FROM users WHERE user_id = app_current_user_id()) OR bp.created_by = app_current_user_id())
            ))
        ))
    )
);
