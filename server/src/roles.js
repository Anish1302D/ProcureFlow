// Which roles may do what, where the database does not already decide.
//
// Approval authority is deliberately absent: who may approve is decided by
// stage staffing inside fn_record_action, never by a role list here.

/** May raise procurement requests (design doc §4: "Raises requisition"). */
export const REQUESTER_ROLES = ['HEAD', 'ACTIVITY_INCHARGE'];

/** May move non-financial issues along: review, resolve, close. */
export const ISSUE_MANAGER_ROLES = ['PRINCIPAL'];

/** May view inventory and purchase bills. */
export const INVENTORY_READER_ROLES = ['ADMIN', 'PRINCIPAL', 'PURCHASE_COMMITTEE'];

/** May change inventory and purchase bills. */
export const INVENTORY_WRITER_ROLES = ['ADMIN'];

export const hasAnyRole = (user, roles) => user.roles.some((role) => roles.includes(role));
