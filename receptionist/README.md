# SIR Reception Desk — implementation notes

This is a standalone SIR receptionist portal. It does not modify `crm.html`, admin, teacher, student, or Talent Hunt files.

## Delivered
- SIR navy/gold responsive login with show/hide password, separate Supabase session and role verification.
- Overview, enquiries (create/update/search/filter), follow-up queue and call log, appointments, visitor coordination, minimal student lookup.
- Dedicated `sir_reception_*` RPCs and isolated receptionist tables; no direct table access from browser.
- Every RPC checks the authenticated user's active `public.staff` receptionist designation.

## Deployment order
1. **Read-only live schema review**: verify `public.staff(id,user_id,full_name,designation,is_active)` column names/types, and check current database roles/RLS. Do not assume GitHub reflects live Supabase.
2. Apply `reception-schema.sql` in Supabase SQL Editor only after review. Migration is additive and stops if required staff columns are absent.
3. Admin creates an authenticated staff account, links it to active `staff` with designation `Receptionist`, and supplies the login credentials privately.
4. Verify authorized receptionist sign-in and that student/teacher/other roles are rejected. Test SQL/RLS privileges with real test accounts.
5. Merge and deploy after security checks. The frontend currently lives on a feature branch and **is not live**.

## Explicit limitations
- Visitor feed and student lookup RPCs are fail-closed stubs returning no data until existing guard/student schemas and privacy requirements are verified. Do not describe these integrations as functional.
- This portal uses its own isolated enquiry tables; existing `crm.html` leads are **not automatically synchronized**. Integration requires inspecting live CRM tables and policies before implementing a safe bridge.
- The migration has not been executed against Supabase. This code is untested against live data.
- No service-role key is shipped to the browser.
- Visitor photo collection belongs to the Security Guard portal, not Reception.
- To minimize accidental privilege escalation, no new permissions are granted on existing student/CRM/visitor tables.

## Acceptance tests
- Receptionist account: sign in, create enquiry, update status, log follow-up, create/update appointment, log out, restore session.
- Teacher/student/non-receptionist account: cannot pass receptionist role verification or invoke RPCs.
- Anonymous access: no RPC or direct table data.
- Invalid phone/status/payload: rejected.
- Student search: no records exposed before audited integration.
- Existing SIR dashboards, `crm.html`, and Talent Hunt remain unchanged.
