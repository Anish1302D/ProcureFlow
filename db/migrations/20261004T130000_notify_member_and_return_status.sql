-- Notify requester (HOD/member) when request is returned for correction or resubmitted.
-- In addition, existing triggers notify on escalation and approval/rejection.

CREATE OR REPLACE FUNCTION fn_notify_request_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_stage_name TEXT;
    v_label      TEXT := lower(replace(NEW.current_status::TEXT, '_', ' '));
BEGIN
    IF left(NEW.current_status::TEXT, 6) = 'UNDER_' THEN
        SELECT name INTO v_stage_name
        FROM workflow_stages WHERE stage_id = NEW.current_stage_id;

        -- Approvers at the stage receive review notification
        INSERT INTO notifications (user_id, request_id, subject, body)
        SELECT sa.user_id, NEW.request_id,
               'Request ' || NEW.request_number || ' awaits your review',
               NEW.title || ' is now with ' || v_stage_name || '.'
        FROM stage_approvers sa
        WHERE sa.stage_id = NEW.current_stage_id;

        -- If escalated from a prior stage, notify requester (HOD)
        IF left(OLD.current_status::TEXT, 6) = 'UNDER_' THEN
            INSERT INTO notifications (user_id, request_id, subject, body)
            VALUES (NEW.raised_by, NEW.request_id,
                    'Request ' || NEW.request_number || ' escalated',
                    'Forwarded to ' || v_stage_name || ' for review.');
        ELSIF OLD.current_status = 'AWAITING_RESUBMISSION' THEN
            INSERT INTO notifications (user_id, request_id, subject, body)
            VALUES (NEW.raised_by, NEW.request_id,
                    'Request ' || NEW.request_number || ' resubmitted',
                    'Resubmitted to ' || v_stage_name || ' for review.');
        END IF;

    ELSIF NEW.current_status = 'AWAITING_RESUBMISSION' THEN
        INSERT INTO notifications (user_id, request_id, subject, body)
        VALUES (NEW.raised_by, NEW.request_id,
                'Request ' || NEW.request_number || ' returned for correction',
                'Sent back for correction. Please review remarks and resubmit.');

    ELSIF NEW.current_status IN ('APPROVED','PARTIALLY_APPROVED','REJECTED','CARRIED_FORWARD') THEN
        INSERT INTO notifications (user_id, request_id, subject, body)
        VALUES (NEW.raised_by, NEW.request_id,
                'Request ' || NEW.request_number || ' ' || v_label,
                CASE
                    WHEN NEW.current_status IN ('APPROVED','PARTIALLY_APPROVED')
                        THEN 'Sanctioned ' || fn_inr(COALESCE(NEW.sanctioned_amount, 0))
                             || ' of ' || fn_inr(NEW.tentative_total_cost) || ' requested.'
                    ELSE NEW.title
                END);
    END IF;

    RETURN NULL;
END;
$$;
