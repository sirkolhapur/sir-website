# Talent Hunt Backend (SIR Kolhapur)

This folder is reserved for the **Talent Hunt** registration and authentication flow. It must remain separate from institute administration and institute-student functions.

## Safety boundaries

- Do not modify or deploy existing institute Edge Functions.
- Do not modify `talent-hunt/student-dashboard.html`.
- Do not expose Supabase service-role credentials or AiSensy API credentials in browser code, Git, or chat.
- Do not mark a registration WhatsApp-verified or create a student account from browser code.
- Only deploy after the function code, SQL migration, RLS/grants, secrets, and test plan have been reviewed.

## Planned function names

- `talent-hunt-send-otp`
- `talent-hunt-verify-otp`
- `talent-hunt-create-student`
- `talent-hunt-send-credentials`

These are reserved names, not deployed functions. Before implementing, check the current Supabase function list and avoid collisions.

## Existing data and compatibility

The existing `public.talent_hunt_registrations` table is intended to be reused. Its currently observed fields include `id`, `student_name`, `school_name`, `student_class`, `whatsapp_number`, `whatsapp_verified`, `status`, timestamps, and `auth_user_id`.

The existing Talent Hunt login page uses Supabase Auth email/password and checks the registration row by `auth_user_id`, requiring `whatsapp_verified = true` and a null/empty or `verified` status. Any implementation must preserve this contract unless a reviewed migration and coordinated login change are approved.

## Implementation order

1. Inspect the complete registration/login HTML, current table policies/grants, existing Edge Function settings, and required Auth behavior.
2. Confirm the AiSensy template/API contract from official account documentation. Do not guess endpoint payloads.
3. Design and review the SQL migration, including canonical 10-digit Indian WhatsApp numbers and a database-enforced unique constraint/index.
4. Implement server-side OTP challenges with expiry, attempt limits, resend throttling, and hashed OTP storage.
5. Implement account creation and credential delivery with a safe failure/retry strategy that never stores plaintext passwords.
6. Wire the existing registration UI to the new endpoints while preserving its visual design.
7. Test duplicates, invalid/expired OTPs, repeated attempts, provider failures, Auth failures, and login compatibility before deployment.

## Current status

Planning scaffold only. No database migrations or Edge Functions have been deployed by this repository change.
