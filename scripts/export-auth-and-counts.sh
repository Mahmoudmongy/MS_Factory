#!/bin/sh
# Runs inside the official postgres image; exports managed Auth rows and exact row-count manifests.
set -eu
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

# Auth table availability differs between Supabase Auth versions. Export only tables
# that actually exist, and fail if core user/identity tables are missing.
set -- --data-only --no-owner --no-privileges
for table in users identities mfa_factors mfa_recovery_code_sets mfa_recovery_codes webauthn_credentials; do
  exists="$(psql "$SUPABASE_DB_URL" -Atqc "SELECT to_regclass('auth.$table') IS NOT NULL")"
  if [ "$exists" = "t" ]; then
    set -- "$@" "--table=auth.$table"
  fi
done
case " $* " in
  *"--table=auth.users"*) ;;
  *) echo "ERROR: auth.users table is missing." >&2; exit 10 ;;
esac
case " $* " in
  *"--table=auth.identities"*) ;;
  *) echo "ERROR: auth.identities table is missing." >&2; exit 11 ;;
esac
pg_dump "$SUPABASE_DB_URL" "$@" --file=/backup/auth-users.sql

cat > /backup/migration-history-schema.sql <<'SQL'
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text NOT NULL PRIMARY KEY,
  statements text[],
  name text,
  created_by text,
  idempotency_key text,
  rollback text[]
);
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS statements text[];
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE supabase_migrations.schema_migrations ADD COLUMN IF NOT EXISTS rollback text[];
CREATE UNIQUE INDEX IF NOT EXISTS schema_migrations_idempotency_key_key
  ON supabase_migrations.schema_migrations(idempotency_key);
SQL

pg_dump "$SUPABASE_DB_URL" --data-only --no-owner --no-privileges \
  --table=supabase_migrations.schema_migrations \
  --file=/backup/migration-history.sql

psql "$SUPABASE_DB_URL" -Atqc "select count(*) from storage.buckets" > /backup/storage-bucket-count.txt
psql "$SUPABASE_DB_URL" -Atqc "select count(*) from auth.users" > /backup/auth-user-count.txt
psql "$SUPABASE_DB_URL" -Atqc "select count(*) from supabase_migrations.schema_migrations" > /backup/migration-count.txt

: > /backup/auth-row-counts.txt
for table in users identities mfa_factors mfa_recovery_code_sets mfa_recovery_codes webauthn_credentials; do
  exists="$(psql "$SUPABASE_DB_URL" -Atqc "SELECT to_regclass('auth.$table') IS NOT NULL")"
  if [ "$exists" = "t" ]; then
    count="$(psql "$SUPABASE_DB_URL" -Atqc "select count(*) from auth.\"$table\"")"
    printf '%s=%s\n' "$table" "$count" >> /backup/auth-row-counts.txt
  fi
done

: > /backup/public-row-counts.txt
for table in $(psql "$SUPABASE_DB_URL" -Atqc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"); do
  count="$(psql "$SUPABASE_DB_URL" -Atqc "select count(*) from public.\"$table\"")"
  printf '%s=%s\n' "$table" "$count" >> /backup/public-row-counts.txt
done
