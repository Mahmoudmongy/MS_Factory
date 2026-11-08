CREATE OR REPLACE VIEW public.production_catalog
WITH (security_barrier = true)
AS
SELECT
  p.user_id,
  p.external_id,
  p.name,
  p.sku,
  p.model,
  p.unit,
  p.warehouse,
  p.image_url,
  p.buy_price,
  COALESCE(i.variant, '-') AS variant,
  COALESCE(i.quantity, 0) AS quantity
FROM public.products AS p
LEFT JOIN public.inventory AS i
  ON i.user_id = p.user_id
 AND i.product_id = p.id
WHERE private.can_access_factory_owner(p.user_id, 'production', false);

REVOKE ALL ON TABLE public.production_catalog FROM authenticated, PUBLIC, anon;
GRANT SELECT ON TABLE public.production_catalog TO authenticated;
