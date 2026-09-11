-- Apply once after 007. USD accounting evidence only; no payment capabilities.
begin;
alter table public.model_calls add column action_id uuid;
alter table public.model_calls add constraint model_calls_action_owner_fk
 foreign key(user_id,action_id) references public.actions(user_id,id);
create index model_calls_action_idx on public.model_calls(user_id,action_id);

create table public.roi_cost_entries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 action_id uuid not null, parent_id uuid,
 estimated_compute_cost_usd double precision check(estimated_compute_cost_usd between 0 and 1e12),
 actual_model_cost_usd double precision check(actual_model_cost_usd between 0 and 1e12),
 confidence double precision not null check(confidence between 0 and 1),
 attribution_notes text not null check(length(btrim(attribution_notes)) between 1 and 4000),
 evidence text not null default '' check(length(evidence)<=2000),
 check(actual_model_cost_usd is null or length(btrim(evidence))>0),
 unique(user_id,id), unique(user_id,action_id,id),
 foreign key(user_id,action_id) references public.actions(user_id,id),
 foreign key(user_id,action_id,parent_id) references public.roi_cost_entries(user_id,action_id,id),
 check(parent_id is distinct from id)
);
create unique index roi_cost_root on public.roi_cost_entries(user_id,action_id) where parent_id is null;
create unique index roi_cost_revision on public.roi_cost_entries(user_id,parent_id) where parent_id is not null;
create table public.roi_outcome_entries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 outcome_id uuid not null, parent_id uuid, effective_at timestamptz not null check(isfinite(effective_at)),
 time_saved_minutes double precision check(time_saved_minutes between 0 and 1e12),
 revenue_influenced_usd double precision check(revenue_influenced_usd between 0 and 1e12),
 expense_avoided_usd double precision check(expense_avoided_usd between 0 and 1e12),
 confidence double precision not null check(confidence between 0 and 1),
 status text not null check(status in ('pending','estimated','confirmed','rejected')),
 attribution_notes text not null check(length(btrim(attribution_notes)) between 1 and 4000),
 evidence text not null default '' check(length(evidence)<=2000),
 check(status <> 'confirmed' or (confidence=1 and length(btrim(evidence))>0)),
 unique(user_id,id), unique(user_id,outcome_id,id),
 foreign key(user_id,outcome_id) references public.outcomes(user_id,id),
 foreign key(user_id,outcome_id,parent_id) references public.roi_outcome_entries(user_id,outcome_id,id),
 check(parent_id is distinct from id)
);
create unique index roi_outcome_root on public.roi_outcome_entries(user_id,outcome_id) where parent_id is null;
create unique index roi_outcome_revision on public.roi_outcome_entries(user_id,parent_id) where parent_id is not null;
create index roi_outcome_month on public.roi_outcome_entries(user_id,effective_at);
create function public.validate_roi_entry_v1() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op <> 'INSERT' then raise exception 'ROI ledger is append-only; create a revision'; end if;
 if tg_table_name='roi_outcome_entries' then
  if new.status='confirmed' and exists(select 1 from public.outcomes where user_id=new.user_id and id=new.outcome_id and status='pending') then
   raise exception 'Pending outcomes cannot have confirmed impact';
  end if;
  if new.parent_id is not null and not exists(select 1 from public.roi_outcome_entries where user_id=new.user_id and id=new.parent_id and outcome_id=new.outcome_id) then raise exception 'Invalid ROI parent'; end if;
 else
  if new.parent_id is not null and not exists(select 1 from public.roi_cost_entries where user_id=new.user_id and id=new.parent_id and action_id=new.action_id) then raise exception 'Invalid ROI parent'; end if;
 end if;
 return new;
end; $$;
create trigger roi_cost_immutable before insert or update or delete on public.roi_cost_entries for each row execute function public.validate_roi_entry_v1();
create trigger roi_outcome_immutable before insert or update or delete on public.roi_outcome_entries for each row execute function public.validate_roi_entry_v1();
alter table public.roi_cost_entries enable row level security;
alter table public.roi_outcome_entries enable row level security;
create policy own_roi_cost_read on public.roi_cost_entries for select to authenticated using(user_id=(select auth.uid()));
create policy own_roi_cost_insert on public.roi_cost_entries for insert to authenticated with check(user_id=(select auth.uid()));
create policy own_roi_outcome_read on public.roi_outcome_entries for select to authenticated using(user_id=(select auth.uid()));
create policy own_roi_outcome_insert on public.roi_outcome_entries for insert to authenticated with check(user_id=(select auth.uid()));
revoke all on public.roi_cost_entries,public.roi_outcome_entries from anon,authenticated;
grant select,insert on public.roi_cost_entries,public.roi_outcome_entries to authenticated;
commit;
