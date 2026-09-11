-- Additive and rerunnable. Existing actions have no execution_key and are unaffected.
begin;
create unique index if not exists actions_execution_key
  on public.actions (user_id, (metadata->>'execution_key'))
  where metadata->>'execution_key' is not null;
create or replace function public.action_execution_ready_v1() returns boolean
language sql stable security invoker set search_path=public,pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from pg_catalog.pg_index
    where indexrelid=to_regclass('public.actions_execution_key') and indisunique and indisvalid
  );
$$;
revoke all on function public.action_execution_ready_v1() from public,anon;
grant execute on function public.action_execution_ready_v1() to authenticated;
commit;
