-- Reporting / dashboard views. Read-only convenience layer over base tables.
--
-- Every view is security_invoker. By default a Postgres view reads its base
-- tables with the privileges of the view's OWNER — here the superuser, which
-- bypasses Row-Level Security. Without this option any user querying a view
-- would see every request in the college, including other people's drafts.

-- Every open request with the age (days since submission).
CREATE OR REPLACE VIEW v_pending_requests
    WITH (security_invoker = true) AS
SELECT
    r.request_id,
    r.request_number,
    r.title,
    r.raised_by,
    u.full_name           AS raised_by_name,
    r.financial_year_id,
    fy.label              AS financial_year,
    r.budget_head_id,
    bh.name               AS budget_head,
    r.current_status,
    r.current_stage_id,
    ws.code               AS current_stage_code,
    ws.name               AS current_stage_name,
    r.tentative_total_cost,
    r.sanctioned_amount,
    r.submitted_at,
    EXTRACT(DAY FROM NOW() - COALESCE(r.submitted_at, r.created_at))::INT AS days_pending
FROM requests r
JOIN users u                    ON u.user_id = r.raised_by
LEFT JOIN financial_years fy    ON fy.financial_year_id = r.financial_year_id
LEFT JOIN budget_heads bh       ON bh.budget_head_id = r.budget_head_id
LEFT JOIN workflow_stages ws    ON ws.stage_id = r.current_stage_id
WHERE r.current_status NOT IN ('APPROVED','REJECTED','FULFILLED','CLOSED','CARRIED_FORWARD');

-- "Pending intelligence" — anything sitting untouched for more than 3 days.
CREATE OR REPLACE VIEW v_pending_gt_3_days
    WITH (security_invoker = true) AS
SELECT *
FROM v_pending_requests
WHERE days_pending > 3;

-- Dashboard counters by financial year.
CREATE OR REPLACE VIEW v_dashboard_by_fy
    WITH (security_invoker = true) AS
SELECT
    r.financial_year_id,
    fy.label AS financial_year,
    COUNT(*)                                                          AS total,
    COUNT(*) FILTER (WHERE r.current_status = 'APPROVED')             AS approved,
    COUNT(*) FILTER (WHERE r.current_status = 'REJECTED')             AS rejected,
    COUNT(*) FILTER (WHERE r.current_status = 'PARTIALLY_APPROVED')   AS partial,
    COUNT(*) FILTER (WHERE r.current_status = 'ESCALATED')            AS escalated,
    COUNT(*) FILTER (WHERE r.current_status IN (
        'SUBMITTED',
        'UNDER_PURCHASE_COMMITTEE_REVIEW',
        'UNDER_PRINCIPAL_REVIEW',
        'UNDER_CDC_REVIEW',
        'UNDER_FINAL_AUTHORITY_REVIEW',
        'AWAITING_RESUBMISSION'
    ))                                                                AS pending,
    COUNT(*) FILTER (WHERE r.current_status IN ('FULFILMENT_PENDING','FULFILLED')) AS fulfilment,
    COUNT(*) FILTER (WHERE r.current_status = 'CARRIED_FORWARD')      AS carried_forward
FROM requests r
LEFT JOIN financial_years fy ON fy.financial_year_id = r.financial_year_id
GROUP BY r.financial_year_id, fy.label;

-- Timeline for a single request: chronological approval actions.
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

-- Roll-up of item-level decisions for a request.
CREATE OR REPLACE VIEW v_request_items_summary
    WITH (security_invoker = true) AS
SELECT
    ri.request_id,
    COUNT(*)                                                       AS total_items,
    COUNT(*) FILTER (WHERE ri.item_status = 'APPROVED')            AS items_approved,
    COUNT(*) FILTER (WHERE ri.item_status = 'PARTIALLY_APPROVED')  AS items_partial,
    COUNT(*) FILTER (WHERE ri.item_status = 'REJECTED')            AS items_rejected,
    COUNT(*) FILTER (WHERE ri.item_status = 'PENDING')             AS items_pending,
    SUM(ri.estimated_total)  AS total_requested_amount,
    SUM(ri.approved_amount)  AS total_approved_amount
FROM request_items ri
GROUP BY ri.request_id;

-- Departmental budget provision summary view with computed utilization and commitments.
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
