# Request Versioning Architecture & Implementation Plan

## Overview
This document specifies the architecture, data models, workflows, and security safeguards for the **ProcureFlow Request Versioning & Immutable Audit Trail** system.

## 1. Objectives & Immutability Rules
- **Stable Request Identity**: The `request_id` and `request_number` remain constant across the entire lifecycle of a requisition, including all revisions and resubmissions.
- **Strict Sequential Numbering**: Versions are numbered sequentially starting at Version 1 (`v1`), incrementing on each resubmission (`v2`, `v3`, ...).
- **Comprehensive Snapshots**: Each version frozen in `request_versions` captures a complete, immutable snapshot:
  - Header metadata: title, description, department, course, financial year, budget head, tentative total cost, and extra parameters.
  - Line items snapshot (`items_snapshot`): item identifiers, names, codes, units, requested quantities, estimated unit costs, and estimated totals.
  - Documents snapshot (`documents_snapshot`): metadata of all active attachments at the moment of submission or resubmission.
  - Requester attribution: `submitted_by` and `submitted_at`.
  - Resolution linkage: `correction_id` linking the revision to the correction request that requested changes.
- **Append-Only Immutability**: Historical snapshots cannot be updated or deleted. Database-level triggers prevent any `UPDATE` or `DELETE` on `request_versions` and `audit_logs`.

## 2. Partial Recommendations vs. Approvals
- **Purchase Committee Scrutiny**: Purchase Committee performs technical scrutiny and recommendations. Committee recommendations (`recommended_quantity`, `recommended_amount`) are recorded separately and **never** overwrite requested values or become final financial approval.
- **Approval Hierarchy Preservation**:
  - Purchase Committee: Recommends and escalates.
  - Principal: Decides proposals up to ₹50,000; escalates larger proposals.
  - CDC (College Development Committee): Decides proposals up to ₹5,00,000.
  - Chairman & Vice Chairman: Hold final authority for proposals above ₹5,00,000.
- **Financial Segregation**:
  - `requested_quantity` / `estimated_total`: Original requested values, never altered.
  - `recommended_quantity` / `recommended_amount`: Recommendations recorded during review.
  - `approved_quantity` / `approved_amount`: Sanctioned amounts decided by authorized authorities.
  - Unapproved values are calculated dynamically without state corruption.

## 3. Workflow Audit Trail
- Every workflow action records:
  - Performed actor and active role.
  - Target workflow stage.
  - Action taken (`SUBMIT`, `RESUBMIT`, `APPROVE`, `PARTIAL_APPROVE`, `REJECT`, `ESCALATE`, `RETURN`, `COMMENT`).
  - Comments and reasons.
  - Previous and new status.
  - Request version number at the time of action (`request_version_number`).
  - Financial amount snapshot.
  - Digital signature verification hash.
- Audit history is strictly append-only.

## 4. API Endpoints
- `GET /api/requests/:id/versions`: Returns all historical version snapshots for a request, protected by Row-Level Security and stage-level authorization.

## 5. UI Interfaces
- **Version Timeline**: Visual version history in Request Details modal, showing timestamps, changes, and authors.
- **Version Diff View**: Side-by-side and highlighted comparison of differences between revisions (quantities, costs, line items, and attachments).

