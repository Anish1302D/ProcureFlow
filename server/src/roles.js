// Which roles may do what, where the database does not already decide.
//
// Approval authority is deliberately absent: who may approve is decided by
// stage staffing inside fn_record_action, never by a role list here.

/** May raise procurement requests (design doc §4: "Raises requisition"). */
export const REQUESTER_ROLES = ['HEAD', 'ACTIVITY_INCHARGE', 'ADMIN'];

/** Roles explicitly barred from raising procurement requests. */
export const REQUESTER_DISALLOWED_ROLES = ['ADMIN'];

/** May move non-financial issues along: review, resolve, close. */
export const ISSUE_MANAGER_ROLES = ['PRINCIPAL'];

/** Roles explicitly barred from logging or creating faculty issues. */
export const ISSUE_CREATOR_DISALLOWED_ROLES = ['ADMIN'];

/** May view inventory and purchase bills. */
export const INVENTORY_READER_ROLES = ['ADMIN', 'PRINCIPAL', 'PURCHASE_COMMITTEE'];

/** May change inventory and purchase bills. */
export const INVENTORY_WRITER_ROLES = ['ADMIN'];

export const hasAnyRole = (user, roles) => (user?.roles ?? []).some((role) => roles.includes(role));

/** Decides whether a user may raise procurement requests. */
export const canRaiseRequests = (user) => {
  if (!user || hasAnyRole(user, REQUESTER_DISALLOWED_ROLES)) return false;
  return hasAnyRole(user, REQUESTER_ROLES);
};

/** Decides whether a user may log or create non-financial issues. */
export const canCreateIssues = (user) => {
  if (!user || hasAnyRole(user, ISSUE_CREATOR_DISALLOWED_ROLES)) return false;
  return true;
};
