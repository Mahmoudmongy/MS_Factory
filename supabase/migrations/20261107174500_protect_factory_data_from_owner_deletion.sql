-- Protect the factory owner's identity from cascading deletion of all business data.
-- Employee Auth users can still be deleted; business rows are owned by the factory admin.
ALTER TABLE public.customers
  DROP CONSTRAINT customers_user_id_fkey,
  ADD CONSTRAINT customers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.factory_state
  DROP CONSTRAINT factory_state_user_id_fkey,
  ADD CONSTRAINT factory_state_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.inventory
  DROP CONSTRAINT inventory_user_id_fkey,
  ADD CONSTRAINT inventory_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.invoice_items
  DROP CONSTRAINT invoice_items_user_id_fkey,
  ADD CONSTRAINT invoice_items_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.invoices
  DROP CONSTRAINT invoices_user_id_fkey,
  ADD CONSTRAINT invoices_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.production_orders
  DROP CONSTRAINT production_orders_user_id_fkey,
  ADD CONSTRAINT production_orders_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.products
  DROP CONSTRAINT products_user_id_fkey,
  ADD CONSTRAINT products_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.returns
  DROP CONSTRAINT returns_user_id_fkey,
  ADD CONSTRAINT returns_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.suppliers
  DROP CONSTRAINT suppliers_user_id_fkey,
  ADD CONSTRAINT suppliers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

ALTER TABLE public.vouchers
  DROP CONSTRAINT vouchers_user_id_fkey,
  ADD CONSTRAINT vouchers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE RESTRICT;

-- The browser app updates factory snapshots via sync_factory_state RPC.
-- Direct deletes are unnecessary and must not be available to authenticated clients.
REVOKE DELETE ON TABLE public.factory_state FROM authenticated;

DO $verify$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT conrelid::regclass AS tbl, conname, pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE contype = 'f'
      AND conname IN (
        'customers_user_id_fkey','factory_state_user_id_fkey','inventory_user_id_fkey',
        'invoice_items_user_id_fkey','invoices_user_id_fkey','production_orders_user_id_fkey',
        'products_user_id_fkey','returns_user_id_fkey','suppliers_user_id_fkey','vouchers_user_id_fkey'
      )
  LOOP
    IF item.definition NOT LIKE '%ON DELETE RESTRICT%' THEN
      RAISE EXCEPTION 'Owner deletion protection missing on %', item.tbl;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.factory_state', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated role still has DELETE on factory_state';
  END IF;
END
$verify$;
