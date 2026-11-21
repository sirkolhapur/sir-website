-- SIR Reception v1. Run only after checking the live staff schema.
-- Additive: does not alter existing CRM, students, attendance, or Talent Hunt tables.
-- Required existing public.staff columns: id, user_id, full_name, designation, is_active.
begin;
do $$ begin
 if to_regclass('public.staff') is null then raise exception 'Missing public.staff; stop migration'; end if;
 if exists(select 1 from (values ('id'),('user_id'),('full_name'),('designation'),('is_active')) c(name)
   where not exists(select 1 from information_schema.columns where table_schema='public' and table_name='staff' and column_name=c.name))
 then raise exception 'Staff schema differs; inspect and adapt migration before applying'; end if;
end $$;
create table if not exists public.sir_reception_enquiries(
 id uuid primary key default gen_random_uuid(),
 student_name text not null, phone text not null, parent_name text,
 course_interest text, source text, status text not null default 'new'
 check(status in ('new','contacted','interested','follow_up','converted','closed')),
 notes text, next_followup_at timestamptz, created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), created_by uuid not null references auth.users(id)
);
create table if not exists public.sir_reception_followups(
 id uuid primary key default gen_random_uuid(),enquiry_id uuid not null references public.sir_reception_enquiries(id),
 outcome text not null check(outcome in ('connected','no_answer','callback_requested','interested','not_interested')),
 notes text not null,next_followup_at timestamptz,created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id)
);
create table if not exists public.sir_reception_appointments(
 id uuid primary key default gen_random_uuid(),visitor_name text not null,contact_phone text not null,
 purpose text not null,staff_name text,scheduled_at timestamptz not null,
 status text not null default 'scheduled' check(status in ('scheduled','confirmed','completed','cancelled')),
 notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id)
);
create index if not exists sir_reception_enquiries_due_idx on public.sir_reception_enquiries(next_followup_at);
create index if not exists sir_reception_appointments_time_idx on public.sir_reception_appointments(scheduled_at);
alter table public.sir_reception_enquiries enable row level security;
alter table public.sir_reception_followups enable row level security;
alter table public.sir_reception_appointments enable row level security;
revoke all on public.sir_reception_enquiries,public.sir_reception_followups,public.sir_reception_appointments from anon,authenticated;
-- Explicitly restrict access to RPC functions, not direct table operations.
create or replace function public.sir_reception_authorized() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.staff s where s.user_id=auth.uid()
 and lower(trim(s.designation))='receptionist' and s.is_active is true)
$$;
revoke all on function public.sir_reception_authorized() from public,anon;
grant execute on function public.sir_reception_authorized() to authenticated;
create or replace function public.sir_reception_verify()
returns table(staff_id text,full_name text,designation text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.sir_reception_authorized() then return; end if;
 return query select s.id::text,s.full_name::text,s.designation::text from public.staff s
 where s.user_id=auth.uid() and lower(trim(s.designation))='receptionist' and s.is_active is true limit 1;
end $$;
create or replace function public.sir_reception_list_enquiries() returns setof public.sir_reception_enquiries
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if not public.sir_reception_authorized() then raise exception 'Access denied';end if;
 return query select * from public.sir_reception_enquiries order by created_at desc limit 1000;
end $$;
create or replace function public.sir_reception_save_enquiry(p_record jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_status text;v_phone text;v_name text;
begin
 if not public.sir_reception_authorized() then raise exception 'Access denied';end if;
 v_id=nullif(p_record->>'id','')::uuid;v_status=coalesce(nullif(p_record->>'status',''),'new');
 v_phone=trim(coalesce(p_record->>'phone',''));v_name=trim(coalesce(p_record->>'student_name',''));
 if v_name='' or v_phone !~ '^[0-9+() -]{8,20}$' or v_status not in ('new','contacted','interested','follow_up','converted','closed')
 then raise exception 'Invalid enquiry';end if;
 if v_id is null then
 insert into public.sir_reception_enquiries(student_name,phone,parent_name,course_interest,source,status,notes,next_followup_at,created_by)
 values(v_name,v_phone,p_record->>'parent_name',p_record->>'course_interest',p_record->>'source',v_status,p_record->>'notes',
 nullif(p_record->>'next_followup_at','')::timestamptz,auth.uid()) returning id into v_id;
 else
 update public.sir_reception_enquiries set student_name=v_name,phone=v_phone,parent_name=p_record->>'parent_name',
 course_interest=p_record->>'course_interest',source=p_record->>'source',status=v_status,notes=p_record->>'notes',
 next_followup_at=nullif(p_record->>'next_followup_at','')::timestamptz,updated_at=now() where id=v_id;
 if not found then raise exception 'Enquiry not found';end if;
 end if;return v_id;
end $$;
create or replace function public.sir_reception_add_followup(p_enquiry_id uuid,p_record jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_outcome text;v_notes text;v_next timestamptz;
begin
 if not public.sir_reception_authorized() then raise exception 'Access denied';end if;
 v_outcome=p_record->>'outcome';v_notes=trim(coalesce(p_record->>'notes',''));
 if v_outcome not in ('connected','no_answer','callback_requested','interested','not_interested') or v_notes='' then raise exception 'Invalid follow-up';end if;
 v_next=nullif(p_record->>'next_followup_at','')::timestamptz;
 insert into public.sir_reception_followups(enquiry_id,outcome,notes,next_followup_at,created_by)
 values(p_enquiry_id,v_outcome,v_notes,v_next,auth.uid()) returning id into v_id;
 update public.sir_reception_enquiries set next_followup_at=v_next,status=case when v_next is not null then 'follow_up' else status end,
 updated_at=now() where id=p_enquiry_id;
 return v_id;
end $$;
create or replace function public.sir_reception_list_appointments() returns setof public.sir_reception_appointments
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not public.sir_reception_authorized() then raise exception 'Access denied';end if;
 return query select * from public.sir_reception_appointments order by scheduled_at desc limit 1000;
end $$;
create or replace function public.sir_reception_save_appointment(p_record jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;v_status text;v_time timestamptz;
begin
 if not public.sir_reception_authorized() then raise exception 'Access denied';end if;
 v_id=nullif(p_record->>'id','')::uuid;v_status=coalesce(nullif(p_record->>'status',''),'scheduled');
 v_time=nullif(p_record->>'scheduled_at','')::timestamptz;
 if trim(coalesce(p_record->>'visitor_name',''))='' or trim(coalesce(p_record->>'purpose',''))=''
 or coalesce(p_record->>'contact_phone','') !~ '^[0-9+() -]{8,20}$'
 or v_time is null or v_status not in ('scheduled','confirmed','completed','cancelled') then raise exception 'Invalid appointment';end if;
 if v_id is null then
 insert into public.sir_reception_appointments(visitor_name,contact_phone,purpose,staff_name,scheduled_at,status,notes,created_by)
 values(p_record->>'visitor_name',p_record->>'contact_phone',p_record->>'purpose',p_record->>'staff_name',
 v_time,v_status,p_record->>'notes',auth.uid()) returning id into v_id;
 else
 update public.sir_reception_appointments set visitor_name=p_record->>'visitor_name',contact_phone=p_record->>'contact_phone',
 purpose=p_record->>'purpose',staff_name=p_record->>'staff_name',scheduled_at=v_time,status=v_status,
 notes=p_record->>'notes',updated_at=now() where id=v_id;
 if not found then raise exception 'Appointment not found';end if;
 end if;return v_id;
end $$;
-- Safe fail-closed placeholders: replace ONLY after gate schema and student lookup are audited.
create or replace function public.sir_reception_list_visitors()
returns table(visitor_name text,purpose text,entry_at timestamptz,status text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not public.sir_reception_authorized() then raise exception 'Access denied';end if;return;end $$;
create or replace function public.sir_reception_find_student(p_query text)
returns table(full_name text,roll_number text,batch_name text,course text)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin if not public.sir_reception_authorized() then raise exception 'Access denied';end if;return;end $$;
revoke all on function public.sir_reception_verify(),public.sir_reception_list_enquiries(),public.sir_reception_save_enquiry(jsonb),
 public.sir_reception_add_followup(uuid,jsonb),public.sir_reception_list_appointments(),public.sir_reception_save_appointment(jsonb),
 public.sir_reception_list_visitors(),public.sir_reception_find_student(text) from public,anon;
grant execute on function public.sir_reception_verify(),public.sir_reception_list_enquiries(),public.sir_reception_save_enquiry(jsonb),
 public.sir_reception_add_followup(uuid,jsonb),public.sir_reception_list_appointments(),public.sir_reception_save_appointment(jsonb),
 public.sir_reception_list_visitors(),public.sir_reception_find_student(text) to authenticated;
commit;
