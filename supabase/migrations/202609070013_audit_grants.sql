-- Supabase default table privileges may pre-grant ALL to authenticated.
-- GRANT SELECT/INSERT alone in 003/005 did not remove those inherited defaults.
-- Restore the intended append-only telemetry and non-deletable review history.
begin;
revoke update, delete on public.model_calls from authenticated;
revoke delete on public.reflection_jobs, public.reflection_proposals from authenticated;
notify pgrst, 'reload schema';
commit;
