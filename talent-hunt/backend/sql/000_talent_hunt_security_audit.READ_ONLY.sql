-- READ-ONLY AUDIT for SIR Talent Hunt. Safe to run in Supabase SQL Editor.
-- This script does not create, alter, update, or delete anything.
-- Review results before running any DRAFT migration.

-- 1) Column definitions for the existing registration table.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'talent_hunt_registrations'
order by ordinal_position;

-- 2) Existing indexes and whether each index is unique.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'talent_hunt_registrations'
order by indexname;

-- 3) RLS state.
select n.nspname as schema_name,
       c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('talent_hunt_registrations', 'talent_hunt_otp_challenges');

-- 4) Existing policies on the registration table.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('talent_hunt_registrations', 'talent_hunt_otp_challenges')
order by tablename, policyname;

-- 5) Table privileges for browser-facing roles.
select grantee, table_schema, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('talent_hunt_registrations', 'talent_hunt_otp_challenges')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

-- 6) Check canonical phone numbers and duplicates.
-- Output only counts; does not expose student names or phone numbers.
select
  count(*) filter (where whatsapp_number is null or whatsapp_number !~ '^[0-9]{10}$') as invalid_phone_rows,
  count(*) - count(distinct whatsapp_number) as duplicate_phone_rows
from public.talent_hunt_registrations;

-- 7) Confirm whether the proposed OTP table already exists.
select to_regclass('public.talent_hunt_otp_challenges') as otp_table_if_exists;
