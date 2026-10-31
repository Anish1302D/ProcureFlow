-- Migration: Strengthen Document Versioning & Concurrency Protection
-- Description: Enforces linear supersession chains (blocking double supersession),
--              preserves request version associations, and ensures strict concurrency locking.

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
    v_req_status  request_status;
BEGIN
    IF app_current_user_id() IS NOT NULL
       AND p_uploaded_by IS DISTINCT FROM app_current_user_id() THEN
        RAISE EXCEPTION 'Actor % does not match the authenticated user', p_uploaded_by
            USING ERRCODE = 'SP013';
    END IF;

    SELECT * INTO v_old FROM attachments WHERE attachment_id = p_old_attachment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attachment % not found', p_old_attachment_id
            USING ERRCODE = 'SP001';
    END IF;

    -- The same reach the attachments_insert policy grants.
    IF app_current_user_id() IS NOT NULL AND NOT (
        app_has_role('ADMIN')
        OR v_old.uploaded_by = app_current_user_id()
        OR (v_old.request_id IS NOT NULL AND app_can_see_request(v_old.request_id))
        OR (v_old.issue_id   IS NOT NULL AND app_can_see_issue(v_old.issue_id))
        OR (v_old.budget_provision_id IS NOT NULL AND app_has_role('HEAD') AND EXISTS (
            SELECT 1 FROM budget_provisions bp
             WHERE bp.budget_provision_id = v_old.budget_provision_id
               AND bp.department_id = (SELECT department_id FROM users WHERE user_id = app_current_user_id())
        ))
    ) THEN
        RAISE EXCEPTION 'User % may not replace attachment %', app_current_user_id(), p_old_attachment_id
            USING ERRCODE = 'SP004';
    END IF;

    -- Linear versioning protection: Cannot supersede a document that has already been superseded
    IF v_old.superseded_by_id IS NOT NULL THEN
        RAISE EXCEPTION 'Attachment % has already been superseded by %', p_old_attachment_id, v_old.superseded_by_id
            USING ERRCODE = 'SP019';
    END IF;

    IF v_old.request_id IS NOT NULL THEN
        SELECT current_version_number, current_status INTO v_req_v, v_req_status
          FROM requests WHERE request_id = v_old.request_id;

        -- Once a request is closed its documents are part of the record.
        IF v_req_status IN ('CLOSED', 'CARRIED_FORWARD') THEN
            RAISE EXCEPTION 'Request is closed; its documents cannot be replaced'
                USING ERRCODE = 'SP003';
        END IF;
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

