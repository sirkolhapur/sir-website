-- SIR Receptionist v2 — reviewed against supplied production schema.
-- Run ONLY after review in Supabase SQL Editor. Never paste service-role keys into frontend.
-- Does not alter CRM RLS policies, CRM functions, or triggers.
begin;

create or replace function public.sir_reception_verify()
returns jsonb language sql stable security definer set search_path = ''
as $$
 select jsonb_build_object('id',m.id,'full_name',m.full_name,'designation',d.name)
 from public.staff_members m
 join public.staff_designations d on d.id=m.designation_id
 where m.user_id=(select auth.uid()) and m.is_active=true and d.is_active=true
 and lower(btrim(d.name)) in ('receptionist','receptionist / front desk executive')
 limit 1;
$$;

create or replace function public.sir_reception_require()
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare v_id uuid;
begin
 select m.id into v_id from public.staff_members m
 join public.staff_designations d on d.id=m.designation_id
 where m.user_id=(select auth.uid()) and m.is_active=true and d.is_active=true
 and lower(btrim(d.name)) in ('receptionist','receptionist / front desk executive') limit 1;
 if v_id is null then raise exception 'Receptionist access denied' using errcode='42501'; end if;
 return v_id;
end;
$$;

create or replace function public.sir_reception_list_enquiries()
returns setof public.admissions language plpgsql stable security definer set search_path = ''
as $$
begin
 perform public.sir_reception_require();
 return query select a.* from public.admissions a order by a.created_at desc limit 2000;
end;
$$;

create or replace function public.sir_reception_save_enquiry(p_record jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_row public.admissions; v_status text; v_phone text; v_source text;
begin
 perform public.sir_reception_require();
 v_id:=nullif(p_record->>'id','')::uuid;
 v_status:=coalesce(nullif(p_record->>'status',''),'new');
 if nullif(p_record->>'id','') is null and v_status<>'new' then raise exception 'New enquiry must start as new' using errcode='22023'; end if;
 if v_status not in ('new','contacted','processing') then
   raise exception 'Invalid CRM status' using errcode='22023';
 end if;
 v_phone:=regexp_replace(coalesce(p_record->>'phone',''),'[^0-9+]','','g');
 if p_record is null or jsonb_typeof(p_record)<>'object' then raise exception 'Invalid enquiry payload' using errcode='22023'; end if;
 if length(btrim(coalesce(p_record->>'student_name','')))<2 or v_phone !~ '^\+?[0-9]{10,15}$' then
   raise exception 'Valid student name and phone required' using errcode='22023';
 end if;
 if v_id is null then
   v_source:=coalesce(nullif(p_record->>'source',''),'walk_in');
   if v_source not in ('walk_in','phone','whatsapp','school_event','referral','other') then
      raise exception 'Invalid reception enquiry source' using errcode='22023';
   end if;
   -- Existing BEFORE INSERT guard sanitizes non-CRM actors and applies rate limits.
   -- Update after insert preserves the guard and automatic counsellor assignment.
   insert into public.admissions(student_name,phone,parent_name,course_interest,message,source)
   values(left(btrim(p_record->>'student_name'),120),v_phone,
     nullif(left(btrim(coalesce(p_record->>'parent_name','')),120),''),
     nullif(left(btrim(coalesce(p_record->>'course_interest','')),120),''),
     nullif(left(btrim(coalesce(p_record->>'message','')),2000),''),
     'website') returning * into v_row;
   update public.admissions set source=v_source,
     next_follow_up_at=nullif(p_record->>'next_follow_up_at','')::timestamptz
   where id=v_row.id returning * into v_row;
 else
   update public.admissions set
     student_name=left(btrim(p_record->>'student_name'),120),
     phone=v_phone,
     parent_name=nullif(left(btrim(coalesce(p_record->>'parent_name','')),120),''),
     course_interest=nullif(left(btrim(coalesce(p_record->>'course_interest','')),120),''),
     message=nullif(left(btrim(coalesce(p_record->>'message','')),2000),''),
     status=v_status::public.admission_status,
     next_follow_up_at=case when v_status in ('new','contacted','processing')
       then nullif(p_record->>'next_follow_up_at','')::timestamptz else null end
   where id=v_id and status in ('new','contacted','processing') returning * into v_row;
   if not found then raise exception 'Enquiry not found or already finalized' using errcode='22023'; end if;
 end if;
 return to_jsonb(v_row);
end;
$$;

create or replace function public.sir_reception_add_followup(p_enquiry_id uuid,p_record jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_row public.admission_activities; v_outcome text; v_actor_name text; v_current_status public.admission_status;
begin
 perform public.sir_reception_require();
 if p_record is null or jsonb_typeof(p_record)<>'object' then
   raise exception 'Invalid follow-up payload' using errcode='22023';
 end if;
 -- Lock the lead before inserting an activity: a concurrent approval/closure
 -- cannot slip between the status check and the CRM activity trigger.
 select a.status into v_current_status from public.admissions a
 where a.id=p_enquiry_id for update;
 if not found or v_current_status not in ('new','contacted','processing') then
   raise exception 'Enquiry not found or already finalized' using errcode='22023';
 end if;
 v_outcome:=p_record->>'outcome';
 if v_outcome not in ('connected','call_back','not_answered','switched_off','wrong_number','not_interested') then
   raise exception 'Invalid call outcome' using errcode='22023';
 end if;
 select m.full_name into v_actor_name from public.staff_members m where m.id=public.sir_reception_require();
 insert into public.admission_activities(admission_id,actor_user_id,actor_name,kind,outcome,note)
 values(p_enquiry_id,(select auth.uid()),v_actor_name,'call',v_outcome,
   nullif(left(btrim(coalesce(p_record->>'note','')),2000),''))
 returning * into v_row;
 if p_record ? 'next_follow_up_at' then
   update public.admissions set next_follow_up_at=
      nullif(p_record->>'next_follow_up_at','')::timestamptz
   where id=p_enquiry_id and status in ('new','contacted','processing');
 end if;
 return to_jsonb(v_row);
end;
$$;

create table if not exists public.sir_reception_appointments (
 id uuid primary key default gen_random_uuid(),
 visitor_name text not null,
 contact_phone text not null,
 purpose text not null,
 staff_name text,
 scheduled_at timestamptz not null,
 status text not null default 'scheduled'
   check(status in ('scheduled','confirmed','completed','cancelled')),
 notes text,
 created_by uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.sir_reception_appointments enable row level security;
revoke all on public.sir_reception_appointments from public,anon,authenticated;

create or replace function public.sir_reception_list_appointments()
returns setof public.sir_reception_appointments
language plpgsql stable security definer set search_path = ''
as $$
begin
 perform public.sir_reception_require();
 return query select a.* from public.sir_reception_appointments a
 order by a.scheduled_at desc limit 1000;
end;
$$;

create or replace function public.sir_reception_save_appointment(p_record jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_row public.sir_reception_appointments; v_status text;
begin
 perform public.sir_reception_require();
 v_id:=nullif(p_record->>'id','')::uuid;
 v_status:=coalesce(nullif(p_record->>'status',''),'scheduled');
 if v_status not in ('scheduled','confirmed','completed','cancelled') then
   raise exception 'Invalid appointment status' using errcode='22023';
 end if;
 if p_record is null or jsonb_typeof(p_record)<>'object' then
   raise exception 'Invalid appointment payload' using errcode='22023';
 end if;
 if length(btrim(coalesce(p_record->>'visitor_name','')))<2
    or regexp_replace(coalesce(p_record->>'contact_phone',''),'[^0-9]','','g') !~ '^[0-9]{10,15}
    raise exception 'Appointment name, phone, purpose and time required' using errcode='22023';
 end if;
 if v_id is null then
   insert into public.sir_reception_appointments
   (visitor_name,contact_phone,purpose,staff_name,scheduled_at,status,notes,created_by)
   values(left(btrim(p_record->>'visitor_name'),120),
      left(btrim(p_record->>'contact_phone'),20),
      left(btrim(p_record->>'purpose'),300),
      nullif(left(btrim(coalesce(p_record->>'staff_name','')),120),''),
      (p_record->>'scheduled_at')::timestamptz,v_status,
      nullif(left(btrim(coalesce(p_record->>'notes','')),2000),''),
      (select auth.uid()))
   returning * into v_row;
 else
   update public.sir_reception_appointments set
     visitor_name=left(btrim(p_record->>'visitor_name'),120),
     contact_phone=left(btrim(p_record->>'contact_phone'),20),
     purpose=left(btrim(p_record->>'purpose'),300),
     staff_name=nullif(left(btrim(coalesce(p_record->>'staff_name','')),120),''),
     scheduled_at=(p_record->>'scheduled_at')::timestamptz,
     status=v_status,
     notes=nullif(left(btrim(coalesce(p_record->>'notes','')),2000),''),
     updated_at=now()
   where id=v_id returning * into v_row;
   if not found then raise exception 'Appointment not found' using errcode='22023'; end if;
 end if;
 return to_jsonb(v_row);
end;
$$;

-- Gate visitors remain disabled until the actual Security Guard data model and access policy are verified.
create or replace function public.sir_reception_list_visitors()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform public.sir_reception_require(); return '[]'::jsonb; end; $$;
-- Exact registered phone or student UID only; no partial-name directory search.
-- Return minimum identity fields; do not expose phone, DOB, email or user_id.
create or replace function public.sir_reception_find_student(p_query text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $
declare v_query text;
begin
 perform public.sir_reception_require();
 v_query := btrim(coalesce(p_query,''));
 if length(v_query)<4 or length(v_query)>40 then
   raise exception 'Enter a valid student UID or registered phone' using errcode='22023';
 end if;
 return coalesce((
   select jsonb_agg(jsonb_build_object('full_name',s.full_name,'roll_number',s.student_uid))
   from (
     select st.full_name,st.student_uid from public.students st
     where st.is_active=true
       and (lower(st.student_uid)=lower(v_query)
         or (length(regexp_replace(v_query,'[^0-9]','','g'))>=10
             and regexp_replace(coalesce(st.phone,''),'[^0-9]','','g')=
                 regexp_replace(v_query,'[^0-9]','','g')))
     order by st.student_uid limit 5
   ) s
 ),'[]'::jsonb);
end;
$;

revoke all on function public.sir_reception_require() from public,anon,authenticated;
revoke all on function public.sir_reception_verify() from public,anon;
revoke all on function public.sir_reception_list_enquiries() from public,anon;
revoke all on function public.sir_reception_save_enquiry(jsonb) from public,anon;
revoke all on function public.sir_reception_add_followup(uuid,jsonb) from public,anon;
revoke all on function public.sir_reception_list_appointments() from public,anon;
revoke all on function public.sir_reception_save_appointment(jsonb) from public,anon;
revoke all on function public.sir_reception_list_visitors() from public,anon;
revoke all on function public.sir_reception_find_student(text) from public,anon;
grant execute on function public.sir_reception_verify() to authenticated;
grant execute on function public.sir_reception_list_enquiries() to authenticated;
grant execute on function public.sir_reception_save_enquiry(jsonb) to authenticated;
grant execute on function public.sir_reception_add_followup(uuid,jsonb) to authenticated;
grant execute on function public.sir_reception_list_appointments() to authenticated;
grant execute on function public.sir_reception_save_appointment(jsonb) to authenticated;
grant execute on function public.sir_reception_list_visitors() to authenticated;
grant execute on function public.sir_reception_find_student(text) to authenticated;
commit;

    or length(btrim(coalesce(p_record->>'purpose','')))<2
    or nullif(p_record->>'scheduled_at','') is null then
    raise exception 'Appointment name, phone, purpose and time required' using errcode='22023';
 end if;
 if v_id is null then
   insert into public.sir_reception_appointments
   (visitor_name,contact_phone,purpose,staff_name,scheduled_at,status,notes,created_by)
   values(left(btrim(p_record->>'visitor_name'),120),
      left(btrim(p_record->>'contact_phone'),20),
      left(btrim(p_record->>'purpose'),300),
      nullif(left(btrim(coalesce(p_record->>'staff_name','')),120),''),
      (p_record->>'scheduled_at')::timestamptz,v_status,
      nullif(left(btrim(coalesce(p_record->>'notes','')),2000),''),
      (select auth.uid()))
   returning * into v_row;
 else
   update public.sir_reception_appointments set
     visitor_name=left(btrim(p_record->>'visitor_name'),120),
     contact_phone=left(btrim(p_record->>'contact_phone'),20),
     purpose=left(btrim(p_record->>'purpose'),300),
     staff_name=nullif(left(btrim(coalesce(p_record->>'staff_name','')),120),''),
     scheduled_at=(p_record->>'scheduled_at')::timestamptz,
     status=v_status,
     notes=nullif(left(btrim(coalesce(p_record->>'notes','')),2000),''),
     updated_at=now()
   where id=v_id returning * into v_row;
   if not found then raise exception 'Appointment not found' using errcode='22023'; end if;
 end if;
 return to_jsonb(v_row);
end;
$$;

-- Gate visitors remain disabled until the actual Security Guard data model and access policy are verified.
create or replace function public.sir_reception_list_visitors()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform public.sir_reception_require(); return '[]'::jsonb; end; $$;
-- Exact registered phone or student UID only; no partial-name directory search.
-- Return minimum identity fields; do not expose phone, DOB, email or user_id.
create or replace function public.sir_reception_find_student(p_query text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $
declare v_query text;
begin
 perform public.sir_reception_require();
 v_query := btrim(coalesce(p_query,''));
 if length(v_query)<4 or length(v_query)>40 then
   raise exception 'Enter a valid student UID or registered phone' using errcode='22023';
 end if;
 return coalesce((
   select jsonb_agg(jsonb_build_object('full_name',s.full_name,'roll_number',s.student_uid))
   from (
     select st.full_name,st.student_uid from public.students st
     where st.is_active=true
       and (lower(st.student_uid)=lower(v_query)
         or (length(regexp_replace(v_query,'[^0-9]','','g'))>=10
             and regexp_replace(coalesce(st.phone,''),'[^0-9]','','g')=
                 regexp_replace(v_query,'[^0-9]','','g')))
     order by st.student_uid limit 5
   ) s
 ),'[]'::jsonb);
end;
$;

revoke all on function public.sir_reception_require() from public,anon,authenticated;
revoke all on function public.sir_reception_verify() from public,anon;
revoke all on function public.sir_reception_list_enquiries() from public,anon;
revoke all on function public.sir_reception_save_enquiry(jsonb) from public,anon;
revoke all on function public.sir_reception_add_followup(uuid,jsonb) from public,anon;
revoke all on function public.sir_reception_list_appointments() from public,anon;
revoke all on function public.sir_reception_save_appointment(jsonb) from public,anon;
revoke all on function public.sir_reception_list_visitors() from public,anon;
revoke all on function public.sir_reception_find_student(text) from public,anon;
grant execute on function public.sir_reception_verify() to authenticated;
grant execute on function public.sir_reception_list_enquiries() to authenticated;
grant execute on function public.sir_reception_save_enquiry(jsonb) to authenticated;
grant execute on function public.sir_reception_add_followup(uuid,jsonb) to authenticated;
grant execute on function public.sir_reception_list_appointments() to authenticated;
grant execute on function public.sir_reception_save_appointment(jsonb) to authenticated;
grant execute on function public.sir_reception_list_visitors() to authenticated;
grant execute on function public.sir_reception_find_student(text) to authenticated;
commit;
