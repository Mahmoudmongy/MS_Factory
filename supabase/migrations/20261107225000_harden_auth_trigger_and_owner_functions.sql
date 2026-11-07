-- Harden Supabase Auth helper functions.
-- current_owner_id only needs to read the caller's own profile row. Invoker
-- security allows profiles RLS to apply and avoids exposing a SECURITY DEFINER
-- RPC through the public API.
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

-- Auth inserts need a narrowly scoped trigger function to create the matching
-- profile despite profiles RLS. Keep it SECURITY DEFINER, but use an empty
-- search_path and fully-qualified object names; callers cannot execute it
-- directly.
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
