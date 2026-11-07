# Supabase setup notes

The connected production project already had its base tables created from `schema.sql` before the initial migration was recorded in Supabase migration history.

- Keep the historical base migration copy in `legacy/`; it is intentionally outside the active migration directory.
- The active migration files must match the versions recorded by the connected project:
  - `20261107080100_harden_auth_rls_20261107.sql`
  - `20261107081648_enforce_employee_permissions_20261107.sql`
- For a new Supabase project, first apply `schema.sql` using the SQL editor, then apply the active migrations in order.
- Do not move the legacy SQL file back into `migrations/` for an existing project; that would attempt to replay the baseline migration.
- Do not run `supabase db push` until the new-project baseline procedure has been followed and the remote migration history has been checked.
