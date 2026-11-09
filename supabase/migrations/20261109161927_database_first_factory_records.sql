-- Database-first record storage. Each business record is independently persisted.
create table if not exists public.factory_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  record_type text not null,
  record_id text not null,
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  deleted_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint factory_records_owner_type_id_key unique (user_id, record_type, record_id)
);
create index if not exists factory_records_owner_type_idx
  on public.factory_records(user_id, record_type) where deleted_at is null;
alter table public.factory_records enable row level security;
alter table public.factory_records force row level security;

drop policy if exists factory_records_read on public.factory_records;
drop policy if exists factory_records_insert on public.factory_records;
drop policy if exists factory_records_update on public.factory_records;
drop policy if exists factory_records_delete on public.factory_records;

create policy factory_records_read on public.factory_records for select
using (private.can_access_factory_owner(user_id,
  case record_type
    when 'partners' then 'customers'
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
  end, false));

create policy factory_records_insert on public.factory_records for insert
with check (private.can_access_factory_owner(user_id,
  case record_type
    when 'partners' then 'customers'
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
  end, true));

create policy factory_records_update on public.factory_records for update
using (private.can_access_factory_owner(user_id,
  case record_type
    when 'partners' then 'customers'
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
  end, true))
with check (private.can_access_factory_owner(user_id,
  case record_type
    when 'partners' then 'customers'
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
  end, true));

create policy factory_records_delete on public.factory_records for delete
using (private.can_access_factory_owner(user_id,
  case record_type
    when 'partners' then 'customers'
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
  end, true));

do $$
begin
  alter publication supabase_realtime add table public.factory_records;
exception when duplicate_object then null;
end $$;
