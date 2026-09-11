-- Execution leases on existing canonical plan messages. No second mission store.
begin;
create index if not exists nexus_mission_due on public.messages(user_id, (metadata->'plan'->'mission'->>'wake_at'))
where metadata->'plan'->'mission' is not null;
create or replace function public.nexus_claim_mission_v1(p_id uuid,p_token uuid,p_ttl_ms integer) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.messages;
begin
 if auth.uid() is null or p_token is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_ttl_ms is null or p_ttl_ms<100 or p_ttl_ms>360000 then raise exception 'Invalid lease duration'; end if;
 select * into item from public.messages where id=p_id and user_id=auth.uid() for update;
 if not found or item.metadata->'plan'->'mission' is null then raise exception 'Mission not found' using errcode='42501'; end if;
 if (item.metadata->'mission_lease'->>'until')::timestamptz > clock_timestamp() then return false; end if;
 update public.messages set metadata=jsonb_set(metadata,'{mission_lease}',jsonb_build_object('token',p_token,'until',clock_timestamp()+p_ttl_ms*interval '1 millisecond')) where id=p_id and user_id=auth.uid();
 return true;
end $$;
create or replace function public.nexus_release_mission_v1(p_id uuid,p_token uuid) returns void
language sql security definer set search_path=public,pg_temp as $$
 update public.messages set metadata=metadata-'mission_lease' where id=p_id and user_id=auth.uid() and metadata->'mission_lease'->>'token'=p_token::text;
$$;
create or replace function public.nexus_checkpoint_mission_v1(p_id uuid,p_token uuid,p_expected timestamptz,p_plan jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare item public.messages;
begin
 select * into item from public.messages where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'Mission not found' using errcode='42501'; end if;
 if p_token is null or item.metadata->'mission_lease'->>'token' is distinct from p_token::text
 or coalesce((item.metadata->'mission_lease'->>'until')::timestamptz,'-infinity')<=clock_timestamp()
 or item.updated_at is distinct from p_expected then raise exception 'Mission checkpoint conflict' using errcode='40001'; end if;
 if p_plan->>'id' is distinct from p_id::text or p_plan->'mission'->>'state' is null
 or not (p_plan->'mission'->>'state'=any(array['DRAFT','PLANNING','READY','RUNNING','WAITING','APPROVAL_REQUIRED','PAUSED','FAILED','CANCELLED','COMPLETED']))
 or p_plan->>'conversation_id' is distinct from item.metadata->'plan'->>'conversation_id'
 or p_plan->>'source_message_id' is distinct from item.metadata->'plan'->>'source_message_id'
 then raise exception 'Invalid mission checkpoint'; end if;
 update public.messages set content=p_plan->>'summary',metadata=jsonb_set(metadata,'{plan}',p_plan) where id=p_id and user_id=auth.uid();
end $$;
revoke all on function public.nexus_claim_mission_v1(uuid,uuid,integer), public.nexus_release_mission_v1(uuid,uuid), public.nexus_checkpoint_mission_v1(uuid,uuid,timestamptz,jsonb) from public,anon;
grant execute on function public.nexus_claim_mission_v1(uuid,uuid,integer), public.nexus_release_mission_v1(uuid,uuid), public.nexus_checkpoint_mission_v1(uuid,uuid,timestamptz,jsonb) to authenticated;
-- Atomic lifecycle events, in addition to the existing mission.updated checkpoint events.
create or replace function public.nexus_capture_mission_state_v1() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare m jsonb=new.metadata->'plan'->'mission'; previous text;
begin
 if tg_op='UPDATE' then previous=old.metadata->'plan'->'mission'->>'state'; end if;
 if m->>'state' is null or m->>'state' is not distinct from previous then return new; end if;
 perform public.nexus_store_event_v1(new.user_id,jsonb_build_object('version',1,'id',gen_random_uuid(),'type','mission.'||lower(m->>'state'),'timestamp',clock_timestamp(),
 'source',jsonb_build_object('kind','database','name','MissionEngine'),'related_entity_id',new.metadata->'plan'->'entity_ids'->0,
 'correlation_id',new.conversation_id,'mission_id',new.id,'severity',case when m->>'state'='FAILED' then 'warning' else 'info' end,'visibility','ambient',
 'payload',jsonb_build_object('state',m->>'state','status',m->>'state','operation_id',new.id::text,'terminal',m->>'state'=any(array['FAILED','CANCELLED','COMPLETED','PAUSED','WAITING','APPROVAL_REQUIRED','READY','DRAFT']),'revision',new.metadata->'plan'->'revision')));
 return new;
end $$;
revoke all on function public.nexus_capture_mission_state_v1() from public,anon,authenticated;
drop trigger if exists nexus_mission_state on public.messages;
create trigger nexus_mission_state after insert or update on public.messages for each row execute function public.nexus_capture_mission_state_v1();
commit;
