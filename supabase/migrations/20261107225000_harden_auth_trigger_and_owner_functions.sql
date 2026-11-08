-- Harden Supabase Auth helper functions.
-- current_owner_id only reads the caller's own profile row. Invoker security
-- keeps profiles RLS in force instead of bypassing it through SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.current_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(p.created_by, p.id)
  FROM public.profiles AS p
  WHERE p.id = (SELECT auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.current_owner_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_owner_id() TO authenticated;

-- Keep the Auth insert trigger narrowly scoped and uncallable by API roles.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
