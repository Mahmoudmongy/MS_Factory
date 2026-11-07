-- Use the database clock for detail-record conflict timestamps.
CREATE OR REPLACE FUNCTION public.touch_transaction_detail_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS returns_touch_updated_at ON public.returns;
CREATE TRIGGER returns_touch_updated_at
BEFORE INSERT OR UPDATE ON public.returns
FOR EACH ROW EXECUTE FUNCTION public.touch_transaction_detail_updated_at();

DROP TRIGGER IF EXISTS vouchers_touch_updated_at ON public.vouchers;
CREATE TRIGGER vouchers_touch_updated_at
BEFORE INSERT OR UPDATE ON public.vouchers
FOR EACH ROW EXECUTE FUNCTION public.touch_transaction_detail_updated_at();

DROP TRIGGER IF EXISTS production_orders_touch_updated_at ON public.production_orders;
CREATE TRIGGER production_orders_touch_updated_at
BEFORE INSERT OR UPDATE ON public.production_orders
FOR EACH ROW EXECUTE FUNCTION public.touch_transaction_detail_updated_at();

REVOKE ALL ON FUNCTION public.touch_transaction_detail_updated_at() FROM PUBLIC;
