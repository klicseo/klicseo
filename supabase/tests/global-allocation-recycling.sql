-- Run only in an empty disposable database with psql -v ON_ERROR_STOP=1 -f this_file.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create table admin_users(id uuid primary key, status text);
create table leads(id uuid primary key, status text);
create table lead_lists(id uuid primary key default gen_random_uuid(), name text, assigned_admin_user_id uuid references admin_users, is_custom_folder boolean default false);
create table lead_list_items(lead_id uuid primary key references leads, list_id uuid references lead_lists, added_at timestamptz default now());
create table lead_folder_items(lead_id uuid primary key references leads, folder_id uuid);
create table lead_allocation_schedules(id uuid primary key);
create table lead_allocations_log(lead_id uuid references leads, schedule_id uuid references lead_allocation_schedules, assigned_to_admin_user_id uuid, assigned_to_list_id uuid, allocation_type text check(allocation_type in ('manual','scheduled','daily_recurring','queue_replenish')), reason text);
\ir ../migrations/0044_global_allocation_recycling.sql
insert into admin_users values(md5('a')::uuid,'active'),(md5('b')::uuid,'active'),(md5('c')::uuid,'active'),(md5('inactive')::uuid,'inactive');
insert into lead_lists(id,name,assigned_admin_user_id) values(md5('source')::uuid,'Source',md5('a')::uuid),(md5('target')::uuid,'Target',md5('b')::uuid);
insert into leads select md5(n::text)::uuid, case when n = 2 then 'booked' when n = 3 then 'interested' else 'new' end from generate_series(1,6) n;
insert into lead_list_items select md5(n::text)::uuid, md5('source')::uuid, now() from generate_series(2,6) n;
insert into lead_folder_items values(md5('2')::uuid,md5('folder')::uuid);
insert into lead_allocation_schedules values(md5('rule')::uuid);
-- Reproduce the live legacy schema: history used rule_id before schedules existed.
alter table lead_allocations_log rename column schedule_id to rule_id;
alter table lead_allocations_log drop constraint lead_allocations_log_allocation_type_check;
alter table lead_allocations_log add constraint lead_allocations_log_allocation_type_check check(allocation_type in ('auto','drip_release','sla_escalation','manual_transfer'));
do $$
begin
  begin
    perform allocate_with_recycling(
      jsonb_build_array(jsonb_build_object('id',md5('2')::uuid,'status','booked','list_id',md5('source')::uuid)),
      1,array[md5('b')::uuid],null,null,'{}','manual','Legacy schema regression');
    raise exception 'Expected missing schedule_id failure';
  exception when undefined_column then null;
  end;
  assert (select count(*) from lead_lists)=2, 'failed batch rolls back its new list';
  assert (select list_id from lead_list_items where lead_id=md5('2')::uuid)=md5('source')::uuid, 'failed batch keeps original assignment';
  assert (select count(*) from lead_allocations_log)=0, 'failed batch leaves no history';
end $$;
\ir ../migrations/0046_allocation_history_schedule_compatibility.sql
-- Applying the compatibility migration again is safe.
\ir ../migrations/0046_allocation_history_schedule_compatibility.sql
do $$
begin
  begin
    perform allocate_with_recycling(
      jsonb_build_array(jsonb_build_object('id',md5('2')::uuid,'status','booked','list_id',md5('source')::uuid)),
      1,array[md5('b')::uuid],null,null,'{}','manual','Legacy allocation type regression');
    raise exception 'Expected legacy allocation-type constraint failure';
  exception when check_violation then null;
  end;
  assert (select count(*) from lead_lists)=2, 'constraint failure rolls back list creation';
  assert (select list_id from lead_list_items where lead_id=md5('2')::uuid)=md5('source')::uuid, 'constraint failure keeps assignment';
end $$;
\ir ../migrations/0047_allocation_history_types_compatibility.sql
do $$
declare result jsonb; snapshot jsonb; before_lists integer;
begin
  select jsonb_agg(jsonb_build_object('id', l.id, 'status', l.status, 'list_id', i.list_id) order by i.list_id nulls first, l.id) into snapshot from leads l left join lead_list_items i on i.lead_id = l.id;
  result := allocate_with_recycling(snapshot, 3, array[md5('b')::uuid,md5('c')::uuid], null, md5('rule')::uuid, '{}', 'daily_recurring', 'Test');
  assert jsonb_array_length(result->'leadIds') = 3, 'batch count';
  assert (result->>'reassignedCount')::int = 2, 'prefer unassigned';
  assert (select count(*) from lead_allocation_deliveries) = 3, 'ledger';
  assert (select count(*) from lead_allocations_log) = 3, 'history';
  assert (select status from leads where id = md5('2')::uuid) = 'booked', 'preserve booked';
  assert (select count(*) from lead_folder_items) = 1, 'preserve folder';
  assert (select max(n)-min(n) from (select count(*) n from lead_list_items where list_id <> md5('source')::uuid group by list_id) x) <= 1, 'balanced';
  -- Put delivered leads back elsewhere; this rule must still exclude them.
  update lead_list_items set list_id = md5('source')::uuid;
  select jsonb_agg(jsonb_build_object('id', l.id, 'status', l.status, 'list_id', i.list_id)) into snapshot from leads l join lead_list_items i on i.lead_id=l.id;
  result := allocate_with_recycling(snapshot, 10, '{}', md5('target')::uuid, md5('rule')::uuid, '{}', 'queue_replenish', 'Next');
  assert jsonb_array_length(result->'leadIds') = 3, 'once per rule';
  assert (select count(*) from lead_allocation_deliveries) = 6, 'ledger cumulative';
  result := allocate_with_recycling(snapshot, 10, '{}', md5('target')::uuid, md5('rule')::uuid, '{}', 'queue_replenish', 'Empty');
  assert jsonb_array_length(result->'leadIds') = 0, 'exhausted';
  -- A changed status or assignment invalidates the snapshot.
  update leads set status = 'changed';
  result := allocate_with_recycling(snapshot, 10, array[md5('c')::uuid], null, null, '{}', 'manual', 'Stale');
  assert jsonb_array_length(result->'leadIds') = 0, 'status snapshot';
  select jsonb_agg(jsonb_build_object('id', l.id, 'status', l.status, 'list_id', i.list_id)) into snapshot from leads l join lead_list_items i on i.lead_id=l.id;
  update lead_list_items set list_id = md5('source')::uuid;
  -- Excluding the whole rule team prevents taking work from non-refilling teammates.
  result := allocate_with_recycling(snapshot, 10, array[md5('c')::uuid], null, null, array[md5('a')::uuid], 'manual', 'Team');
  assert jsonb_array_length(result->'leadIds') = 0, 'team exclusion';
  select jsonb_agg(jsonb_build_object('id', l.id, 'status', l.status, 'list_id', i.list_id)) into snapshot from leads l join lead_list_items i on i.lead_id=l.id;
  select count(*) into before_lists from lead_lists;
  begin
    perform allocate_with_recycling(snapshot, 3, array[md5('c')::uuid], null, null, '{}', 'invalid', 'Rollback');
    raise exception 'Expected history constraint failure';
  exception when check_violation then null;
  end;
  assert (select count(*) from lead_lists) = before_lists, 'rollback lists';
  assert not exists(select 1 from lead_list_items where list_id <> md5('source')::uuid), 'rollback moves';
  begin
    perform allocate_with_recycling(snapshot, 3, array[md5('inactive')::uuid], null, null, '{}', 'manual', 'Inactive');
    raise exception 'Expected inactive failure';
  exception when raise_exception then assert sqlerrm = 'Choose active team members';
  end;
  assert not has_function_privilege('authenticated', 'allocate_with_recycling(jsonb,integer,uuid[],uuid,uuid,uuid[],text,text)', 'execute'), 'server only';
end $$;

-- Legacy history values remain accepted, and rerunning the migration preserves them.
insert into lead_allocations_log(lead_id, allocation_type, reason) values(md5('2')::uuid, 'auto', 'Preserved legacy history');
\ir ../migrations/0047_allocation_history_types_compatibility.sql
do $$ begin
  assert exists(select 1 from lead_allocations_log where allocation_type='auto' and reason='Preserved legacy history');
end $$;
