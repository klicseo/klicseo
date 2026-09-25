-- Fair recycling: persistent per-lead counts, filtered rounds, and atomic/idempotent dispatch.
begin;
alter table public.leads add column recycle_count integer not null default 0 check(recycle_count>=0);
alter table public.leads add column last_recycled_at timestamptz;
create index leads_recycle_rotation_idx on public.leads(recycle_count,last_recycled_at nulls first,id);

-- Only identifiable recycle records are imported; arbitrary/manual transfers are not recycling.
-- to_jsonb supports legacy audit tables that lack created_at.
update public.leads l set recycle_count=h.n,last_recycled_at=h.latest from (
  select lead_id,count(*)::integer n,max((to_jsonb(a)->>'created_at')::timestamptz) latest
  from public.lead_allocations_log a
  where reason like '% | Reassigned from list %'
     or reason='Selective lead recycling / 2nd attempt pitch'
     or reason='2nd attempt pitch / Lead recycling'
  group by lead_id
) h where l.id=h.lead_id;

create table public.lead_recycle_requests (
  request_id text primary key,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create table public.lead_recycle_events (
  request_id text not null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  source_list_id uuid not null,
  destination_list_id uuid not null,
  recycle_count integer not null,
  created_at timestamptz not null default now(),
  primary key(request_id,lead_id)
);
-- List IDs are historical values: deleting a list must not erase rotation history.
alter table public.lead_recycle_requests enable row level security;
alter table public.lead_recycle_events enable row level security;
create policy service_role_recycle_requests on public.lead_recycle_requests for all to service_role using(true) with check(true);
create policy service_role_recycle_events on public.lead_recycle_events for all to service_role using(true) with check(true);
grant all on public.lead_recycle_requests,public.lead_recycle_events to service_role;

create function public.eligible_recycle_pool(p jsonb) returns setof public.leads language sql stable as $$
  select l.* from public.filtered_admin_leads(p - 'schedule_id') l
  where (nullif(p->>'source_list_id','') is null or exists(select 1 from public.lead_list_items i where i.lead_id=l.id and i.list_id=(p->>'source_list_id')::uuid))
    and (nullif(p->>'source_admin_user_id','') is null or exists(select 1 from public.lead_list_items i join public.lead_lists a on a.id=i.list_id where i.lead_id=l.id and a.assigned_admin_user_id=(p->>'source_admin_user_id')::uuid))
    and (not coalesce((p->>'recycle_only')::boolean,false) or (coalesce(l.status,'new') <> 'booked' and exists(select 1 from public.lead_list_items i where i.lead_id=l.id)))
$$;
create function public.round_allocation_leads(p jsonb) returns setof public.leads language sql stable as $$
  with pool as materialized (select l.*,exists(select 1 from public.lead_list_items i where i.lead_id=l.id) assigned from public.eligible_recycle_pool(p) l),
  lowest as (select min(recycle_count) n from pool where assigned)
  select l.* from public.leads l join pool q on q.id=l.id
  where not q.assigned or q.recycle_count=(select n from lowest)
$$;
create function public.preview_recycle_round(p_filter jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('count',count(*),
    'assignedCount',count(*) filter(where exists(select 1 from public.lead_list_items i where i.lead_id=l.id)),
    'unassignedCount',count(*) filter(where not exists(select 1 from public.lead_list_items i where i.lead_id=l.id)),
    'totalMatchingCount',(select count(*) from public.eligible_recycle_pool(p_filter)),
    'recycleCount',min(recycle_count) filter(where exists(select 1 from public.lead_list_items i where i.lead_id=l.id)))
  from public.round_allocation_leads(p_filter) l
$$;
create function public.allocate_recycle_round(
  p_filter jsonb, p_count integer, p_assignees uuid[], p_target_list uuid,
  p_schedule uuid, p_excluded_staff uuid[], p_type text, p_reason text,
  p_request_id text, p_reset_status boolean default false, p_list_name text default null
) returns jsonb language plpgsql set search_path = public as $$
declare
  candidate record;
  normalized jsonb;
  snapshot jsonb;
  signature jsonb;
  cached public.lead_recycle_requests%rowtype;
  result jsonb;
  created_lists uuid[] := '{}';
  total_matching integer;
  round_available integer;
  round_count integer;
  protected_count integer := 0;
  current_status text;
  source_list uuid;
  source_owner uuid;
  target_owner uuid;
  ids uuid[] := '{}';
  old_lists uuid[] := '{}';
  staff uuid[];
  destination uuid;
  recipient uuid;
  reassigned integer := 0;
  idx integer;
  staff_idx integer;
  batch_size integer;
  cursor_idx integer := 1;
begin
  if p_count is null or p_count <= 0 then raise exception 'Lead count must be positive'; end if;
  select coalesce(array_agg(id order by position), '{}') into staff
    from (select id, min(n) as position from unnest(p_assignees) with ordinality chosen(id,n) group by id) selected;
  if p_target_list is null and cardinality(staff) = 0 then raise exception 'Select a destination'; end if;
  -- Serialize membership writes, including legacy upserts, during this short transaction.
  lock table public.lead_lists, public.lead_list_items in share row exclusive mode;
  if nullif(p_request_id, '') is null or length(p_request_id) > 200 then raise exception 'A recycling request ID is required'; end if;
  signature := jsonb_build_object('filter',p_filter,'count',p_count,'staff',staff,'target',p_target_list,
    'schedule',p_schedule,'excluded',p_excluded_staff,'type',p_type,'reason',p_reason,'reset',p_reset_status,'name',p_list_name);
  select * into cached from public.lead_recycle_requests where request_id=p_request_id;
  if found then
    if cached.payload <> signature then raise exception 'Recycling request ID was reused with different options'; end if;
    return cached.result;
  end if;
  if p_schedule is not null then
    perform 1 from public.lead_allocation_schedules where id = p_schedule for update;
    if not found then raise exception 'Schedule no longer exists'; end if;
  end if;
  if p_target_list is not null then
    select assigned_admin_user_id into target_owner from public.lead_lists
      where id = p_target_list and not coalesce(is_custom_folder, false);
    if not found then raise exception 'Destination list no longer exists or is a custom folder'; end if;
    if target_owner is not null and not exists (select 1 from public.admin_users where id = target_owner and status = 'active') then
      raise exception 'Destination owner is inactive';
    end if;
  elsif exists (select 1 from unnest(staff) as chosen(id) where not exists (select 1 from public.admin_users u where u.id = chosen.id and u.status = 'active')) then
    raise exception 'Choose active team members';
  end if;

  -- Compute the round from the entire eligible pool, never from a bounded client snapshot.
  normalized := p_filter || jsonb_build_object('allocation',true,'include_assigned',true,
    'target_list_id',p_target_list,'excludedStaff',to_jsonb(case when p_target_list is not null
      then array_remove(array[target_owner],null) else staff || coalesce(p_excluded_staff,'{}') end));
  if coalesce((normalized->>'recycle_only')::boolean,false)
     and nullif(normalized->>'source_list_id','') is null and nullif(normalized->>'source_admin_user_id','') is null then
    raise exception 'Source list or source staff member is required';
  end if;
  select count(*) into total_matching from public.eligible_recycle_pool(normalized);
  select count(*),min(l.recycle_count) filter(where exists(select 1 from public.lead_list_items i where i.lead_id=l.id))
    into round_available,round_count from public.round_allocation_leads(normalized) l;
  select coalesce(jsonb_agg(to_jsonb(q)), '[]') into snapshot from (
    select l.id,coalesce(l.status,'new') status,i.list_id from public.round_allocation_leads(normalized) l
    left join public.lead_list_items i on i.lead_id=l.id
    order by (i.list_id is not null),l.last_recycled_at nulls first,l.id limit p_count
  ) q;
  if coalesce((normalized->>'recycle_only')::boolean,false) then
    select count(*) - total_matching into protected_count from public.lead_list_items i
      join public.lead_lists a on a.id=i.list_id
      where (nullif(normalized->>'source_list_id','') is null or i.list_id=(normalized->>'source_list_id')::uuid)
        and (nullif(normalized->>'source_admin_user_id','') is null or a.assigned_admin_user_id=(normalized->>'source_admin_user_id')::uuid);
  end if;

  for candidate in select * from jsonb_to_recordset(snapshot) as c(id uuid, status text, list_id uuid) loop
    exit when cardinality(ids) >= p_count;
    if candidate.id = any(ids) then continue; end if;
    select coalesce(status, 'new') into current_status from public.leads where id = candidate.id for update;
    if not found or current_status is distinct from candidate.status then continue; end if;
    select i.list_id, l.assigned_admin_user_id into source_list, source_owner
      from public.lead_list_items i join public.lead_lists l on l.id = i.list_id where i.lead_id = candidate.id;
    if source_list is distinct from candidate.list_id then continue; end if;
    if source_list = p_target_list or (p_target_list is not null and source_owner = target_owner)
       or (p_target_list is null and source_owner = any(staff || coalesce(p_excluded_staff, '{}'))) then continue; end if;
    ids := array_append(ids, candidate.id);
    old_lists := array_append(old_lists, source_list);
  end loop;

  if p_target_list is not null then staff := array[target_owner]; end if;
  if cardinality(ids) > 0 then
    for staff_idx in 1..least(cardinality(staff), cardinality(ids)) loop
      recipient := staff[staff_idx];
      batch_size := cardinality(ids) / cardinality(staff) + case when staff_idx <= cardinality(ids) % cardinality(staff) then 1 else 0 end;
      destination := p_target_list;
      if destination is null then
        insert into public.lead_lists(name, assigned_admin_user_id)
          values (coalesce(nullif(p_list_name,''), 'Allocated Leads (' || to_char(now() at time zone 'Asia/Kolkata', 'DD/MM/YYYY') || ')'), recipient) returning id into destination;
        created_lists := array_append(created_lists,destination);
      end if;
      for idx in cursor_idx..cursor_idx + batch_size - 1 loop
        insert into public.lead_list_items(list_id, lead_id, added_at) values(destination, ids[idx], now())
          on conflict (lead_id) do update set list_id = excluded.list_id, added_at = excluded.added_at;
        if old_lists[idx] is not null then
          reassigned := reassigned + 1;
          update public.leads set recycle_count=recycle_count+1,last_recycled_at=now() where id=ids[idx];
          insert into public.lead_recycle_events(request_id,lead_id,source_list_id,destination_list_id,recycle_count)
            select p_request_id,id,old_lists[idx],destination,recycle_count from public.leads where id=ids[idx];
        end if;
        insert into public.lead_allocations_log(lead_id, schedule_id, assigned_to_admin_user_id, assigned_to_list_id, allocation_type, reason)
          values(ids[idx], p_schedule, recipient, destination, p_type,
            p_reason || case when old_lists[idx] is null then '' else ' | Reassigned from list ' || old_lists[idx]::text end);
        if p_schedule is not null then
          insert into public.lead_allocation_deliveries(schedule_id, lead_id) values(p_schedule, ids[idx]) on conflict(schedule_id,lead_id) do update set delivered_at=excluded.delivered_at;
        end if;
      end loop;
      cursor_idx := cursor_idx + batch_size;
    end loop;
  end if;
  if p_reset_status then update public.leads set status='new' where id=any(ids); end if;
  result := jsonb_build_object('leadIds',to_jsonb(ids),'reassignedCount',reassigned,
    'createdListIds',to_jsonb(created_lists),'assignedStaffCount',least(cardinality(staff),cardinality(ids)),
    'protectedCount',protected_count,'totalMatchingCount',total_matching,'roundAvailableCount',round_available,
    'recycleCount',round_count,'roundComplete',cardinality(ids)=round_available and round_available>0,
    'waitingCount',total_matching-round_available);
  insert into public.lead_recycle_requests(request_id,payload,result) values(p_request_id,signature,result);
  return result;
end;
$$;

revoke all on function public.eligible_recycle_pool(jsonb),public.round_allocation_leads(jsonb),public.preview_recycle_round(jsonb),public.allocate_recycle_round(jsonb,integer,uuid[],uuid,uuid,uuid[],text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.eligible_recycle_pool(jsonb),public.round_allocation_leads(jsonb),public.preview_recycle_round(jsonb),public.allocate_recycle_round(jsonb,integer,uuid[],uuid,uuid,uuid[],text,text,text,boolean,text) to service_role;
-- Old clients fail closed rather than bypassing the new rotation invariant.
revoke execute on function public.allocate_with_recycling(jsonb,integer,uuid[],uuid,uuid,uuid[],text,text) from service_role;
notify pgrst,'reload schema';
commit;
