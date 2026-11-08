#!/bin/sh
# Runs inside the official postgres image; exports managed Auth rows and exact row-count manifests.
set -eu
: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

pg_dump "$SUPABASE_DB_URL" --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities \
  --table=auth.mfa_factors --table=auth.mfa_recovery_code_sets \
  --table=auth.mfa_recovery_codes --table=auth.webauthn_credentials \
  --file=/backup/auth-users.sql

pg_dump "$SUPABASE_DB_URL" --schema-only --no-owner --no-privileges \
  --schema=supabase_migrations --file=/backup/migration-history-schema.sql

pg_dump "$SUPABASE_DB_URL" --data-only --no-owner --no-privileges \
  --table=supabase_migrations.schema_migrations \
  --file=/backup/migration-history.sql

psql "$SUPABASE_DB_URL" -Atqc "select count(*) from storage.buckets" > /backup/storage-bucket-count.txt
psql "$SUPABASE_DB_URL" -Atqc "select count(*) from auth.users" > /backup/auth-user-count.txt
psql "$SUPABASE_DB_URL" -Atqc "select count(*) from supabase_migrations.schema_migrations" > /backup/migration-count.txt

: > /backup/auth-row-counts.txt
for table in users identities mfa_factors mfa_recovery_code_sets mfa_recovery_codes webauthn_credentials; do
  count="$(psql "$SUPABASE_DB_URL" -Atqc "select count(*) from auth.\"$table\"")"
  printf '%s=%s\n' "$table" "$count" >> /backup/auth-row-counts.txt
done

: > /backup/public-row-counts.txt
for table in $(psql "$SUPABASE_DB_URL" -Atqc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name"); do
  count="$(psql "$SUPABASE_DB_URL" -Atqc "select count(*) from public.\"$table\"")"
  printf '%s=%s\n' "$table" "$count" >> /backup/public-row-counts.txt
done
