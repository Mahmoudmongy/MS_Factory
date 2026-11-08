#!/usr/bin/env bash
# Restore a verified logical Supabase backup into the dedicated, empty QA project only.
# Managed auth/storage schemas stay owned by Supabase; Auth rows and the custom trigger
# are restored separately. This follows Supabase's documented logical restore order.
set -Eeuo pipefail

: "${QA_SUPABASE_DB_URL:?QA_SUPABASE_DB_URL is required}"
: "${EXPECTED_QA_PROJECT_REF:?EXPECTED_QA_PROJECT_REF is required}"
: "${FORBIDDEN_PRODUCTION_PROJECT_REF:?FORBIDDEN_PRODUCTION_PROJECT_REF is required}"

RESTORE_DIR="${RESTORE_DIR:-$PWD}"
cd "$RESTORE_DIR"

for file in roles.sql schema.sql data.sql auth-users.sql migration-history-schema.sql migration-history.sql auth-trigger.sql \
            database-files.sha256 manifest.txt public-row-counts.txt auth-row-counts.txt \
            auth-user-count.txt migration-count.txt storage-bucket-count.txt; do
  test -s "$file" || { echo "::error::Backup file is missing or empty: $file"; exit 1; }
done

grep -qx 'project=ms-factory' <(grep '^project=' manifest.txt) || {
  echo "::error::Backup manifest project identity is invalid."; exit 1;
}
grep -q '^source=Supabase CLI db dump$' manifest.txt || {
  echo "::error::Backup is not a Supabase CLI logical export."; exit 1;
}
grep -q '^encryption=age public-key recipient$' manifest.txt || {
  echo "::error::Backup encryption manifest is invalid."; exit 1;
}
if [[ "$(tr -d '[:space:]' < storage-bucket-count.txt)" != "0" ]]; then
  echo "::error::Backup contains Storage buckets, but this restore pipeline does not transfer Storage object bytes."
  exit 1
fi

sha256sum --check --status database-files.sha256 || {
  echo "::error::One or more logical backup files failed SHA-256 verification."; exit 1;
}

# Fail closed unless the connection string unmistakably targets the dedicated QA project.
python3 - <<'PY'
import os
from urllib.parse import urlparse, unquote

u = urlparse(os.environ["QA_SUPABASE_DB_URL"])
host = (u.hostname or "").lower()
user = unquote(u.username or "").lower()
expected = os.environ["EXPECTED_QA_PROJECT_REF"].lower()
forbidden = os.environ["FORBIDDEN_PRODUCTION_PROJECT_REF"].lower()
if forbidden in host or forbidden in user:
    raise SystemExit("Refusing restore: production project reference detected.")
if expected not in host and expected not in user:
    raise SystemExit("Refusing restore: connection string does not identify the dedicated QA project.")
if u.scheme not in ("postgres", "postgresql") or not u.path.endswith("/postgres"):
    raise SystemExit("Refusing restore: invalid PostgreSQL connection string.")
PY

psql_cmd=(psql --no-psqlrc --set=ON_ERROR_STOP=1 --dbname "$QA_SUPABASE_DB_URL")

# Never overwrite an existing QA dataset. The destination must be empty before restore.
public_tables="$("${psql_cmd[@]}" --tuples-only --no-align --command="SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';" | tr -d '[:space:]')"
auth_users="$("${psql_cmd[@]}" --tuples-only --no-align --command="SELECT count(*) FROM auth.users;" | tr -d '[:space:]')"
auth_identities="$(${psql_cmd[@]} --tuples-only --no-align --command="SELECT count(*) FROM auth.identities;" | tr -d '[:space:]')"
auth_mfa_factors="$(${psql_cmd[@]} --tuples-only --no-align --command="SELECT count(*) FROM auth.mfa_factors;" | tr -d '[:space:]')"
auth_mfa_recovery_sets="$(${psql_cmd[@]} --tuples-only --no-align --command="SELECT count(*) FROM auth.mfa_recovery_code_sets;" | tr -d '[:space:]')"
auth_mfa_recovery_codes="$(${psql_cmd[@]} --tuples-only --no-align --command="SELECT count(*) FROM auth.mfa_recovery_codes;" | tr -d '[:space:]')"
auth_webauthn_credentials="$(${psql_cmd[@]} --tuples-only --no-align --command="SELECT count(*) FROM auth.webauthn_credentials;" | tr -d '[:space:]')"
migration_schema="$("${psql_cmd[@]}" --tuples-only --no-align --command="SELECT to_regnamespace('supabase_migrations') IS NOT NULL;" | tr -d '[:space:]')"
migration_table="$("${psql_cmd[@]}" --tuples-only --no-align --command="SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL;" | tr -d '[:space:]')"
storage_buckets="$("${psql_cmd[@]}" --tuples-only --no-align --command="SELECT count(*) FROM storage.buckets;" | tr -d '[:space:]')"

if [[ "$public_tables" != "0" || "$auth_users" != "0" || "$auth_identities" != "0" || \\
      "$auth_mfa_factors" != "0" || "$auth_mfa_recovery_sets" != "0" || \\
      "$auth_mfa_recovery_codes" != "0" || "$auth_webauthn_credentials" != "0" || \\
      "$storage_buckets" != "0" ]]; then
  echo "::error::QA is not an empty Supabase restore target. No data was changed."
  exit 1
fi
if [[ "$migration_schema" == "t" && "$migration_table" != "t" ]]; then
  echo "::error::QA has an incomplete migration-history schema. No data was changed."
  exit 1
fi
if [[ "$migration_table" == "t" ]]; then
  migration_rows="$("${psql_cmd[@]}" --tuples-only --no-align --command="SELECT count(*) FROM supabase_migrations.schema_migrations;" | tr -d '[:space:]')"
  if [[ "$migration_rows" != "0" ]]; then
    echo "::error::QA migration history is not empty. No data was changed."
    exit 1
  fi
fi

# Supabase CLI restore notes: keep target-owned managed roles and normalize history schema.
python3 - <<'PY'
import re
from pathlib import Path

for filename in ("roles.sql", "schema.sql", "migration-history-schema.sql"):
    path = Path(filename)
    text = path.read_text()
    text = re.sub(r'(?im)^\s*ALTER\s+[^;\n]+?\s+OWNER\s+TO\s+"supabase_admin"\s*;\s*$', '', text)
    text = re.sub(r'(?im)^\s*GRANT\s+"postgres"\s+TO\s+"cli_login_postgres"[^;]*;\s*$', '', text)
    text = re.sub(r'(?im)^\s*(?:CREATE|ALTER)\s+ROLE\s+"?cli_login_postgres"?[^;]*;\s*$', '', text)
    text = re.sub(r'(?im)^\s*(?:GRANT|REVOKE)\s+[^;]*"cli_login_postgres"[^;]*;\s*$', '', text)
    path.write_text(text)

history_path = Path("migration-history-schema.sql")
history = history_path.read_text()
history, schema_count = re.subn(
    r'(?im)^\s*CREATE\s+SCHEMA(?:\s+IF\s+NOT\s+EXISTS)?\s+"?supabase_migrations"?\s*;\s*$',
    'CREATE SCHEMA IF NOT EXISTS supabase_migrations;',
    history
)
if schema_count == 0:
    history = 'CREATE SCHEMA IF NOT EXISTS supabase_migrations;\n' + history
history_path.write_text(history)
PY

# Make the exported custom auth.users trigger idempotent before touching QA.
python3 - <<'PY'
import re
from pathlib import Path

source = Path("auth-trigger.sql").read_text()
names = re.findall(
    r'CREATE\s+TRIGGER\s+("(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s+.*?\s+ON\s+auth\.users\b',
    source, flags=re.IGNORECASE | re.DOTALL
)
if not names:
    raise SystemExit("No custom auth.users trigger definition found in backup.")
drops = "".join(f"DROP TRIGGER IF EXISTS {name} ON auth.users;\n" for name in dict.fromkeys(names))
Path("auth-trigger-qa-idempotent.sql").write_text(drops + "\n" + source)
PY

# Supabase's documented roles/schema/data restore. Keep platform-managed auth/storage
# schemas intact; import durable Auth rows separately and restore the custom trigger
# inside the same transaction so any failure rolls the entire QA restore back.
if [[ "$migration_schema" == "t" ]]; then
  "${psql_cmd[@]}" --single-transaction \
    --file roles.sql \
    --file schema.sql \
    --command 'SET session_replication_role = replica' \
    --file data.sql \
    --file auth-users.sql \
    --file migration-history.sql \
    --file auth-trigger-qa-idempotent.sql
else
  "${psql_cmd[@]}" --single-transaction \
    --file roles.sql \
    --file schema.sql \
    --file migration-history-schema.sql \
    --command 'SET session_replication_role = replica' \
    --file data.sql \
    --file auth-users.sql \
    --file migration-history.sql \
    --file auth-trigger-qa-idempotent.sql
fi

# Verify public/Auth/migration row counts, RLS coverage, and exact custom Auth triggers.
python3 - <<'PY'
import os, re, subprocess
from pathlib import Path

db = os.environ["QA_SUPABASE_DB_URL"]

def psql(sql):
    return subprocess.check_output(
        ["psql", "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align",
         "--dbname", db, "--command", sql],
        text=True
    ).strip()

def read_counts(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        parts = line.split("|")
        if len(parts) != 2:
            continue
        name, value = parts[0].strip(), parts[1].strip()
        if (re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name) or
            re.fullmatch(r"auth\.[A-Za-z_][A-Za-z0-9_]*", name)) and value.isdigit():
            result[name] = int(value)
    if not result:
        raise SystemExit(f"No table counts could be parsed from {path}.")
    return result

public_counts = read_counts("public-row-counts.txt")
for table, expected in public_counts.items():
    actual = int(psql(f'SELECT count(*) FROM public."{table}";'))
    if actual != expected:
        raise SystemExit(f"QA row-count mismatch for public.{table}: expected {expected}, found {actual}.")

for table, expected in read_counts("auth-row-counts.txt").items():
    if not re.fullmatch(r"auth\.[A-Za-z_][A-Za-z0-9_]*", table):
        raise SystemExit(f"Invalid Auth table name in backup metadata: {table}")
    actual = int(psql(f'SELECT count(*) FROM {table};'))
    if actual != expected:
        raise SystemExit(f"QA row-count mismatch for {table}: expected {expected}, found {actual}.")

expected_auth = int(Path("auth-user-count.txt").read_text().strip())
actual_auth = int(psql("SELECT count(*) FROM auth.users;"))
if actual_auth != expected_auth:
    raise SystemExit(f"Auth user count mismatch: expected {expected_auth}, found {actual_auth}.")

expected_migrations = int(Path("migration-count.txt").read_text().strip())
actual_migrations = int(psql("SELECT count(*) FROM supabase_migrations.schema_migrations;"))
if actual_migrations != expected_migrations:
    raise SystemExit(f"Migration history count mismatch: expected {expected_migrations}, found {actual_migrations}.")

public_total = int(psql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"))
rls_total = int(psql("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relrowsecurity;"))
storage_total = int(psql("SELECT count(*) FROM storage.buckets;"))
if public_total != len(public_counts) or rls_total != public_total or storage_total != 0:
    raise SystemExit(f"Public schema/RLS/Storage validation failed: tables={public_total}, backed-up={len(public_counts)}, RLS-enabled={rls_total}, storage buckets={storage_total}.")

trigger_source = Path("auth-trigger.sql").read_text()
trigger_names = re.findall(
    r'CREATE\s+TRIGGER\s+("(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)\s+.*?\s+ON\s+auth\.users\b',
    trigger_source, flags=re.IGNORECASE | re.DOTALL
)
actual_trigger_names = set(filter(None, psql("""
SELECT t.tgname FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='auth' AND c.relname='users' AND NOT t.tgisinternal;
""").splitlines()))
expected_trigger_names = {name.strip('"').replace('""', '"') for name in trigger_names}
if not expected_trigger_names or not expected_trigger_names.issubset(actual_trigger_names):
    raise SystemExit("One or more exported custom auth.users triggers are missing after restore.")

print(f"QA restore verified: {public_total} public tables, {actual_auth} Auth users, {actual_migrations} migrations, RLS enabled on all public tables, and {len(expected_trigger_names)} custom Auth triggers.")
PY
