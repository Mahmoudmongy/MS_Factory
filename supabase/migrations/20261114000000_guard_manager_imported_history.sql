-- Protect Manager.io-imported historical records from accidental edits/deletes.
-- App-side guards are backed by this database trigger so API clients cannot bypass them.
create or replace function public.guard_manager_imported_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.payload->>'manager_read_only' = 'true'
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'MANAGER_IMPORTED_RECORD_READ_ONLY: imported historical records cannot be changed or deleted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.guard_manager_imported_history() from public, anon, authenticated;

drop trigger if exists trg_guard_manager_imported_history on public.factory_records;
create trigger trg_guard_manager_imported_history
before update or delete on public.factory_records
for each row
execute function public.guard_manager_imported_history();
