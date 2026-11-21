# Receptionist PR #101 — operator deployment checklist

**Status:** GitHub branch only. Not proof of production readiness. Use a staging Supabase project first. Never run the disabled/superseded reception-schema.sql, reception-v2.sql, reception-v3.sql or reception-v4.sql.

## 1. Back up and verify
- Supabase Dashboard → Database → Backups: confirm a restorable backup/point-in-time recovery appropriate for your plan before changing production.
- In SQL Editor, review the current tables public.staff_members, public.staff_designations, public.admissions, public.admission_activities, public.students, and public.is_admin(). Confirm the referenced fields exist.
- Review CRM triggers and their effects; especially admission insert guard, autoassignment, activity trigger and existing status rules.
- Do not publish SQL reports containing student personal data.

## 2. Apply SQL in staging first
- Open `receptionist/reception-final.sql` on PR #101 → Raw → copy full file → Supabase Dashboard → SQL Editor → New query → paste → Run.
- Open `receptionist/admin-staff-login-ids.sql` → repeat.
- Both files contain explicit BEGIN/COMMIT; stop and capture the *full error message* if either fails. Do not retry random edits or merge until resolved.
- Open `receptionist/post-deploy-checks.sql` → run read-only checks. Expected: 10 functions; all SECURITY DEFINER with empty search_path; anon_execute=false; require() authenticated_execute=false; appointment table RLS=true and direct authenticated table access=false.
- Check that CRM triggers still exist and CRM works for its current roles.

## 3. Create and verify a Receptionist account
- Admin Dashboard → Staff Directory → Create Staff Login.
- Use the exact designation `Receptionist / Front Desk Executive` or `Receptionist`, active=true, unique login username and a strong temporary password. Use the normal admin workflow; **never** insert users manually into auth.users.
- Confirm the staff row has a linked `user_id` and that the directory shows the **verified** login email from Supabase Auth.
- If the directory says `Login ID not verified`, check the RPC and deployed `admin-create-staff` Edge Function; do not guess a `staff.<employee-id>@sir.net.in` login.
- If the function creates an unexpected Auth email or missing staff link, **stop**. The Edge Function source was not found in the inspected repo; its implementation must be checked in Supabase Dashboard → Edge Functions before modifying it.

## 4. Browser end-to-end tests
- Open the PR preview or local branch's `receptionist/index.html` (do not merge for testing). Login using the exact verified Auth email and password.
- Create an enquiry; verify the CRM displays it with the expected source and assigned counsellor.
- Update an active enquiry; log a call; check the CRM activity timeline and due follow-up.
- Confirm approved/rejected/closed enquiries cannot be edited by Receptionist.
- Create/update an appointment; reload and verify persistence.
- Search an **active test student** using exact UID or full registered phone; confirm only name and UID appear.
- Log out during a data refresh and confirm no previously loaded personal information reappears.
- Repeat RPC attempts with teacher, counsellor, inactive receptionist and anonymous accounts: they must be denied. Test Admin/CRM regression separately.

## 5. Known unfinished dependency
- Gate visitor feed is deliberately a stub returning [] until the Security Guard table, field names and permissions are inspected. Do not fabricate a table or loosen RLS to make it appear working.
- Verify the actual deployed `admin-create-staff` Edge Function source/behavior. Repository code alone cannot confirm its Auth provisioning logic.
- Only merge PR #101 after SQL, real-account authorization, CRM regression and Gate integration acceptance.

## What to send back
Paste **only** SQL Editor errors or the *non-sensitive* output of post-deploy-checks.sql, plus whether the Admin Staff Directory shows a verified Login ID. Do **not** send passwords, service-role keys, access tokens, student phone numbers or personal data.
