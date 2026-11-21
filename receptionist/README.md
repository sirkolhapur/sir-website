# SIR Reception Desk — PR #101 deployment status

## Implemented on feature branch
- Responsive SIR receptionist login, dashboard, logout and show/hide password.
- Existing CRM-aligned enquiry statuses and field names.
- Receptionist-only RPC migration in `reception-v2.sql`, using `staff_members`, `staff_designations`, `admissions` and `admission_activities`.
- Appointment storage and RPCs in `reception-v2.sql`.
- Visitor and student lookup functions intentionally return no records pending permission audit.

## DO NOT RUN
`reception-schema.sql` is a deliberately disabled, superseded draft. It is NOT the migration.

## Deployment blockers
1. Review `reception-v2.sql` in a staging database, especially SECURITY DEFINER execution, insert/update triggers, and role permissions.
2. Fix frontend field mappings and UX against actual RPC payloads; verify notes and status values.
3. Verify `admin-create-staff` produces the same login ID displayed in Staff Directory and accepted by Receptionist login. Admin already has Staff Directory > Create Staff Login.
4. Confirm an active `Receptionist / Front Desk Executive` designation exists and staff account is provisioned.
5. Run authorized and unauthorized account tests; verify no cross-role access and that existing CRM behavior remains unchanged.
6. Deploy SQL in a controlled manner, then merge PR and test live.

## Not yet delivered
- Actual gate visitor data feed (security guard module integration).
- Restricted student identity lookup.
- Live login/CRUD end-to-end test.

No changes to Talent Hunt student dashboard or other existing role pages.
