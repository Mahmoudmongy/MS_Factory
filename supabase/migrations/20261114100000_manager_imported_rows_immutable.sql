-- Mark records sourced from Manager.io and prevent authenticated clients from
-- inserting, editing, or deleting those historical rows. New operational rows
-- remain writable and default to manager_imported = false.

alter table public.customers add column if not exists manager_imported boolean not null default false;
alter table public.suppliers add column if not exists manager_imported boolean not null default false;
alter table public.products add column if not exists manager_imported boolean not null default false;
alter table public.inventory_location_balances add column if not exists manager_imported boolean not null default false;
alter table public.invoices add column if not exists manager_imported boolean not null default false;
alter table public.invoice_items add column if not exists manager_imported boolean not null default false;
alter table public.returns add column if not exists manager_imported boolean not null default false;
alter table public.return_items add column if not exists manager_imported boolean not null default false;
alter table public.vouchers add column if not exists manager_imported boolean not null default false;
alter table public.production_orders add column if not exists manager_imported boolean not null default false;

do $$
begin
 if to_regclass('manager_import.source_records') is not null then
  execute $q$update public.customers c set manager_imported=true from manager_import.source_records s where s.record_type='customers' and s.manager_key=c.external_id and s.user_id=c.user_id$q$;
  execute $q$update public.suppliers c set manager_imported=true from manager_import.source_records s where s.record_type='suppliers' and s.manager_key=c.external_id and s.user_id=c.user_id$q$;
  execute $q$update public.products c set manager_imported=true from manager_import.source_records s where s.record_type in ('inventory_items','inventory_kits') and s.manager_key=c.external_id and s.user_id=c.user_id$q$;
  execute $q$update public.invoices c set manager_imported=true from manager_import.source_records s where s.record_type in ('sales_invoices','purchase_invoices') and s.manager_key=c.external_id and s.user_id=c.user_id$q$;
  execute $q$update public.returns c set manager_imported=true from manager_import.source_records s where s.record_type in ('credit_notes','debit_notes') and s.manager_key=c.external_id and s.user_id=c.user_id$q$;
  execute $q$update public.vouchers c set manager_imported=true from manager_import.source_records s where s.record_type in ('receipts','payments') and s.manager_key=c.external_id and s.user_id=c.user_id$q$;
  execute $q$update public.production_orders c set manager_imported=true from manager_import.source_records s where s.record_type='production_orders' and s.manager_key=c.external_id and s.user_id=c.user_id$q$;
 else
  -- On a clean installation the import staging schema may not exist yet.
  -- External IDs are only marked as historical when already populated.
  update public.customers set manager_imported=true where external_id is not null;
  update public.suppliers set manager_imported=true where external_id is not null;
  update public.products set manager_imported=true where external_id is not null;
  update public.invoices set manager_imported=true where external_id is not null;
  update public.returns set manager_imported=true where external_id is not null;
  update public.vouchers set manager_imported=true where external_id is not null;
  update public.production_orders set manager_imported=true where external_id is not null;
 end if;
end $$;

update public.inventory_location_balances b set manager_imported=true
from public.products p
where p.id=b.product_id and p.user_id=b.user_id and p.manager_imported=true;
update public.invoice_items c set manager_imported=true
from public.invoices i
where i.id=c.invoice_id and i.user_id=c.user_id and i.manager_imported=true;
update public.return_items c set manager_imported=true
from public.returns r
where r.id=c.return_id and r.user_id=c.user_id and r.manager_imported=true;
do $$
declare t text;
begin
 foreach t in array array['customers','suppliers','products','inventory_location_balances','invoices','invoice_items','returns','return_items','vouchers','production_orders'] loop
  execute format('drop policy if exists manager_imported_no_insert on public.%I',t);
  execute format('drop policy if exists manager_imported_no_update on public.%I',t);
  execute format('drop policy if exists manager_imported_no_delete on public.%I',t);
  execute format('create policy manager_imported_no_insert on public.%I as restrictive for insert to authenticated with check (not manager_imported)',t);
  execute format('create policy manager_imported_no_update on public.%I as restrictive for update to authenticated using (not manager_imported) with check (not manager_imported)',t);
  execute format('create policy manager_imported_no_delete on public.%I as restrictive for delete to authenticated using (not manager_imported)',t);
 end loop;
end $$;

comment on column public.customers.manager_imported is 'True for immutable historical rows imported from Manager.io.';
comment on column public.suppliers.manager_imported is 'True for immutable historical rows imported from Manager.io.';
comment on column public.products.manager_imported is 'True for immutable historical rows imported from Manager.io.';
comment on column public.inventory_location_balances.manager_imported is 'True for immutable historical balances imported from Manager.io.';
comment on column public.invoices.manager_imported is 'True for immutable historical documents imported from Manager.io.';
comment on column public.invoice_items.manager_imported is 'True for immutable historical invoice lines imported from Manager.io.';
comment on column public.returns.manager_imported is 'True for immutable historical credit/debit notes imported from Manager.io.';
comment on column public.return_items.manager_imported is 'True for immutable historical return lines imported from Manager.io.';
comment on column public.vouchers.manager_imported is 'True for immutable historical receipts/payments imported from Manager.io.';
comment on column public.production_orders.manager_imported is 'True for immutable historical production orders imported from Manager.io.';
