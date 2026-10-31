-- Migration bookkeeping.
--
-- A database built from these schema files already contains the effect of
-- every migration listed below, because each migration's change is mirrored
-- into the schema files. Recording them here means a fresh build knows it is
-- current, and nobody has to remember to run a baseline step by hand.
--
-- When you add a migration: mirror its change into the schema files AND add
-- its filename to this list. See db/migrations/README.md.

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (filename) VALUES
    ('20260902T180000_baseline.sql'),
    ('20260902T193000_add_sqlstate_error_codes.sql'),
    ('20260911T120000_backend_rls_fixes.sql'),
    ('20260912T090000_indian_number_format.sql'),
    ('20260927T120000_other_sentinel_items.sql'),
    ('20260927T121500_seed_courses.sql'),
    ('20260927T200000_add_attachment_storage_backend.sql'),
    ('20260927T211500_amount_routing_and_cdc_joint.sql'),
    ('20260927T220000_resubmission_and_versioning.sql'),
    ('20260927T230000_document_versioning.sql'),
    ('20260927T240000_budget_provision.sql'),
    ('20260929T120000_fix_return_action_and_resubmit_seal.sql'),
    ('20260929T130000_course_funding_type.sql'),
    -- These two were never listed, so a database built from these files saw
    -- them as pending and run-pending-migrations.js re-ran them — putting the
    -- 4 October versions of fn_record_action, app_is_stage_participant and
    -- fn_notify_request_status back over the current ones.
    ('20261004T130000_notify_member_and_return_status.sql'),
    ('20261004T170000_cdc_funding_separation.sql'),
    ('20261011T120000_add_user_token_version.sql'),
    ('20261011T200000_config_driven_system.sql'),
    ('20261011T220000_approval_workflow_and_user_mgmt_corrections.sql'),
    ('20261011T230000_secure_account_activation.sql'),
    ('20261014T100000_historical_user_member_architecture.sql'),
    ('20261015T100000_workflow_engine_enhancements.sql'),
    ('20261015T180000_cdc_route_single_rule.sql'),
    ('20261017T120000_remove_issue_assignment_and_escalation.sql'),
    ('20261018T120000_invitations_and_password_recovery.sql'),
    ('20261018T130000_two_step_verification.sql'),
    ('20261031T090000_strengthen_request_version_snapshots.sql'),
    ('20261031T093000_preserve_complete_resubmission_history.sql'),
    ('20261031T100000_item_level_partial_recommendations.sql'),
    ('20261031T103000_append_only_audit_integrity.sql')
ON CONFLICT (filename) DO NOTHING;
