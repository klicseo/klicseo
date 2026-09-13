-- Keep organization independent of exclusive staff assignment.
-- Apply before running the matching application version. Transactional and rerunnable.
begin;
lock table public.lead_lists, public.lead_list_items in share row exclusive mode;
alter table public.lead_lists add column if not exists is_custom_folder boolean not null default false;
update public.lead_lists l set is_custom_folder = true
where exists (select 1 from public.app_settings s where s.key = 'lead_custom_folder:' || l.id::text and s.value = 'true')
   or exists (select 1 from public.audit_logs a where a.entity = 'lead_lists' and a.action = 'create' and a.entity_id::text = l.id::text);

create table if not exists public.lead_folder_items (
  list_id uuid not null references public.lead_lists(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, lead_id),
  unique (lead_id)
);
alter table public.lead_folder_items enable row level security;
revoke all on public.lead_folder_items from anon, authenticated;
grant all on public.lead_folder_items to service_role;

insert into public.lead_folder_items (list_id, lead_id, added_at)
select i.list_id, i.lead_id, i.added_at from public.lead_list_items i
join public.lead_lists l on l.id = i.list_id where l.is_custom_folder
on conflict (lead_id) do nothing;

-- Existing owned folders also granted staff access. Preserve that access in a
-- separate assignment list, while retaining the original organizational folder.
do $$
declare folder record; assignment_id uuid;
begin
  for folder in select l.* from public.lead_lists l
    where l.is_custom_folder and l.assigned_admin_user_id is not null
      and exists (select 1 from public.lead_list_items i where i.list_id = l.id)
  loop
    insert into public.lead_lists (name, created_by, assigned_admin_user_id)
    values (folder.name || ' — staff assignments', folder.created_by, folder.assigned_admin_user_id)
    returning id into assignment_id;
    update public.lead_list_items set list_id = assignment_id where list_id = folder.id;
    update public.lead_allocation_schedules set target_list_id = assignment_id where target_list_id = folder.id;
  end loop;
end $$;
-- Unowned folder membership is organization, not a staff assignment.
delete from public.lead_list_items i using public.lead_lists l
where i.list_id = l.id and l.is_custom_folder;
-- A custom folder cannot be an allocation destination. Pause legacy targets for review.
update public.lead_allocation_schedules s set status = 'paused',
  notes = concat_ws(E'\n', s.notes, 'Choose a staff assignment list as the destination. Custom folders now retain leads independently.')
from public.lead_lists l where s.target_list_id = l.id and l.is_custom_folder
  and s.status in ('pending', 'active_recurring');

create or replace view public.lead_collection_items with (security_invoker = true) as
select list_id, lead_id, added_at from public.lead_list_items
union all
select list_id, lead_id, added_at from public.lead_folder_items;
revoke all on public.lead_collection_items from anon, authenticated;
grant select on public.lead_collection_items to service_role;

-- Enforce the separation even for callers outside the application.
create or replace function public.check_lead_membership_kind() returns trigger
language plpgsql set search_path = public as $$
declare custom boolean;
begin
  select is_custom_folder into custom from public.lead_lists where id = new.list_id for key share;
  if custom is null then raise exception 'Destination list does not exist'; end if;
  if custom <> (tg_table_name = 'lead_folder_items') then
    raise exception 'Custom folder membership and staff assignments must be stored separately';
  end if;
  return new;
end $$;
drop trigger if exists check_membership_kind on public.lead_list_items;
create trigger check_membership_kind before insert or update on public.lead_list_items
for each row execute function public.check_lead_membership_kind();
drop trigger if exists check_membership_kind on public.lead_folder_items;
create trigger check_membership_kind before insert or update on public.lead_folder_items
for each row execute function public.check_lead_membership_kind();

-- Folder/list identity is immutable; changing it would invalidate memberships.
create or replace function public.keep_lead_list_kind() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.is_custom_folder <> new.is_custom_folder then raise exception 'List kind cannot be changed'; end if;
  return new;
end $$;
drop trigger if exists keep_list_kind on public.lead_lists;
create trigger keep_list_kind before update on public.lead_lists
for each row execute function public.keep_lead_list_kind();

-- Deleting a scheduled destination must not redirect its rule to a global pool.
create or replace function public.pause_deleted_list_schedules() returns trigger
language plpgsql set search_path = public as $$
begin
  update public.lead_allocation_schedules set status = 'paused',
    notes = concat_ws(E'\n', notes, 'Destination list deleted; choose a new destination before resuming.')
  where target_list_id = old.id and status in ('pending', 'active_recurring');
  return old;
end $$;
drop trigger if exists pause_list_schedules on public.lead_lists;
create trigger pause_list_schedules before delete on public.lead_lists
for each row execute function public.pause_deleted_list_schedules();
notify pgrst, 'reload schema';
commit;
