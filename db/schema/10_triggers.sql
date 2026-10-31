-- Keep updated_at columns fresh automatically.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_set_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER requests_set_updated_at
    BEFORE UPDATE ON requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER issues_set_updated_at
    BEFORE UPDATE ON issues
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER inventory_items_set_updated_at
    BEFORE UPDATE ON inventory_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- requests.sanctioned_amount is derived: it is always the sum of what was
-- approved across the request's line items. Keeping it as a stored column
-- makes dashboards and reports cheap, but a stored derived value drifts the
-- moment anything writes an item without recomputing it. This trigger makes
-- that impossible — the total is maintained by the database, not the caller.
CREATE OR REPLACE FUNCTION fn_sync_sanctioned_amount()
RETURNS TRIGGER AS $$
DECLARE
    v_request_id UUID;
BEGIN
    v_request_id := COALESCE(NEW.request_id, OLD.request_id);

    UPDATE requests r
       SET sanctioned_amount = sub.total
      FROM (
            SELECT COALESCE(SUM(approved_amount), 0) AS total
            FROM request_items
            WHERE request_id = v_request_id
           ) sub
     WHERE r.request_id = v_request_id
       AND r.sanctioned_amount IS DISTINCT FROM sub.total;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER request_items_sync_sanctioned
    AFTER INSERT OR DELETE OR UPDATE OF approved_amount ON request_items
    FOR EACH ROW EXECUTE FUNCTION fn_sync_sanctioned_amount();

-- Append-only audit integrity safeguards.
-- Prevents UPDATE and DELETE on immutable audit and history tables.
CREATE OR REPLACE FUNCTION fn_prevent_immutable_record_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % is strictly append-only and immutable; historical records cannot be updated or deleted', TG_TABLE_NAME
        USING ERRCODE = 'SP019';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_request_versions_immutable
    BEFORE UPDATE OR DELETE ON request_versions
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_immutable_record_mutation();

CREATE TRIGGER trg_audit_logs_immutable
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_immutable_record_mutation();

CREATE TRIGGER trg_digital_signatures_immutable
    BEFORE UPDATE OR DELETE ON digital_signatures
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_immutable_record_mutation();

CREATE OR REPLACE FUNCTION fn_prevent_approval_action_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Approval actions are permanent workflow audit records and cannot be deleted'
        USING ERRCODE = 'SP019';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_approval_actions_no_delete
    BEFORE DELETE ON approval_actions
    FOR EACH ROW EXECUTE FUNCTION fn_prevent_approval_action_deletion();
