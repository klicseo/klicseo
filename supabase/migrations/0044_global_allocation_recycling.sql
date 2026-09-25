-- Atomic opt-in reassignment; existing allocation rules remain unassigned-only.
begin;
create table public.lead_allocation_deliveries (
  schedule_id uuid not null references public.lead_allocation_schedules(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  primary key (schedule_id, lead_id)
);
alter table public.lead_allocation_deliveries enable row level security;
create policy service_role_all_deliveries on public.lead_allocation_deliveries
  for all to service_role using (true) with check (true);
grant all on public.lead_allocation_deliveries to service_role;

create function public.allocate_with_recycling(
  p_candidates jsonb, p_count integer, p_assignees uuid[], p_target_list uuid,
  p_schedule uuid, p_excluded_staff uuid[], p_type text, p_reason text
) returns jsonb language plpgsql set search_path = public as $$
declare
  candidate record;
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

  for candidate in select * from jsonb_to_recordset(p_candidates) as c(id uuid, status text, list_id uuid) loop
    exit when cardinality(ids) >= p_count;
    if candidate.id = any(ids) then continue; end if;
    select coalesce(status, 'new') into current_status from public.leads where id = candidate.id for update;
    if not found or current_status is distinct from candidate.status then continue; end if;
    select i.list_id, l.assigned_admin_user_id into source_list, source_owner
      from public.lead_list_items i join public.lead_lists l on l.id = i.list_id where i.lead_id = candidate.id;
    if source_list is distinct from candidate.list_id then continue; end if;
    if source_list = p_target_list or (p_target_list is not null and source_owner = target_owner)
       or (p_target_list is null and source_owner = any(staff || coalesce(p_excluded_staff, '{}'))) then continue; end if;
    if p_schedule is not null and exists (select 1 from public.lead_allocation_deliveries where schedule_id = p_schedule and lead_id = candidate.id) then continue; end if;
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
          values ('Allocated Leads (' || to_char(now() at time zone 'Asia/Kolkata', 'DD/MM/YYYY') || ')', recipient) returning id into destination;
      end if;
      for idx in cursor_idx..cursor_idx + batch_size - 1 loop
        insert into public.lead_list_items(list_id, lead_id, added_at) values(destination, ids[idx], now())
          on conflict (lead_id) do update set list_id = excluded.list_id, added_at = excluded.added_at;
        if old_lists[idx] is not null then reassigned := reassigned + 1; end if;
        insert into public.lead_allocations_log(lead_id, schedule_id, assigned_to_admin_user_id, assigned_to_list_id, allocation_type, reason)
          values(ids[idx], p_schedule, recipient, destination, p_type,
            p_reason || case when old_lists[idx] is null then '' else ' | Reassigned from list ' || old_lists[idx]::text end);
        if p_schedule is not null then
          insert into public.lead_allocation_deliveries(schedule_id, lead_id) values(p_schedule, ids[idx]);
        end if;
      end loop;
      cursor_idx := cursor_idx + batch_size;
    end loop;
  end if;
  return jsonb_build_object('leadIds', to_jsonb(ids), 'reassignedCount', reassigned);
end;
$$;
revoke all on function public.allocate_with_recycling(jsonb, integer, uuid[], uuid, uuid, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.allocate_with_recycling(jsonb, integer, uuid[], uuid, uuid, uuid[], text, text) to service_role;
notify pgrst, 'reload schema';
commit;
