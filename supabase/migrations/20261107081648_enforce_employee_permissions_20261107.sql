-- Enforce employee permissions in Postgres, not only in the browser.
-- The full factory_state contains all modules and is administrator-only.
CREATE OR REPLACE FUNCTION private.can_access_factory_owner(
  p_owner_id uuid,
  p_permission text,
  p_write boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS actor
    WHERE actor.id = (SELECT auth.uid())
      AND (
        (actor.id = p_owner_id AND actor.is_admin IS TRUE)
        OR (
          actor.created_by = p_owner_id
          AND p_permission IS NOT NULL
          AND (
            actor.permissions ->> p_permission = 'true'
            OR (p_write IS FALSE AND actor.permissions ->> 'reports' = 'true')
          )
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.can_access_factory_owner(uuid, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_access_factory_owner(uuid, text, boolean) TO authenticated;

-- Replace the broad owner/team policy with per-module permission policies.
DROP POLICY IF EXISTS factory_owner_team_access ON public.customers;
DROP POLICY IF EXISTS factory_owner_team_access ON public.suppliers;
DROP POLICY IF EXISTS factory_owner_team_access ON public.products;
DROP POLICY IF EXISTS factory_owner_team_access ON public.inventory;
DROP POLICY IF EXISTS factory_owner_team_access ON public.invoices;
DROP POLICY IF EXISTS factory_owner_team_access ON public.invoice_items;
DROP POLICY IF EXISTS factory_owner_team_access ON public.returns;
DROP POLICY IF EXISTS factory_owner_team_access ON public.vouchers;
DROP POLICY IF EXISTS factory_owner_team_access ON public.production_orders;
DROP POLICY IF EXISTS factory_owner_team_access ON public.factory_state;

-- Employees must never read/write the full JSON snapshot.
CREATE POLICY factory_state_admin_only
  ON public.factory_state FOR ALL TO authenticated
  USING (private.can_access_factory_owner(user_id, NULL, true))
  WITH CHECK (private.can_access_factory_owner(user_id, NULL, true));

DO $policies$
DECLARE
  item record;
  t text;
  perm text;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('customers', 'customers'),
      ('suppliers', 'suppliers'),
      ('products', 'inventory'),
      ('inventory', 'inventory'),
      ('invoices', 'invoices'),
      ('invoice_items', 'invoices'),
      ('returns', 'invoices'),
      ('vouchers', 'invoices'),
      ('production_orders', 'production')
    ) AS x(table_name, permission_key)
  LOOP
    t := item.table_name;
    perm := item.permission_key;

    EXECUTE format('DROP POLICY IF EXISTS factory_read_permission ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS factory_insert_permission ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS factory_update_permission ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS factory_delete_permission ON public.%I', t);

    EXECUTE format(
      'CREATE POLICY factory_read_permission ON public.%I FOR SELECT TO authenticated USING (private.can_access_factory_owner(user_id, %L, false))',
      t, perm
    );
    EXECUTE format(
      'CREATE POLICY factory_insert_permission ON public.%I FOR INSERT TO authenticated WITH CHECK (private.can_access_factory_owner(user_id, %L, true))',
      t, perm
    );
    EXECUTE format(
      'CREATE POLICY factory_update_permission ON public.%I FOR UPDATE TO authenticated USING (private.can_access_factory_owner(user_id, %L, true)) WITH CHECK (private.can_access_factory_owner(user_id, %L, true))',
      t, perm, perm
    );
    EXECUTE format(
      'CREATE POLICY factory_delete_permission ON public.%I FOR DELETE TO authenticated USING (private.can_access_factory_owner(user_id, %L, true))',
      t, perm
    );
  END LOOP;
END;
$policies$;

-- Foreign-key indexes recommended by the Supabase performance advisor.
CREATE INDEX IF NOT EXISTS idx_profiles_created_by ON public.profiles(created_by);
CREATE INDEX IF NOT EXISTS idx_invoice_items_product_id ON public.invoice_items(product_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_supplier_id ON public.invoices(supplier_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_product_id ON public.production_orders(product_id);
CREATE INDEX IF NOT EXISTS idx_returns_customer_id ON public.returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_returns_invoice_id ON public.returns(invoice_id);
CREATE INDEX IF NOT EXISTS idx_returns_supplier_id ON public.returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_customer_id ON public.vouchers(customer_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_supplier_id ON public.vouchers(supplier_id);
