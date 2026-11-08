-- Keep the owner lookup under the caller's profile RLS instead of exposing
-- a SECURITY DEFINER helper through the public API.
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

-- Auth user creation requires a narrowly scoped trigger function to create
-- its profile. Keep SECURITY DEFINER for the trigger only, with an empty
-- search_path and fully qualified relation names.
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
