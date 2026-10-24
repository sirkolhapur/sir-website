-- DRAFT ONLY — review before running in Supabase SQL Editor.
-- Talent Hunt only. This migration does not alter institute tables or functions.
-- Existing checks reported no duplicate/invalid WhatsApp numbers, but rerun
-- the checks immediately before applying this migration.

begin;

-- Canonical storage contract: Indian mobile number as exactly 10 digits.
-- The registration API must normalize/validate before inserting.
-- This unique index enforces one registration per WhatsApp number at DB level.
create unique index if not exists talent_hunt_registrations_whatsapp_unique
  on public.talent_hunt_registrations (whatsapp_number);

-- OTP challenges are separate from registration records. Store only a keyed
-- digest of the OTP, never the raw OTP. The HMAC key belongs in Edge Function
-- secrets and must not be stored in this table.
create table if not exists public.talent_hunt_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null
    references public.talent_hunt_registrations(id) on delete cascade,
  otp_digest text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  last_sent_at timestamptz not null default now(),
  verified_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists talent_hunt_otp_challenges_registration_created_idx
  on public.talent_hunt_otp_challenges (registration_id, created_at desc);

create index if not exists talent_hunt_otp_challenges_expiry_idx
  on public.talent_hunt_otp_challenges (expires_at);

-- OTP challenges must only be accessed by trusted server-side functions.
alter table public.talent_hunt_otp_challenges enable row level security;

-- Intentionally no anon/authenticated policies are created here.
-- Confirm grants and existing policies in the project before applying.
-- Service-role access bypasses RLS; Edge Functions must validate every request.

commit;
