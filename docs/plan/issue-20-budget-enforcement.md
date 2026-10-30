# Issue #20: Department Budget Limit Enforcement

## 1. Problem Statement
When a Head of Department (HOD) raises a procurement request, the system must not permit the request total to exceed the remaining available budget for that department.

For example:
- Department allocated budget: ₹5,00,000
- Previously utilized budget: ₹3,00,000
- Remaining budget: ₹2,00,000
- New request: ₹2,50,000

The request must be rejected because it exceeds the available budget by ₹50,000.

## 2. Objectives & Scope
1. **Accurate Budget Calculation**: Calculate available/remaining budget using:
   `Remaining Budget = Allocated Budget - (Utilized Amount + Committed Amount)`
   where:
   - `Allocated Budget`: The provision allocated to the department (specific to the budget head or department-wide).
   - `Utilized Amount`: Sanctioned amounts of approved/fulfilled requests in the same financial year.
   - `Committed Amount`: Tentative costs of in-flight requests currently under review.
2. **Backend Enforcement**: Validate budget in `POST /api/requests` using trusted server calculations and atomic transaction locking (`SELECT ... FOR UPDATE` on `budget_provisions`).
3. **Frontend Dynamic Validation**: In `NewRequestModal.jsx`, display the available budget and dynamically warn and prevent submission if the request total exceeds the remaining budget.
4. **Missing Provision Handling**: Prevent requests if a department does not have an active budget provision for the chosen financial year.
5. **Concurrency Protection**: Prevent concurrent requests from exceeding the budget simultaneously using PostgreSQL row-level locks.
6. **Preserve Existing Roles & Workflows**: Ensure approvals, reporting, carry-forwards, and existing requests remain completely unaffected.
7. **25-Commit Implementation Plan**: Execute incrementally across 25 meaningful commits with full regression coverage.
