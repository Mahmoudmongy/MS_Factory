-- ==============================================================================
-- MS Factory — سكريبت تنظيف قاعدة البيانات وتهيئة المزامنة المباشرة للجداول
-- Project: yvrislcbbhtruwdnuooz (Production Database)
--
-- الضوابط:
-- 1. لا يتم حذف الجداول (DROP TABLE) أو المخطط (DROP SCHEMA).
-- 2. الحفاظ على دوال RLS وسياسات الأمان وTriggers.
-- 3. تنظيف جميع بيانات التجارب وحركات المخزون والفواتير والسندات من الجداول الأساسية.
-- 4. إبقاء / تهيئة حساب المدير الأساسي للتمكن من الدخول بأمان.
-- 5. تفعيل المزامنة المباشرة على الجداول (customers, suppliers, products, inventory,
--    invoices, invoice_items, returns, vouchers, production_orders).
-- ==============================================================================

BEGIN;

-- 1. تنظيف بيانات التطبيق وحركات العمليات مع مراعاة الترتيب والمفاتيح المرجعية
DELETE FROM public.invoice_items;
DELETE FROM public.invoices;
DELETE FROM public.returns;
DELETE FROM public.vouchers;
DELETE FROM public.production_orders;
DELETE FROM public.inventory;
DELETE FROM public.products;
DELETE FROM public.customers;
DELETE FROM public.suppliers;
DELETE FROM public.factory_state;

-- 2. التحقق من وجود حساب المدير في public.profiles والحفاظ عليه أو ترقيته
-- الموظفون التجريبيون يتم تنظيفهم إذا وُجدوا
DELETE FROM public.profiles WHERE is_admin IS NOT TRUE AND created_by IS NOT NULL;

-- التأكد من أن حساب المالك/المدير يملك is_admin = true ولا يتم حذف حسابه
UPDATE public.profiles
SET is_admin = true,
    must_change_password = false
WHERE created_by IS NULL;

-- 3. التأكد من تفعيل RLS على كافة الجداول
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.factory_state ENABLE ROW LEVEL SECURITY;

-- 4. تفعيل فرض RLS الصارم (FORCE ROW LEVEL SECURITY)
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.products FORCE ROW LEVEL SECURITY;
ALTER TABLE public.inventory FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.returns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.factory_state FORCE ROW LEVEL SECURITY;

-- 5. التحقق من سلامة المؤشرات اللازمة للمزامنة المباشرة
CREATE INDEX IF NOT EXISTS idx_customers_user_ext ON public.customers(user_id, external_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_user_ext ON public.suppliers(user_id, external_id);
CREATE INDEX IF NOT EXISTS idx_products_user_ext ON public.products(user_id, external_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user_ext ON public.invoices(user_id, external_id);
CREATE INDEX IF NOT EXISTS idx_returns_user_ext ON public.returns(user_id, external_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_user_ext ON public.vouchers(user_id, external_id);
CREATE INDEX IF NOT EXISTS idx_production_orders_user_ext ON public.production_orders(user_id, external_id);

COMMIT;
