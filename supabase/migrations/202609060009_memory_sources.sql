-- Incremental Phase 1 provenance; does not rewrite memory content or embeddings.
begin;
create table public.memory_sources (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 memory_id uuid not null, source_message_id uuid,
 kind text not null check(kind in ('conversation','manual','seed','revision','legacy_unknown','reflection')),
 operation text not null check(operation in ('create','edit','backfill')),
 quote text, reference text not null, content_snapshot text not null, summary_snapshot text not null,
 unique(user_id,id), foreign key(user_id,memory_id) references public.memories(user_id,id),
 foreign key(user_id,source_message_id) references public.messages(user_id,id)
);
alter table public.memory_sources enable row level security;
create policy own_memory_sources on public.memory_sources for select to authenticated using(user_id=(select auth.uid()));
revoke all on public.memory_sources from anon,authenticated;
grant select on public.memory_sources to authenticated;
create index memory_sources_history on public.memory_sources(user_id,memory_id,created_at);
create function public.write_memory_source_v1(m public.memories, op text) returns void
 language plpgsql security definer set search_path='' as $$
declare msg public.messages; source_kind text; source_quote text; source_ref text; source_id uuid;
begin
 if op='backfill' and exists(select 1 from public.memory_sources where memory_id=m.id and user_id=m.user_id) then return; end if;
 select * into msg from public.messages where id=m.source_message_id and user_id=m.user_id and role='user';
 if op='edit' then
  source_kind='revision'; source_quote=m.content; source_ref='Recorded memory revision; inspect version history and original evidence';
 elsif msg.id is not null then
  source_kind='conversation'; source_id=msg.id; source_quote=m.metadata->>'evidence_quote';
  if source_quote is null or length(btrim(source_quote))=0 or strpos(msg.content,source_quote)=0 then source_quote=msg.content; end if;
  source_ref='message:' || msg.id::text;
 elsif m.metadata->>'seed'='true' then
  source_kind='seed'; source_quote=m.content; source_ref=coalesce(m.metadata->>'source','Seed source unspecified');
 elsif m.metadata->>'origin'='reflection' then
  source_kind='reflection'; source_quote=m.content; source_ref='reflection_proposal:' || coalesce(m.metadata->>'reflection_proposal_id','unspecified');
 elsif op='create' and m.metadata->>'origin'='manual' then
  source_kind='manual'; source_quote=m.content; source_ref='Authenticated manual memory submission';
 else
  source_kind='legacy_unknown'; source_quote=null; source_ref='Original source unavailable; retained snapshot is not source evidence';
 end if;
 insert into public.memory_sources(user_id,memory_id,source_message_id,kind,operation,quote,reference,content_snapshot,summary_snapshot)
 values(m.user_id,m.id,source_id,source_kind,op,source_quote,source_ref,m.content,m.summary);
end; $$;
revoke all on function public.write_memory_source_v1(public.memories,text) from public,anon,authenticated;
create function public.capture_memory_source_v1() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then perform public.write_memory_source_v1(new,'create');
 elsif new.content is distinct from old.content or new.summary is distinct from old.summary then perform public.write_memory_source_v1(new,'edit'); end if;
 return new;
end; $$;
revoke all on function public.capture_memory_source_v1() from public,anon,authenticated;
create trigger memory_source_capture after insert or update on public.memories for each row execute function public.capture_memory_source_v1();
select public.write_memory_source_v1(m,'backfill') from public.memories m;
-- New supporting/contradicting quotes must be genuine; existing records stay intact.
revoke update,delete on public.memory_evidence from authenticated;
create function public.validate_memory_evidence_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.messages where id=new.source_message_id and user_id=new.user_id and role='user' and strpos(content,new.quote)>0) then raise exception 'Evidence must quote an owned user message'; end if;
 return new;
end; $$;
create trigger validate_memory_evidence before insert on public.memory_evidence for each row execute function public.validate_memory_evidence_v1();
notify pgrst,'reload schema';
commit;
