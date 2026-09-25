-- Older installations have rule_id (legacy routing rules) instead of schedule_id.
-- CREATE TABLE IF NOT EXISTS in 0039/0040 does not upgrade that existing table.
-- Keep legacy rule references and history intact; new schedules use their own FK.
begin;
alter table public.lead_allocations_log
  add column if not exists schedule_id uuid references public.lead_allocation_schedules(id) on delete set null;
create index if not exists lead_allocations_log_schedule_id_idx
  on public.lead_allocations_log(schedule_id) where schedule_id is not null;
notify pgrst, 'reload schema';
commit;
