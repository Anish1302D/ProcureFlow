-- Enumerated types.
-- Keep all controlled vocabularies here so they are easy to find and evolve.

CREATE TYPE budget_head_type AS ENUM ('REVENUE', 'CAPITAL');

CREATE TYPE budget_item_type AS ENUM ('CONSUMABLE', 'CAPITAL', 'REVENUE');

CREATE TYPE request_status AS ENUM (
    'DRAFT',
    'SUBMITTED',
    'UNDER_PURCHASE_COMMITTEE_REVIEW',
    'UNDER_PRINCIPAL_REVIEW',
    'UNDER_CDC_REVIEW',
    'UNDER_FINAL_AUTHORITY_REVIEW',
    'AWAITING_RESUBMISSION',
    'APPROVED',
    'PARTIALLY_APPROVED',
    'REJECTED',
    'ESCALATED',
    'FULFILMENT_PENDING',
    'FULFILLED',
    'CLOSED',
    'CARRIED_FORWARD'
);

CREATE TYPE request_item_status AS ENUM (
    'PENDING',
    'APPROVED',
    'PARTIALLY_APPROVED',
    'REJECTED'
);

CREATE TYPE approval_action_type AS ENUM (
    'SUBMIT',
    'APPROVE',
    'PARTIAL_APPROVE',
    'REJECT',
    'ESCALATE',
    'FORWARD',
    'RETURN',
    'RESUBMIT',
    'COMMENT',
    'CARRY_FORWARD',
    'CLOSE'
);

CREATE TYPE workflow_stage_code AS ENUM (
    'PURCHASE_COMMITTEE',
    'PRINCIPAL',
    'CDC',
    'FINAL_AUTHORITY'
);

CREATE TYPE comment_visibility AS ENUM (
    'ALL',          -- everyone who can see the request
    'UP_CHAIN',     -- current stage and above only
    'STAGE_ONLY'    -- only the stage that authored it
);

CREATE TYPE notification_channel AS ENUM ('IN_APP', 'EMAIL');

CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'READ', 'FAILED');

CREATE TYPE issue_status AS ENUM (
    'SUBMITTED',
    'IN_REVIEW',
    'RESOLVED',
    'CLOSED'
);

-- Whether a course is government-aided. Grant and non-grant courses answer to
-- different CDC members (docs/plan/decisions.md).
CREATE TYPE course_funding_type AS ENUM ('GRANT', 'NON_GRANT');
