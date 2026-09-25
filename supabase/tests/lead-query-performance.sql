-- Empty disposable database only. Includes minimal fixture schema and migration 0044.
\ir global-allocation-recycling.sql
alter table leads add column created_at timestamptz default now(), add column source text,
  add column name text, add column phone text, add column car_number text, add column car_brand text,
  add column car_model text, add column area text, add column address text, add column pincode text,
  add column service text, add column service_option text, add column price_total numeric,
  add column custom_fields jsonb;
create view lead_collection_items as select list_id,lead_id from lead_list_items
  union all select folder_id as list_id,lead_id from lead_folder_items;
\ir ../migrations/0045_lead_query_performance.sql
update leads set source='upload',area='Adyar',service='Wash',status='new',created_at='2025-01-01T00:00:00Z';
update leads set source='wizard',status='booked',area='Velachery' where id=md5('1')::uuid;
do $$
declare pending jsonb; rows jsonb; result jsonb; old_fingerprint text;
begin
  pending := lead_query_metadata_pending(500);
  assert jsonb_array_length(pending)=6, 'initial backfill';
  select jsonb_agg(jsonb_build_object('id',l.id,'fingerprint',lead_query_fingerprint(l), 'locality',l.area,'year','2025','bulk',l.source='upload','kind',case when l.source='wizard' then 'website_form' else 'year' end)) into rows from leads l;
  perform save_lead_query_metadata(rows);
  assert lead_query_metadata_pending(500)='[]'::jsonb, 'backfill persists';
  result := admin_lead_query('page','{}',2,0);
  assert jsonb_array_length(result->'leads')=2 and (result->>'totalCount')::int=6, 'bounded page';
  assert (admin_lead_query('page','{}',2,99)->>'totalCount')::int=6, 'out of range count';
  assert (admin_lead_query('page','{"area":"Adyar","folder":"year_2025"}',2,0)->>'totalCount')::int=5, 'area year filtering';
  assert (admin_lead_query('page','{"folder":"website_form"}',2,0)->>'totalCount')::int=1, 'website filter';
  assert (admin_lead_query('page',jsonb_build_object('folder',md5('folder')::uuid),2,0)->>'totalCount')::int=1, 'custom folder';
  assert (admin_lead_query('page',jsonb_build_object('assignedAdminUserId',md5('b')::uuid),2,0)->>'totalCount')::int=0, 'staff scope';
  result := admin_lead_query('status','{}');
  assert (result->>'total')::int=6 and (result->>'booked')::int=1 and (result->>'assigned')::int=6, 'status totals';
  assert (admin_lead_query('status','{"assignment":"unassigned"}')->>'assigned')::int=6, 'assignment totals ignore assignment filter';
  assert (admin_lead_query('services','{}')->0->>'count')::int=6, 'service totals';
  assert jsonb_array_length(admin_lead_query('areas','{}'))=2, 'area totals';
  assert (admin_lead_query('folderCounts','{}')->>'totalLeads')::int=6, 'folder total';
  assert (admin_lead_query('allocationCount','{"allocation":true,"include_assigned":false}')->>'count')::int=0, 'unassigned pool';
  assert (admin_lead_query('allocationCount','{"allocation":true,"include_assigned":true}')->>'count')::int=6, 'recycling pool';
  assert jsonb_array_length(admin_lead_query('allocation','{"allocation":true,"include_assigned":true}',2))=2, 'bounded allocation';
  assert (admin_lead_query('allocationCount',jsonb_build_object('allocation',true,'include_assigned',true,'excludedStaff',jsonb_build_array(md5('a')::uuid)))->>'count')::int=0, 'allocation target exclusion';
  assert (admin_lead_query('allocationCount',jsonb_build_object('allocation',true,'include_assigned',true,'schedule_id',md5('rule')::uuid))->>'count')::int=0, 'delivery exclusion';
  -- Status edits must not trigger expensive decryption or location backfills.
  update leads set status='contacted' where id=md5('2')::uuid;
  assert lead_query_metadata_pending(500)='[]'::jsonb, 'status update avoids rebuild';
  select lead_query_fingerprint(l) into old_fingerprint from leads l where id=md5('2')::uuid;
  update leads set address='Changed address' where id=md5('2')::uuid;
  assert jsonb_array_length(lead_query_metadata_pending(500))=1, 'address invalidates one row';
  perform save_lead_query_metadata(jsonb_build_array(jsonb_build_object('id',md5('2')::uuid,'fingerprint',old_fingerprint,'locality','Stale','year','2025','bulk',true,'kind','year')));
  assert not (select query_ready from leads where id=md5('2')::uuid), 'stale derivation rejected';
  assert not has_function_privilege('authenticated','admin_lead_query(text,jsonb,integer,integer)','execute'), 'server-only reads';
end $$;
-- Representative volume to exercise selective indexed pages (not a production benchmark).
insert into leads(id,created_at,source,status,area,service,query_locality,query_year,query_bulk,query_kind,query_ready)
select md5('volume-'||n)::uuid, '2025-01-01'::timestamptz + n*interval '1 minute','upload',
  case when n%100=0 then 'booked' else 'new' end,'Adyar','Wash','Adyar','2025',true,'year',true
from generate_series(1,10000) n;
analyze leads;
explain (analyze,buffers) select id from filtered_admin_leads('{"status":"booked"}') order by created_at desc nulls last,id desc limit 25;
