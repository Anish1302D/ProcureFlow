-- Append-only audit integrity safeguards.
--
-- Prevents UPDATE and DELETE on immutable audit and history tables:
-- request_versions, audit_logs, digital_signatures, and approval_actions.

CREATE OR REPLACE FUNCTION fn_prevent_immutable_record_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % is strictly append-only and immutable; historical records cannot be updated or deleted', TG_TABLE_NAME
        USING ERRCODE = 'SP019';
END;
$$ LANGUAGE plpgsql;

-- 1. request_versions: never editable or deletable
DROP TRIGGER IF EXISTS trg_request_versions_immutable ON request_versions;
CREATE TRIGGER trg_request_versions_immutable
    BEFORE UPDATE OR DELETE ON request_versions
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_immutable_record_mutation();

-- 2. audit_logs: strictly append-only
DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_immutable_record_mutation();

-- 3. digital_signatures: strictly immutable
DROP TRIGGER IF EXISTS trg_digital_signatures_immutable ON digital_signatures;
CREATE TRIGGER trg_digital_signatures_immutable
    BEFORE UPDATE OR DELETE ON digital_signatures
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_immutable_record_mutation();

-- 4. approval_actions: prevent deletion of workflow audit trail
CREATE OR REPLACE FUNCTION fn_prevent_approval_action_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Approval actions are permanent workflow audit records and cannot be deleted'
        USING ERRCODE = 'SP019';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_approval_actions_no_delete ON approval_actions;
CREATE TRIGGER trg_approval_actions_no_delete
    BEFORE DELETE ON approval_actions
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_approval_action_deletion();

