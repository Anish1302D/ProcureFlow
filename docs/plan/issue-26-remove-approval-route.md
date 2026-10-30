# Issue #26: Remove Redundant Approval Route Navigation

## 1. Context & Problem Statement
In the original application navigation structure:
- **Admin Navigation (`NAV.admin`)**: Contained `System configuration` (`id: 'settings'`) under the Operations group.
- **Shared Account Navigation (`ACCOUNT`)**: Contained `Approval route` (`id: 'settings'`) alongside Notifications and Profile.
- **Header Page Titles (`PAGE_TITLES`)**: Mapped `settings: 'Approval route'`.
- Both navigation items pointed to the identical route (`settings`), which renders `SettingsPreferences.jsx`.

For Admin users, this resulted in the `settings` page being rendered twice in the sidebar (once under Operations as "System configuration" and once under Account as "Approval route"). For non-admin users, `Approval route` was displayed under Account, exposing an unconfigured or read-only preview of workflow stages.

## 2. Objective
Eliminate the redundant `Approval Route` navigation from the shared `ACCOUNT` menu while:
1. Preserving `System configuration` in the Admin sidebar Operations group.
2. Preserving the configuration and governance page (`SettingsPreferences.jsx`) with all financial thresholds, approver assignments, operational flags, and workflow simulations.
3. Preserving all approval routing and workflow logic (Purchase Committee review, Principal approval, CDC committee review, and Chairman/Vice Chairman final authority).
4. Updating header page title mapping so `settings` displays `System configuration`.
5. Handling legacy/alias route navigation (`#/approval-route` / `#/approval_route`) gracefully without 404 or authorization leaks.

## 3. Architecture & Resolution
- **Centralized Navigation Definitions (`src/components/layout/navigation.js`)**:
  - `NAV`: Grouped menu items per portal (`principal`, `approver`, `faculty`, `admin`).
  - `ACCOUNT`: Reduced strictly to user-centric account items (`notifications` and `profile`).
  - `PAGE_TITLES`: Maps `settings` to `'System configuration'` and aliases `'approval-route'` to `'System configuration'`.
  - `pagesFor(portal)` & `canAccessPage(portal, pageId)`: Role-based authorization determining permitted screens per portal.
- **Route Alias Normalization (`src/context/AppContext.jsx`)**:
  - `normalizePageSlug(slug)` maps legacy `approval-route` or `approval_route` to `settings`.
  - Unauthorized portals attempting to open `#/settings` fall back gracefully to `HOME[portal]`.
- **Integrity Preservation**:
  - All database triggers, functions (`fn_enforce_stage_progression`), and thresholds (≤ ₹50k Principal, ₹50k-₹5L CDC, > ₹5L Chairman/VC) remain completely untouched and verified.

## 4. Verification & Test Matrix
- Unit and regression coverage added in:
  - `src/components/layout/navigation.test.js`: Portal routing, account menu separation, route guard fallbacks.
  - `src/pages/SettingsPreferences.test.js`: Admin-only access to system configuration and governance.
  - `src/components/layout/ResponsiveNavigation.test.js`: Desktop and mobile responsive drawer, active highlighting, backdrop.
  - `src/workflow/approvalWorkflowIntegrity.test.js`: Stage thresholds, operator vs approver roles, and return-for-correction rules.
