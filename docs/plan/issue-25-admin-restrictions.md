# Issue #25: Disallow Admin from Raising Procurement Requests and Logging Issues

## 1. Problem Statement
In the existing application:
- Admin users (`ADMIN` role) were previously included in `REQUESTER_ROLES` in `server/src/roles.js`.
- Admin users could call `POST /api/requests` to create procurement requisitions.
- Admin users could call `POST /api/issues` to log faculty issues.
- The Admin UI displayed buttons to raise requests and log issues.

This violated separation of duties. Administrators in ProcureFlow are operational auditors, master-data managers, system configuration managers, and oversight authorities. They must **NOT** raise requisitions or log issues. However, Administrators must retain full permissions to view, monitor, manage, and configure all existing requests and issues.

## 2. Objective & Scope
1. **Remove `ADMIN` from `REQUESTER_ROLES`**: Segregate roles into requester roles (`HEAD`, `ACTIVITY_INCHARGE`) and disallowed roles (`ADMIN`).
2. **Enforce Backend Request Restrictions**: In `server/src/routes/requests.js`, reject any request creation attempt by an `ADMIN` (including multi-role users) with `403 Forbidden` (`'Administrators cannot create procurement requests'`).
3. **Enforce Backend Issue Restrictions**: In `server/src/routes/issues.js`, reject any issue creation attempt by an `ADMIN` with `403 Forbidden` (`'Administrators cannot create or log issues'`).
4. **Session Payload Alignment**: In `server/src/routes/auth.js`, bind `user.can.raiseRequests` and `user.can.logIssues` to helper functions `canRaiseRequests(user)` and `canCreateIssues(user)` so the client session accurately reflects backend policy.
5. **Hide Frontend Creation Entry Points**:
   - `src/components/layout/Header.jsx`: Guard "New request" and "Log issue" buttons against `ADMIN`.
   - `src/pages/FinancialRequestsManagement.jsx`: Guard "New request" button against `ADMIN`.
   - `src/pages/NonFinancialRequestsManagement.jsx`: Guard "Log issue" button against `ADMIN`.
   - `src/pages/FacultyDashboard.jsx`: Guard "New request" and "Log issue" buttons against `ADMIN`.
   - `src/components/modals/NewRequestModal.jsx`: Return `null` immediately if `user?.roles?.includes('ADMIN')`.
   - `src/components/modals/NewIssueModal.jsx`: Return `null` immediately if `user?.roles?.includes('ADMIN')`.
6. **Preserve Full Administrative Functionality**:
   - Retain full viewing and search across all requests (`GET /api/requests`, `GET /api/requests/:id`).
   - Retain full viewing and search across all issues (`GET /api/issues`, `GET /api/issues/:id`).
   - Retain all administrative navigation items: Dashboard, User Management, Master Data, System Configuration, Budgets, All Requests, Faculty Issues, Inventory, Purchase Bills, Reports, Exports, Audit Log.
   - Retain dashboard stat cards and overview metrics.
7. **Preserve Eligible Requesters & Creators**:
   - Retain request creation for `HEAD` (with department check) and `ACTIVITY_INCHARGE`.
   - Retain issue creation for `HEAD`, `FACULTY`, `STAFF`, `ACTIVITY_INCHARGE`, `PRINCIPAL`, and committee members.
8. **Verify RLS Security Integrity**:
   - Row-Level Security policies (`requests_admin`, `requests_own`, `issues_read`) remain strictly intact.

## 3. Architecture & Implementation Summary

### Role Definitions (`server/src/roles.js`)
- `REQUESTER_ROLES = ['HEAD', 'ACTIVITY_INCHARGE']`
- `REQUESTER_DISALLOWED_ROLES = ['ADMIN']`
- `ISSUE_CREATOR_DISALLOWED_ROLES = ['ADMIN']`
- `canRaiseRequests(user)` returns `false` if `ADMIN`, `true` only for eligible requester roles.
- `canCreateIssues(user)` returns `false` if `ADMIN`, `true` for all other authenticated users.

### API Gateways
- `POST /api/requests`:
  - `requireRole(...REQUESTER_ROLES)` rejects requests lacking eligible roles.
  - Explicit defensive guard: `if (req.user.roles.includes('ADMIN')) throw forbidden('Administrators cannot create procurement requests');` prevents multi-role escalation.
- `POST /api/issues`:
  - Explicit defensive guard: `if (req.user.roles.includes('ADMIN')) throw forbidden('Administrators cannot create or log issues');`.

### Test Coverage Suites
1. `src/auth/adminRequestRestrictions.test.js`: Validates role policies and API specifications for request creation restrictions.
2. `src/auth/adminIssueRestrictions.test.js`: Validates role policies and API specifications for issue creation restrictions.
3. `src/auth/adminRequestForbidden.test.js`: Validates 403 Forbidden response and route code guards for direct request creation.
4. `src/auth/adminIssueForbidden.test.js`: Validates 403 Forbidden response and route code guards for direct issue creation.
5. `src/auth/preserveEligibleRequesters.test.js`: Validates `HEAD` and `ACTIVITY_INCHARGE` retain procurement requisition capability.
6. `src/auth/preserveEligibleIssueCreators.test.js`: Validates non-admin campus roles retain issue creation capability.
7. `src/auth/alignCreationAuth.test.js`: Validates `auth.js` user payload can-flags mirror backend authorization policies.
8. `src/auth/roleBasedActionVisibility.test.js`: Validates UI visibility and modal rendering guards across components.
9. `src/auth/adminViewingPreserved.test.js`: Validates Admin retains full viewing, monitoring, and administrative navigation.
10. `src/auth/securityRlsIntegrity.test.js`: Validates database RLS policies and defense-in-depth architecture.
