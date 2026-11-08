CREATE OR REPLACE VIEW public.production_factory_config
WITH (security_barrier = true)
AS
SELECT
  fs.user_id,
  COALESCE(fs.state->'accts', '[]'::jsonb) AS accts,
  COALESCE(fs.state->'codes', '[]'::jsonb) AS codes,
  COALESCE(fs.state->'curs', '["EGP"]'::jsonb) AS curs,
  COALESCE(fs.state->'wh', '[]'::jsonb) AS warehouses,
  COALESCE(fs.state->>'name', '') AS factory_name
FROM public.factory_state AS fs
WHERE private.can_access_factory_owner(fs.user_id, 'production', false);

REVOKE ALL ON TABLE public.production_factory_config FROM authenticated, PUBLIC, anon;
GRANT SELECT ON TABLE public.production_factory_config TO authenticated;
