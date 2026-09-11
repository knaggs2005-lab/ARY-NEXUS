-- Additive, rerunnable extension of the existing immutable cost ledger.
-- Legacy estimated_compute_cost_usd remains the total MODEL estimate override.
-- New fields record ADDITIONAL non-model infrastructure/tool amounts; never a second model bill.
begin;
alter table public.roi_cost_entries
 add column if not exists additional_compute_cost_usd double precision
 check (additional_compute_cost_usd between 0 and 1e12),
 add column if not exists tool_cost_usd double precision
 check (tool_cost_usd between 0 and 1e12);
comment on column public.roi_cost_entries.additional_compute_cost_usd is 'Additional attributed non-model compute cost in USD; NULL means unassessed. Does not replace model telemetry.';
comment on column public.roi_cost_entries.tool_cost_usd is 'Additional attributed tool cost in USD; NULL means unassessed. Exclude costs already represented by model or compute amounts.';
notify pgrst, 'reload schema';
commit;
