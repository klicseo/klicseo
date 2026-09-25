-- Empty disposable database only; includes earlier regression fixtures.
\ir lead-query-performance.sql
\ir ../migrations/0048_recycling_rounds.sql
-- Historical global moves are imported, not ordinary legacy allocation records.
do $$ begin
  assert exists(select 1 from leads where recycle_count>0), 'confirmed history backfill';
  assert not has_function_privilege('service_role','allocate_with_recycling(jsonb,integer,uuid[],uuid,uuid,uuid[],text,text)','execute'), 'old write path fails closed';
  assert not has_function_privilege('authenticated','allocate_recycle_round(jsonb,integer,uuid[],uuid,uuid,uuid[],text,text,text,boolean,text)','execute'), 'server only';
end $$;
insert into leads(id,status,service,query_ready,query_kind,recycle_count)
select md5('round-'||n)::uuid,'call_not_responded','RoundTest',true,'year',case when n>5 then 2 else 0 end from generate_series(1,7) n;
insert into lead_list_items select md5('round-'||n)::uuid,md5('source')::uuid,now() from generate_series(1,7) n;
do $$
declare f jsonb := '{"allocation":true,"include_assigned":true,"services":["RoundTest"]}'; r jsonb; retry jsonb; before_count integer; before_lists integer;
begin
  assert (preview_recycle_round(f)->>'count')::int=5, 'only lowest count in preview';
  assert (preview_recycle_round(f)->>'totalMatchingCount')::int=7, 'preview total pool';
  r := allocate_recycle_round(f,3,array[md5('b')::uuid],null,md5('rule')::uuid,'{}','manual','Round test','round-1');
  assert (r->>'reassignedCount')::int=3, 'first batch';
  assert not (r->>'roundComplete')::boolean, 'unfinished round';
  retry := allocate_recycle_round(f,3,array[md5('b')::uuid],null,md5('rule')::uuid,'{}','manual','Round test','round-1');
  assert retry=r, 'idempotent response';
  assert (select count(*) from lead_recycle_events)=3, 'retry does not add events';
  begin
    perform allocate_recycle_round(f,4,array[md5('b')::uuid],null,md5('rule')::uuid,'{}','manual','Round test','round-1');
    raise exception 'Expected reused request conflict';
  exception when raise_exception then assert sqlerrm='Recycling request ID was reused with different options'; end;
  -- Ordinary transfers do not reset counts. Returning leads to source makes them eligible again.
  update lead_list_items set list_id=md5('source')::uuid where lead_id in(select id from leads where service='RoundTest');
  r := allocate_recycle_round(f,6,array[md5('b')::uuid],null,md5('rule')::uuid,'{}','manual','Round test','round-2');
  assert (r->>'reassignedCount')::int=2, 'finish round with partial batch, not next-round leads';
  assert (r->>'roundComplete')::boolean, 'round complete';
  update lead_list_items set list_id=md5('source')::uuid where lead_id in(select id from leads where service='RoundTest');
  r := allocate_recycle_round(f,6,array[md5('b')::uuid],null,md5('rule')::uuid,'{}','daily_recurring','Round test','round-3');
  assert (r->>'reassignedCount')::int=5, 'same schedule can recycle in later rounds';
  assert (select min(recycle_count) from leads where service='RoundTest')=2, 'uneven counts converge';
  assert (select count(*) from lead_recycle_events)=10, 'one event per successful recycle';
  update lead_list_items set list_id=md5('source')::uuid where lead_id in(select id from leads where service='RoundTest');
  select sum(recycle_count) into before_count from leads;
  select count(*) into before_lists from lead_lists;
  begin
    perform allocate_recycle_round(f,2,array[md5('b')::uuid],null,null,'{}','invalid','Rollback','failed',true);
    raise exception 'Expected check failure';
  exception when check_violation then null; end;
  assert (select sum(recycle_count) from leads)=before_count, 'rollback counters';
  assert (select count(*) from lead_lists)=before_lists, 'rollback lists';
  assert not exists(select 1 from lead_recycle_requests where request_id='failed'), 'rollback request receipt';
  assert not exists(select 1 from lead_recycle_events where request_id='failed'), 'rollback events';
  assert not exists(select 1 from leads where service='RoundTest' and status<>'call_not_responded'), 'rollback status reset';
  -- New entrants have priority even if IDs would sort after older leads.
  insert into leads(id,status,service,query_ready) values(md5('new-round')::uuid,'call_not_responded','RoundTest',true);
  insert into lead_list_items values(md5('new-round')::uuid,md5('source')::uuid,now());
  assert (preview_recycle_round(f)->>'count')::int=1, 'new lead prioritized';
  -- Dedicated recycling protects booked even if explicitly selected, and atomically resets status.
  update leads set status='booked' where id=md5('round-7')::uuid;
  f := f || jsonb_build_object('recycle_only',true,'source_list_id',md5('source')::uuid,'statuses',jsonb_build_array('call_not_responded','booked'));
  r := allocate_recycle_round(f,100,'{}',md5('target')::uuid,null,'{}','manual','Dedicated','dedicated',true,'Custom recycle');
  assert (r->>'reassignedCount')::int=1, 'dedicated uses same round selector';
  assert (select status from leads where id=md5('new-round')::uuid)='new', 'status reset committed with move';
  assert (select recycle_count from leads where id=md5('round-7')::uuid)=2, 'booked protected';
  assert (r->>'protectedCount')::int>=1, 'reports exclusions';
  -- Recipient exclusions apply before computing the next round.
  f := '{"allocation":true,"include_assigned":true,"services":["RoundTest"]}'::jsonb || jsonb_build_object('excludedStaff',jsonb_build_array(md5('a')::uuid,md5('b')::uuid));
  assert (preview_recycle_round(f)->>'count')::int=0, 'current owners excluded';
end $$;
-- Fresh allocation does not use a recycle turn; filters isolate other pools.
insert into leads(id,status,service,query_ready) values(md5('fresh-round')::uuid,'new','FreshRound',true);
do $$
declare r jsonb; deleted_list uuid; f jsonb := '{"allocation":true,"include_assigned":true,"services":["FreshRound"]}';
begin
  r := allocate_recycle_round(f,10,array[md5('b')::uuid],null,null,'{}','manual','Fresh','fresh-1');
  assert jsonb_array_length(r->'leadIds')=1 and (r->>'reassignedCount')::int=0, 'fresh allocation';
  assert (select recycle_count from leads where id=md5('fresh-round')::uuid)=0, 'fresh does not consume recycle';
  deleted_list := (r->'createdListIds'->>0)::uuid;
  r := allocate_recycle_round(f,10,array[md5('c')::uuid],null,null,'{}','manual','Recycle','fresh-2');
  assert (r->>'reassignedCount')::int=1, 'other filtered pools cannot block this pool';
  delete from lead_lists where id=deleted_list;
  assert (select recycle_count from leads where id=md5('fresh-round')::uuid)=1, 'list deletion preserves counts';
  assert exists(select 1 from lead_recycle_events where source_list_id=deleted_list), 'list deletion preserves history';
end $$;

-- Seed a separate pool for concurrent requests tested by the companion shell harness.
insert into leads(id,status,service,query_ready) select md5('parallel-'||n)::uuid,'call_not_responded','ParallelTest',true from generate_series(1,6) n;
insert into lead_list_items select md5('parallel-'||n)::uuid,md5('source')::uuid,now() from generate_series(1,6) n;
