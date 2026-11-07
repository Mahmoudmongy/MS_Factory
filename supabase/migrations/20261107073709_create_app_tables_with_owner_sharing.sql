/*
# Create app tables aligned with the cloud sync and owner-shared access

1. Overview
- The factory app stores its data in the browser and syncs it to these tables.
- The owner (the account that signed up first) and the employees created by the owner share one data set.
- Employees are identified by profiles.created_by; their data rows use the owner's id as user_id.

2. New tables (all with RLS enabled)
- profiles: one row per auth user. username and permissions are used by employee accounts. created_by is empty for the owner.
- customers, suppliers: partner records synced from the app (external_id links to the app's id).
- products: product records synced from the app, full app record kept in raw.
- inventory: stock balance per product and variant (not yet written by the app).
- invoices: one row per app document, full app record kept in raw.
- invoice_items: line items of an invoice.
- returns, vouchers, production_orders: created for future sync (not yet written by the app).

3. Security
- RLS enabled on every table.
- Data tables: readable and writable only for rows whose user_id equals the current owner (public.current_owner_id()).
- profiles: a user can read their own profile and change only full_name. username, created_by, and permissions can be changed only by the server function that creates employees.
- Employee accounts are created by the create-employee edge function, not from the browser.

4. Notes
- Idempotent: safe to run again.
- No data is deleted.
*/

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  username text UNIQUE CHECK (username IS NULL OR username ~ '^[a-z0-9._-]+$'),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.current_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p.created_by, p.id) FROM public.profiles p WHERE p.id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.current_owner_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_owner_id() TO authenticated;

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.current_owner_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.current_owner_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text NOT NULL,
  phone text,
  email text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_id)
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.current_owner_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  name text NOT NULL,
  qty numeric(14,3) NOT NULL DEFAULT 0,
  price numeric(14,2) NOT NULL DEFAULT 0,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_id)
);

CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.current_owner_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant text NOT NULL DEFAULT '-',
  quantity numeric(14,3) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, variant)
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.current_owner_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  customer_name text,
  total numeric(14,2) NOT NULL DEFAULT 0,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, external_id)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.current_owner_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_name text NOT NULL DEFAULT '',
  qty numeric(14,3) NOT NULL DEFAULT 1,
  price numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.current_owner_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  return_no text NOT NULL,
  return_type text NOT NULL CHECK (return_type IN ('sale_return', 'purchase_return')),
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  return_date date NOT NULL DEFAULT current_date,
  total numeric(14,2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.current_owner_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  voucher_no text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  account text NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  voucher_date date NOT NULL DEFAULT current_date,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT public.current_owner_id() REFERENCES auth.users(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'delivered')),
  breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_cost numeric(14,2) NOT NULL DEFAULT 0,
  order_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customers_user ON customers(user_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_user ON suppliers(user_id);
CREATE INDEX IF NOT EXISTS idx_products_user ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_user ON inventory(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_user ON invoice_items(user_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_returns_user ON returns(user_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_user ON vouchers(user_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_user ON production_orders(user_id);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, UPDATE (full_name) ON profiles TO authenticated;

DROP POLICY IF EXISTS "select_own_profile" ON profiles;
CREATE POLICY "select_own_profile" ON profiles FOR SELECT
  TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers', 'suppliers', 'products', 'inventory', 'invoices',
    'invoice_items', 'returns', 'vouchers', 'production_orders'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'select_owner_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (user_id = public.current_owner_id())', 'select_owner_' || t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'insert_owner_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (user_id = public.current_owner_id())', 'insert_owner_' || t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'update_owner_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (user_id = public.current_owner_id()) WITH CHECK (user_id = public.current_owner_id())', 'update_owner_' || t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'delete_owner_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (user_id = public.current_owner_id())', 'delete_owner_' || t, t);
  END LOOP;
END $$;
