-- Remove inherited broad profile grants from authenticated users.
-- Employees may read their own profile and change only their display name.
-- Authorization fields remain writable only by trusted server-side operations.
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM authenticated;

REVOKE
  INSERT (id, email, full_name, created_at, username, must_change_password, permissions, created_by, is_admin),
  UPDATE (id, email, full_name, created_at, username, must_change_password, permissions, created_by, is_admin),
  REFERENCES (id, email, full_name, created_at, username, must_change_password, permissions, created_by, is_admin)
ON TABLE public.profiles FROM authenticated;

GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name) ON TABLE public.profiles TO authenticated;

DO $verify$
BEGIN
  IF NOT has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') THEN
    RAISE EXCEPTION 'Expected profile read and own-name update privileges are missing';
  END IF;

  IF has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR has_table_privilege('authenticated', 'public.profiles', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.profiles', 'TRIGGER')
     OR has_column_privilege('authenticated', 'public.profiles', 'permissions', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'created_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'must_change_password', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE') THEN
    RAISE EXCEPTION 'Authenticated profile grants remain broader than intended';
  END IF;
END
$verify$;
