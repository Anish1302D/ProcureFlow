# Issue #25: Disallow Admin from Raising Procurement Requests and Logging Issues

## 1. Problem Statement
In the existing application:
- Admin users (`ADMIN` role) are currently included in `REQUESTER_ROLES` in `server/src/roles.js`.
- Admin users can call `POST /api/requests` to create procurement requisitions.
- Admin users can call `POST /api/issues` to log faculty issues.
- The Admin UI displays buttons to raise requests and log issues.

This violates separation of duties. Administrators in ProcureFlow are operational auditors, master-data managers, system configuration managers, and oversight authorities. They must **NOT** raise requisitions or log issues. However, Administrators must retain full permissions to view, monitor, manage, and configure all existing requests and issues.

## 2. Objective
1. Remove `ADMIN` from `REQUESTER_ROLES`.
2. Restrict request creation (`POST /api/requests`) so `ADMIN` is strictly forbidden (HTTP 403).
3. Restrict issue creation (`POST /api/issues`) so `ADMIN` is strictly forbidden (HTTP 403).
4. Hide or disable all request and issue creation actions in the Admin UI (`Header.jsx`, `NonFinancialRequestsManagement.jsx`, `FinancialRequestsManagement.jsx`, modals).
5. Preserve all existing Admin capabilities: viewing all requests, inspecting audit logs, viewing issues, managing users, master data, budgets, inventory, bills, reports, and system configuration.
6. Preserve request creation for `HEAD` and `ACTIVITY_INCHARGE`, and issue creation for all other eligible campus users.
7. Execute across 20 distinct, meaningful commits with regression test coverage.
