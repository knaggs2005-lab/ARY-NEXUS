-- Reflection v1: durable review queue; no automatic application of proposals.
begin;
create unique index messages_conversation_identity on public.messages(user_id,conversation_id,id);
create table public.reflection_jobs (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 conversation_id uuid not null, source_message_id uuid not null,
 status text not null default 'pending' check(status in ('pending','running','completed','failed')),
 attempts integer not null default 0 check(attempts between 0 and 5), lease_until timestamptz, error text,
 version text not null, observations jsonb not null default '[]' check(jsonb_typeof(observations)='array'),
 unique(user_id,id), unique(user_id,source_message_id),
 foreign key(user_id,conversation_id,source_message_id) references public.messages(user_id,conversation_id,id) on delete cascade
);
create table public.reflection_proposals (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 job_id uuid not null, fingerprint text not null,
 kind text not null check(kind in ('memory_update','relationship_update','lesson_learned','outcome_link','importance_adjustment')),
 status text not null default 'pending' check(status in ('pending','accepted','rejected')),
 noticed text not null, reason text not null, change jsonb not null check(jsonb_typeof(change)='object'),
 evidence jsonb not null check(jsonb_typeof(evidence)='array' and jsonb_array_length(evidence)>0),
 review_reason text, reviewed_at timestamptz, reviewed_by uuid,
 applied_changes jsonb not null default '[]' check(jsonb_typeof(applied_changes)='array'),
 unique(user_id,id), unique(user_id,fingerprint),
 foreign key(user_id,job_id) references public.reflection_jobs(user_id,id) on delete cascade,
 check((status='pending' and review_reason is null and reviewed_at is null and reviewed_by is null and applied_changes='[]'::jsonb)
   or (status<>'pending' and review_reason is not null and reviewed_by is not null and length(btrim(review_reason))>0 and reviewed_at is not null and reviewed_by=user_id)),
 check(status<>'rejected' or applied_changes='[]'::jsonb)
);
alter table public.reflection_jobs enable row level security;
alter table public.reflection_proposals enable row level security;
create policy tenant_access on public.reflection_jobs for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy tenant_access on public.reflection_proposals for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
grant select,insert,update on public.reflection_jobs,public.reflection_proposals to authenticated;
revoke all on public.reflection_jobs,public.reflection_proposals from anon;
create index reflection_jobs_queue on public.reflection_jobs(user_id,status,created_at);
create index reflection_proposals_review on public.reflection_proposals(user_id,status,created_at);
create trigger set_updated_at before update on public.reflection_jobs for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.reflection_proposals for each row execute function public.set_updated_at();
create function public.protect_reflection_audit() returns trigger language plpgsql set search_path='' as $$
begin
 if old.status <> 'pending' or new.status='pending'
 or (to_jsonb(new)-'status'-'review_reason'-'reviewed_at'-'reviewed_by'-'applied_changes'-'updated_at')
 <> (to_jsonb(old)-'status'-'review_reason'-'reviewed_at'-'reviewed_by'-'applied_changes'-'updated_at') then
 raise exception 'Reflection proposals and completed reviews are immutable'; end if;
 return new;
end; $$;
create trigger protect_reflection_audit before update on public.reflection_proposals for each row execute function public.protect_reflection_audit();
create table public.outcome_versions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 record_id uuid not null, snapshot jsonb not null, recorded_at timestamptz not null default clock_timestamp(), unique(user_id,id),
 foreign key(user_id,record_id) references public.outcomes(user_id,id) on delete cascade
);
alter table public.outcome_versions enable row level security;
create policy tenant_read on public.outcome_versions for select to authenticated using((select auth.uid())=user_id);
revoke all on public.outcome_versions from public,anon,authenticated;
grant select on public.outcome_versions to authenticated;
create index outcome_versions_history on public.outcome_versions(user_id,record_id,recorded_at);
insert into public.outcome_versions(user_id,record_id,snapshot) select user_id,id,to_jsonb(o) from public.outcomes o;
create function public.capture_outcome_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and (to_jsonb(new)-'updated_at')=(to_jsonb(old)-'updated_at') then return new; end if;
 insert into public.outcome_versions(user_id,record_id,snapshot) values(new.user_id,new.id,to_jsonb(new));
 return new;
end; $$;
revoke all on function public.capture_outcome_version() from public,anon,authenticated;
create trigger outcome_version after insert or update on public.outcomes for each row execute function public.capture_outcome_version();
create or replace function public.apply_memory_batch(mutations jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare m jsonb; payload jsonb; tbl text; cols text; vals text; assignments text; changed integer; current_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(mutations) <> 'array' or jsonb_array_length(mutations) > 200 then raise exception 'Invalid batch'; end if;
  -- Serializes batches for a user, including competing extraction commits.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  for m in select value from jsonb_array_elements(mutations) loop
    tbl := m->>'table';
    if tbl not in ('memories','entities','relationships','memory_entities','messages','entity_aliases','memory_evidence','memory_conflicts','extraction_jobs','reflection_jobs','reflection_proposals','outcomes','tasks','decisions','goals','actions','conversations') then raise exception 'Unsupported batch table'; end if;
    payload := coalesce(m->'data','{}'::jsonb) - 'id' - 'user_id' - 'created_at' - 'updated_at';
    if jsonb_typeof(payload) <> 'object' then raise exception 'Invalid data'; end if;
    if m->>'kind' = 'insert' then
      payload := payload || jsonb_build_object('user_id',auth.uid(),'id',coalesce((m->>'id')::uuid,gen_random_uuid()));
      select string_agg(format('%I',key),','),string_agg(format('r.%I',key),',') into cols,vals from jsonb_object_keys(payload) key;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r',tbl,cols,vals,tbl) using payload;
    elsif m->>'kind' in ('update','check') then
      execute format('select to_jsonb(t) from public.%I t where id=$1 and user_id=$2 for update',tbl) into current_row using (m->>'id')::uuid,auth.uid();
      if current_row is null then raise exception 'Record not found' using errcode='40001'; end if;
      if m ? 'expected_updated_at' and (current_row->>'updated_at')::timestamptz <> (m->>'expected_updated_at')::timestamptz then raise exception 'Record changed; retry' using errcode='40001'; end if;
      if m->>'kind' = 'check' then continue; end if;
      select string_agg(format('%I = r.%I',key,key),',') into assignments from jsonb_object_keys(payload) key;
      if assignments is null then raise exception 'Empty update'; end if;
      execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) r where t.id=$2 and t.user_id=$3',tbl,assignments,tbl) using payload,(m->>'id')::uuid,auth.uid();
      get diagnostics changed = row_count;
      if changed <> 1 then raise exception 'Record changed; retry' using errcode='40001'; end if;
    else raise exception 'Unsupported mutation'; end if;
  end loop;
end; $$;
revoke all on function public.apply_memory_batch(jsonb) from public,anon;
grant execute on function public.apply_memory_batch(jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
