REVOKE ALL ON TABLE public.production_catalog FROM authenticated, PUBLIC, anon;
GRANT SELECT ON TABLE public.production_catalog TO authenticated;