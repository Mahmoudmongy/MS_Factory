-- Cover updated_by foreign keys so user deletion/SET NULL does not scan every business table.
CREATE INDEX IF NOT EXISTS idx_customers_updated_by ON public.customers(updated_by);
CREATE INDEX IF NOT EXISTS idx_factory_accounting_state_updated_by ON public.factory_accounting_state(updated_by);
CREATE INDEX IF NOT EXISTS idx_production_orders_updated_by ON public.production_orders(updated_by);
CREATE INDEX IF NOT EXISTS idx_products_updated_by ON public.products(updated_by);
CREATE INDEX IF NOT EXISTS idx_returns_updated_by ON public.returns(updated_by);
CREATE INDEX IF NOT EXISTS idx_suppliers_updated_by ON public.suppliers(updated_by);
CREATE INDEX IF NOT EXISTS idx_vouchers_updated_by ON public.vouchers(updated_by);
