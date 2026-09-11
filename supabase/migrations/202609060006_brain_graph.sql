-- Read-only graph projection. Rerunnable; identities and knowledge are unchanged.
create index if not exists graph_entity_search_idx on public.entities using gin
  (to_tsvector('simple', name || ' ' || description));
create index if not exists graph_entity_name_idx on public.entities(user_id,lower(name));
create index if not exists graph_entity_page_idx on public.entities(user_id,id);
create index if not exists graph_source_idx on public.relationships(user_id,source_entity_id,id);
create index if not exists graph_target_idx on public.relationships(user_id,target_entity_id,id);
create index if not exists graph_scope_idx on public.relationships(user_id,source_entity_id,target_entity_id)
  where relationship_type='part_of';
create index if not exists graph_memory_links_idx on public.memory_entities(user_id,entity_id,memory_id);
create index if not exists graph_goals_idx on public.goals(user_id,entity_id,id);
create index if not exists graph_tasks_idx on public.tasks(user_id,entity_id,goal_id);

create or replace function public.brain_edge_state_v1(r public.relationships, at_time timestamptz)
returns text language sql stable security invoker as $$
  select case
    when r.valid_to <= at_time then 'historical'
    when r.valid_from > at_time then 'scheduled'
    when r.strength <= 0 or (r.memory_id is not null and not exists (
      select 1 from public.memories m where m.user_id=auth.uid() and m.id=r.memory_id
      and m.status='active' and m.archived_at is null
      and (m.valid_from is null or m.valid_from<=at_time) and (m.valid_to is null or m.valid_to>at_time)
    )) then 'inactive' else 'current' end
$$;

-- Scope is explicit child -> parent part_of membership, at most two hops.
-- Ordinary tracks/mentions/blocks edges never assert company ownership.
create or replace function public.brain_in_scope_v1(entity uuid, scope uuid, at_time timestamptz)
returns boolean language sql stable security invoker as $$
  select scope is null or entity=scope or exists (
    select 1 from public.relationships r where r.user_id=auth.uid()
    and r.source_entity_id=entity and r.relationship_type='part_of'
    and public.brain_edge_state_v1(r,at_time)='current'
    and (r.target_entity_id=scope or exists (
      select 1 from public.relationships s where s.user_id=auth.uid()
      and s.source_entity_id=r.target_entity_id and s.target_entity_id=scope
      and s.relationship_type='part_of' and public.brain_edge_state_v1(s,at_time)='current'
    ))
  )
$$;

-- SQL table function remains inlineable: filters can use entity/FTS indexes.
create or replace function public.brain_candidates_v1(ids uuid[], filters jsonb, at_time timestamptz)
returns setof public.entities language sql stable security invoker as $$
  select e.* from public.entities e where e.user_id=auth.uid()
    and (ids is null or e.id=any(ids))
    and (jsonb_array_length(coalesce(filters->'types','[]'::jsonb))=0 or e.entity_type::text in (select jsonb_array_elements_text(filters->'types')))
    -- Separate indexed pools avoid an OR/correlated-alias scan across every entity.
    and (coalesce(filters->>'q','')='' or e.id in (
      select n.id from public.entities n where n.user_id=auth.uid() and lower(n.name)=lower(filters->>'q')
      union
      select n.id from public.entities n where n.user_id=auth.uid()
        and to_tsvector('simple',n.name || ' ' || n.description) @@ plainto_tsquery('simple',filters->>'q')
      union
      select a.entity_id from public.entity_aliases a where a.user_id=auth.uid() and a.alias=lower(filters->>'q')
    ))
    and public.brain_in_scope_v1(e.id,(filters->>'project_id')::uuid,at_time)
    and public.brain_in_scope_v1(e.id,(filters->>'company_id')::uuid,at_time)
$$;

create or replace function public.query_brain_graph_v1(p_query jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare
  root_id uuid := (p_query->>'root')::uuid;
  cursor_id uuid := (p_query->>'after')::uuid;
  hops integer := coalesce((p_query->>'depth')::integer,1);
  node_limit integer := coalesce((p_query->>'limit')::integer,50);
  edge_limit integer := coalesce((p_query->>'edge_limit')::integer,200);
  relation_mode text := coalesce(p_query->>'relationships','current');
  at_time timestamptz := statement_timestamp();
  selected uuid[] := '{}'; frontier uuid[] := '{}'; candidates uuid[] := '{}';
  adjacency uuid[]; adjacent_count integer; candidate_id uuid; hop integer;
  nodes_cut boolean := false; edges_cut boolean := false;
  node_json jsonb; edge_json jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if hops not between 1 and 2 or node_limit not between 1 and 100 or edge_limit not between 1 and 500
    or relation_mode not in ('current','historical','all') or length(coalesce(p_query->>'q',''))>120
    or (root_id is not null and cursor_id is not null)
    or jsonb_typeof(coalesce(p_query->'types','[]'::jsonb)) <> 'array'
  then raise exception 'Invalid graph query' using errcode='22023'; end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(p_query->'types','[]'::jsonb)) t
    where t not in ('person','company','project','product','goal','decision','task'))
    then raise exception 'Invalid entity type' using errcode='22023'; end if;
  if p_query->>'project_id' is not null and not exists (
    select 1 from entities where user_id=auth.uid() and id=(p_query->>'project_id')::uuid and entity_type='project')
    then raise exception 'Invalid project scope' using errcode='P0002'; end if;
  if p_query->>'company_id' is not null and not exists (
    select 1 from entities where user_id=auth.uid() and id=(p_query->>'company_id')::uuid and entity_type='company')
    then raise exception 'Invalid company scope' using errcode='P0002'; end if;
  if root_id is not null then
    if not exists (select 1 from entities where id=root_id and user_id=auth.uid())
      then raise exception 'Entity not found' using errcode='P0002'; end if;
    select coalesce(array_agg(id),'{}') into selected from brain_candidates_v1(array[root_id],p_query - 'types' - 'q',at_time);
    frontier := selected;
    for hop in 1..hops loop
      exit when cardinality(frontier)=0;
      adjacency := '{}';
      foreach candidate_id in array frontier loop
        -- A high-degree hub cannot cause an unbounded traversal. Stable edge ID ordering.
        select coalesce(array_agg(other order by id),'{}'), count(*) into candidates, adjacent_count from (
          select r.id, case when r.source_entity_id=candidate_id then r.target_entity_id else r.source_entity_id end other
          from relationships r where r.user_id=auth.uid()
          and (r.source_entity_id=candidate_id or r.target_entity_id=candidate_id)
          and (relation_mode='all' or (relation_mode='current' and brain_edge_state_v1(r,at_time)='current')
            or (relation_mode='historical' and brain_edge_state_v1(r,at_time) in ('historical','inactive')))
          order by r.id limit 501
        ) a;
        if adjacent_count>500 then nodes_cut:=true; end if;
        adjacency:=adjacency || candidates[1:500];
      end loop;
      select coalesce(array_agg(id order by id),'{}') into candidates from (
        select id from brain_candidates_v1(adjacency,p_query,at_time) where not(id=any(selected))
        order by id limit node_limit-cardinality(selected)+1
      ) c;
      if cardinality(candidates)>node_limit-cardinality(selected) then nodes_cut:=true; end if;
      frontier:=candidates[1:greatest(node_limit-cardinality(selected),0)];
      selected:=selected || frontier;
    end loop;
  else
    select coalesce(array_agg(id order by id),'{}') into selected from (
      select id from brain_candidates_v1(null,p_query,at_time)
      where cursor_id is null or id>cursor_id order by id limit node_limit+1
    ) c;
    nodes_cut:=cardinality(selected)>node_limit;
    selected:=selected[1:node_limit];
  end if;

  -- Hydrate only selected IDs. No vectors, content, metadata blobs, or conversation bodies.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',e.id,'label',e.name,'type',e.entity_type,
    'status',case when e.metadata->>'status' in ('active','blocked','completed','cancelled','paused','archived','unknown') then e.metadata->>'status' else 'unknown' end,
    'importance',m.importance,'recency',greatest(e.updated_at,m.recency),
    'connectedMemoryCount',m.total,'activeBlockerCount',b.total,'activeBlockers',b.items,
    'relatedGoalCount',g.total,'relatedGoals',g.items
  ) order by array_position(selected,e.id)),'[]'::jsonb) into node_json
  from entities e
  cross join lateral (
    select count(*) total,max(mm.importance_score) importance,max(mm.updated_at) recency
    from memory_entities me join memories mm on mm.id=me.memory_id and mm.user_id=me.user_id
    where me.user_id=auth.uid() and me.entity_id=e.id and mm.status='active' and mm.archived_at is null
    and (mm.valid_from is null or mm.valid_from<=at_time) and (mm.valid_to is null or mm.valid_to>at_time)
  ) m
  cross join lateral (
    select count(*) total,coalesce(jsonb_agg(item order by id) filter(where rn<=10),'[]'::jsonb) items from (
      select r.id,row_number() over(order by r.id) rn,
        jsonb_build_object('id',blocker.id,'label',blocker.name,'relationshipId',r.id) item
      from relationships r join entities blocker on blocker.id=r.source_entity_id and blocker.user_id=r.user_id
      where r.user_id=auth.uid() and r.target_entity_id=e.id and r.relationship_type='blocks'
      and brain_edge_state_v1(r,at_time)='current'
      and coalesce(blocker.metadata->>'status','unknown') not in ('completed','cancelled','archived')
      and not (blocker.entity_type='task'
        and exists (select 1 from tasks bt where bt.user_id=auth.uid() and bt.entity_id=blocker.id)
        and not exists (select 1 from tasks bt where bt.user_id=auth.uid() and bt.entity_id=blocker.id and bt.status in ('pending','in_progress')))
    ) items
  ) b
  cross join lateral (
    select count(*) total,coalesce(jsonb_agg(item order by id) filter(where rn<=10),'[]'::jsonb) items from (
      select gg.id,row_number() over(order by gg.id) rn,
        jsonb_build_object('id',gg.id,'title',gg.title,'status',gg.status,'progress',gg.progress) item
      from goals gg where gg.user_id=auth.uid() and (gg.entity_id=e.id or exists (
        select 1 from tasks tt where tt.user_id=auth.uid() and tt.entity_id=e.id and tt.goal_id=gg.id
      ))
    ) items
  ) g
  where e.user_id=auth.uid() and e.id=any(selected);

  select count(*)>edge_limit,coalesce(jsonb_agg(item order by id) filter(where rn<=edge_limit),'[]'::jsonb)
  into edges_cut,edge_json from (
    select r.id,row_number() over(order by r.id) rn,jsonb_build_object(
      'id',r.id,'source',r.source_entity_id,'target',r.target_entity_id,'type',r.relationship_type,
      'strength',r.strength,'status',brain_edge_state_v1(r,at_time),'validFrom',r.valid_from,'validTo',r.valid_to,
      'updatedAt',r.updated_at,'evidenceMemoryId',r.memory_id
    ) item from relationships r where r.user_id=auth.uid()
    and r.source_entity_id=any(selected) and r.target_entity_id=any(selected)
    and (relation_mode='all' or (relation_mode='current' and brain_edge_state_v1(r,at_time)='current')
      or (relation_mode='historical' and brain_edge_state_v1(r,at_time) in ('historical','inactive')))
    order by r.id limit edge_limit+1
  ) edges;
  return jsonb_build_object('version','brain-graph-v1','nodes',node_json,'edges',edge_json,
    'meta',jsonb_build_object('root',root_id,'depth',hops,'generatedAt',at_time,
      'nodesTruncated',nodes_cut,'edgesTruncated',edges_cut,
      'nextCursor',case when root_id is null and nodes_cut then selected[cardinality(selected)] else null end));
end $$;

revoke all on function public.brain_edge_state_v1(public.relationships,timestamptz) from public,anon;
revoke all on function public.brain_in_scope_v1(uuid,uuid,timestamptz) from public,anon;
revoke all on function public.brain_candidates_v1(uuid[],jsonb,timestamptz) from public,anon;
revoke all on function public.query_brain_graph_v1(jsonb) from public,anon;
grant execute on function public.brain_edge_state_v1(public.relationships,timestamptz) to authenticated;
grant execute on function public.brain_in_scope_v1(uuid,uuid,timestamptz) to authenticated;
grant execute on function public.brain_candidates_v1(uuid[],jsonb,timestamptz) to authenticated;
grant execute on function public.query_brain_graph_v1(jsonb) to authenticated;
