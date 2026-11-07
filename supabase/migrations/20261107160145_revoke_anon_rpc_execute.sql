-- Remove default anonymous EXECUTE grants from internal synchronization helpers.
REVOKE ALL ON FUNCTION public.sync_factory_state(integer, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.touch_transaction_detail_updated_at() FROM anon;
