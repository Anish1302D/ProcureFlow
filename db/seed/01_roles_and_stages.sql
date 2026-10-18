-- Seed minimum viable roles and the workflow stages.
-- Amount thresholds encode the routing described in the design doc:
--   < 50,000                 -> Purchase Committee
--   50,000 - < 5,00,000      -> Principal
--   >= 5,00,000              -> CDC (and can escalate to Final Authority)

INSERT INTO roles (code, name, description) VALUES
    ('HEAD',                 'Head of Department',    'Raises requisitions'),
    ('ACTIVITY_INCHARGE',    'Activity In-charge',    'Raises requisitions'),
    ('PURCHASE_COMMITTEE',   'Purchase Committee',    'Reviews requests below 50,000'),
    ('PRINCIPAL',            'Principal',             'Approval / escalation authority'),
    ('CDC_MEMBER',           'CDC Member',            'CDC review'),
    ('CDC_GRANT_MEMBER',     'CDC Grant Member',      'Grant-side CDC authority'),
    ('CDC_NON_GRANT_MEMBER', 'CDC Non-Grant Member',  'Non-grant CDC authority'),
    ('CHAIRMAN',             'Chairman',              'Final authority'),
    ('VICE_PRESIDENT',       'Vice Chairman',         'Final authority'),
    ('ADMIN',                'Administrator',         'System administration')
ON CONFLICT (code) DO NOTHING;

INSERT INTO workflow_stages (code, name, sequence_no, is_final) VALUES
    ('PURCHASE_COMMITTEE', 'Purchase Committee',       1, FALSE),
    ('PRINCIPAL',          'Principal',                2, FALSE),
    ('CDC',                'CDC',                      3, FALSE),
    ('FINAL_AUTHORITY',    'Chairman & Vice Chairman', 4, TRUE)
ON CONFLICT (code) DO NOTHING;

-- Amount-based routing rules. All requests enter at Purchase Committee for validity review.
INSERT INTO stage_routing_rules (stage_id, min_amount, max_amount)
SELECT stage_id, 0::NUMERIC, NULL::NUMERIC FROM workflow_stages WHERE code = 'PURCHASE_COMMITTEE';

-- Default non-secret business configurations
INSERT INTO system_configurations (key, value, description, category, is_secret) VALUES
    ('workflow.threshold.principal_max', '50000'::jsonb, 'Maximum request amount decided finally by Principal (₹50,000). Requests above this escalate.', 'approval_workflow', FALSE),
    ('workflow.threshold.cdc_max', '500000'::jsonb, 'Maximum request amount decided by CDC (₹5,00,000). Requests above this escalate to Chairman.', 'approval_workflow', FALSE),
    ('workflow.stage.entry', '"PURCHASE_COMMITTEE"'::jsonb, 'Stage code where new requests enter for initial verification', 'approval_workflow', FALSE),
    ('workflow.stage.principal', '"PRINCIPAL"'::jsonb, 'Stage code for the Principal approval gate', 'approval_workflow', FALSE),
    ('workflow.stage.intermediate', '"CDC"'::jsonb, 'Stage code for College Development Committee intermediate authority', 'approval_workflow', FALSE),
    ('workflow.stage.final_authority', '"FINAL_AUTHORITY"'::jsonb, 'Stage code for the final governing authority', 'approval_workflow', FALSE),
    ('workflow.authority.final_role', '"CHAIRMAN"'::jsonb, 'Role code authorized for final sanction', 'approval_workflow', FALSE),
    ('roles.vice_chairman.title', '"Vice Chairman"'::jsonb, 'Institutional title for Vice Chairman role', 'institutional', FALSE),
    ('cdc.teaching_members_limit', '3'::jsonb, 'Maximum number of teaching faculty members on the College Development Committee', 'institutional', FALSE),
    ('cdc.non_teaching_members_limit', '1'::jsonb, 'Maximum number of non-teaching staff members on the College Development Committee', 'institutional', FALSE),
    ('budget.warn_utilization_percent', '85'::jsonb, 'Budget utilization threshold percentage at which warnings are displayed', 'budget', FALSE),
    ('institution.name', '"S.P. College"'::jsonb, 'Official institution name', 'institutional', FALSE),
    ('institution.system_name', '"College Procurement & Approval Workflow System"'::jsonb, 'Institutional workflow system title', 'institutional', FALSE),
    ('institution.support_email', '"support@spcollege.edu.in"'::jsonb, 'Institutional system support email address', 'institutional', FALSE)
ON CONFLICT (key) DO NOTHING;
