-- Improve the audit policy plan and add indexes for existing foreign keys.
drop policy if exists factory_audit_log_admin_read on public.factory_audit_log;
create policy factory_audit_log_admin_read
  on public.factory_audit_log
  for select to authenticated
  using (
    factory_user_id = (select auth.uid())
    and exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and coalesce(p.is_admin, false) = true
    )
  );
create index if not exists factory_sync_baselines_published_by_idx
  on public.factory_sync_baselines(published_by);
create index if not exists source_effects_updated_by_idx
  on public.source_effects(updated_by) where updated_by is not null;
