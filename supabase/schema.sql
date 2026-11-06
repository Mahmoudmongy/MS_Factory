/*
# إنشاء جداول التطبيق مع حماية الصفوف (RLS)

1. الجداول الجديدة
- profiles: بيانات المستخدم الأساسية، تُنشأ تلقائياً عند التسجيل
- customers: العملاء
- suppliers: الموردون
- products: الأصناف (المنتجات والخامات)
- inventory: أرصدة المخزون لكل صنف ومقاس/لون
- invoices: فواتير البيع والشراء
- invoice_items: بنود الفواتير
- returns: المرتجعات (مرتجع بيع ومرتجع شراء)
- vouchers: السندات (مقبوضات ومدفوعات)
- production_orders: أوامر الإنتاج

2. الأمان
- تفعيل RLS على كل الجداول
- كل مستخدم يرى ويعدّل بياناته فقط عبر عمود user_id
- الصلاحيات (GRANT) للمستخدمين المسجلين فقط، بدون وصول للزوار

3. ملاحظات
- يُنفَّذ هذا الملف مرة واحدة في SQL Editor
- لا يحذف أي بيانات
*/

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  customer_type text NOT NULL DEFAULT 'retail' CHECK (customer_type IN ('retail', 'wholesale')),
  governorate text,
  city text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  governorate text,
  city text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  model text,
  unit text NOT NULL DEFAULT 'قطعة',
  warehouse text,
  buy_price numeric(12,2) NOT NULL DEFAULT 0,
  retail_price numeric(12,2) NOT NULL DEFAULT 0,
  wholesale_price numeric(12,2) NOT NULL DEFAULT 0,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant text NOT NULL DEFAULT '-',
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, variant)
);

CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_no text NOT NULL,
  invoice_type text NOT NULL CHECK (invoice_type IN ('sale', 'purchase')),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  invoice_date date NOT NULL DEFAULT current_date,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  variant text NOT NULL DEFAULT '-',
  quantity numeric(12,3) NOT NULL DEFAULT 0,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  line_total numeric(12,2) NOT NULL DEFAULT 0,
  note text
);

CREATE TABLE IF NOT EXISTS returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  return_no text NOT NULL,
  return_type text NOT NULL CHECK (return_type IN ('sale_return', 'purchase_return')),
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  return_date date NOT NULL DEFAULT current_date,
  total numeric(12,2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  voucher_no text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  account text NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  voucher_date date NOT NULL DEFAULT current_date,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS production_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  order_no text NOT NULL,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'delivered')),
  breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_cost numeric(12,2) NOT NULL DEFAULT 0,
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

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'select_own_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = user_id)', 'select_own_' || t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'insert_own_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id)', 'insert_own_' || t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'update_own_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id)', 'update_own_' || t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'delete_own_' || t, t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.uid() = user_id)', 'delete_own_' || t, t);
  END LOOP;
END $$;
