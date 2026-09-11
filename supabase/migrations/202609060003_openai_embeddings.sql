-- Embedding identities and content-free model telemetry. Apply once after migration 002.
begin;
alter table public.memories
 add column embedding_version text not null default 'legacy-v1',
 add column embedding_dimensions integer not null default 384 check(embedding_dimensions=384),
 add column embedding_input_hash text;
-- Historical embeddings retain their original space; label legacy provenance without rewriting facts.
update public.memory_versions set snapshot = snapshot || jsonb_build_object('embedding_version','legacy-v1','embedding_dimensions',384,'embedding_input_hash',null)
 where not (snapshot ? 'embedding_version');

create table public.model_calls (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 operation text not null, model text not null, input_tokens integer check(input_tokens>=0), cached_input_tokens integer check(cached_input_tokens>=0), output_tokens integer check(output_tokens>=0),
 latency_ms integer not null check(latency_ms>=0), estimated_cost_usd double precision check(estimated_cost_usd>=0), pricing_version text not null,
 retrieval_count integer not null default 0 check(retrieval_count>=0), memories_extracted integer check(memories_extracted>=0),
 status text not null check(status in ('succeeded','failed')), error_code text, unique(user_id,id)
);
alter table public.model_calls enable row level security;
create policy tenant_access on public.model_calls for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
grant select,insert on public.model_calls to authenticated;
revoke all on public.model_calls from anon;
create index model_calls_user_time_idx on public.model_calls(user_id,created_at desc);
-- Direct text edits must not leave an old vector marked current.
create function public.invalidate_stale_embedding() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.content is distinct from old.content or new.summary is distinct from old.summary)
 and new.embedding_input_hash is not distinct from old.embedding_input_hash then new.embedding_input_hash=null; end if;
 return new;
end; $$;
create trigger invalidate_stale_embedding before update on public.memories for each row execute function public.invalidate_stale_embedding();
create function public.search_memories_v3(query_text text, query_embedding extensions.vector(384), model_id text, match_count integer default 8, version_id text default 'legacy-v1', min_similarity double precision default 0.4)
returns table(id uuid, score double precision, similarity double precision)
language sql stable security invoker set search_path = public,extensions as $$
with eligible as (
 select m.* from public.memories m where user_id=(select auth.uid()) and archived_at is null and status='active'
 and (valid_from is null or valid_from <= now()) and (valid_to is null or valid_to > now())
), semantic_pool as (
 select id, greatest(0,1-(embedding <=> query_embedding)) sim from eligible
 where embedding_model=model_id and embedding_version=version_id and embedding_input_hash is not null and embedding is not null and query_embedding is not null
 and vector_norm(embedding)>0 and vector_norm(query_embedding)>0
 order by embedding <=> query_embedding,id limit 100
), semantic as (
 select id,sim,row_number() over(order by sim desc,id) r from semantic_pool where sim >= greatest(0,least(min_similarity,1))
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

revoke all on function public.search_memories_v3(text,extensions.vector,text,integer,text,double precision) from public,anon;
grant execute on function public.search_memories_v3(text,extensions.vector,text,integer,text,double precision) to authenticated;
notify pgrst,'reload schema';
commit;
