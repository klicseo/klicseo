-- Isolated PostgreSQL test fixture ONLY. Never run this fixture in Supabase.
\set ON_ERROR_STOP on
create role anon;
create role authenticated;
create role service_role;
create table public.employees(id uuid primary key);
create table public.admin_users(id uuid primary key);
create table public.leads(id uuid primary key);
create table public.app_settings(key text primary key, value text);
create table public.audit_logs(id uuid primary key, entity text, action text, entity_id text);
\ir ../migrations/0034_lead_lists.sql

\ir ../migrations/0036_lead_lists_assigned_admin_user_id.sql
\ir ../migrations/0042_exclusive_lead_list_items.sql
create table public.lead_allocation_schedules(id uuid primary key default gen_random_uuid(), target_list_id uuid references public.lead_lists(id) on delete set null, status text, notes text);
insert into admin_users values ('00000000-0000-0000-0000-000000000001');
insert into leads select ('00000000-0000-0000-0001-' || lpad(n::text,12,'0'))::uuid from generate_series(1,3) n;
insert into lead_lists(id,name,assigned_admin_user_id) values
 ('00000000-0000-0000-0002-000000000001','Owned folder','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0002-000000000002','Unowned folder',null),
 ('00000000-0000-0000-0002-000000000003','Staff list','00000000-0000-0000-0000-000000000001');
insert into app_settings values ('lead_custom_folder:00000000-0000-0000-0002-000000000001','true');
insert into audit_logs values (gen_random_uuid(),'lead_lists','create','00000000-0000-0000-0002-000000000002');
insert into lead_list_items(list_id,lead_id) values
 ('00000000-0000-0000-0002-000000000001','00000000-0000-0000-0001-000000000001'),
 ('00000000-0000-0000-0002-000000000002','00000000-0000-0000-0001-000000000002');
insert into lead_allocation_schedules(target_list_id,status) values
 ('00000000-0000-0000-0002-000000000001','active_recurring'),
 ('00000000-0000-0000-0002-000000000002','pending');
\ir ../migrations/0043_separate_custom_folder_membership.sql
-- Applying twice must preserve membership and not generate duplicate staff lists.
\ir ../migrations/0043_separate_custom_folder_membership.sql
do $$
begin
 if (select count(*) from lead_folder_items) <> 2 then raise exception 'Folder backfill failed'; end if;
 if (select count(*) from lead_lists) <> 4 then raise exception 'Migration not idempotent'; end if;
 if (select count(*) from lead_list_items) <> 1 then raise exception 'Assignment migration failed'; end if;
 if not exists (select 1 from lead_list_items i join lead_lists l on i.list_id=l.id where i.lead_id='00000000-0000-0000-0001-000000000001' and not l.is_custom_folder and l.assigned_admin_user_id='00000000-0000-0000-0000-000000000001') then raise exception 'Staff access not preserved'; end if;
 if not exists(select 1 from lead_allocation_schedules where target_list_id='00000000-0000-0000-0002-000000000002' and status='paused') then raise exception 'Folder destination not paused'; end if;
end $$;
-- Allocate from folder; membership stays intact.
insert into lead_list_items(list_id,lead_id) values ('00000000-0000-0000-0002-000000000003','00000000-0000-0000-0001-000000000002') on conflict(lead_id) do nothing;
-- Repeated/concurrent-style claim cannot steal an existing assignment.
insert into lead_list_items(list_id,lead_id) select list_id,'00000000-0000-0000-0001-000000000002'::uuid from lead_list_items where lead_id='00000000-0000-0000-0001-000000000001' on conflict(lead_id) do nothing;
do $$
begin
 if not exists (select 1 from lead_folder_items where lead_id='00000000-0000-0000-0001-000000000002') then raise exception 'Allocation removed folder membership'; end if;
 if not exists (select 1 from lead_list_items where lead_id='00000000-0000-0000-0001-000000000002' and list_id='00000000-0000-0000-0002-000000000003') then raise exception 'Exclusive assignment lost'; end if;
 begin
  insert into lead_list_items(list_id,lead_id) values('00000000-0000-0000-0002-000000000002','00000000-0000-0000-0001-000000000003');
  raise exception 'Wrong kind accepted' using errcode='ZX001';
 exception when raise_exception then null; end;
 begin
  insert into lead_folder_items(list_id,lead_id) values('00000000-0000-0000-0002-000000000003','00000000-0000-0000-0001-000000000003');
  raise exception 'Wrong kind accepted' using errcode='ZX001';
 exception when raise_exception then null; end;
end $$;
-- Deleting a folder keeps leads and staff assignment.
delete from lead_lists where id='00000000-0000-0000-0002-000000000002';
do $$ begin
 if (select count(*) from leads) <> 3 or (select count(*) from lead_list_items) <> 2 then raise exception 'Folder deletion lost leads or assignment'; end if;
end $$;
-- Deleting a staff list keeps organizational membership and pauses its schedule.
delete from lead_lists where name='Owned folder — staff assignments';
do $$ begin
 if (select count(*) from leads) <> 3 or (select count(*) from lead_folder_items) <> 1 then raise exception 'List deletion lost leads or folder membership'; end if;
 if exists(select 1 from lead_allocation_schedules where status='active_recurring') then raise exception 'Deleted destination still active'; end if;
end $$;
select 'Folder membership migration and lifecycle checks passed' as result;
