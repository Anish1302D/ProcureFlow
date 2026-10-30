# Issue #26: Remove Redundant Approval Route Navigation

## 1. Context & Problem Statement
In the existing application navigation structure:
- **Admin Navigation (`NAV.admin`)**: Contains `System configuration` (`id: 'settings'`) under the Operations group.
- **Shared Account Navigation (`ACCOUNT`)**: Contains `Approval route` (`id: 'settings'`) alongside Notifications and Profile.
- **Header Page Titles (`PAGE_TITLES`)**: Maps `settings: 'Approval route'`.
- Both navigation items point to the identical route (`settings`), which renders `SettingsPreferences.jsx`.

For Admin users, this resulted in the `settings` page being rendered twice in the sidebar (once under Operations as "System configuration" and once under Account as "Approval route"). For non-admin users, `Approval route` was displayed under Account, which exposed a read-only preview of workflow stages.

## 2. Objective
Eliminate the redundant `Approval Route` navigation from the shared `ACCOUNT` menu while:
1. Preserving `System configuration` in the Admin sidebar.
2. Preserving the configuration and settings page (`SettingsPreferences.jsx`).
3. Preserving all approval routing and workflow logic (Purchase Committee, Principal, CDC, Chairman/Vice Chairman).
4. Updating header page title mapping so `settings` displays `System configuration`.
5. Handling legacy/alias route navigation (`#/approval-route`) gracefully without 404 or authorization leaks.

## 3. Implementation Plan
- Step 01: Establish feature branch and baseline.
- Step 02: Add navigation regression test coverage documenting expected navigation behavior.
- Step 03: Centralize shared account and portal navigation definitions.
- Step 04: Remove the redundant 'Approval route' entry from shared `ACCOUNT` navigation.
- Step 05: Verify and preserve 'System configuration' for Admin portal in sidebar and header.
- Step 06: Align role-based navigation permissions across all user roles.
- Step 07: Clean up obsolete references and handle route aliases (`approval-route` -> `settings`).
- Step 08: Test System Configuration route accessibility and role restrictions.
- Step 09: Test desktop and mobile responsive navigation behavior.
- Step 10: Verify approval workflow logic and threshold calculations remain intact.
- Step 11: Update system documentation.
- Step 12: Final integration test run, linting, build verification, and branch push.
