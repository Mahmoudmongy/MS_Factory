-- Restrict authenticated clients to the CRUD privileges used by the application.
-- RLS controls which rows a user can access; these extra table-level privileges
-- are not needed by the browser app and can bypass row-level protections
-- (TRUNCATE is not governed by RLS).
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN
ON ALL TABLES IN SCHEMA public
FROM authenticated;

-- Keep future public tables least-privileged when created by the migration owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
REVOKE TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON TABLES FROM authenticated;

DO $verify$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT c.oid, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  LOOP
    IF has_table_privilege('authenticated', item.oid, 'TRUNCATE')
       OR has_table_privilege('authenticated', item.oid, 'TRIGGER')
       OR has_table_privilege('authenticated', item.oid, 'REFERENCES')
       OR has_table_privilege('authenticated', item.oid, 'MAINTAIN') THEN
      RAISE EXCEPTION 'Unexpected elevated privilege remains for public.%', item.relname;
    END IF;
  END LOOP;
END
$verify$;
