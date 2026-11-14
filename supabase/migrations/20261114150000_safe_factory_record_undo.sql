-- Safe undo and hard-delete protection for database-first factory records.
-- Business changes are reverted by a compensating write, never by erasing audit history.
create or replace function public.reject_factory_record_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception 'FACTORY_RECORD_HARD_DELETE_DISABLED: use a versioned soft delete'
      using errcode = '42501';
  end if;
  return old;
end;
$$;
revoke all on function public.reject_factory_record_hard_delete() from public, anon, authenticated;
drop trigger if exists factory_records_no_hard_delete on public.factory_records;
create trigger factory_records_no_hard_delete
before delete on public.factory_records
for each row execute function public.reject_factory_record_hard_delete();
revoke delete on public.factory_records from public, anon, authenticated;

create or replace function private.undo_factory_record_change(p_audit_id bigint)
returns public.factory_records
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_audit public.factory_audit_log;
  v_latest bigint;
  v_current public.factory_records;
  v_result public.factory_records;
begin
  if v_actor is null then
    raise exception 'UNDO_AUTH_REQUIRED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.is_admin is true
      and coalesce(p.created_by, p.id) = v_actor
  ) then
    raise exception 'UNDO_ADMIN_ONLY' using errcode = '42501';
  end if;
  select * into v_audit
  from public.factory_audit_log
  where id = p_audit_id and factory_user_id = v_actor
  for update;
  if not found then
    raise exception 'UNDO_AUDIT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not private.can_access_factory_record(v_actor, v_audit.record_type, true) then
    raise exception 'UNDO_PERMISSION_DENIED' using errcode = '42501';
  end if;
  select max(id) into v_latest
  from public.factory_audit_log
  where factory_user_id = v_actor
    and record_type = v_audit.record_type
    and record_id = v_audit.record_id;
  if v_latest is distinct from p_audit_id then
    raise exception 'UNDO_NOT_LATEST: a newer change exists for this record'
      using errcode = '40001';
  end if;
  if v_audit.operation = 'INSERT' then
    select * into v_current
    from public.factory_records
    where user_id = v_actor and record_type = v_audit.record_type
      and record_id = v_audit.record_id
    for update;
    if not found or to_jsonb(v_current) is distinct from v_audit.new_row then
      raise exception 'UNDO_VERSION_CONFLICT: record changed after this audit entry'
        using errcode = '40001';
    end if;
    update public.factory_records
      set deleted_at = clock_timestamp(), version = version + 1,
          updated_at = clock_timestamp(), updated_by = v_actor
      where id = v_current.id
      returning * into v_result;
  elsif v_audit.operation = 'UPDATE' then
    select * into v_current
    from public.factory_records
    where user_id = v_actor and record_type = v_audit.record_type
      and record_id = v_audit.record_id
    for update;
    if not found or to_jsonb(v_current) is distinct from v_audit.new_row
       or v_audit.old_row is null then
      raise exception 'UNDO_VERSION_CONFLICT: record changed after this audit entry'
        using errcode = '40001';
    end if;
    update public.factory_records
      set payload = v_audit.old_row -> 'payload',
          deleted_at = nullif(v_audit.old_row ->> 'deleted_at','')::timestamptz,
          version = version + 1, updated_at = clock_timestamp(), updated_by = v_actor
      where id = v_current.id
      returning * into v_result;
  else
    raise exception 'UNDO_UNSUPPORTED_OPERATION: hard-deleted records cannot be restored through this action'
      using errcode = '22023';
  end if;
  return v_result;
end;
$$;
revoke all on function private.undo_factory_record_change(bigint) from public, anon;
grant execute on function private.undo_factory_record_change(bigint) to authenticated;
grant usage on schema private to authenticated;

create or replace function public.undo_factory_record_change(p_audit_id bigint)
returns public.factory_records
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.undo_factory_record_change(p_audit_id);
end;
$$;
revoke all on function public.undo_factory_record_change(bigint) from public, anon;
grant execute on function public.undo_factory_record_change(bigint) to authenticated;
