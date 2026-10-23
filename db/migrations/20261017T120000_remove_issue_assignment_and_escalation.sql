-- Migration: 20261017T120000_remove_issue_assignment_and_escalation.sql
-- Description: Remove assignment and escalation from the issue-logging workflow.
--
-- Issues route directly to the Principal; no middleman is assigned or escalated
-- to. Removes the assigned_to, escalated_to, and escalated_at columns, the
-- ESCALATED value from issue_status, and the notification branches that fired
-- when those fields changed.
--
-- Mirrored in db/schema/01_enums.sql, 08_non_financial.sql, 14_rls.sql,
-- and 16_notifications.sql.

BEGIN;

-- ── 1. Resolve any open issues left in ESCALATED status ──────────────────────
-- There must be no rows carrying the value before we can remove it from the
-- enum. Move them to IN_REVIEW so no issue is silently lost.

UPDATE issues SET status = 'IN_REVIEW' WHERE status = 'ESCALATED';

-- ── 2. Replace fn_notify_issue ────────────────────────────────────────────────
-- Principal notified on INSERT; raiser notified on status change.
-- Assignment and escalation branches removed — those columns are going away.

CREATE OR REPLACE FUNCTION fn_notify_issue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        SELECT ur.user_id, NEW.issue_id,
               'New issue ' || NEW.issue_number, NEW.title
        FROM user_roles ur
        JOIN roles r ON r.role_id = ur.role_id
        WHERE r.code = 'PRINCIPAL'
          AND ur.user_id <> NEW.raised_by;
        RETURN NULL;
    END IF;

    IF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO notifications (user_id, issue_id, subject, body)
        VALUES (NEW.raised_by, NEW.issue_id,
                'Issue ' || NEW.issue_number || ' is now '
                    || lower(replace(NEW.status::TEXT, '_', ' ')),
                NEW.title);
    END IF;

    RETURN NULL;
END;
$$;

-- ── 3. Drop the update trigger before altering status column type ───────────

DROP TRIGGER IF EXISTS issues_notify_update ON issues;

-- ── 4. Update app_can_see_issue ───────────────────────────────────────────────
-- Visibility is now: Principal (all issues) or the raiser (their own).
-- Assignee / escalation-target clauses removed.

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
              AND app_current_user_id() = i.raised_by
        );
$$;

-- ── 5. Update RLS policies ────────────────────────────────────────────────────
-- Drop before the column drop: a policy that names a column prevents DROP COLUMN.

DROP POLICY IF EXISTS issues_read   ON issues;
DROP POLICY IF EXISTS issues_update ON issues;

CREATE POLICY issues_read ON issues
    FOR SELECT
    USING (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR raised_by = app_current_user_id()
    );

CREATE POLICY issues_update ON issues
    FOR UPDATE
    USING (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR raised_by = app_current_user_id()
    )
    WITH CHECK (
        app_has_role('ADMIN')
        OR app_has_role('PRINCIPAL')
        OR raised_by = app_current_user_id()
    );

-- ── 6. Drop the assignment / escalation columns ───────────────────────────────
-- issues_assigned_idx is dropped automatically together with its column.

ALTER TABLE issues
    DROP COLUMN IF EXISTS assigned_to,
    DROP COLUMN IF EXISTS escalated_to,
    DROP COLUMN IF EXISTS escalated_at;

-- ── 7. Replace the issue_status enum without ESCALATED ────────────────────────
-- PostgreSQL has no ALTER TYPE … DROP VALUE, so we recreate the type in four
-- steps: drop the column default, swap the column to a new enum type, drop the
-- old type, rename the new one, restore the default.

ALTER TABLE issues ALTER COLUMN status DROP DEFAULT;

CREATE TYPE issue_status_new AS ENUM ('SUBMITTED', 'IN_REVIEW', 'RESOLVED', 'CLOSED');

ALTER TABLE issues
    ALTER COLUMN status TYPE issue_status_new
    USING status::text::issue_status_new;

DROP TYPE issue_status;
ALTER TYPE issue_status_new RENAME TO issue_status;

ALTER TABLE issues ALTER COLUMN status SET DEFAULT 'SUBMITTED'::issue_status;

-- ── 8. Recreate the update trigger to fire only on status changes ───────────

CREATE TRIGGER issues_notify_update
    AFTER UPDATE OF status ON issues
    FOR EACH ROW
    EXECUTE FUNCTION fn_notify_issue();

-- ── Bookkeeping ───────────────────────────────────────────────────────────────

INSERT INTO schema_migrations (filename)
VALUES ('20261017T120000_remove_issue_assignment_and_escalation.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
