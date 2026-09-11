-- Non-destructive, rerunnable RPC upgrade. Keep v3 for older clients.
begin;
create or replace function public.search_memories_v4(
 query_text text, query_embedding extensions.vector(384), model_id text,
 match_count integer default 200, version_id text default 'legacy-v1',
 min_similarity double precision default 0.4)
returns table(id uuid, score double precision, similarity double precision,
 semantic_score double precision, text_score double precision,
 semantic_rank bigint, text_rank bigint, candidate_updated_at timestamptz)
language sql stable security invoker set search_path = public,extensions as $$
with eligible as not materialized (
 select m.* from public.memories m
 where user_id=(select auth.uid()) and archived_at is null and status='active'
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
revoke all on function public.search_memories_v4(text,extensions.vector,text,integer,text,double precision) from public,anon;
grant execute on function public.search_memories_v4(text,extensions.vector,text,integer,text,double precision) to authenticated;
notify pgrst,'reload schema';
commit;
