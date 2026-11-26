# Receptionist integration — verified database architecture (2026-11-21)

## Verified from Supabase read-only inventory
- Staff identity: public.staff_members joined to public.staff_designations on designation_id.
- Staff active check: staff_members.is_active and staff_designations.is_active.
- Existing CRM: public.admissions, public.admission_activities.
- Existing CRM functions: crm_role(), crm_whoami(), crm_staff_id(), crm_can_see(uuid).
- crm_role() currently recognizes admin, lead, counsellor, NOT Receptionist.
- crm_can_see() grants admin/lead broad access and counsellor assigned/unassigned access. Do not broaden this function to add Receptionist without examining existing RLS.
- Existing CRM status enum values used by crm.html: new, contacted, processing, approved, rejected, closed.

## Critical correction
The previous receptionist migration assumed nonexistent public.staff and created duplicate CRM tables. It is **superseded and intentionally non-executable**. No migration has been applied.

## Safe integration plan
1. Confirm actual designation name(s) and current admissions/admission_activities RLS policies and triggers using read-only catalog inspection.
2. Add receptionist-specific SECURITY DEFINER RPCs that validate auth.uid() against active staff_members + active staff_designations, and enforce per-operation least privilege. Keep crm_role() and crm_can_see() unchanged.
3. Use existing admissions and admission_activities for enquiry and follow-up records; no parallel leads tables.
4. Appointment data requires a separate isolated table only if no existing appointments table exists (none was returned by the supplied catalog search).
5. Gate visitors and student lookup remain unavailable until underlying gate tables and privacy policy are verified.
6. Test receptionist and non-receptionist accounts and then merge PR.

## Do not deploy yet
The frontend still calls sir_reception_* RPCs which do not exist in production. Do not merge the PR or run the old SQL.
