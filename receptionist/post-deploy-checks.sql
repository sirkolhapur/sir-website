-- SIR Receptionist: READ-ONLY post-deployment verification.
-- Run in Supabase SQL Editor after receptionist/reception-final.sql and admin-staff-login-ids.sql.
-- Does not create accounts, change permissions or write application data.

-- A. Required functions and SECURITY DEFINER / search_path settings.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer,
       p.proconfig as function_settings
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in (
 'sir_reception_verify','sir_reception_require','sir_reception_list_enquiries',
 'sir_reception_save_enquiry','sir_reception_add_followup',
 'sir_reception_list_appointments','sir_reception_save_appointment',
 'sir_reception_list_visitors','sir_reception_find_student',
 'sir_admin_staff_login_ids')
order by p.proname;

-- B. API function grants. anon must be false for all; authenticated
-- must be false for sir_reception_require and true for other API RPCs.
select p.proname,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'sir_reception_%'
   or (n.nspname='public' and p.proname='sir_admin_staff_login_ids')
order by p.proname;

-- C. Appointment table must be RLS-enabled and inaccessible directly
-- to anon/authenticated; all access should go through role-checked RPCs.
select c.relname,c.relrowsecurity as rls_enabled,
 has_table_privilege('anon',c.oid,'SELECT') as anon_select,
 has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select,
 has_table_privilege('authenticated',c.oid,'INSERT') as authenticated_insert
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='sir_reception_appointments';

-- D. Verify the active Receptionist designation exists (no personal data).
select d.name,d.is_active,count(m.id) filter(where m.is_active) as active_staff_count
from public.staff_designations d
left join public.staff_members m on m.designation_id=d.id
where lower(btrim(d.name)) in ('receptionist','receptionist / front desk executive')
group by d.id,d.name,d.is_active;

-- E. Confirm live CRM triggers are still present; do not change them.
select event_object_table,trigger_name,event_manipulation,action_timing
from information_schema.triggers
where event_object_schema='public' and event_object_table in ('admissions','admission_activities')
order by event_object_table,trigger_name;
