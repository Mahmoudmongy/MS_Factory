create or replace function private.can_access_factory_record(
  p_owner_id uuid, p_record_type text, p_write boolean
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_record_type = 'partners' then
      private.can_access_factory_owner(p_owner_id, 'customers', p_write)
      or private.can_access_factory_owner(p_owner_id, 'suppliers', p_write)
    else private.can_access_factory_owner(
      p_owner_id,
      case p_record_type
        when 'customers' then 'customers'
        when 'suppliers' then 'suppliers'
        when 'items' then 'inventory'
        when 'wh' then 'inventory'
        when 'codes' then 'inventory'
        when 'mv' then 'inventory'
        when 'docs' then 'invoices'
        when 'sret' then 'invoices'
        when 'pret' then 'invoices'
        when 'vch' then 'invoices'
        when 'po' then 'production'
        when 'emp' then 'employees'
        when 'payroll' then 'payroll'
        else null
      end,
      p_write
    )
  end;
$$;
revoke all on function private.can_access_factory_record(uuid,text,boolean) from public;
grant execute on function private.can_access_factory_record(uuid,text,boolean) to authenticated;

drop policy if exists factory_records_read on public.factory_records;
drop policy if exists factory_records_insert on public.factory_records;
drop policy if exists factory_records_update on public.factory_records;
drop policy if exists factory_records_delete on public.factory_records;

create policy factory_records_read on public.factory_records for select
using (private.can_access_factory_record(user_id, record_type, false));
create policy factory_records_insert on public.factory_records for insert
with check (private.can_access_factory_record(user_id, record_type, true));
create policy factory_records_update on public.factory_records for update
using (private.can_access_factory_record(user_id, record_type, true))
with check (private.can_access_factory_record(user_id, record_type, true));
create policy factory_records_delete on public.factory_records for delete
using (private.can_access_factory_record(user_id, record_type, true));
