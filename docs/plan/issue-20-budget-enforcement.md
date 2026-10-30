# Issue #20: Department Budget Limit Enforcement

## 1. Problem Statement
When a Head of Department (HOD) raises a procurement request, the system must not permit the request total to exceed the remaining available budget for that department.

For example:
- Department allocated budget: ₹5,00,000
- Previously utilized budget: ₹3,00,000
- Remaining budget: ₹2,00,000
- New request: ₹2,50,000

The request must be rejected because it exceeds the available budget by ₹50,000.

---

## 2. Existing Budget Architecture & Schema Audit

### 2.1 Database Entities
- **`budget_provisions`** (`db/schema/08_non_financial.sql`):
  - `budget_provision_id UUID PRIMARY KEY`
  - `department_id INTEGER NOT NULL REFERENCES departments`
  - `financial_year_id INTEGER NOT NULL REFERENCES financial_years`
  - `budget_head_id INTEGER NULL REFERENCES budget_heads` (Specific budget head or NULL for department-wide provision)
  - `allocated_amount NUMERIC(14,2) NOT NULL CHECK (allocated_amount >= 0)`
  - Unique index: `(department_id, financial_year_id, COALESCE(budget_head_id, -1))`
- **`requests`** (`db/schema/02_requests.sql`):
  - `request_id UUID PRIMARY KEY`
  - `department_id INTEGER REFERENCES departments`
  - `financial_year_id INTEGER NOT NULL REFERENCES financial_years`
  - `budget_head_id INTEGER NOT NULL REFERENCES budget_heads`
  - `tentative_total_cost NUMERIC(14,2) NOT NULL` (Sum of `request_items.estimated_total`)
  - `sanctioned_amount NUMERIC(14,2)` (Final approved amount from approval flow)
  - `current_status request_status NOT NULL`
- **`request_items`** (`db/schema/02_requests.sql`):
  - `request_item_id UUID PRIMARY KEY`
  - `request_id UUID NOT NULL REFERENCES requests`
  - `budget_item_id INTEGER NOT NULL REFERENCES budget_items`
  - `requested_quantity NUMERIC(10,2) NOT NULL`
  - `estimated_unit_cost NUMERIC(14,2) NOT NULL`
  - `estimated_total NUMERIC(14,2) NOT NULL` (`round(qty * cost, 2)`)

### 2.2 Database View `v_department_budget_summary` (`db/schema/11_views.sql`)
The authoritative source of truth for budget figures across the institution:
```sql
SELECT
    bp.budget_provision_id,
    bp.department_id,
    bp.financial_year_id,
    bp.budget_head_id,
    bp.allocated_amount,
    COALESCE(req_stats.utilized_amount, 0)   AS utilized_amount,
    COALESCE(req_stats.committed_amount, 0)  AS committed_amount,
    (bp.allocated_amount - (COALESCE(req_stats.utilized_amount, 0) + COALESCE(req_stats.committed_amount, 0))) AS remaining_amount,
    (bp.allocated_amount - COALESCE(req_stats.utilized_amount, 0)) AS available_amount
FROM budget_provisions bp
LEFT JOIN LATERAL (
    SELECT
        SUM(CASE WHEN r.current_status IN ('APPROVED', 'PARTIALLY_APPROVED', 'FULFILMENT_PENDING', 'FULFILLED')
                 THEN COALESCE(r.sanctioned_amount, r.tentative_total_cost) ELSE 0 END) AS utilized_amount,
        SUM(CASE WHEN r.current_status IN ('SUBMITTED', 'UNDER_PURCHASE_COMMITTEE_REVIEW', 'UNDER_PRINCIPAL_REVIEW', 'UNDER_CDC_REVIEW', 'UNDER_FINAL_AUTHORITY_REVIEW', 'AWAITING_RESUBMISSION')
                 THEN r.tentative_total_cost ELSE 0 END) AS committed_amount
    FROM requests r
    WHERE r.department_id = bp.department_id
      AND r.financial_year_id = bp.financial_year_id
      AND (bp.budget_head_id IS NULL OR r.budget_head_id = bp.budget_head_id)
) req_stats ON true;
```

### 2.3 Stored Procedure `fn_get_department_budget_context` (`db/schema/12_functions.sql`)
Selects the applicable budget provision for `(department_id, financial_year_id, budget_head_id)`.
It prefers the specific `budget_head_id` provision, falling back to the department-wide provision (`budget_head_id IS NULL`) via:
`ORDER BY v.budget_head_id NULLS LAST LIMIT 1`.

---

## 3. Financial Lifecycle & Accounting Rules
1. **Utilized (`utilized_amount`)**:
   - Statuses: `APPROVED`, `PARTIALLY_APPROVED`, `FULFILMENT_PENDING`, `FULFILLED`.
   - Uses `sanctioned_amount` (or falls back to `tentative_total_cost`).
2. **Committed (`committed_amount`)**:
   - Statuses: `SUBMITTED`, `UNDER_PURCHASE_COMMITTEE_REVIEW`, `UNDER_PRINCIPAL_REVIEW`, `UNDER_CDC_REVIEW`, `UNDER_FINAL_AUTHORITY_REVIEW`, `AWAITING_RESUBMISSION`.
   - Uses `tentative_total_cost`.
3. **Released / Ignored**:
   - Statuses: `DRAFT` (unsubmitted work), `REJECTED` (denied requests release committed funds immediately), `CLOSED`, `CARRIED_FORWARD`.
4. **Remaining Budget (`remaining_amount`)**:
   - Formula: `Allocated Amount - (Utilized Amount + Committed Amount)`.
   - This represents the exact maximum amount a new request can take without causing budget deficits.

---

## 4. Concurrency Protection Strategy
To prevent double-spend race conditions (e.g., remaining budget is ₹1,00,000; Request A for ₹70,000 and Request B for ₹60,000 submitted concurrently):
- Request creation and submission transactions acquire a row-level lock on the applicable `budget_provisions` record using `SELECT budget_provision_id FROM budget_provisions WHERE ... FOR UPDATE`.
- This serializes concurrent requests for the same department/provision so that each transaction evaluates the latest committed state of requests.

---

## 5. API Error Specification
When a request exceeds the available budget:
- **HTTP Status**: `422 Unprocessable Entity`
- **Error Message**:
  `"Request amount exceeds available departmental budget by ₹<excess>. Maximum permitted amount: ₹<remaining>."`
- **Error Details Payload**:
  ```json
  {
    "requestedAmount": 250000,
    "allocatedAmount": 500000,
    "utilizedAmount": 300000,
    "committedAmount": 0,
    "remainingAmount": 200000,
    "excessAmount": 50000
  }
  ```
When no budget provision exists for the department:
- **HTTP Status**: `422 Unprocessable Entity`
- **Error Message**:
  `"No budget provision has been declared for this department for the selected financial year."`
