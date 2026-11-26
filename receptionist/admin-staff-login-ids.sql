-- SIR Admin Staff Directory: authoritative login identities.
-- Deploy only after reviewing in Supabase SQL Editor.
-- Reads Auth email from auth.users; never exposes password hashes or tokens.
-- No changes to CRM, staff creation, or existing RLS policies.
begin;
create or replace function public.sir_admin_staff_login_ids()
returns table(staff_id uuid, login_email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  return query
  select m.id, u.email::text
  from public.staff_members m
  left join auth.users u on u.id = m.user_id;
end;
$$;
revoke all on function public.sir_admin_staff_login_ids() from public, anon;
grant execute on function public.sir_admin_staff_login_ids() to authenticated;
commit;
