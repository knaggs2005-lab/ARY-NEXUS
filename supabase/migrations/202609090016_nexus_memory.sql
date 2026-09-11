-- Additive: learned memories, IDs, types, vector indexes and history remain unchanged.
begin;
create table if not exists public.knowledge_documents (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 title text not null check(length(title) between 1 and 200), content text not null check(length(content) between 1 and 20000),
 reference text not null check(length(reference) between 3 and 1000), confidence double precision not null check(confidence between 0 and 1),
 entity_ids uuid[] not null default '{}', supersedes_id uuid, archived_at timestamptz,
 unique(user_id,id), foreign key(user_id,supersedes_id) references public.knowledge_documents(user_id,id), check(supersedes_id is null or supersedes_id<>id)
);
create unique index if not exists knowledge_one_successor on public.knowledge_documents(user_id,supersedes_id) where supersedes_id is not null;
alter table public.knowledge_documents enable row level security;
drop policy if exists knowledge_owner on public.knowledge_documents;
create policy knowledge_owner on public.knowledge_documents to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.knowledge_documents from public,anon,authenticated;
grant select,insert,update on public.knowledge_documents to authenticated;
create or replace function public.nexus_knowledge_guard_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='UPDATE' and (to_jsonb(new)-'archived_at'-'updated_at') is distinct from (to_jsonb(old)-'archived_at'-'updated_at') then raise exception 'Knowledge is versioned; append a revision'; end if;
 if exists(select 1 from unnest(new.entity_ids) e where not exists(select 1 from public.entities t where t.id=e and t.user_id=new.user_id)) then raise exception 'Knowledge entity not found'; end if;
 return new;
end; $$;
drop trigger if exists knowledge_guard on public.knowledge_documents;
create trigger knowledge_guard before insert or update on public.knowledge_documents for each row execute function public.nexus_knowledge_guard_v1();
-- Owner-scoped, fixed SQL, callable inside the existing atomic action/outcome batch.
create or replace function public.nexus_delete_memory_record_v1(p_id uuid,p_expected timestamptz) returns void language plpgsql security definer set search_path='' as $$
declare m public.memories;
begin
 if auth.uid() is null or p_expected is null then raise exception 'Authentication and revision required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into m from public.memories where user_id=auth.uid() and id=p_id for update;
 if m.id is null or m.updated_at<>p_expected then raise exception 'Memory changed or missing' using errcode='40001'; end if;
 if exists(select 1 from public.memories where user_id=auth.uid() and id<>p_id and (supersedes_id=p_id or metadata->'nexus_memory'->'consolidated_from' @> jsonb_build_array(jsonb_build_object('id',p_id))))
 or exists(select 1 from public.relationships where user_id=auth.uid() and memory_id=p_id) then raise exception 'Memory has dependants; archive instead' using errcode='40001'; end if;
 delete from public.memory_conflicts where user_id=auth.uid() and (existing_memory_id=p_id or candidate_memory_id=p_id);
 delete from public.memory_sources where user_id=auth.uid() and memory_id=p_id;
 delete from public.memory_evidence where user_id=auth.uid() and memory_id=p_id;
 delete from public.memory_versions where user_id=auth.uid() and record_id=p_id;
 delete from public.memory_entities where user_id=auth.uid() and memory_id=p_id;
 delete from public.memories where user_id=auth.uid() and id=p_id;
end; $$;
revoke all on function public.nexus_delete_memory_record_v1(uuid,timestamptz) from public,anon;
grant execute on function public.nexus_delete_memory_record_v1(uuid,timestamptz) to authenticated;
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
    if tbl not in ('memories','entities','relationships','memory_entities','messages','entity_aliases','memory_evidence','memory_conflicts','extraction_jobs','reflection_jobs','reflection_proposals','outcomes','tasks','decisions','goals','actions','conversations','knowledge_documents') then raise exception 'Unsupported batch table'; end if;
    payload := coalesce(m->'data','{}'::jsonb) - 'id' - 'user_id' - 'created_at' - 'updated_at';
    if jsonb_typeof(payload) <> 'object' then raise exception 'Invalid data'; end if;
    if m->>'kind' = 'delete_memory' then
      if tbl <> 'memories' or not (m ? 'expected_updated_at') then raise exception 'Invalid memory deletion'; end if;
      perform public.nexus_delete_memory_record_v1((m->>'id')::uuid,(m->>'expected_updated_at')::timestamptz);
    elsif m->>'kind' = 'insert' then
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

create or replace function public.search_memories_v5(
 query_text text, query_embedding extensions.vector(384), model_id text,
 match_count integer default 200, version_id text default 'legacy-v1',
 min_similarity double precision default 0.4, conversation_scope uuid default null)
returns table(id uuid, score double precision, similarity double precision,
 semantic_score double precision, text_score double precision,
 semantic_rank bigint, text_rank bigint, candidate_updated_at timestamptz)
language sql stable security invoker set search_path = public,extensions as $$
with eligible as not materialized (
 select m.* from public.memories m
 where user_id=(select auth.uid()) and archived_at is null and status='active'
 and (m.metadata->'nexus_memory'->>'expires_at' is null or (m.metadata->'nexus_memory'->>'expires_at')::timestamptz>now())
 and (coalesce(m.metadata->'nexus_memory'->>'class','SEMANTIC')<>'WORKING' or (conversation_scope is not null and m.metadata->'nexus_memory'->>'conversation_id'=conversation_scope::text))
 and (valid_from is null or valid_from <= now()) and (valid_to is null or valid_to > now())
), semantic_pool as (
 select id, updated_at, greatest(0,1-(embedding <=> query_embedding)) sim
 from eligible
 where embedding_model=model_id and embedding_version=version_id
 and embedding_dimensions=384 and embedding_input_hash is not null
 and embedding is not null and query_embedding is not null
 and vector_norm(embedding)>0 and vector_norm(query_embedding)>0
 order by embedding <=> query_embedding,id limit 100
), semantic as (
 select id,updated_at,sim,row_number() over(order by sim desc,id) r
 from semantic_pool where sim >= greatest(0.000001,least(min_similarity,1))
), lexical_pool as (
 select id,updated_at,ts_rank_cd(to_tsvector('english',content || ' ' || summary),
   plainto_tsquery('english',query_text)) rank
 from eligible where to_tsvector('english',content || ' ' || summary)
   @@ plainto_tsquery('english',query_text)
 order by rank desc,id limit 100
), lexical as (
 select id,updated_at,rank,row_number() over(order by rank desc,id) r from lexical_pool
), candidates as (select id from semantic union select id from lexical)
select c.id,
 (coalesce(1.0/(60+s.r),0)+coalesce(1.0/(60+l.r),0))::double precision,
 coalesce(s.sim,0)::double precision,
 s.sim::double precision,l.rank::double precision,s.r,l.r,coalesce(s.updated_at,l.updated_at)
from candidates c left join semantic s on s.id=c.id left join lexical l on l.id=c.id
order by 2 desc,c.id limit greatest(1,least(match_count,200));
$$;
revoke all on function public.search_memories_v5(text,extensions.vector,text,integer,text,double precision,uuid) from public,anon;
grant execute on function public.search_memories_v5(text,extensions.vector,text,integer,text,double precision,uuid) to authenticated;

notify pgrst,'reload schema';
commit;
