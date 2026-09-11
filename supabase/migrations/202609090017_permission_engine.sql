-- Additive policy dimensions; existing numeric policies and append-only history remain valid.
begin;
alter table public.permission_policies add column if not exists permission_class text;
alter table public.permission_policies add column if not exists subject_agent_id uuid;
alter table public.permission_policies add column if not exists behavior text;
alter table public.permission_policies drop constraint if exists permission_class_valid;
alter table public.permission_policies add constraint permission_class_valid check (permission_class is null or permission_class in ('READ','WRITE','EXECUTE','COMMUNICATE','DELETE','PURCHASE','ADMIN','PHYSICAL_CONTROL','FINANCIAL','EXTERNAL_PUBLISH'));
alter table public.permission_policies drop constraint if exists permission_behavior_valid;
alter table public.permission_policies add constraint permission_behavior_valid check (behavior is null or (behavior = 'deny' and level = 0) or (behavior in ('always_allow','ask_every_time') and level = 5));
alter table public.permission_policies drop constraint if exists permission_agent_owner;
alter table public.permission_policies add constraint permission_agent_owner foreign key (user_id,subject_agent_id) references public.messages(user_id,id);
create or replace function public.validate_permission_agent() returns trigger language plpgsql set search_path = public as $$
begin
  if new.subject_agent_id is not null and not exists(select 1 from public.messages where id=new.subject_agent_id and user_id=new.user_id and metadata->>'agent_version'='agent-v1') then
    raise exception 'Permission agent must be an owned registered agent';
  end if;
  return new;
end $$;
drop trigger if exists permission_agent_validation on public.permission_policies;
create trigger permission_agent_validation before insert on public.permission_policies for each row execute function public.validate_permission_agent();
commit;
