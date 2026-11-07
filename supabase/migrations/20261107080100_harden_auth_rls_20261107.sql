-- Harden authentication and tenant isolation for Factory Manager.
-- Additive migration: preserves existing business data.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.can_access_factory_owner(p_owner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND (
       p_owner_id = (SELECT auth.uid())
       OR EXISTS (SELECT 1 FROM public.profiles actor
                  WHERE actor.id = (SELECT auth.uid()) AND actor.created_by = p_owner_id)
       OR EXISTS (SELECT 1 FROM public.profiles member
                  WHERE member.id = p_owner_id AND member.created_by = (SELECT auth.uid()))
     );
$function$;
REVOKE ALL ON FUNCTION private.can_access_factory_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_access_factory_owner(uuid) TO authenticated;

DROP POLICY IF EXISTS "profiles read" ON public.profiles;
DROP POLICY IF EXISTS "profiles write" ON public.profiles;
DROP POLICY IF EXISTS "select_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name) ON TABLE public.profiles TO authenticated;
CREATE POLICY select_own_profile ON public.profiles FOR SELECT TO authenticated
  USING ((SELECT auth.uid()) = id);
CREATE POLICY update_own_profile ON public.profiles FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id) WITH CHECK ((SELECT auth.uid()) = id);

ALTER TABLE public.profiles ALTER COLUMN is_admin SET DEFAULT false;
UPDATE public.profiles SET is_admin = false WHERE is_admin IS NULL;

-- The project had exactly one Auth user and one root profile at deployment time.
DO $bootstrap$
BEGIN
  IF (SELECT count(*) FROM auth.users) = 1
     AND (SELECT count(*) FROM public.profiles) = 1 THEN
    UPDATE public.profiles p SET is_admin = true
    WHERE p.id = (SELECT u.id FROM auth.users u LIMIT 1) AND p.created_by IS NULL;
  END IF;
END;
$bootstrap$;

DO $policies$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers','suppliers','products','inventory','invoices',
    'invoice_items','returns','vouchers','production_orders','factory_state'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'owner and team', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'select_own_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'insert_own_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'update_own_' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'delete_own_' || t, t);
    IF t = 'factory_state' THEN
      EXECUTE 'DROP POLICY IF EXISTS "User can read own state" ON public.factory_state';
      EXECUTE 'DROP POLICY IF EXISTS "User can write own state" ON public.factory_state';
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', t);
    EXECUTE format(
      'CREATE POLICY factory_owner_team_access ON public.%I FOR ALL TO authenticated USING (private.can_access_factory_owner(user_id)) WITH CHECK (private.can_access_factory_owner(user_id))',
      t
    );
  END LOOP;
END;
$policies$;
