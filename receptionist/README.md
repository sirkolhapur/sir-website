# SIR Reception Desk — PR #101 deployment status

## Code prepared on feature branch (not deployed)
- Responsive Receptionist login/dashboard, enquiries, follow-ups, appointments and sign-out.
- Enquiry fields/status/source aligned to existing admissions CRM; Receptionist cannot approve/reject/close enquiries.
- Follow-up actor attribution and row-locking against concurrent finalized status changes.
- `reception-final.sql`: role-scoped RPCs, CRM reuse, appointments table, exact-match student identity lookup (active student UID or full registered phone; returns name and UID only).
- `admin-staff-login-ids.sql`: admin-only lookup of actual Auth login emails for existing staff; does **not** create Auth users.
- Sign-out clears cached receptionist data; independent RPC failures do not hide other loaded sections.
- Gate visitor RPC is intentionally empty until Security Guard schema and permissions are audited.

## DO NOT RUN
`reception-schema.sql` is a disabled superseded draft. **Do not execute `reception-v2.sql`, `reception-v3.sql` or `reception-v4.sql`: these are malformed superseded attempts. Use only `reception-final.sql` after SQL review.**

## Deployment order and blockers
1. Review both SQL migrations against the **current** Supabase schema and permissions, ideally in staging. Inspect `SECURITY DEFINER` ownership and existing admissions triggers before running.
2. Deploy `reception-final.sql` and `admin-staff-login-ids.sql` in a controlled database change.
3. Verify deployed `admin-create-staff` Edge Function (its source is not present in the inspected repository): create an active staff member with designation `Receptionist / Front Desk Executive`; confirm its Auth email from the admin-only RPC. Do not infer login email from employee ID.
4. Test receptionist sign-in, sign-out, enquiry insert/update, follow-up, appointment CRUD, and exact-match student lookup with a real permitted account.
5. Test denied access for unauthenticated, teacher, counsellor, disabled receptionist and other non-receptionist accounts. Check CRM regression, trigger activity logs, rate limiting and appointment access.
6. Inspect actual Security Guard visitor table/policy and implement the feed; the visitor panel is **not** functional yet.
7. Only then merge PR and test live.

## Limitations
- No Supabase database migration has been executed by this PR.
- No real Auth login, database integration, or role-security tests have passed yet.
- Student lookup is deliberately minimal and must be privacy-reviewed before deployment.
- This PR changes Admin Staff Directory display but does not replace staff creation.
- Talent Hunt student dashboard is untouched.
