-- Retire the legacy snapshot/normalized-table write path.
-- The live application now reads and writes only public.factory_records.
-- Keeping authenticated access here allowed an older open tab/device to repopulate demo data.
begin;
revoke all privileges on table
  public.factory_state,
  public.customers,
  public.suppliers,
  public.products,
  public.invoices,
  public.invoice_items,
  public.inventory,
  public.production_orders,
  public.returns,
  public.vouchers
from public, anon, authenticated;

delete from public.invoice_items;
delete from public.invoices;
delete from public.returns;
delete from public.vouchers;
delete from public.production_orders;
delete from public.inventory;
delete from public.customers;
delete from public.suppliers;
delete from public.products;
delete from public.factory_state;
commit;
