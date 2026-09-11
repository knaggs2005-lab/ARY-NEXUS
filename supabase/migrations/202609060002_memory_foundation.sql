-- Incremental migration. Run AFTER 202609060001_initial.sql; never rerun the initial schema.
begin;
alter table public.memories
  add column status text not null default 'active' check (status in ('active','superseded','disputed')),
  add column valid_from timestamptz,
  add column valid_to timestamptz,
  add column supersedes_id uuid,
  add constraint memories_validity check (valid_to is null or valid_from is null or valid_to > valid_from),
  add constraint memories_supersedes_fk foreign key(user_id,supersedes_id) references public.memories(user_id,id);
alter table public.relationships
 add column valid_from timestamptz, add column valid_to timestamptz, add column memory_id uuid,
 add constraint relationships_validity check(valid_to is null or valid_from is null or valid_to > valid_from),
 add constraint relationships_memory_fk foreign key(user_id,memory_id) references public.memories(user_id,id);
create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = clock_timestamp(); return new; end;
$$;
create table public.entity_aliases (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
unique(user_id,id),
entity_id uuid not null, alias text not null check(alias = lower(trim(alias)) and length(alias) between 1 and 200),
unique(user_id,alias), foreign key(user_id,entity_id) references public.entities(user_id,id) on delete cascade);
alter table public.entity_aliases enable row level security;
create policy tenant_access on public.entity_aliases for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select,insert,update,delete on public.entity_aliases to authenticated;
revoke all on public.entity_aliases from anon;
create index entity_aliases_user_idx on public.entity_aliases(user_id);
create trigger set_updated_at before update on public.entity_aliases for each row execute function public.set_updated_at();
create table public.memory_evidence (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
unique(user_id,id),
memory_id uuid not null, source_message_id uuid not null, quote text not null check(length(trim(quote)) > 0),
evidence_type text not null check(evidence_type in ('supports','contradicts')),
unique(user_id,memory_id,source_message_id,evidence_type),
foreign key(user_id,memory_id) references public.memories(user_id,id) on delete cascade,
foreign key(user_id,source_message_id) references public.messages(user_id,id));
alter table public.memory_evidence enable row level security;
create policy tenant_access on public.memory_evidence for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select,insert,update,delete on public.memory_evidence to authenticated;
revoke all on public.memory_evidence from anon;
create index memory_evidence_user_idx on public.memory_evidence(user_id);
create trigger set_updated_at before update on public.memory_evidence for each row execute function public.set_updated_at();
create table public.memory_conflicts (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
unique(user_id,id),
existing_memory_id uuid not null, candidate_memory_id uuid not null, reason text not null,
status text not null default 'pending' check(status in ('pending','replaced','kept_existing','kept_both')),
check(existing_memory_id <> candidate_memory_id),
foreign key(user_id,existing_memory_id) references public.memories(user_id,id),
foreign key(user_id,candidate_memory_id) references public.memories(user_id,id));
alter table public.memory_conflicts enable row level security;
create policy tenant_access on public.memory_conflicts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select,insert,update,delete on public.memory_conflicts to authenticated;
revoke all on public.memory_conflicts from anon;
create index memory_conflicts_user_idx on public.memory_conflicts(user_id);
create trigger set_updated_at before update on public.memory_conflicts for each row execute function public.set_updated_at();
create table public.extraction_jobs (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
unique(user_id,id),
source_message_id uuid not null, status text not null default 'pending' check(status in ('pending','running','completed','failed')),
attempts integer not null default 0 check(attempts between 0 and 5), lease_until timestamptz, error text,
saved_memory_ids uuid[] not null default '{}', unique(user_id,source_message_id),
foreign key(user_id,source_message_id) references public.messages(user_id,id));
alter table public.extraction_jobs enable row level security;
create policy tenant_access on public.extraction_jobs for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select,insert,update,delete on public.extraction_jobs to authenticated;
revoke all on public.extraction_jobs from anon;
create index extraction_jobs_user_idx on public.extraction_jobs(user_id);
create trigger set_updated_at before update on public.extraction_jobs for each row execute function public.set_updated_at();
create table public.memory_versions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
unique(user_id,id),
record_id uuid not null, snapshot jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
foreign key(user_id,record_id) references public.memories(user_id,id) on delete cascade);
alter table public.memory_versions enable row level security;
create policy tenant_read on public.memory_versions for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.memory_versions from public,anon,authenticated;
grant select on public.memory_versions to authenticated;
create index memory_versions_history_idx on public.memory_versions(user_id,record_id,recorded_at);
-- Baseline captures current knowledge at migration time, not invented past history.
insert into public.memory_versions(user_id,record_id,snapshot) select user_id,id,to_jsonb(r) from public.memories r;
create table public.relationship_versions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
unique(user_id,id),
record_id uuid not null, snapshot jsonb not null, recorded_at timestamptz not null default clock_timestamp(),
foreign key(user_id,record_id) references public.relationships(user_id,id) on delete cascade);
alter table public.relationship_versions enable row level security;
create policy tenant_read on public.relationship_versions for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.relationship_versions from public,anon,authenticated;
grant select on public.relationship_versions to authenticated;
create index relationship_versions_history_idx on public.relationship_versions(user_id,record_id,recorded_at);
-- Baseline captures current knowledge at migration time, not invented past history.
insert into public.relationship_versions(user_id,record_id,snapshot) select user_id,id,to_jsonb(r) from public.relationships r;

-- Definer is narrowly scoped to history writes; callers cannot modify history tables.
create function public.capture_knowledge_version() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if TG_OP = 'UPDATE' and (to_jsonb(new) - 'updated_at' - 'last_accessed_at') = (to_jsonb(old) - 'updated_at' - 'last_accessed_at') then return new; end if;
  if TG_TABLE_NAME = 'memories' then
    insert into public.memory_versions(user_id,record_id,snapshot) values(new.user_id,new.id,to_jsonb(new));
  elsif TG_TABLE_NAME = 'relationships' then
    insert into public.relationship_versions(user_id,record_id,snapshot) values(new.user_id,new.id,to_jsonb(new));
  end if;
  return new;
end; $$;
revoke all on function public.capture_knowledge_version() from public,anon,authenticated;
create trigger knowledge_version after insert or update on public.memories for each row execute function public.capture_knowledge_version();
create trigger knowledge_version after insert or update on public.relationships for each row execute function public.capture_knowledge_version();

-- Tenant-scoped atomic unit of work. Same privileges as direct CRUD; no elevation.
-- Column names are quoted, values parameterized, tables explicitly allowlisted.
create function public.apply_memory_batch(mutations jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare m jsonb; payload jsonb; tbl text; cols text; vals text; assignments text; changed integer; current_row jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(mutations) <> 'array' or jsonb_array_length(mutations) > 200 then raise exception 'Invalid batch'; end if;
  -- Serializes batches for a user, including competing extraction commits.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
  for m in select value from jsonb_array_elements(mutations) loop
    tbl := m->>'table';
    if tbl not in ('memories','entities','relationships','memory_entities','messages','entity_aliases','memory_evidence','memory_conflicts','extraction_jobs') then raise exception 'Unsupported batch table'; end if;
    payload := (m->'data') - 'id' - 'user_id' - 'created_at' - 'updated_at';
    if jsonb_typeof(payload) <> 'object' then raise exception 'Invalid data'; end if;
    if m->>'kind' = 'insert' then
      payload := payload || jsonb_build_object('user_id',auth.uid(),'id',coalesce((m->>'id')::uuid,gen_random_uuid()));
      select string_agg(format('%I',key),','),string_agg(format('r.%I',key),',') into cols,vals from jsonb_object_keys(payload) key;
      execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) r',tbl,cols,vals,tbl) using payload;
    elsif m->>'kind' = 'update' then
      execute format('select to_jsonb(t) from public.%I t where id=$1 and user_id=$2 for update',tbl) into current_row using (m->>'id')::uuid,auth.uid();
      if current_row is null then raise exception 'Record not found' using errcode='40001'; end if;
      if m ? 'expected_updated_at' and (current_row->>'updated_at')::timestamptz <> (m->>'expected_updated_at')::timestamptz then raise exception 'Record changed; retry' using errcode='40001'; end if;
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

-- Semantic and lexical candidates are independently ranked; lexical matches do
-- not need to clear a semantic threshold. Ordinary PostgreSQL FTS, not BM25.
create or replace function public.search_memories(query_text text, query_embedding extensions.vector(384), model_id text, match_count integer default 8)
returns table(id uuid, score double precision, similarity double precision)
language sql stable security invoker set search_path = public,extensions as $$
with eligible as (
 select m.* from public.memories m where user_id=(select auth.uid()) and archived_at is null and status='active'
 and (valid_from is null or valid_from <= now()) and (valid_to is null or valid_to > now())
), semantic_pool as (
 select id, greatest(0,1-(embedding <=> query_embedding)) sim from eligible
 where embedding_model=model_id and embedding is not null and query_embedding is not null
 and vector_norm(embedding)>0 and vector_norm(query_embedding)>0
 order by embedding <=> query_embedding,id limit 100
), semantic as (
 select id,sim,row_number() over(order by sim desc,id) r from semantic_pool where sim >= 0.2
), lexical_pool as (
 select id,ts_rank_cd(to_tsvector('english',content || ' ' || summary),plainto_tsquery('english',query_text)) rank
 from eligible where to_tsvector('english',content || ' ' || summary) @@ plainto_tsquery('english',query_text)
 order by rank desc,id limit 100
), lexical as (select id,row_number() over(order by rank desc,id) r from lexical_pool),
candidates as (select id from semantic union select id from lexical)
select c.id, (coalesce(1.0/(60+s.r),0)+coalesce(1.0/(60+l.r),0))::double precision score, coalesce(s.sim,0)::double precision
from candidates c left join semantic s on s.id=c.id left join lexical l on l.id=c.id
order by score desc,c.id limit greatest(1,least(match_count,50));
$$;
notify pgrst,'reload schema';
commit;
