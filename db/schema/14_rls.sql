-- Row-Level Security.
--
-- HOW THIS WORKS
-- The application connects as the `app_user` role and, at the start of every
-- request, tells Postgres who the logged-in person is:
--
--     SET LOCAL app.user_id = '<uuid of the authenticated user>';
--
-- Use SET LOCAL (transaction-scoped), never plain SET, or the value leaks to
-- the next request that reuses the pooled connection.
--
-- IMPORTANT: superusers and table owners bypass RLS. Connecting as `postgres`
-- sees everything regardless of the policies below — that is expected, and is
-- why the app must not use the postgres role.

-- ---------------------------------------------------------------------------
-- Application role
-- ---------------------------------------------------------------------------
-- Created without LOGIN deliberately: choose a password yourself rather than
-- having one committed to the repository.
--
--     ALTER ROLE app_user LOGIN PASSWORD '<your password>';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- WHY THESE ARE SECURITY DEFINER
-- A policy expression is itself subject to RLS. A helper that reads `requests`
-- or `approval_actions` while those tables' own policies call that same helper
-- recurses until the stack blows. SECURITY DEFINER makes these helpers read as
-- the (RLS-exempt) owner, which breaks the cycle. search_path is pinned so the
-- elevated body cannot be redirected at a shadowed table.
--
-- Each returns only a boolean, so nothing leaks beyond a visibility yes/no.

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS UUID AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::UUID;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_has_role(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON r.role_id = ur.role_id
        WHERE ur.user_id = app_current_user_id()
          AND r.code = p_code
    );
$$;

CREATE OR REPLACE FUNCTION app_request_funding_type(p_request_id UUID)
RETURNS course_funding_type
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT COALESCE(
        c.funding_type,
        d.funding_type,
        'GRANT'::course_funding_type
    )
    FROM requests r
    LEFT JOIN courses c ON c.course_id = r.course_id
    LEFT JOIN departments d ON d.department_id = r.department_id
    WHERE r.request_id = p_request_id;
$$;

-- True when the user is a configured approver on a stage this request sits at
-- now, or passed through earlier (so approvers keep visibility after escalating).
-- For CDC, grants visibility only to the matching Grant vs Non-Grant member.
CREATE OR REPLACE FUNCTION app_is_stage_participant(p_request_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM requests r
        JOIN stage_approvers sa ON sa.user_id = p_user_id
        JOIN roles ro ON ro.role_id = sa.role_id
        WHERE r.request_id = p_request_id
          AND (
                sa.stage_id = r.current_stage_id
             OR EXISTS (
                    SELECT 1 FROM approval_actions aa
                    WHERE aa.request_id = r.request_id
                      AND aa.stage_id   = sa.stage_id
                )
          )
          AND (
                ro.code NOT IN ('CDC_GRANT_MEMBER', 'CDC_NON_GRANT_MEMBER')
             OR (ro.code = 'CDC_GRANT_MEMBER' AND app_request_funding_type(r.request_id) = 'GRANT')
             OR (ro.code = 'CDC_NON_GRANT_MEMBER' AND app_request_funding_type(r.request_id) = 'NON_GRANT')
          )
    )
    OR EXISTS (
        SELECT 1 FROM approval_actions aa
        WHERE aa.request_id = p_request_id
          AND aa.performed_by = p_user_id
    );
$$;


CREATE OR REPLACE FUNCTION app_can_see_request(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        EXISTS (
            SELECT 1 FROM requests r
            WHERE r.request_id = p_request_id
              AND r.raised_by  = app_current_user_id()
        )
        OR app_is_stage_participant(p_request_id, app_current_user_id());
$$;

-- The Principal reads all college data (requirements §4), except drafts, which
-- stay private to their author until submitted. Kept separate from
-- app_can_see_request on purpose: that helper also gates WRITE policies, and
-- read-all must not quietly become edit-all.
CREATE OR REPLACE FUNCTION app_principal_can_read(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT app_has_role('PRINCIPAL')
       AND EXISTS (
            SELECT 1 FROM requests r
            WHERE r.request_id = p_request_id
              AND r.current_status <> 'DRAFT'
       );
$$;

-- Issue participants: raiser, assignee, escalation target, and the Principal.
CREATE OR REPLACE FUNCTION app_can_see_issue(p_issue_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT app_has_role('PRINCIPAL')
        OR EXISTS (
            SELECT 1 FROM issues i
            WHERE i.issue_id = p_issue_id
              AND app_current_user_id() IN (i.raised_by, i.assigned_to, i.escalated_to)
        );
$$;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- Multiple permissive policies on a table are OR-ed together.

ALTER TABLE requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY requests_admin ON requests
    USING (app_has_role('ADMIN'))
    WITH CHECK (app_has_role('ADMIN'));

-- A requester sees and edits their own requests.
CREATE POLICY requests_own ON requests
    USING (raised_by = app_current_user_id())
    WITH CHECK (raised_by = app_current_user_id());

-- Approvers see requests currently at their stage, or that passed through it.
CREATE POLICY requests_approver ON requests
    FOR SELECT
    USING (app_is_stage_participant(request_id, app_current_user_id()));

-- The Principal reads every submitted request, not only those routed through
-- the Principal stage — a 5 lakh request goes straight to CDC and would
-- otherwise be invisible to the college's primary approver.
CREATE POLICY requests_principal_read ON requests
    FOR SELECT
    USING (app_has_role('PRINCIPAL') AND current_status <> 'DRAFT');

-- Approvers act through fn_record_action, which updates the request row.
--
-- USING: the approver must be staffed at the stage the request sits at NOW.
-- WITH CHECK: the updated row may sit at that stage or any stage above it.
-- The explicit WITH CHECK matters. Without one, Postgres re-applies USING to
-- the new row — and an escalation moves the request to a stage the escalating
-- approver is not staffed at, so every escalation was rejected.
CREATE POLICY requests_approver_update ON requests
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM stage_approvers sa
            WHERE sa.user_id = app_current_user_id()
              AND sa.stage_id = requests.current_stage_id
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM stage_approvers sa
            JOIN workflow_stages mine   ON mine.stage_id   = sa.stage_id
            JOIN workflow_stages target ON target.stage_id = requests.current_stage_id
            WHERE sa.user_id = app_current_user_id()
              AND target.sequence_no >= mine.sequence_no
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
            requests.current_status IN ('APPROVED', 'PARTIALLY_APPROVED', 'REJECTED')
            AND requests.tentative_total_cost > app_get_config_numeric('workflow.threshold.principal_max', 50000)
            AND EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
                WHERE sa.user_id = app_current_user_id()
                  AND ws.code = 'PRINCIPAL'
            )
        )
        AND NOT (
            requests.current_status IN ('APPROVED', 'PARTIALLY_APPROVED', 'REJECTED')
            AND requests.tentative_total_cost > app_get_config_numeric('workflow.threshold.cdc_max', 500000)
            AND EXISTS (
                SELECT 1 FROM stage_approvers sa
                JOIN workflow_stages ws ON ws.stage_id = sa.stage_id
                WHERE sa.user_id = app_current_user_id()
                  AND ws.code = 'CDC'
            )
        )
    );

-- Line items follow their parent request.
ALTER TABLE request_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY request_items_via_request ON request_items
    USING (app_has_role('ADMIN') OR app_can_see_request(request_id))
    WITH CHECK (app_has_role('ADMIN') OR app_can_see_request(request_id));

CREATE POLICY request_items_principal_read ON request_items
    FOR SELECT
    USING (app_principal_can_read(request_id));

-- The audit trail follows the request too.
ALTER TABLE approval_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_actions_via_request ON approval_actions
    USING (app_has_role('ADMIN') OR app_can_see_request(request_id))
    WITH CHECK (app_has_role('ADMIN') OR app_can_see_request(request_id));

CREATE POLICY approval_actions_principal_read ON approval_actions
    FOR SELECT
    USING (app_principal_can_read(request_id));

-- Comment visibility — the hierarchical rule from the design doc.
--   ALL         visible to anyone who can see the request
--   UP_CHAIN    visible to the authoring stage, every stage above it, and the
--               Principal. The design doc's own example: a CDC member's note
--               that grant budget is unavailable is visible to CDC and to the
--               Principal, but not to the Purchase Committee or the Head.
--   STAGE_ONLY  visible only to approvers on the authoring stage
-- The author always sees their own comment.
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY comments_visibility ON comments
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR author_user_id = app_current_user_id()
        OR (
            (app_can_see_request(request_id) OR app_principal_can_read(request_id))
            AND (
                visibility = 'ALL'
                OR (
                    visibility = 'UP_CHAIN'
                    AND (
                        app_has_role('PRINCIPAL')
                        OR EXISTS (
                            SELECT 1
                            FROM stage_approvers sa
                            JOIN workflow_stages viewer ON viewer.stage_id = sa.stage_id
                            JOIN workflow_stages author ON author.stage_id = comments.stage_id
                            WHERE sa.user_id = app_current_user_id()
                              AND viewer.sequence_no >= author.sequence_no
                        )
                    )
                )
                OR (
                    visibility = 'STAGE_ONLY'
                    AND EXISTS (
                        SELECT 1 FROM stage_approvers sa
                        WHERE sa.user_id = app_current_user_id()
                          AND sa.stage_id = comments.stage_id
                    )
                )
            )
        )
    );

-- You can only comment as yourself, and only on a request you can see.
CREATE POLICY comments_insert ON comments
    FOR INSERT
    WITH CHECK (
        author_user_id = app_current_user_id()
        AND (
            app_has_role('ADMIN')
            OR app_can_see_request(request_id)
            OR app_principal_can_read(request_id)
        )
    );

-- People see only their own notifications.
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_own ON notifications
    USING (app_has_role('ADMIN') OR user_id = app_current_user_id())
    WITH CHECK (app_has_role('ADMIN') OR user_id = app_current_user_id());

-- Attachments follow their parent request or issue. Reading, adding and
-- removing are separate policies: being able to see a quotation must not
-- mean being able to delete it. There is no UPDATE policy — a stored file's
-- record is never edited, only added or (by its uploader) removed.
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY attachments_read ON attachments
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR uploaded_by = app_current_user_id()
        OR (request_id IS NOT NULL
            AND (app_can_see_request(request_id) OR app_principal_can_read(request_id)))
        OR (issue_id IS NOT NULL AND app_can_see_issue(issue_id))
        OR (budget_provision_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM budget_provisions bp WHERE bp.budget_provision_id = attachments.budget_provision_id
        ))
    );

CREATE POLICY attachments_insert ON attachments
    FOR INSERT
    WITH CHECK (
        uploaded_by = app_current_user_id()
        AND (
            app_has_role('ADMIN')
            OR (request_id IS NOT NULL AND app_can_see_request(request_id))
            OR (issue_id   IS NOT NULL AND app_can_see_issue(issue_id))
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

CREATE POLICY attachments_delete ON attachments
    FOR DELETE
    USING (app_has_role('ADMIN') OR uploaded_by = app_current_user_id());

-- Budget Provisions RLS
ALTER TABLE budget_provisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY budget_provisions_read ON budget_provisions
    FOR SELECT
    USING (
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

CREATE POLICY budget_provisions_write ON budget_provisions
    FOR ALL
    USING (
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

-- Non-financial issues: raiser, assignee, escalation target, Principal, Admin.
-- Split so the Principal and assignee can move an issue along (review,
-- assign, resolve) — previously only the raiser could update it, so the
-- Principal could see an issue but never resolve it. There is no DELETE
-- policy: issues are part of the record.
ALTER TABLE issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY issues_read ON issues
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR app_current_user_id() IN (raised_by, assigned_to, escalated_to)
    );

CREATE POLICY issues_insert ON issues
    FOR INSERT
    WITH CHECK (app_has_role('ADMIN') OR raised_by = app_current_user_id());

CREATE POLICY issues_update ON issues
    FOR UPDATE
    USING (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR app_current_user_id() IN (raised_by, assigned_to, escalated_to)
    )
    WITH CHECK (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR app_current_user_id() IN (raised_by, assigned_to, escalated_to)
    );

-- The audit log is append-only for everyone; only Admin reads it back.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_admin_read ON audit_logs
    FOR SELECT USING (app_has_role('ADMIN'));

CREATE POLICY audit_logs_insert ON audit_logs
    FOR INSERT WITH CHECK (true);

-- Correction requests follow request visibility.
ALTER TABLE correction_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY correction_requests_read ON correction_requests
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR app_can_see_request(request_id)
        OR app_principal_can_read(request_id)
    );

CREATE POLICY correction_requests_insert ON correction_requests
    FOR INSERT
    WITH CHECK (
        app_has_role('ADMIN')
        OR app_can_see_request(request_id)
    );

-- Version snapshots follow request visibility.
ALTER TABLE request_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY request_versions_read ON request_versions
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR app_can_see_request(request_id)
        OR app_principal_can_read(request_id)
    );

CREATE POLICY request_versions_insert ON request_versions
    FOR INSERT
    WITH CHECK (
        app_has_role('ADMIN')
        OR app_can_see_request(request_id)
    );

-- System configurations: non-secret rows readable by anyone; secret rows and writes restricted to ADMIN.
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

-- Account setup tokens are strictly administrator-managed under RLS.
-- Public unauthenticated verification and consumption are handled exclusively via
-- the SECURITY DEFINER functions fn_verify_account_setup_token and fn_consume_account_setup_token.
ALTER TABLE account_setup_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_setup_tokens_admin ON account_setup_tokens;
CREATE POLICY account_setup_tokens_admin ON account_setup_tokens
    FOR ALL
    TO app_user
    USING (app_has_role('ADMIN'))
    WITH CHECK (app_has_role('ADMIN'));

GRANT SELECT, INSERT, UPDATE, DELETE ON account_setup_tokens TO app_user;

-- Role appointments / Tenure history RLS
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
