-- Add audit columns required by idempotent versioned deletes on all detail tables.
ALTER TABLE public.returns
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.set_detail_sync_audit_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.now();
  NEW.updated_by := (SELECT auth.uid());
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_detail_sync_audit_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS returns_sync_audit_fields ON public.returns;
CREATE TRIGGER returns_sync_audit_fields
BEFORE UPDATE ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.set_detail_sync_audit_fields();

DROP TRIGGER IF EXISTS vouchers_sync_audit_fields ON public.vouchers;
CREATE TRIGGER vouchers_sync_audit_fields
BEFORE UPDATE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.set_detail_sync_audit_fields();

DROP TRIGGER IF EXISTS production_orders_sync_audit_fields ON public.production_orders;
CREATE TRIGGER production_orders_sync_audit_fields
BEFORE UPDATE ON public.production_orders
FOR EACH ROW EXECUTE FUNCTION public.set_detail_sync_audit_fields();
