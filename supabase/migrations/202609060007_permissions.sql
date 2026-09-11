begin;
-- Translate legacy permissions without discarding historical action rows.
alter table public.actions add column if not exists approval_required boolean not null default false;
alter table public.actions add column if not exists workspace text not null default 'ary-nexus';
alter table public.actions add column if not exists product_entity_ids uuid[] not null default '{}';
do $$ declare c record; begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='actions' and column_name='permission_level' and data_type='text') then
    for c in select conname from pg_constraint where conrelid='public.actions'::regclass and contype='c' and (pg_get_constraintdef(oid) like '%permission_level%' or pg_get_constraintdef(oid) like '%status%') loop
      execute format('alter table public.actions drop constraint %I',c.conname);
    end loop;
    update public.actions set approval_required=(permission_level='approval_required'),metadata=metadata||jsonb_build_object('legacy_permission_level',permission_level);
    alter table public.actions alter column permission_level type smallint using (case permission_level when 'forbidden' then 0 when 'read' then 1 when 'approval_required' then 4 else 5 end);
    alter table public.actions add constraint actions_permission_range check(permission_level between 0 and 5);
    alter table public.actions add constraint actions_status_v2 check(status in ('requested','approval_required','succeeded','failed','blocked'));
    alter table public.actions add constraint actions_no_access check(permission_level<>0 or status='blocked');
  end if;
end $$;
create table public.permission_policies (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  scope_key text not null, parent_id uuid, enabled boolean not null default true,
  tool text,action_type text,workspace text,product_entity_id uuid,subject_user_id uuid,
  level smallint not null check(level between 0 and 5),reason text not null check(length(trim(reason)) between 1 and 1000),
  unique(user_id,id),unique(user_id,id,scope_key),
  foreign key(user_id,parent_id,scope_key) references public.permission_policies(user_id,id,scope_key),
  foreign key(user_id,product_entity_id) references public.entities(user_id,id),
  check(subject_user_id is null or subject_user_id=user_id),check(workspace is null or workspace='ary-nexus')
);
create unique index permission_initial_scope on public.permission_policies(user_id,scope_key) where parent_id is null;
create unique index permission_successor on public.permission_policies(user_id,parent_id) where parent_id is not null;
create index permission_owner on public.permission_policies(user_id,created_at);
create table public.action_approvals (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  action_id uuid not null,decision text not null check(decision in ('approved','rejected')),
  reason text not null check(length(trim(reason)) between 1 and 1000),fingerprint text not null,policy_hash text not null,
  expires_at timestamptz not null,consumed_at timestamptz,
  unique(user_id,action_id),foreign key(user_id,action_id) references public.actions(user_id,id),
  check(expires_at>created_at and expires_at<=created_at+interval '10 minutes 5 seconds')
);
create index approval_owner on public.action_approvals(user_id,created_at);
alter table public.permission_policies enable row level security;
alter table public.action_approvals enable row level security;
create policy tenant_read on public.permission_policies for select to authenticated using(user_id=(select auth.uid()));
create policy tenant_insert on public.permission_policies for insert to authenticated with check(user_id=(select auth.uid()));
create policy tenant_read on public.action_approvals for select to authenticated using(user_id=(select auth.uid()));
create policy tenant_insert on public.action_approvals for insert to authenticated with check(user_id=(select auth.uid()) and consumed_at is null);
grant select,insert on public.permission_policies,public.action_approvals to authenticated;
revoke all on public.permission_policies,public.action_approvals from anon;
revoke update,delete on public.permission_policies,public.action_approvals from authenticated;
revoke delete on public.actions from authenticated;
create function public.validate_action_approval_v1() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare attempt public.actions;
begin
  select * into attempt from public.actions where id=new.action_id and user_id=new.user_id;
  if not found or attempt.status<>'approval_required' or new.fingerprint<>attempt.metadata->>'fingerprint' or new.policy_hash<>attempt.metadata->>'policy_hash' then raise exception 'Approval must match a pending action';end if;
  return new;
end $$;
create trigger validate_action_approval before insert on public.action_approvals for each row execute function public.validate_action_approval_v1();
create function public.consume_action_approval_v1(p_id uuid,p_fingerprint text,p_policy_hash text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.action_approvals set consumed_at=clock_timestamp(),updated_at=clock_timestamp()
  where id=p_id and user_id=auth.uid() and decision='approved' and consumed_at is null and expires_at>clock_timestamp() and fingerprint=p_fingerprint and policy_hash=p_policy_hash;
  return found;
end $$;
revoke all on function public.consume_action_approval_v1(uuid,text,text) from public,anon;
grant execute on function public.consume_action_approval_v1(uuid,text,text) to authenticated;
create function public.protect_action_audit_v1() returns trigger language plpgsql as $$
begin
  if (to_jsonb(new)-array['status','output','error','updated_at']) is distinct from (to_jsonb(old)-array['status','output','error','updated_at']) or old.status<>'requested' or new.status not in ('succeeded','failed') then raise exception 'Action audit is immutable'; end if;
  return new;
end $$;
create trigger protect_action_audit before update on public.actions for each row execute function public.protect_action_audit_v1();
commit;
