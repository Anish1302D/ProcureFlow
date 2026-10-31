-- Migration: Auditable Document Archival
-- Description: Adds archival columns to attachments table, eliminates hard deletion of documents,
--              and records immutable audit log entries upon document archival.

ALTER TABLE attachments ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS archived_by_role TEXT DEFAULT NULL;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS archived_reason TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS attachments_archived_idx ON attachments(archived_at) WHERE archived_at IS NOT NULL;

CREATE OR REPLACE FUNCTION fn_archive_attachment(
    p_attachment_id UUID,
    p_actor_id      UUID,
    p_actor_role    TEXT,
    p_reason        TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_att attachments%ROWTYPE;
BEGIN
    SELECT * INTO v_att FROM attachments WHERE attachment_id = p_attachment_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Attachment % not found', p_attachment_id
            USING ERRCODE = 'SP001';
    END IF;

    IF v_att.archived_at IS NOT NULL THEN
        RAISE EXCEPTION 'Attachment % is already archived', p_attachment_id
            USING ERRCODE = 'SP016';
    END IF;

    UPDATE attachments
       SET archived_at = NOW(),
           archived_by = p_actor_id,
           archived_by_role = p_actor_role,
           archived_reason = p_reason
     WHERE attachment_id = p_attachment_id;

    INSERT INTO audit_logs (
        entity_type, entity_id, actor_user_id, action, before_json, after_json
    ) VALUES (
        'attachment',
        p_attachment_id::TEXT,
        p_actor_id,
        'ARCHIVE_ATTACHMENT',
        jsonb_build_object(
            'attachment_id', v_att.attachment_id,
            'file_name', v_att.file_name,
            'version_number', v_att.version_number,
            'request_id', v_att.request_id,
            'size_bytes', v_att.size_bytes
        ),
        jsonb_build_object(
            'archived_at', NOW(),
            'archived_by', p_actor_id,
            'archived_by_role', p_actor_role,
            'archived_reason', p_reason
        )
    );
END;
$$;

