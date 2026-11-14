-- Align production with the QA-tested, non-privileged owner lookup.
-- The function reads only the caller's own profile row through profiles RLS.
CREATE OR REPLACE FUNCTION public.current_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT coalesce(p.created_by, p.id)
  FROM public.profiles p
  WHERE p.id = (SELECT auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.current_owner_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_owner_id() TO authenticated, service_role;
