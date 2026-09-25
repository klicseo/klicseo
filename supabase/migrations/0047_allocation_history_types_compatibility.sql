-- Preserve legacy routing history while accepting current allocation modes.
begin;
alter table public.lead_allocations_log
  drop constraint if exists lead_allocations_log_allocation_type_check;
alter table public.lead_allocations_log
  add constraint lead_allocations_log_allocation_type_check
  check (allocation_type in (
    'auto', 'drip_release', 'sla_escalation', 'manual_transfer',
    'manual', 'scheduled', 'daily_recurring', 'queue_replenish'
  ));
notify pgrst, 'reload schema';
commit;
