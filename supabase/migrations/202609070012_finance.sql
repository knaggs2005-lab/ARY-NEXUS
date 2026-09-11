-- Additive statement ledger. Existing memory, actions, ROI and batch RPCs are unchanged.
begin;
create table public.finance_snapshots (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.users(id),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 import_key text not null check(length(btrim(import_key)) between 1 and 120),
 account_key text not null check(length(btrim(account_key)) between 1 and 120),
 parent_id uuid,as_of timestamptz not null check(isfinite(as_of)),observed_at timestamptz not null check(isfinite(observed_at) and observed_at>=as_of),
 source_label text not null check(length(btrim(source_label)) between 1 and 300),
 source_reference text not null check(length(btrim(source_reference)) between 1 and 1000),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 unique(user_id,id),unique(user_id,import_key),unique(user_id,account_key,as_of,id),
 foreign key(user_id,account_key,as_of,parent_id) references public.finance_snapshots(user_id,account_key,as_of,id),
 check(parent_id is distinct from id)
);
create unique index finance_snapshot_root on public.finance_snapshots(user_id,account_key,as_of) where parent_id is null;
create unique index finance_snapshot_revision on public.finance_snapshots(user_id,parent_id) where parent_id is not null;
create index finance_snapshot_time on public.finance_snapshots(user_id,as_of desc,observed_at);
create function public.validate_finance_snapshot_v1() returns trigger language plpgsql set search_path='' as $$
declare linked text; item jsonb; previous public.finance_snapshots;
begin
 if tg_op <> 'INSERT' then raise exception 'Financial snapshots are append-only'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,0));
 if new.observed_at>clock_timestamp() then raise exception 'Future financial observation'; end if;
 if new.payload->'account'->>'kind' is null or new.payload->'account'->>'currency' is null or new.payload->'account'->>'kind' not in ('cash','investment','asset','credit','loan','liability') or new.payload->'account'->>'currency' not in ('USD','EUR','GBP','CAD','AUD','CHF','JPY') or new.payload->'account'->>'name' is null then raise exception 'Invalid financial account'; end if;
 if jsonb_typeof(new.payload->'transactions') is distinct from 'array' or jsonb_typeof(new.payload->'bills') is distinct from 'array' or jsonb_typeof(new.payload->'holdings') is distinct from 'array' or jsonb_typeof(new.payload->'entity_ids') is distinct from 'array' or jsonb_typeof(new.payload->'goal_ids') is distinct from 'array' then raise exception 'Invalid financial collections'; end if;
 if jsonb_array_length(new.payload->'transactions')>200 or jsonb_array_length(new.payload->'bills')>50 or jsonb_array_length(new.payload->'holdings')>100 then raise exception 'Financial statement too large'; end if;
 if new.payload->'balance_minor' is null or (new.payload->'balance_minor'<>'null'::jsonb and (jsonb_typeof(new.payload->'balance_minor')<>'number' or (new.payload->>'balance_minor')::numeric<>trunc((new.payload->>'balance_minor')::numeric) or abs((new.payload->>'balance_minor')::numeric)>1e12)) then raise exception 'Invalid minor-unit balance'; end if;
 if new.payload->'account'->>'kind' in ('credit','loan','liability') and (new.payload->>'balance_minor')::numeric<0 then raise exception 'Debt is a nonnegative amount owed'; end if;
 for item in select value from jsonb_array_elements(new.payload->'transactions') loop
  if item->>'source_id' is null or item->>'kind' is null or item->>'kind' not in ('income','expense','refund','transfer','adjustment','unclassified') or item->>'status' is null or item->>'status' not in ('posted','pending') or item->>'at' is null or not isfinite((item->>'at')::timestamptz) or (item->>'at')::timestamptz>new.as_of then raise exception 'Invalid source transaction'; end if;
 end loop;
 for item in select value from jsonb_array_elements(new.payload->'transactions') union all select value from jsonb_array_elements(new.payload->'bills') loop
  if jsonb_typeof(item->'amount_minor') is distinct from 'number' or (item->>'amount_minor')::numeric<>trunc((item->>'amount_minor')::numeric) or (item->>'amount_minor')::numeric not between 0 and 1e12 then raise exception 'Invalid minor-unit amount'; end if;
 end loop;
 if (select count(*)<>count(distinct value->>'source_id') from jsonb_array_elements(new.payload->'transactions')) or (select count(*)<>count(distinct value->>'source_id') from jsonb_array_elements(new.payload->'bills')) or (select count(*)<>count(distinct value->>'source_id') from jsonb_array_elements(new.payload->'holdings')) then raise exception 'Duplicate or missing source record ID'; end if;
 select * into previous from public.finance_snapshots where user_id=new.user_id and account_key=new.account_key limit 1;
 if found and (previous.payload->'account'->>'currency'<>new.payload->'account'->>'currency' or previous.payload->'account'->>'kind'<>new.payload->'account'->>'kind') then raise exception 'Account identity changed'; end if;
 if new.parent_id is not null and exists(select 1 from public.finance_snapshots where user_id=new.user_id and id=new.parent_id and observed_at>new.observed_at) then raise exception 'Correction observation predates parent'; end if;
 for linked in select value from jsonb_array_elements_text(new.payload->'entity_ids') union select value->>'entity_id' from jsonb_array_elements(new.payload->'transactions') where value->>'entity_id' is not null loop
  if not exists(select 1 from public.entities where user_id=new.user_id and id=linked::uuid) then raise exception 'Invalid finance entity'; end if;
 end loop;
 for linked in select value from jsonb_array_elements_text(new.payload->'goal_ids') union select value->>'goal_id' from jsonb_array_elements(new.payload->'transactions') where value->>'goal_id' is not null loop
  if not exists(select 1 from public.goals where user_id=new.user_id and id=linked::uuid) then raise exception 'Invalid finance goal'; end if;
 end loop;
 return new;
end $$;
create trigger finance_snapshot_immutable before insert or update or delete on public.finance_snapshots for each row execute function public.validate_finance_snapshot_v1();
alter table public.finance_snapshots enable row level security;
create policy finance_own_read on public.finance_snapshots for select to authenticated using(user_id=(select auth.uid()));
create policy finance_own_insert on public.finance_snapshots for insert to authenticated with check(user_id=(select auth.uid()));
revoke all on public.finance_snapshots from anon,authenticated;
grant select,insert on public.finance_snapshots to authenticated;
comment on table public.finance_snapshots is 'Immutable source-attributed account statements, integer currency minor units. Corrections append revisions; no financial execution.';
commit;
