-- Row-Level Security regression test, run the way the API runs: as app_user.
--
-- WHY THIS EXISTS
-- Testing as postgres proves nothing about security — superusers bypass RLS.
-- Every defect fixed in migration 20260911T120000 passed the earlier tests
-- for exactly that reason. This file switches to app_user and sets
-- app.user_id per actor, then asserts what each person can and cannot do.
--
-- SAFE TO RUN ANYWHERE
-- Everything happens inside one transaction that is rolled back at the end,
-- so no rows survive. Requires the dev seed (db/seed/03) for its users, and
-- assumes no requests or issues already exist, since it asserts exact counts.
--
--   psql -U postgres -d spc_approval -f db/tests/rls_app_user.sql
--
-- Output: one PASS/FAIL line per check, then a summary.

\set QUIET on
\set ON_ERROR_STOP on
SET client_min_messages = notice;

BEGIN;

CREATE TEMP TABLE t_result (n SERIAL, ok BOOLEAN, label TEXT);
GRANT ALL ON t_result TO app_user;
GRANT ALL ON SEQUENCE t_result_n_seq TO app_user;

-- Stash ids in transaction-local settings so DO blocks can read them.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT * FROM (VALUES
        ('head',         'head.cs@spcollege.edu'),
        ('head_chem',    'head.chem@spcollege.edu'),
        ('incharge',     'incharge@spcollege.edu'),
        ('pc',           'pc1@spcollege.edu'),
        ('principal',    'principal@spcollege.edu'),
        ('cdc_grant',    'cdc.grant@spcollege.edu'),
        ('cdc_nongrant', 'cdc.nongrant@spcollege.edu'),
        ('chairman',     'chairman@spcollege.edu'),
        ('vp',           'vp@spcollege.edu'),
        ('admin',        'admin@spcollege.edu')) AS v(k, email)
    LOOP
        PERFORM set_config('t.' || r.k,
            (SELECT user_id::TEXT FROM users WHERE email = r.email), true);
    END LOOP;
END $$;

-- Acting as someone: become app_user, then identify.
CREATE FUNCTION pg_temp.act_as(p_key TEXT) RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.user_id', current_setting('t.' || p_key), true);
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.assert_that(p_ok BOOLEAN, p_label TEXT) RETURNS VOID AS $$
BEGIN
    INSERT INTO t_result (ok, label) VALUES (COALESCE(p_ok, false), p_label);
END $$ LANGUAGE plpgsql;

-- Asserts that a statement fails with a given SQLSTATE (NULL = any error).
CREATE FUNCTION pg_temp.expect_error(p_sql TEXT, p_state TEXT, p_label TEXT) RETURNS VOID AS $$
BEGIN
    EXECUTE p_sql;
    PERFORM pg_temp.assert_that(false, p_label || ' — expected an error, statement succeeded');
EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.assert_that(p_state IS NULL OR SQLSTATE = p_state,
        p_label || CASE WHEN p_state IS NULL OR SQLSTATE = p_state THEN ''
                        ELSE ' — got ' || SQLSTATE || ': ' || SQLERRM END);
END $$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION pg_temp.act_as(TEXT), pg_temp.assert_that(BOOLEAN, TEXT),
                          pg_temp.expect_error(TEXT, TEXT, TEXT) TO app_user;

SET ROLE app_user;

-- ===========================================================================
-- Requests: creation, numbering, drafts stay private
-- ===========================================================================
DO $$
DECLARE v_fy INT; v_it INT; v_off INT; v_mic INT; v_cart INT; v_big UUID; v_draft UUID; v_small UUID;
BEGIN
    SELECT financial_year_id INTO v_fy FROM financial_years WHERE is_active;
    SELECT budget_head_id INTO v_it  FROM budget_heads WHERE code = 'IT';
    SELECT budget_head_id INTO v_off FROM budget_heads WHERE code = 'OFFICE';
    SELECT budget_item_id INTO v_mic  FROM budget_items WHERE code = 'MIC-01';
    SELECT budget_item_id INTO v_cart FROM budget_items WHERE code = 'CART-01';

    -- Head: a 6 lakh request and a private draft.
    PERFORM pg_temp.act_as('head');
    INSERT INTO requests (raised_by, financial_year_id, budget_head_id, title, tentative_total_cost)
    VALUES (current_setting('t.head')::UUID, v_fy, v_it, 'AV overhaul', 600000)
    RETURNING request_id INTO v_big;
    INSERT INTO request_items (request_id, budget_item_id, item_type_snapshot,
                               requested_quantity, estimated_unit_cost, estimated_total)
    VALUES (v_big, v_mic, 'CAPITAL', 4, 150000, 600000);

    INSERT INTO requests (raised_by, financial_year_id, budget_head_id, title, tentative_total_cost)
    VALUES (current_setting('t.head')::UUID, v_fy, v_off, 'Private draft', 900)
    RETURNING request_id INTO v_draft;

    -- In-charge: a 30,000 request (Purchase Committee).
    PERFORM pg_temp.act_as('incharge');
    INSERT INTO requests (raised_by, financial_year_id, budget_head_id, title, tentative_total_cost)
    VALUES (current_setting('t.incharge')::UUID, v_fy, v_off, 'Cartridges', 30000)
    RETURNING request_id INTO v_small;
    INSERT INTO request_items (request_id, budget_item_id, item_type_snapshot,
                               requested_quantity, estimated_unit_cost, estimated_total)
    VALUES (v_small, v_cart, 'CONSUMABLE', 10, 3000, 30000);

    PERFORM set_config('t.big',   v_big::TEXT,   true);
    PERFORM set_config('t.draft', v_draft::TEXT, true);
    PERFORM set_config('t.small', v_small::TEXT, true);

    PERFORM pg_temp.assert_that(
        (SELECT request_number FROM requests WHERE request_id = v_small) ~ '^REQ-\d{4}-\d{4,}$',
        'request_number generated from the sequence when omitted');

    PERFORM pg_temp.expect_error(format(
        $q$INSERT INTO requests (raised_by, financial_year_id, budget_head_id, title, tentative_total_cost)
           VALUES (%L, %s, %s, 'forged', 1)$q$, current_setting('t.head'), v_fy, v_off),
        '42501', 'cannot create a request in someone else''s name');
END $$;

-- Submit both finished requests (as their owners).
DO $$ BEGIN
    PERFORM pg_temp.act_as('head');     PERFORM fn_submit_request(current_setting('t.big')::UUID);
    PERFORM pg_temp.act_as('incharge'); PERFORM fn_submit_request(current_setting('t.small')::UUID);

    PERFORM pg_temp.act_as('head');
    PERFORM pg_temp.assert_that(
        (SELECT current_status FROM requests WHERE request_id = current_setting('t.big')::UUID) = 'UNDER_PURCHASE_COMMITTEE_REVIEW',
        'all requests enter Purchase Committee review first, regardless of amount');
END $$;

-- Enforce stage progression trigger test
DO $$ BEGIN
    PERFORM pg_temp.act_as('admin');
    PERFORM pg_temp.expect_error(format(
        $q$UPDATE requests SET current_stage_id = (SELECT stage_id FROM workflow_stages WHERE code = 'CDC'),
                               current_status = 'UNDER_CDC_REVIEW'
           WHERE request_id = %L$q$, current_setting('t.big')),
        'SP016', 'request cannot jump to CDC without prior Principal approval action');
END $$;

-- ===========================================================================
-- Visibility, including through views
-- ===========================================================================
DO $$ BEGIN
    PERFORM pg_temp.act_as('incharge');
    PERFORM pg_temp.assert_that((SELECT count(*) FROM requests) = 1,
        'in-charge sees only their own request');
    PERFORM pg_temp.assert_that((SELECT count(*) FROM v_pending_requests) = 1,
        'in-charge sees only their own request through v_pending_requests (view leak fixed)');
    PERFORM pg_temp.assert_that(NOT EXISTS (SELECT 1 FROM v_pending_requests
                                      WHERE request_id = current_setting('t.draft')::UUID),
        'another user''s draft is invisible through views');

    PERFORM pg_temp.act_as('pc');
    PERFORM pg_temp.assert_that(EXISTS (SELECT 1 FROM requests WHERE request_id = current_setting('t.big')::UUID),
        'purchase committee sees 6 lakh request sitting at PC stage');

    PERFORM pg_temp.act_as('admin');
    PERFORM pg_temp.assert_that((SELECT count(*) FROM requests) = 3,
        'admin sees everything, drafts included');
END $$;

-- ===========================================================================
-- Approval workflow as app_user
-- ===========================================================================
DO $$ BEGIN
    -- Purchase committee validity review only: cannot approve directly
    PERFORM pg_temp.act_as('pc');
    PERFORM pg_temp.expect_error(format(
        $q$SELECT fn_record_action(%L, %L, 'APPROVE')$q$,
        current_setting('t.big'), current_setting('t.pc')),
        'SP005', 'Purchase Committee cannot approve requests directly');

    -- PC passes both requests to Principal
    PERFORM fn_record_action(current_setting('t.big')::UUID, current_setting('t.pc')::UUID, 'ESCALATE', NULL, 'Valid');
    PERFORM fn_record_action(current_setting('t.small')::UUID, current_setting('t.pc')::UUID, 'ESCALATE', NULL, 'Valid');

    PERFORM pg_temp.assert_that(
        (SELECT current_status FROM requests WHERE request_id = current_setting('t.big')::UUID) = 'UNDER_PRINCIPAL_REVIEW',
        'PC passes 6 lakh request to Principal');

    -- Principal cannot approve requests exceeding 50,000
    PERFORM pg_temp.act_as('principal');
    PERFORM pg_temp.expect_error(format(
        $q$SELECT fn_record_action(%L, %L, 'APPROVE')$q$,
        current_setting('t.big'), current_setting('t.principal')),
        'SP005', 'Principal cannot final-approve request exceeding 50,000');

    -- Principal approves small request (30,000) directly
    PERFORM fn_record_action(current_setting('t.small')::UUID, current_setting('t.principal')::UUID, 'APPROVE');
    PERFORM pg_temp.assert_that(
        (SELECT current_status FROM requests WHERE request_id = current_setting('t.small')::UUID) = 'APPROVED',
        'Principal approves 30,000 request directly as final authority');

    -- Principal passes 6 lakh request to CDC / Final Authority
    PERFORM fn_record_action(current_setting('t.big')::UUID, current_setting('t.principal')::UUID, 'ESCALATE');
    PERFORM pg_temp.assert_that(
        (SELECT current_status FROM requests WHERE request_id = current_setting('t.big')::UUID) = 'UNDER_FINAL_AUTHORITY_REVIEW',
        'Principal passes 6 lakh request to Final Authority');
END $$;

-- CDC 2-member model test
DO $$
DECLARE v_mid UUID; v_fy INT; v_it INT; v_mic INT;
BEGIN
    SELECT financial_year_id INTO v_fy FROM financial_years WHERE is_active;
    SELECT budget_head_id INTO v_it  FROM budget_heads WHERE code = 'IT';
    SELECT budget_item_id INTO v_mic  FROM budget_items WHERE code = 'MIC-01';

    -- Head creates a 1 lakh request (CDC band: 50k-5L)
    PERFORM pg_temp.act_as('head');
    INSERT INTO requests (raised_by, financial_year_id, budget_head_id, title, tentative_total_cost)
    VALUES (current_setting('t.head')::UUID, v_fy, v_it, 'Mid request', 100000)
    RETURNING request_id INTO v_mid;
    INSERT INTO request_items (request_id, budget_item_id, item_type_snapshot,
                               requested_quantity, estimated_unit_cost, estimated_total)
    VALUES (v_mid, v_mic, 'CAPITAL', 1, 100000, 100000);
    PERFORM set_config('t.mid', v_mid::TEXT, true);
    PERFORM fn_submit_request(v_mid);

    -- PC passes to Principal
    PERFORM pg_temp.act_as('pc');
    PERFORM fn_record_action(v_mid, current_setting('t.pc')::UUID, 'ESCALATE');

    -- Principal passes to CDC
    PERFORM pg_temp.act_as('principal');
    PERFORM fn_record_action(v_mid, current_setting('t.principal')::UUID, 'ESCALATE');

    -- CDC member tries RETURN action -> expect SP005 (RETURN is only permitted for PC and Principal)
    PERFORM pg_temp.act_as('cdc_grant');
    PERFORM pg_temp.expect_error(
        format($q$SELECT fn_record_action(%L::UUID, %L::UUID, 'RETURN', p_comments := 'Invalid stage return')$q$, v_mid, current_setting('t.cdc_grant')),
        'SP005', 'CDC stage cannot execute RETURN action');

    -- CDC Non-Grant Member cannot see Grant requests under RLS
    PERFORM pg_temp.act_as('cdc_nongrant');
    PERFORM pg_temp.assert_that(
        NOT EXISTS (SELECT 1 FROM requests WHERE request_id = v_mid),
        'CDC Non-Grant member cannot see Grant request under RLS');

    -- CDC Grant Member approves: single decision is sufficient; request advances to APPROVED
    PERFORM pg_temp.act_as('cdc_grant');
    PERFORM fn_record_action(v_mid, current_setting('t.cdc_grant')::UUID, 'APPROVE');
    PERFORM pg_temp.assert_that(
        (SELECT current_status FROM requests WHERE request_id = v_mid) = 'APPROVED',
        'request advances to APPROVED on single CDC Grant approval');
END $$;

-- ===========================================================================
-- Resubmission & Versioning tests
-- ===========================================================================
DO $$
DECLARE
    v_res_id UUID;
    v_fy     INT;
    v_it     INT;
    v_mic    INT;
    v_new_v  INT;
BEGIN
    SELECT financial_year_id INTO v_fy FROM financial_years WHERE is_active;
    SELECT budget_head_id INTO v_it  FROM budget_heads WHERE code = 'IT';
    SELECT budget_item_id INTO v_mic  FROM budget_items WHERE code = 'MIC-01';

    -- Head creates a request and submits it (Version 1 snapshot created)
    PERFORM pg_temp.act_as('head');
    INSERT INTO requests (raised_by, financial_year_id, budget_head_id, title, description, tentative_total_cost)
    VALUES (current_setting('t.head')::UUID, v_fy, v_it, 'Resubmission test req', 'Original description v1', 25000)
    RETURNING request_id INTO v_res_id;

    INSERT INTO request_items (request_id, budget_item_id, item_type_snapshot,
                               requested_quantity, estimated_unit_cost, estimated_total)
    VALUES (v_res_id, v_mic, 'CAPITAL', 1, 25000, 25000);

    PERFORM fn_submit_request(v_res_id);

    PERFORM pg_temp.assert_that(
        (SELECT current_version_number FROM requests WHERE request_id = v_res_id) = 1,
        'request current_version_number is 1 upon initial submission');

    PERFORM pg_temp.assert_that(
        EXISTS (SELECT 1 FROM request_versions WHERE request_id = v_res_id AND version_number = 1 AND title = 'Resubmission test req'),
        'version 1 snapshot saved in request_versions upon initial submission');

    -- Purchase Committee returns the request for correction
    PERFORM pg_temp.act_as('pc');
    PERFORM fn_record_action(v_res_id, current_setting('t.pc')::UUID, 'RETURN', p_comments := 'Quotation missing stamp, please update quotation');

    PERFORM pg_temp.assert_that(
        (SELECT current_status FROM requests WHERE request_id = v_res_id) = 'AWAITING_RESUBMISSION',
        'request status becomes AWAITING_RESUBMISSION after PC returns it');

    PERFORM pg_temp.assert_that(
        EXISTS (SELECT 1 FROM correction_requests WHERE request_id = v_res_id AND reason LIKE '%missing stamp%'),
        'correction request row recorded with reason and requester');

    -- PC tries to approve or escalate while request is AWAITING_RESUBMISSION -> expect SP017 error
    PERFORM pg_temp.expect_error(
        format($q$SELECT fn_record_action(%L::UUID, %L::UUID, 'ESCALATE')$q$, v_res_id, current_setting('t.pc')),
        'SP017', 'cannot advance a request that is awaiting resubmission');

    -- Requester edits fields and resubmits
    PERFORM pg_temp.act_as('head');
    UPDATE requests SET title = 'Resubmission test req (Updated)', description = 'Revised description v2' WHERE request_id = v_res_id;

    v_new_v := fn_resubmit_request(v_res_id, current_setting('t.head')::UUID, 'Resubmitted with updated quotation and details', 'sha256-mock-signature-hash');

    PERFORM pg_temp.assert_that(v_new_v = 2, 'resubmission returns new version number 2');

    PERFORM pg_temp.assert_that(
        EXISTS (SELECT 1 FROM approval_actions aa JOIN digital_signatures ds ON ds.signature_id = aa.signature_id WHERE aa.request_id = v_res_id AND aa.action = 'RESUBMIT' AND ds.signed_hash = 'sha256-mock-signature-hash'),
        'RESUBMIT action entry carries digital signature seal when provided');

    PERFORM pg_temp.assert_that(
        (SELECT current_version_number FROM requests WHERE request_id = v_res_id) = 2,
        'request current_version_number updated to 2');

    PERFORM pg_temp.assert_that(
        (SELECT current_status FROM requests WHERE request_id = v_res_id) = 'UNDER_PURCHASE_COMMITTEE_REVIEW',
        'request returned to review stage after resubmission');

    PERFORM pg_temp.assert_that(
        (SELECT resolved_by_version FROM correction_requests WHERE request_id = v_res_id) = 2,
        'correction request resolved_by_version marked as 2');

    PERFORM pg_temp.assert_that(
        (SELECT count(*) FROM request_versions WHERE request_id = v_res_id) = 2,
        'request_versions contains both version 1 and version 2 snapshots');

    PERFORM pg_temp.assert_that(
        (SELECT description FROM request_versions WHERE request_id = v_res_id AND version_number = 1) = 'Original description v1',
        'version 1 snapshot preserves original description');

    PERFORM pg_temp.assert_that(
        (SELECT description FROM request_versions WHERE request_id = v_res_id AND version_number = 2) = 'Revised description v2',
        'version 2 snapshot contains revised description');

    -- Verify downstream approvers (Principal and PC) can read full version history
    PERFORM pg_temp.act_as('principal');
    PERFORM pg_temp.assert_that(
        (SELECT count(*) FROM request_versions WHERE request_id = v_res_id) = 2,
        'Principal can view both version 1 and version 2 history via RLS');

    PERFORM pg_temp.act_as('pc');
    PERFORM pg_temp.assert_that(
        (SELECT count(*) FROM request_versions WHERE request_id = v_res_id) = 2,
        'PC can view both version 1 and version 2 history via RLS');

    -- Non-raiser tries to resubmit someone else's request -> expect SP004
    PERFORM pg_temp.act_as('incharge');
    PERFORM pg_temp.expect_error(
        format($q$SELECT fn_resubmit_request(%L::UUID, %L::UUID, 'unauthorized')$q$, v_res_id, current_setting('t.incharge')),
        'SP004', 'non-raiser cannot resubmit another user''s request');
END $$;

-- ===========================================================================
-- Document Versioning tests (Phase 2c)
-- ===========================================================================
DO $$
DECLARE
    v_doc_req UUID;
    v_att1    UUID;
    v_att2    UUID;
    v_fy      INT;
    v_it      INT;
BEGIN
    SELECT financial_year_id INTO v_fy FROM financial_years WHERE is_active;
    SELECT budget_head_id INTO v_it  FROM budget_heads WHERE code = 'IT';

    -- Head creates request and attaches initial document v1
    PERFORM pg_temp.act_as('head');
    INSERT INTO requests (raised_by, financial_year_id, budget_head_id, title, tentative_total_cost)
    VALUES (current_setting('t.head')::UUID, v_fy, v_it, 'Doc versioning req', 10000)
    RETURNING request_id INTO v_doc_req;

    INSERT INTO attachments (request_id, file_name, mime_type, storage_path, storage_backend, uploaded_by, version_number, request_version_number)
    VALUES (v_doc_req, 'quotation_v1.pdf', 'application/pdf', 'docs/q1.pdf', 'local', current_setting('t.head')::UUID, 1, 1)
    RETURNING attachment_id INTO v_att1;

    PERFORM fn_submit_request(v_doc_req);

    -- Supersede local attachment v1 with Drive-stored attachment v2
    v_att2 := fn_supersede_attachment(v_att1, 'quotation_v2.pdf', 'application/pdf', 2048, 'drive://folder/q2.pdf', 'drive', current_setting('t.head')::UUID, 'Updated vendor pricing');

    PERFORM pg_temp.assert_that(
        (SELECT version_number FROM attachments WHERE attachment_id = v_att2) = 2,
        'superseded attachment has version_number 2');

    PERFORM pg_temp.assert_that(
        (SELECT storage_backend FROM attachments WHERE attachment_id = v_att2) = 'drive',
        'new attachment version retains drive storage_backend');

    PERFORM pg_temp.assert_that(
        (SELECT superseded_by_id FROM attachments WHERE attachment_id = v_att1) = v_att2,
        'old local attachment superseded_by_id points to new drive attachment');

    -- Supersede Drive-stored attachment v2 with local attachment v3 (cross-backend drive -> local)
    DECLARE
        v_att3 UUID;
    BEGIN
        v_att3 := fn_supersede_attachment(v_att2, 'quotation_v3.pdf', 'application/pdf', 4096, 'docs/q3.pdf', 'local', current_setting('t.head')::UUID, 'Final signed quotation');
        PERFORM pg_temp.assert_that(
            (SELECT superseded_by_id FROM attachments WHERE attachment_id = v_att2) = v_att3,
            'old drive attachment superseded_by_id points to new local attachment');
    END;

    PERFORM pg_temp.assert_that(
        (SELECT count(*) FROM attachments WHERE request_id = v_doc_req) = 3,
        'all old and new attachment versions across storage backends remain queryable');

    -- PC returns request for correction
    PERFORM pg_temp.act_as('pc');
    PERFORM fn_record_action(v_doc_req, current_setting('t.pc')::UUID, 'RETURN', p_comments := 'Need updated specs');

    -- Head resubmits request (advancing to request version 2) and attaches new document
    PERFORM pg_temp.act_as('head');
    PERFORM fn_resubmit_request(v_doc_req, current_setting('t.head')::UUID, 'Resubmitted with specs');

    INSERT INTO attachments (request_id, file_name, mime_type, storage_path, storage_backend, uploaded_by, version_number, request_version_number)
    VALUES (v_doc_req, 'specs_v2.pdf', 'application/pdf', 'docs/specs.pdf', 'drive', current_setting('t.head')::UUID, 1, 2);

    PERFORM pg_temp.assert_that(
        (SELECT request_version_number FROM attachments WHERE file_name = 'specs_v2.pdf') = 2,
        'document uploaded during resubmission carries request_version_number 2');

    PERFORM pg_temp.assert_that(
        (SELECT request_version_number FROM attachments WHERE attachment_id = v_att1) = 1,
        'original document retains request_version_number 1');

    -- Verify Principal can see all document versions via RLS
    PERFORM pg_temp.act_as('principal');
    PERFORM pg_temp.assert_that(
        (SELECT count(*) FROM attachments WHERE request_id = v_doc_req) = 4,
        'Principal can view all 4 document versions across request iterations under RLS');

    -- Verify unrelated user cannot see any document versions
    PERFORM pg_temp.act_as('incharge');
    PERFORM pg_temp.assert_that(
        (SELECT count(*) FROM attachments WHERE request_id = v_doc_req) = 0,
        'unrelated user sees zero document versions under RLS');
END $$;

-- ===========================================================================
-- Budget Provision tests (Phase 2d)
-- ===========================================================================
DO $$
DECLARE
    v_fy        INT;
    v_cs_dept   INT;
    v_chem_dept INT;
    v_it_head   INT;
    v_bp_id     UUID;
    v_bp_att    UUID;
    v_bp_att2   UUID;
    v_req_id    UUID;
    v_mic       INT;
BEGIN
    SELECT financial_year_id INTO v_fy FROM financial_years WHERE is_active LIMIT 1;
    SELECT department_id INTO v_cs_dept FROM departments WHERE code = 'CS';
    SELECT department_id INTO v_chem_dept FROM departments WHERE code = 'CHEM';
    SELECT budget_head_id INTO v_it_head FROM budget_heads WHERE code = 'IT';
    SELECT budget_item_id INTO v_mic FROM budget_items WHERE code = 'MIC-01';

    -- Head of CS (Dr. A. Deshpande) submits budget provision for CS department
    PERFORM pg_temp.act_as('head');
    INSERT INTO budget_provisions (department_id, financial_year_id, budget_head_id, allocated_amount, remarks, created_by)
    VALUES (v_cs_dept, v_fy, v_it_head, 500000.00, 'CS IT Budget 2026-27', current_setting('t.head')::UUID)
    RETURNING budget_provision_id INTO v_bp_id;

    PERFORM pg_temp.assert_that(v_bp_id IS NOT NULL, 'HOD can insert budget provision for their own department');

    -- Attach PDF supporting document to budget provision
    INSERT INTO attachments (budget_provision_id, file_name, mime_type, storage_path, storage_backend, uploaded_by)
    VALUES (v_bp_id, 'budget_proposal_v1.pdf', 'application/pdf', 'docs/budget_v1.pdf', 'local', current_setting('t.head')::UUID)
    RETURNING attachment_id INTO v_bp_att;

    PERFORM pg_temp.assert_that(v_bp_att IS NOT NULL, 'supporting PDF document attached to budget provision');

    -- Test document versioning on budget provision attachment via fn_supersede_attachment
    v_bp_att2 := fn_supersede_attachment(v_bp_att, 'budget_proposal_v2.pdf', 'application/pdf', 4096, 'docs/budget_v2.pdf', 'drive', current_setting('t.head')::UUID, 'Revised annual allocation');

    PERFORM pg_temp.assert_that(
        (SELECT superseded_by_id FROM attachments WHERE attachment_id = v_bp_att) = v_bp_att2,
        'budget provision PDF attachment uses document versioning model');

    -- HOD of CS (head) attempts to insert budget provision for ANOTHER department (CHEM) -> expect RLS error
    PERFORM pg_temp.act_as('head');
    PERFORM pg_temp.expect_error(
        format($q$INSERT INTO budget_provisions (department_id, financial_year_id, budget_head_id, allocated_amount, created_by) VALUES (%L, %L, %L, 200000, %L)$q$,
               v_chem_dept, v_fy, v_it_head, current_setting('t.head')),
        '42501', 'HOD cannot insert budget provision for another department');

    -- Second HOD (head_chem, Head of Chemistry) attempts to insert budget provision for CS department -> expect RLS error
    PERFORM pg_temp.act_as('head_chem');
    PERFORM pg_temp.expect_error(
        format($q$INSERT INTO budget_provisions (department_id, financial_year_id, budget_head_id, allocated_amount, created_by) VALUES (%L, %L, %L, 250000, %L)$q$,
               v_cs_dept, v_fy, v_it_head, current_setting('t.head_chem')),
        '42501', 'Second HOD cannot insert budget provision for CS department');

    -- Second HOD (head_chem) inserts budget provision for their own department (CHEM) -> succeeds
    DECLARE
        v_chem_bp_id UUID;
    BEGIN
        INSERT INTO budget_provisions (department_id, financial_year_id, budget_head_id, allocated_amount, remarks, created_by)
        VALUES (v_chem_dept, v_fy, v_it_head, 350000.00, 'Chemistry IT Budget 2026-27', current_setting('t.head_chem')::UUID)
        RETURNING budget_provision_id INTO v_chem_bp_id;

        PERFORM pg_temp.assert_that(v_chem_bp_id IS NOT NULL, 'Second HOD can insert budget provision for their own department');
    END;

    -- Verify Principal can read budget provision summary and context
    PERFORM pg_temp.act_as('principal');
    PERFORM pg_temp.assert_that(
        EXISTS (SELECT 1 FROM v_department_budget_summary WHERE budget_provision_id = v_bp_id),
        'Principal can read any department budget provision via summary view');

    -- Create an approved request under CS department and IT budget head to test dynamic utilization calculation
    PERFORM pg_temp.act_as('head');
    INSERT INTO requests (raised_by, department_id, financial_year_id, budget_head_id, title, tentative_total_cost, current_status)
    VALUES (current_setting('t.head')::UUID, v_cs_dept, v_fy, v_it_head, 'Budget test request', 30000, 'DRAFT')
    RETURNING request_id INTO v_req_id;

    INSERT INTO request_items (request_id, budget_item_id, item_type_snapshot, requested_quantity, estimated_unit_cost, estimated_total)
    VALUES (v_req_id, v_mic, 'CAPITAL', 1, 30000, 30000);

    PERFORM fn_submit_request(v_req_id);

    -- PC passes to Principal
    PERFORM pg_temp.act_as('pc');
    PERFORM fn_record_action(v_req_id, current_setting('t.pc')::UUID, 'ESCALATE');

    -- Principal approves <= 50,000 request (moves to APPROVED)
    PERFORM pg_temp.act_as('principal');
    PERFORM fn_record_action(v_req_id, current_setting('t.principal')::UUID, 'APPROVE');

    -- Check computed utilized and remaining figures in v_department_budget_summary
    PERFORM pg_temp.assert_that(
        (SELECT utilized_amount FROM v_department_budget_summary WHERE budget_provision_id = v_bp_id) = 30000.00,
        'computed utilized_amount dynamically reflects real approved request amount');

    PERFORM pg_temp.assert_that(
        (SELECT remaining_amount FROM v_department_budget_summary WHERE budget_provision_id = v_bp_id) = 470000.00,
        'computed remaining_amount dynamically reflects allocated minus utilized amount');

    -- Verify request-review context helper fn_get_department_budget_context returns computed totals
    PERFORM pg_temp.assert_that(
        (SELECT remaining_amount FROM fn_get_department_budget_context(v_cs_dept, v_fy, v_it_head)) = 470000.00,
        'fn_get_department_budget_context returns computed budget context for review screen');
END $$;

RESET ROLE;

\set QUIET off
\pset footer off
\echo
SELECT CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label FROM t_result ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed, count(*) AS total
FROM t_result;

ROLLBACK;
