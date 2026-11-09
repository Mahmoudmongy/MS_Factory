create or replace function private.can_access_factory_record(
  p_owner_id uuid, p_record_type text, p_write boolean
) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_record_type = 'partners' then
      private.can_access_factory_owner(p_owner_id, 'customers', p_write)
      or private.can_access_factory_owner(p_owner_id, 'suppliers', p_write)
      or (p_write is false and private.can_access_factory_owner(p_owner_id, 'invoices', false))
    when p_record_type in ('items','codes','mv') then
      private.can_access_factory_owner(p_owner_id, 'inventory', p_write)
      or private.can_access_factory_owner(p_owner_id, 'invoices', p_write)
      or private.can_access_factory_owner(p_owner_id, 'production', p_write)
    when p_record_type = 'wh' then
      private.can_access_factory_owner(p_owner_id, 'inventory', p_write)
      or (p_write is false and private.can_access_factory_owner(p_owner_id, 'invoices', false))
      or (p_write is false and private.can_access_factory_owner(p_owner_id, 'production', false))
    when p_record_type = 'wo' then
      private.can_access_factory_owner(p_owner_id, 'inventory', p_write)
      or private.can_access_factory_owner(p_owner_id, 'production', p_write)
    when p_record_type = 'L' then
      private.can_access_factory_owner(p_owner_id, 'settings', p_write)
      or private.can_access_factory_owner(p_owner_id, 'invoices', p_write)
      or private.can_access_factory_owner(p_owner_id, 'inventory', p_write)
      or private.can_access_factory_owner(p_owner_id, 'production', p_write)
      or (p_write is false and private.can_access_factory_owner(p_owner_id, 'reports', false))
    when p_record_type in ('accts','je') then
      private.can_access_factory_owner(p_owner_id, 'settings', p_write)
      or (p_write is false and private.can_access_factory_owner(p_owner_id, 'reports', false))
    else private.can_access_factory_owner(
      p_owner_id,
      case p_record_type
        when 'customers' then 'customers'
        when 'suppliers' then 'suppliers'
        when 'docs' then 'invoices'
        when 'sret' then 'invoices'
        when 'pret' then 'invoices'
        when 'vch' then 'invoices'
        when 'po' then 'production'
        when 'payroll' then 'payroll'
        else null
      end,
      p_write
    )
  end;
$$;
