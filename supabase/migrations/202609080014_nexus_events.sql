-- Normalized, owner-scoped event journal. Canonical record events commit with their source mutation.
begin;
create table if not exists public.nexus_events (
  id uuid not null,
  user_id uuid not null references public.users(id) on delete cascade,
  sequence bigint check (sequence > 0),
  version integer not null default 1 check (version = 1),
  type text not null check (length(type) <= 120 and type ~ '^(ary|agent|mission|memory|tool|skill|automation|device|voice|computer|browser|permission|model|system)\.[a-z][a-z0-9_.]*$'),
  timestamp timestamptz not null default clock_timestamp(),
  source jsonb not null check (jsonb_typeof(source) = 'object' and source->>'kind' in ('backend','database','client') and length(source->>'name') between 1 and 80),
  related_entity_id uuid,
  correlation_id uuid,
  mission_id uuid,
  severity text not null check (severity in ('debug','info','warning','error','critical')),
  visibility text not null check (visibility in ('ambient','systems','internal')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 8192),
  primary key(user_id,id), unique(user_id,sequence)
);
create index if not exists nexus_events_type_cursor on public.nexus_events(user_id,type,sequence desc);
create index if not exists nexus_events_correlation on public.nexus_events(user_id,correlation_id,sequence);
alter table public.nexus_events enable row level security;
drop policy if exists nexus_event_owner_read on public.nexus_events;
create policy nexus_event_owner_read on public.nexus_events for select to authenticated using(user_id = auth.uid() and visibility <> 'internal');
revoke all on public.nexus_events from anon, authenticated;
grant select on public.nexus_events to authenticated;

-- Private transactional outbox insertion. Delivery cursors are assigned only to committed rows by the reader.
create or replace function public.nexus_store_event_v1(p_user uuid, p_event jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.nexus_events; previous public.nexus_events; safe_payload jsonb; field record;
begin
  if p_user is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into safe_payload from jsonb_each(coalesce(p_event->'payload','{}'))
  where key = any(array['label','state','status','phase','role','operation_id','action_id','record_id','conversation_id','source_message_id','memory_id','tool','capability','device_id','terminal','count','revision','model','provider','duration_ms','input_tokens','output_tokens','estimated_cost_usd','reason_code','retryable']);
  for field in select key,value from jsonb_each(safe_payload) loop
    if field.key in ('action_id','record_id','conversation_id','source_message_id','memory_id') then
      if jsonb_typeof(field.value) <> 'null' then
        if jsonb_typeof(field.value) <> 'string' then raise exception 'Invalid event reference'; end if;
        perform (field.value#>>'{}')::uuid;
      elsif field.key in ('record_id','memory_id') then raise exception 'Invalid event reference'; end if;
    elsif field.key in ('terminal','retryable') then
      if jsonb_typeof(field.value) <> 'boolean' then raise exception 'Invalid event boolean'; end if;
    elsif field.key in ('count','revision','duration_ms','input_tokens','output_tokens','estimated_cost_usd') then
      if jsonb_typeof(field.value) = 'null' and field.key not in ('count','revision') then continue; end if;
      if jsonb_typeof(field.value) <> 'number' then raise exception 'Invalid event metric'; end if;
      if (field.value#>>'{}')::numeric < 0 or (field.key in ('count','revision') and trunc((field.value#>>'{}')::numeric) <> (field.value#>>'{}')::numeric) then raise exception 'Invalid event metric'; end if;
    elsif jsonb_typeof(field.value) <> 'string' or length(field.value#>>'{}') > 240 then
      raise exception 'Invalid event text';
    end if;
  end loop;
  if jsonb_typeof(p_event->'source'->'kind') is distinct from 'string'
    or jsonb_typeof(p_event->'source'->'name') is distinct from 'string'
    or ((p_event->'source') - 'kind' - 'name') <> '{}'::jsonb then raise exception 'Invalid event source'; end if;
  p_event := jsonb_set(p_event,'{payload}',safe_payload);
  select * into previous from public.nexus_events where user_id=p_user and id=(p_event->>'id')::uuid;
  if found then
    if (to_jsonb(previous)-'user_id'-'sequence'-'timestamp') <> (p_event-'timestamp') then
      raise exception 'Event id belongs to different data' using errcode='23505';
    end if;
    return to_jsonb(previous)||jsonb_build_object('sequence',previous.sequence::text);
  end if;
  insert into public.nexus_events(id,user_id,sequence,version,type,timestamp,source,related_entity_id,correlation_id,mission_id,severity,visibility,payload)
  values ((p_event->>'id')::uuid,p_user,null,(p_event->>'version')::int,p_event->>'type',(p_event->>'timestamp')::timestamptz,p_event->'source',
    (p_event->>'related_entity_id')::uuid,(p_event->>'correlation_id')::uuid,(p_event->>'mission_id')::uuid,p_event->>'severity',p_event->>'visibility',safe_payload) on conflict(user_id,id) do nothing returning * into item;
  if not found then
    select * into item from public.nexus_events where user_id=p_user and id=(p_event->>'id')::uuid;
    if (to_jsonb(item)-'user_id'-'sequence'-'timestamp') <> (p_event-'timestamp') then raise exception 'Event id belongs to different data' using errcode='23505'; end if;
  end if;
  return to_jsonb(item)||jsonb_build_object('sequence',item.sequence::text);
end $$;
revoke all on function public.nexus_store_event_v1(uuid,jsonb) from public,anon,authenticated;
create or replace function public.nexus_append_event_v1(p_event jsonb) returns jsonb
language sql security definer set search_path=public,pg_temp as $$ select public.nexus_store_event_v1(auth.uid(),p_event) $$;
revoke all on function public.nexus_append_event_v1(jsonb) from public,anon;
grant execute on function public.nexus_append_event_v1(jsonb) to authenticated;

create or replace function public.nexus_read_events_v1(p_after bigint default null,p_before bigint default null,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare events jsonb; next_cursor text; more boolean; last_sequence bigint;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 or (p_after is not null and p_before is not null) or coalesce(p_after,0)<0 or coalesce(p_before,0)<0 then raise exception 'Invalid event cursor'; end if;
  -- No source-row locks are acquired here. Late source commits remain unsequenced until the next read,
  -- and therefore cannot land behind a cursor already delivered to a client.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,14014));
  select coalesce(max(sequence),0) into last_sequence from public.nexus_events where user_id=auth.uid();
  with pending as (
    select id,row_number() over(order by timestamp,id) as ordinal from public.nexus_events where user_id=auth.uid() and sequence is null
  ) update public.nexus_events e set sequence=last_sequence+p.ordinal from pending p where e.user_id=auth.uid() and e.id=p.id;
  with selected as (
    select * from public.nexus_events where user_id=auth.uid() and visibility<>'internal'
      and (p_after is null or sequence>p_after) and (p_before is null or sequence<p_before)
    order by case when p_after is not null then sequence end asc, case when p_after is null then sequence end desc limit p_limit+1
  ), page as (
    select * from selected order by case when p_after is not null then sequence end asc, case when p_after is null then sequence end desc limit p_limit
  )
  select coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('sequence',p.sequence::text) order by p.sequence) from page p),'[]'),
    coalesce((select max(sequence)::text from page),p_after::text,'0'),(select count(*)>p_limit from selected)
  into events,next_cursor,more;
  return jsonb_build_object('events',events,'cursor',next_cursor,'has_more',more);
end $$;
revoke all on function public.nexus_read_events_v1(bigint,bigint,integer) from public,anon;
grant execute on function public.nexus_read_events_v1(bigint,bigint,integer) to authenticated;

create or replace function public.nexus_capture_activity_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare n jsonb=to_jsonb(new); o jsonb; event_type text; event_status text; mission uuid; p jsonb;
begin
  if tg_op='UPDATE' then o=to_jsonb(old); end if;
  if tg_table_name='actions' then
    if o->>'status' is not distinct from n->>'status' then return new; end if;
    event_type='tool.'||(n->>'status'); event_status=n->>'status';
  elsif tg_table_name='outcomes' then event_type='tool.outcome_recorded'; event_status=n->>'status';
  elsif tg_table_name='memories' then
    if o is not null and (o-'updated_at'-'last_accessed_at'-'embedding'-'embedding_model'-'embedding_version'-'embedding_dimensions'-'embedding_input_hash'-'metadata'-'valid_from'-'valid_to'-'memory_type'-'source_message_id') = (n-'updated_at'-'last_accessed_at'-'embedding'-'embedding_model'-'embedding_version'-'embedding_dimensions'-'embedding_input_hash'-'metadata'-'valid_from'-'valid_to'-'memory_type'-'source_message_id') then return new; end if;
    event_type=case when o is null then 'memory.created' else 'memory.updated' end; event_status=n->>'status';
  elsif tg_table_name='memory_conflicts' then event_type='memory.conflict_changed'; event_status=n->>'status';
  elsif tg_table_name='action_approvals' then
    if o is not null then return new; end if; event_type='permission.'||(n->>'decision'); event_status=n->>'decision';
  elsif tg_table_name='permission_policies' then event_type='permission.policy_changed';
  elsif tg_table_name='model_calls' then
    if o is not null then return new; end if; event_type='model.completed'; event_status=n->>'status';
  elsif tg_table_name='messages' and n->'metadata'->'plan' is not null then
    if o->'metadata'->'plan'->>'revision' is not distinct from n->'metadata'->'plan'->>'revision' then return new; end if;
    event_type='mission.updated'; event_status=n->'metadata'->'plan'->>'status'; mission=new.id;
  elsif tg_table_name='extraction_jobs' then
    if o->>'status' is not distinct from n->>'status' then return new; end if;
    event_type='memory.extraction_changed'; event_status=n->>'status';
  else return new; end if;
  p=jsonb_build_object('record_id',new.id);
  if event_status is not null then p=p||jsonb_build_object('status',event_status); end if;
  if n->>'tool_name' is not null then p=p||jsonb_build_object('tool',n->>'tool_name'); end if;
  if tg_table_name='model_calls' then p=p||jsonb_build_object('model',n->>'model','duration_ms',n->'latency_ms','input_tokens',n->'input_tokens','output_tokens',n->'output_tokens','estimated_cost_usd',n->'estimated_cost_usd'); end if;
  if mission is not null then p=p||jsonb_build_object('revision',n->'metadata'->'plan'->'revision'); end if;
  perform public.nexus_store_event_v1(new.user_id,jsonb_build_object('version',1,'id',gen_random_uuid(),'type',event_type,'timestamp',clock_timestamp(),
    'source',jsonb_build_object('kind','database','name',tg_table_name),'related_entity_id',n->'product_entity_ids'->0,
    'correlation_id',coalesce(nullif(n->'conversation_id','null'::jsonb),nullif(n->'action_id','null'::jsonb),case when tg_table_name='actions' then n->'id' end),'mission_id',mission,
    'severity',case when event_status in ('failed','blocked','rejected') then 'warning' else 'info' end,'visibility','systems','payload',p));
  return new;
end $$;
revoke all on function public.nexus_capture_activity_v1() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['actions','outcomes','memories','memory_conflicts','action_approvals','permission_policies','model_calls','messages','extraction_jobs'] loop
    execute format('drop trigger if exists nexus_activity on public.%I',t);
    execute format('create trigger nexus_activity after insert or update on public.%I for each row execute function public.nexus_capture_activity_v1()',t);
  end loop;
end $$;
commit;
