-- Persist application-derived (decrypted) locality and import classification once,
-- then perform filtering, pagination and aggregation without shipping every lead.
begin;
alter table public.leads
  add column query_locality text,
  add column query_year text,
  add column query_bulk boolean,
  add column query_kind text,
  add column query_ready boolean not null default false;

create function public.lead_query_fingerprint(l public.leads) returns text
language sql stable set search_path = public as $$
  select md5(jsonb_build_array(l.area,l.address,l.pincode,l.custom_fields,l.source,extract(epoch from l.created_at))::text)
$$;
create function public.invalidate_lead_query_metadata() returns trigger
language plpgsql set search_path = public as $$
begin
  if row(old.area,old.address,old.pincode,old.custom_fields,old.source,old.created_at)
     is distinct from row(new.area,new.address,new.pincode,new.custom_fields,new.source,new.created_at) then
    new.query_ready := false;
  end if;
  return new;
end $$;
create trigger invalidate_lead_query_metadata before update on public.leads
for each row execute function public.invalidate_lead_query_metadata();

create index leads_query_pending_idx on public.leads(id) where not query_ready;
create index leads_created_id_idx on public.leads(created_at desc nulls last, id desc);
create index leads_status_created_id_idx on public.leads(coalesce(status, 'new'), created_at desc nulls last, id desc);
create index leads_locality_created_idx on public.leads(lower(query_locality), created_at desc nulls last, id desc);
create index leads_kind_year_created_idx on public.leads(query_kind, query_year, created_at desc nulls last, id desc);
create index leads_service_created_idx on public.leads(service, created_at desc nulls last, id desc);

create function public.lead_query_metadata_pending(p_limit integer default 500) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (
    select id, area, address, pincode, custom_fields, source, created_at,
      lead_query_fingerprint(l) as fingerprint
    from leads l where not query_ready order by id limit least(greatest(p_limit,1),500)
  ) q
$$;
create function public.save_lead_query_metadata(p_rows jsonb) returns void
language sql set search_path = public as $$
  update leads l set query_locality = r.locality, query_year = r.year,
    query_bulk = r.bulk, query_kind = r.kind, query_ready = true
  from jsonb_to_recordset(p_rows) r(id uuid, fingerprint text, locality text, year text, bulk boolean, kind text)
  where l.id = r.id and not l.query_ready and lead_query_fingerprint(l) = r.fingerprint
$$;

-- Inlineable SQL predicate function shared by page reads and aggregate queries.
create function public.filtered_admin_leads(p jsonb) returns setof public.leads
language sql stable as $$
 select l.* from public.leads l
 where (coalesce(p->>'status','all') = 'all' or coalesce(l.status,'new') = p->>'status')
 and (not (p ? 'statuses') or jsonb_array_length(p->'statuses') = 0 or lower(trim(coalesce(l.status,'new'))) in (select lower(trim(jsonb_array_elements_text(p->'statuses')))))
 and (not (p ? 'excludeStatuses') or coalesce(l.status,'new') not in (select jsonb_array_elements_text(p->'excludeStatuses')))
 and (not (p ? 'matchedIds') or l.id in (select value::uuid from jsonb_array_elements_text(p->'matchedIds')))
 and (nullif(p->>'assignedAdminUserId','') is null or exists (
   select 1 from public.lead_list_items i join public.lead_lists a on a.id=i.list_id
   where i.lead_id=l.id and a.assigned_admin_user_id=(p->>'assignedAdminUserId')::uuid))
 and (coalesce(p->>'assignment','all') = 'all' or
   (p->>'assignment' = 'assigned') = exists(select 1 from public.lead_list_items i where i.lead_id=l.id))
 and (case when p->>'folder' ~* '^[0-9a-f-]{36}$' then exists (
   select 1 from public.lead_collection_items i where i.lead_id=l.id and i.list_id=(p->>'folder')::uuid)
   when p->>'folder' in ('all','all_master') then true
   when p->>'folder'='website_form' or (p->>'source'='wizard' and not coalesce((p->>'allocation')::boolean,false)) then l.query_kind='website_form'
   when p->>'folder'='hot_leads' or (p->>'source'='admin' and not coalesce((p->>'allocation')::boolean,false)) then l.query_kind='hot_leads'
   else true end)
 and (coalesce((p->>'allocation')::boolean,false) or coalesce(p->>'folder','') !~* '^[0-9a-f-]{36}$' or coalesce(p->>'source','') not in ('wizard','admin')
   or l.query_kind=case when p->>'source'='wizard' then 'website_form' else 'hot_leads' end)
 and (coalesce(nullif(p->>'year','all'),case when p->>'folder' like 'year_%' then substring(p->>'folder' from 6) end) is null
   or (l.query_kind='year' and l.query_year=case when p->>'folder' like 'year_%' then substring(p->>'folder' from 6) else p->>'year' end))
 and (coalesce(p->>'source','all')='all' or l.source=p->>'source')
 and (coalesce(p->>'area','all')='all' or case when lower(p->>'area') in ('unspecified','unspecified / other')
   then lower(l.query_locality) in ('unspecified','unknown','unspecified / other')
   else lower(l.query_locality)=lower(p->>'area') end)
 and (coalesce(p->>'service','all')='all' or l.service=p->>'service')
 and (coalesce(p->>'serviceOption','all')='all' or l.service_option=p->>'serviceOption')
 and (nullif(p->>'fromIso','') is null or l.created_at >= (p->>'fromIso')::timestamptz)
 and (nullif(p->>'toIso','') is null or l.created_at <= (p->>'toIso')::timestamptz)
 and (not (p ? 'areas') or jsonb_array_length(p->'areas')=0 or exists(select 1 from jsonb_array_elements_text(p->'areas') a where strpos(lower(l.query_locality),lower(a)) > 0))
 and (not (p ? 'pincodes') or jsonb_array_length(p->'pincodes')=0 or exists(select 1 from jsonb_array_elements_text(p->'pincodes') a where strpos(l.pincode,a) > 0))
 and (not (p ? 'services') or jsonb_array_length(p->'services')=0 or exists(select 1 from jsonb_array_elements_text(p->'services') a where strpos(lower(l.service),lower(a)) > 0))
 and (nullif(p->>'min_price','') is null or coalesce(l.price_total,0) >= (p->>'min_price')::numeric)
 and (not coalesce((p->>'allocation')::boolean,false) or (
   (coalesce((p->>'include_assigned')::boolean,false) or not exists(select 1 from public.lead_list_items i where i.lead_id=l.id))
   and not exists(select 1 from public.lead_list_items i join public.lead_lists a on a.id=i.list_id where i.lead_id=l.id and (
      i.list_id=nullif(p->>'target_list_id','')::uuid
      or a.assigned_admin_user_id in (select value::uuid from jsonb_array_elements_text(coalesce(p->'excludedStaff','[]')))))
   and not exists(select 1 from public.lead_allocation_deliveries d where d.lead_id=l.id and d.schedule_id=nullif(p->>'schedule_id','')::uuid)
 ))
$$;

create function public.admin_lead_query(p_mode text, p_filter jsonb default '{}', p_limit integer default 50, p_offset integer default 0) returns jsonb
language plpgsql stable set search_path = public as $$
declare result jsonb; base jsonb; assigned bigint; unassigned bigint;
begin
 if p_mode='page' then
   select jsonb_build_object('totalCount',(select count(*) from filtered_admin_leads(p_filter)),
     'leads',coalesce(jsonb_agg(to_jsonb(q)),'[]')) into result from (
       select * from filtered_admin_leads(p_filter) order by created_at desc nulls last, id desc
       limit least(greatest(p_limit,1),500) offset greatest(p_offset,0)) q;
 elsif p_mode='search' then
   select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
     select id,name,phone,car_number,car_brand,car_model,area,address,pincode,service,service_option,query_locality
     from filtered_admin_leads(p_filter) where nullif(p_filter->>'afterId','') is null or id > (p_filter->>'afterId')::uuid
     order by id limit least(greatest(p_limit,1),500)) q;
 elsif p_mode='status' then
   select count(*) filter(where exists(select 1 from lead_list_items i where i.lead_id=l.id)),
     count(*) filter(where not exists(select 1 from lead_list_items i where i.lead_id=l.id)) into assigned,unassigned
     from filtered_admin_leads(p_filter - 'assignment' - 'status') l;
   select coalesce(jsonb_object_agg(status,n),'{}') into base from (
     select coalesce(status,'new') status,count(*) n from filtered_admin_leads(p_filter - 'status') group by coalesce(status,'new')) q;
   result := '{"new":0,"contacted":0,"follow_up":0,"call_not_responded":0,"booked":0,"cancelled":0,"draft":0}'::jsonb || base ||
     jsonb_build_object('total',(select count(*) from filtered_admin_leads(p_filter - 'status')),'assigned',assigned,'unassigned',unassigned);
 elsif p_mode='services' then
   select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
     select service,count(*) as count from filtered_admin_leads(p_filter) where service is not null and service <> '' group by service order by count(*) desc,service) q;
 elsif p_mode='areas' then
   select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
     select case when query_locality in ('Unspecified','Unknown') then 'Unspecified / Other' else query_locality end as area,
       count(*) as count, count(*) filter(where status='booked') as "bookedCount",
       count(*) filter(where not exists(select 1 from lead_list_items i where i.lead_id=l.id)) as "unassignedCount"
     from filtered_admin_leads(p_filter) l group by 1 order by (case when query_locality in ('Unspecified','Unknown') then 'Unspecified / Other' else query_locality end = 'Unspecified / Other'),count(*) desc,1) q;
 elsif p_mode='folderCounts' then
   select jsonb_build_object('totalLeads',count(*),'system',coalesce((select jsonb_agg(to_jsonb(q)) from (
     select query_kind as kind,query_year as year,count(*) as count,count(*) filter(where status='booked') as "bookedCount"
     from filtered_admin_leads(p_filter) group by query_kind,query_year) q),'[]')) into result from filtered_admin_leads(p_filter);
 elsif p_mode='listStats' then
   select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
     select i.list_id,coalesce(l.status,'new') status,count(*) as count
     from lead_collection_items i join leads l on l.id=i.lead_id
     where i.list_id in(select value::uuid from jsonb_array_elements_text(p_filter->'listIds'))
       and (nullif(p_filter->>'assignedAdminUserId','') is null or exists(select 1 from lead_list_items a join lead_lists b on b.id=a.list_id where a.lead_id=l.id and b.assigned_admin_user_id=(p_filter->>'assignedAdminUserId')::uuid))
     group by i.list_id,coalesce(l.status,'new')) q;
 elsif p_mode='allocationCount' then
   select jsonb_build_object('count',count(*),'assignedCount',count(*) filter(where exists(select 1 from lead_list_items i where i.lead_id=l.id)),
     'unassignedCount',count(*) filter(where not exists(select 1 from lead_list_items i where i.lead_id=l.id))) into result from filtered_admin_leads(p_filter) l;
 elsif p_mode='allocation' then
   select coalesce(jsonb_agg(to_jsonb(q)),'[]') into result from (
     select l.id,coalesce(l.status,'new') status,i.list_id from filtered_admin_leads(p_filter) l
     left join lead_list_items i on i.lead_id=l.id
     order by (i.list_id is not null),l.id limit greatest(p_limit,1)) q;
 elsif p_mode='summaries' then
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'primaryLocality',query_locality,'area',area,'pincode',pincode,
     'service',service,'service_option',service_option,'price_total',price_total,'status',status,'source',source,
     'created_at',created_at,'year',query_year,'isBulkUpload',query_bulk)),'[]') into result from filtered_admin_leads(p_filter);
 else raise exception 'Unknown lead query mode'; end if;
 return result;
end $$;

revoke all on function public.lead_query_metadata_pending(integer), public.save_lead_query_metadata(jsonb), public.filtered_admin_leads(jsonb), public.admin_lead_query(text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.lead_query_metadata_pending(integer), public.save_lead_query_metadata(jsonb), public.filtered_admin_leads(jsonb), public.admin_lead_query(text,jsonb,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
