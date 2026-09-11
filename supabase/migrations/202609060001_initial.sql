-- Ary Nexus: tenant-owned intelligence records. Apply with Supabase migrations.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  entity_type text not null check (entity_type in ('person','company','project','product','goal','decision','task')),
  name text not null check (length(trim(name)) > 0), description text not null default '', metadata jsonb not null default '{}'::jsonb,
  unique(user_id,id)
);
create index entities_user_idx on public.entities(user_id);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  title text not null default 'New conversation', metadata jsonb not null default '{}'::jsonb,
  unique(user_id,id)
);
create index conversations_user_idx on public.conversations(user_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  conversation_id uuid not null, role text not null check (role in ('user','assistant','system')),
  content text not null, metadata jsonb not null default '{}'::jsonb,
  foreign key (user_id, conversation_id) references public.conversations(user_id,id) on delete cascade,
  unique(user_id,id)
);
create index messages_user_idx on public.messages(user_id);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  memory_type text not null check (memory_type in ('fact','preference','episodic','procedural','goal','decision')),
  content text not null check (length(trim(content)) > 0), summary text not null default '',
  importance_score double precision not null default 0.5 check (importance_score between 0 and 1),
  confidence_score double precision not null default 0.8 check (confidence_score between 0 and 1),
  last_accessed_at timestamptz, embedding extensions.vector(384), embedding_model text not null,
  archived_at timestamptz, source_message_id uuid, metadata jsonb not null default '{}'::jsonb,
  foreign key (user_id, source_message_id) references public.messages(user_id,id),
  unique(user_id,id)
);
create index memories_user_idx on public.memories(user_id);

create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  source_entity_id uuid not null, target_entity_id uuid not null,
  relationship_type text not null check (length(trim(relationship_type)) > 0),
  strength double precision not null default 1 check (strength between 0 and 1), metadata jsonb not null default '{}'::jsonb,
  check (source_entity_id <> target_entity_id),
  unique (user_id,source_entity_id,target_entity_id,relationship_type),
  foreign key (user_id,source_entity_id) references public.entities(user_id,id) on delete cascade,
  foreign key (user_id,target_entity_id) references public.entities(user_id,id) on delete cascade,
  unique(user_id,id)
);
create index relationships_user_idx on public.relationships(user_id);

create table public.memory_entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  memory_id uuid not null, entity_id uuid not null, unique(user_id,memory_id,entity_id),
  foreign key (user_id,memory_id) references public.memories(user_id,id) on delete cascade,
  foreign key (user_id,entity_id) references public.entities(user_id,id) on delete cascade,
  unique(user_id,id)
);
create index memory_entities_user_idx on public.memory_entities(user_id);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  entity_id uuid, title text not null, description text not null default '',
  status text not null default 'active' check (status in ('active','completed','paused','abandoned')),
  target_date timestamptz, progress double precision not null default 0 check (progress between 0 and 1),
  metadata jsonb not null default '{}'::jsonb,
  foreign key (user_id,entity_id) references public.entities(user_id,id),
  unique(user_id,id)
);
create index goals_user_idx on public.goals(user_id);

create table public.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  entity_id uuid, goal_id uuid, title text not null, rationale text not null,
  status text not null default 'proposed' check (status in ('proposed','accepted','superseded','rejected')),
  confidence_score double precision not null default 0.5 check (confidence_score between 0 and 1),
  decided_at timestamptz, metadata jsonb not null default '{}'::jsonb,
  foreign key (user_id,entity_id) references public.entities(user_id,id),
  foreign key (user_id,goal_id) references public.goals(user_id,id),
  unique(user_id,id)
);
create index decisions_user_idx on public.decisions(user_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  entity_id uuid, goal_id uuid, title text not null, description text not null default '',
  status text not null default 'pending' check (status in ('pending','in_progress','completed','cancelled')),
  priority integer not null default 2 check (priority between 0 and 3), due_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  foreign key (user_id,entity_id) references public.entities(user_id,id),
  foreign key (user_id,goal_id) references public.goals(user_id,id),
  unique(user_id,id)
);
create index tasks_user_idx on public.tasks(user_id);

create table public.actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  conversation_id uuid, tool_name text not null, action_type text not null,
  permission_level text not null check (permission_level in ('read','write','approval_required','forbidden')),
  status text not null check (status in ('requested','succeeded','failed','blocked')),
  input jsonb not null default '{}'::jsonb, output jsonb not null default '{}'::jsonb,
  error text, metadata jsonb not null default '{}'::jsonb,
  foreign key (user_id,conversation_id) references public.conversations(user_id,id),
  check (permission_level <> 'forbidden' or status = 'blocked'),
  check (permission_level <> 'approval_required' or status in ('requested','blocked')),
  unique(user_id,id)
);
create index actions_user_idx on public.actions(user_id);

create table public.outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  action_id uuid not null, goal_id uuid,
  status text not null check (status in ('success','failure','pending')),
  summary text not null, metrics jsonb not null default '{}'::jsonb, metadata jsonb not null default '{}'::jsonb,
  foreign key (user_id,action_id) references public.actions(user_id,id),
  foreign key (user_id,goal_id) references public.goals(user_id,id),
  unique(user_id,id)
);
create index outcomes_user_idx on public.outcomes(user_id);

create index memories_embedding_idx on public.memories using hnsw (embedding extensions.vector_cosine_ops) where archived_at is null;
create index memories_text_idx on public.memories using gin (to_tsvector('english',content || ' ' || summary));
create index messages_history_idx on public.messages(user_id,conversation_id,created_at);
create index relationships_target_idx on public.relationships(user_id,target_entity_id);
create index entities_name_idx on public.entities(user_id,lower(name));

create function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
alter table public.users enable row level security;
create policy tenant_access on public.users for all to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
grant select, insert, update, delete on public.users to authenticated;
revoke all on public.users from anon;
create trigger set_updated_at before update on public.users for each row execute function public.set_updated_at();
alter table public.entities enable row level security;
create policy tenant_access on public.entities for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.entities to authenticated;
revoke all on public.entities from anon;
create trigger set_updated_at before update on public.entities for each row execute function public.set_updated_at();
alter table public.conversations enable row level security;
create policy tenant_access on public.conversations for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.conversations to authenticated;
revoke all on public.conversations from anon;
create trigger set_updated_at before update on public.conversations for each row execute function public.set_updated_at();
alter table public.messages enable row level security;
create policy tenant_access on public.messages for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.messages to authenticated;
revoke all on public.messages from anon;
create trigger set_updated_at before update on public.messages for each row execute function public.set_updated_at();
alter table public.memories enable row level security;
create policy tenant_access on public.memories for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.memories to authenticated;
revoke all on public.memories from anon;
create trigger set_updated_at before update on public.memories for each row execute function public.set_updated_at();
alter table public.relationships enable row level security;
create policy tenant_access on public.relationships for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.relationships to authenticated;
revoke all on public.relationships from anon;
create trigger set_updated_at before update on public.relationships for each row execute function public.set_updated_at();
alter table public.memory_entities enable row level security;
create policy tenant_access on public.memory_entities for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.memory_entities to authenticated;
revoke all on public.memory_entities from anon;
create trigger set_updated_at before update on public.memory_entities for each row execute function public.set_updated_at();
alter table public.goals enable row level security;
create policy tenant_access on public.goals for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.goals to authenticated;
revoke all on public.goals from anon;
create trigger set_updated_at before update on public.goals for each row execute function public.set_updated_at();
alter table public.decisions enable row level security;
create policy tenant_access on public.decisions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.decisions to authenticated;
revoke all on public.decisions from anon;
create trigger set_updated_at before update on public.decisions for each row execute function public.set_updated_at();
alter table public.tasks enable row level security;
create policy tenant_access on public.tasks for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.tasks to authenticated;
revoke all on public.tasks from anon;
create trigger set_updated_at before update on public.tasks for each row execute function public.set_updated_at();
alter table public.actions enable row level security;
create policy tenant_access on public.actions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.actions to authenticated;
revoke all on public.actions from anon;
create trigger set_updated_at before update on public.actions for each row execute function public.set_updated_at();
alter table public.outcomes enable row level security;
create policy tenant_access on public.outcomes for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.outcomes to authenticated;
revoke all on public.outcomes from anon;
create trigger set_updated_at before update on public.outcomes for each row execute function public.set_updated_at();

-- Invoker rights preserve RLS. No caller-supplied tenant identifier.
create function public.search_memories(query_text text, query_embedding extensions.vector(384), model_id text, match_count integer default 8)
returns table (id uuid, score double precision, similarity double precision)
language sql stable security invoker set search_path = public, extensions as $$
  with candidates as (
    select m.id, m.importance_score, m.confidence_score,
      case when m.embedding_model = model_id and query_embedding is not null and m.embedding is not null
        and vector_norm(query_embedding) > 0 and vector_norm(m.embedding) > 0
        then greatest(0, 1 - (m.embedding <=> query_embedding)) else 0 end as sim,
      ts_rank_cd(to_tsvector('english',m.content || ' ' || m.summary),plainto_tsquery('english',query_text))::double precision as lexical
    from public.memories m where m.user_id = (select auth.uid()) and m.archived_at is null
  )
  select id, (0.7 * sim + 0.2 * least(1, lexical * 5) + 0.07 * importance_score + 0.03 * confidence_score)::double precision as score, sim
  from candidates where sim >= 0.2 or lexical > 0
  order by score desc, id limit greatest(1,least(match_count,50));
$$;
revoke all on function public.search_memories(text,extensions.vector,text,integer) from public, anon;
grant execute on function public.search_memories(text,extensions.vector,text,integer) to authenticated;
