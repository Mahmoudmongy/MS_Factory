-- Prevent destructive physical deletes and block soft-deleting records that still have live dependants.
-- Normal application deletes are versioned tombstones through apply_factory_record_batch.
create or replace function private.guard_factory_record_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referenced boolean := false;
begin
  if old.deleted_at is not null or new.deleted_at is null then
    return new;
  end if;

  if old.record_type = 'docs' then
    select exists (
      select 1 from public.factory_records r
      where r.user_id = old.user_id and r.record_type = 'vch'
        and r.deleted_at is null and coalesce(r.payload->'alloc','{}'::jsonb) ? old.record_id
    ) into v_referenced;
    if v_referenced then
      raise exception 'FACTORY_RECORD_DELETE_BLOCKED: reverse or remove linked vouchers before deleting this invoice';
    end if;

  elsif old.record_type = 'po' then
    select exists (
      select 1 from public.factory_records r
      where r.user_id = old.user_id and r.deleted_at is null
        and ((r.record_type = 'docs' and r.payload->>'dest' = old.record_id)
          or (r.record_type = 'wo' and r.payload->>'po' = old.record_id))
    ) into v_referenced;
    if v_referenced then
      raise exception 'FACTORY_RECORD_DELETE_BLOCKED: linked purchase invoices or write-offs must be reversed first';
    end if;

  elsif old.record_type = 'partners' then
    select exists (
      select 1 from public.factory_records r
      where r.user_id = old.user_id and r.deleted_at is null
        and r.record_type in ('docs','vch','L') and r.payload->>'pid' = old.record_id
    ) into v_referenced;
    if v_referenced then
      raise exception 'FACTORY_RECORD_DELETE_BLOCKED: a partner referenced by documents or ledger history cannot be deleted';
    end if;

  elsif old.record_type = 'items' then
    select exists (
      select 1
      from public.factory_records r
      where r.user_id = old.user_id and r.deleted_at is null
        and (
          (r.record_type = 'mv' and r.payload->>'iid' = old.record_id)
          or (r.record_type = 'docs' and exists (
            select 1 from jsonb_array_elements(
              case when jsonb_typeof(r.payload->'lines') = 'array' then r.payload->'lines' else '[]'::jsonb end
            ) line where line->>'iid' = old.record_id
          ))
          or (r.record_type = 'po' and exists (
            select 1 from jsonb_array_elements(
              case when jsonb_typeof(r.payload->'mats') = 'array' then r.payload->'mats' else '[]'::jsonb end
            ) mat where mat->>'iid' = old.record_id
          ))
        )
    ) into v_referenced;
    if v_referenced then
      raise exception 'FACTORY_RECORD_DELETE_BLOCKED: an item with invoice, production or stock movement history cannot be deleted';
    end if;

  elsif old.record_type = 'wh' then
    select exists (
      select 1 from public.factory_records r
      where r.user_id = old.user_id and r.deleted_at is null
        and ((r.record_type = 'wh' and r.payload->>'parentId' = old.record_id)
          or (r.record_type = 'items' and r.payload->>'wh' = old.record_id)
          or (r.record_type = 'mv' and r.payload->>'wh' = old.record_id))
    ) into v_referenced;
    if v_referenced then
      raise exception 'FACTORY_RECORD_DELETE_BLOCKED: a warehouse containing child locations, items or stock history cannot be deleted';
    end if;

  elsif old.record_type = 'accts' then
    select exists (
      select 1 from public.factory_records r
      where r.user_id = old.user_id and r.record_type = 'L'
        and r.deleted_at is null and r.payload->>'a' = old.record_id
    ) into v_referenced;
    if v_referenced then
      raise exception 'FACTORY_RECORD_DELETE_BLOCKED: an account referenced by ledger entries cannot be deleted';
    end if;

  elsif old.record_type = 'je' then
    select exists (
      select 1 from public.factory_records r
      where r.user_id = old.user_id and r.record_type = 'L'
        and r.deleted_at is null and r.payload->>'rid' = old.record_id
        and r.payload->>'src' = 'je'
    ) into v_referenced;
    if v_referenced then
      raise exception 'FACTORY_RECORD_DELETE_BLOCKED: reverse the journal entry before deleting it';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_factory_record_soft_delete() from public, anon, authenticated;
drop trigger if exists factory_records_soft_delete_guard on public.factory_records;
create trigger factory_records_soft_delete_guard
before update of deleted_at on public.factory_records
for each row execute function private.guard_factory_record_soft_delete();

create or replace function private.reject_factory_record_physical_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'FACTORY_RECORD_PHYSICAL_DELETE_BLOCKED: physical deletion is disabled; use a permission-checked versioned tombstone';
end;
$$;

revoke all on function private.reject_factory_record_physical_delete() from public, anon, authenticated;
drop trigger if exists factory_records_no_physical_delete on public.factory_records;
create trigger factory_records_no_physical_delete
before delete on public.factory_records
for each row execute function private.reject_factory_record_physical_delete();
