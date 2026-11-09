REVOKE EXECUTE ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role;

DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.handle_new_user()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Unexpected API role can still execute public.handle_new_user()';
  END IF;

  IF NOT has_function_privilege('postgres', 'public.handle_new_user()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Function owner lost EXECUTE privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgrelid = 'auth.users'::regclass
       AND tgname = 'on_auth_user_created'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Expected auth.users profile trigger is missing';
  END IF;
END
$verify$;