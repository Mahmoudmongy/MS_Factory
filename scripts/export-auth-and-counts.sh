#!/usr/bin/env bash
# Export only durable Supabase Auth identity data and non-sensitive row counts.
# Active sessions, refresh tokens, challenges, OAuth flow state and one-time tokens
# are intentionally excluded: they are transient credentials, not restorable users.
set -Eeuo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"

psql_cmd=(psql --no-psqlrc --set=ON_ERROR_STOP=1 --tuples-only --no-align "$SUPABASE_DB_URL")
dump_cmd=(pg_dump --no-owner --no-privileges --no-comments --dbname="$SUPABASE_DB_URL")

# Fail closed if a Supabase Auth table expected by this backup format is absent.
for table in users identities mfa_factors mfa_recovery_code_sets mfa_recovery_codes webauthn_credentials; do
  exists="$("${psql_cmd[@]}" --command="SELECT to_regclass('auth.$table') IS NOT NULL;")"
  if [[ "$exists" != "t" ]]; then
    echo "::error::Required Auth table auth.$table is missing; refusing a partial Auth backup."
    exit 1
  fi
done

# Keep durable user identity, password hashes, MFA enrollment/recovery and passkeys.
# Do not export sessions, refresh tokens, challenges, or temporary OAuth state.
"${dump_cmd[@]}" \
  --data-only --column-inserts \
  --table=auth.users \
  --table=auth.identities \
  --table=auth.mfa_factors \
  --table=auth.mfa_recovery_code_sets \
  --table=auth.mfa_recovery_codes \
  --table=auth.webauthn_credentials \
  --file=auth-users.sql

test -s auth-users.sql

# Export migration history separately from application schema/data.
"${dump_cmd[@]}" --schema-only --table=supabase_migrations.schema_migrations --file=migration-history-schema.sql
"${dump_cmd[@]}" --data-only --column-inserts --table=supabase_migrations.schema_migrations --file=migration-history.sql

# Capture the custom auth.users trigger and its function definition exactly as installed.
"${psql_cmd[@]}" --command="
SELECT pg_get_functiondef(p.oid) || E'\n\n' || pg_get_triggerdef(t.oid) || ';'
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE n.nspname = 'auth'
  AND c.relname = 'users'
  AND NOT t.tgisinternal
ORDER BY t.tgname;
" > auth-trigger.sql

if [[ ! -s auth-trigger.sql ]]; then
  echo "::error::No custom trigger found on auth.users; refusing a backup with missing Auth profile behavior."
  exit 1
fi

# Counts are metadata only; no customer or employee business data is printed to logs.
"${psql_cmd[@]}" --command="SELECT 'storage_bucket_count=' || count(*) FROM storage.buckets;" \
  | sed 's/^[[:space:]]*//' > storage-bucket-count.txt
"${psql_cmd[@]}" --command="SELECT 'auth_user_count=' || count(*) FROM auth.users;" \
  | sed 's/^[[:space:]]*//' > auth-user-count.txt
"${psql_cmd[@]}" --command="SELECT 'migration_count=' || count(*) FROM supabase_migrations.schema_migrations;" \
  | sed 's/^[[:space:]]*//' > migration-count.txt

# Human-readable counts for every public base table, without exporting row contents.
: > public-row-counts.txt
while IFS= read -r query; do
  [[ -z "$query" ]] && continue
  "${psql_cmd[@]}" --command="$query" >> public-row-counts.txt
done < <(
  "${psql_cmd[@]}" --command="
    SELECT format(
      'SELECT %L AS table_name, count(*) AS row_count FROM %I.%I;',
      table_name, table_schema, table_name
    )
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  "
)

# Per-table Auth counts, excluding transient session/token tables.
: > auth-row-counts.txt
for table in users identities mfa_factors mfa_recovery_code_sets mfa_recovery_codes webauthn_credentials; do
  "${psql_cmd[@]}" --command="SELECT 'auth.$table' AS table_name, count(*) AS row_count FROM auth.$table;" \
    >> auth-row-counts.txt
done

for file in auth-users.sql migration-history-schema.sql migration-history.sql auth-trigger.sql \
            storage-bucket-count.txt auth-user-count.txt migration-count.txt \
            public-row-counts.txt auth-row-counts.txt; do
  test -s "$file" || { echo "::error::Expected export is empty: $file"; exit 1; }
done

echo "Auth identity export and row-count metadata completed."
