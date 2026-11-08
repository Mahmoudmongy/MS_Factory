#!/usr/bin/env bash
# Guarded logical restore for MS Factory. Run only against a new, empty QA project.
set -euo pipefail
umask 077

: "${BACKUP_FILE:?Set BACKUP_FILE to the downloaded .tar.gz.age object}"
: "${BACKUP_SHA256_FILE:?Set BACKUP_SHA256_FILE to its downloaded .sha256 sidecar}"
: "${AGE_IDENTITY_FILE:?Set AGE_IDENTITY_FILE to the offline age private identity file}"
: "${RESTORE_SUPABASE_DB_URL:?Set RESTORE_SUPABASE_DB_URL to the QA database connection string}"
: "${RESTORE_TARGET_PROJECT_REF:?Set RESTORE_TARGET_PROJECT_REF to the target QA project ref}"

PRODUCTION_PROJECT_REF="yvrislcbbhtruwdnuooz"
if [[ "$RESTORE_TARGET_PROJECT_REF" == "$PRODUCTION_PROJECT_REF" ]]; then
  echo "ERROR: refusing to restore into the production Supabase project." >&2
  exit 20
fi
if [[ ! "$RESTORE_TARGET_PROJECT_REF" =~ ^[a-z0-9]{20}$ ]]; then
  echo "ERROR: target project ref must be a 20-character Supabase project ref." >&2
  exit 21
fi
for command in age tar sha256sum psql python3; do
  command -v "$command" >/dev/null || { echo "ERROR: missing required command: $command" >&2; exit 22; }
done
[[ -s "$BACKUP_FILE" && -s "$BACKUP_SHA256_FILE" && -s "$AGE_IDENTITY_FILE" ]] || {
  echo "ERROR: backup, checksum sidecar, or offline identity file is missing/empty." >&2; exit 23;
}

# Verify that the declared target ref is actually present in the connection host or pooler username.
python3 - "$RESTORE_SUPABASE_DB_URL" "$RESTORE_TARGET_PROJECT_REF" <<'PY'
import sys
from urllib.parse import urlparse, unquote
parsed = urlparse(sys.argv[1])
ref = sys.argv[2]
host = parsed.hostname or ""
user = unquote(parsed.username or "")
if parsed.scheme not in ("postgres", "postgresql") or (ref not in host and ref not in user):
    raise SystemExit("ERROR: database URL does not identify the declared QA project ref.")
PY

backup_dir="$(cd "$(dirname "$BACKUP_FILE")" && pwd)"
backup_name="$(basename "$BACKUP_FILE")"
BACKUP_FILE="$backup_dir/$backup_name"
checksum_dir="$(cd "$(dirname "$BACKUP_SHA256_FILE")" && pwd)"
checksum_name="$(basename "$BACKUP_SHA256_FILE")"
if [[ "$backup_dir" != "$checksum_dir" ]]; then
  echo "ERROR: keep the encrypted archive and checksum sidecar in the same directory." >&2; exit 24
fi
(cd "$backup_dir" && sha256sum -c "$checksum_name")

work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT INT TERM
age --decrypt --identity "$AGE_IDENTITY_FILE" --output "$work/ms-factory-db-backup.tar.gz" "$BACKUP_FILE"
tar -tzf "$work/ms-factory-db-backup.tar.gz" >/dev/null
mkdir "$work/archive"
tar -xzf "$work/ms-factory-db-backup.tar.gz" -C "$work/archive"
cd "$work/archive"

for required in roles.sql schema.sql data.sql auth-users.sql migration-history-schema.sql migration-history.sql auth-trigger.sql auth-row-counts.txt public-row-counts.txt manifest.txt database-files.sha256 auth-user-count.txt migration-count.txt storage-bucket-count.txt; do
  [[ -s "$required" ]] || { echo "ERROR: backup archive is missing $required." >&2; exit 25; }
done
grep -qx 'project=ms-factory' manifest.txt || { echo "ERROR: unexpected backup manifest." >&2; exit 26; }
sha256sum -c database-files.sha256
[[ "$(cat storage-bucket-count.txt)" == "0" ]] || {
  echo "ERROR: this backup does not include Supabase Storage objects; restore refused." >&2; exit 27;
}

# Parse credentials into a mode-600 temporary environment file, not command arguments.
python3 - "$RESTORE_SUPABASE_DB_URL" "$work/pg_env.sh" <<'PY'
import sys, shlex
from urllib.parse import urlparse, unquote
url = urlparse(sys.argv[1])
values = {
    "PGHOST": url.hostname or "",
    "PGPORT": str(url.port or 5432),
    "PGUSER": unquote(url.username or ""),
    "PGPASSWORD": unquote(url.password or ""),
    "PGDATABASE": (url.path or "/postgres").lstrip("/") or "postgres",
    "PGSSLMODE": "require",
}
with open(sys.argv[2], "w", encoding="utf-8") as f:
    for key, value in values.items():
        f.write("export " + key + "=" + shlex.quote(value) + "\n")
PY
chmod 600 "$work/pg_env.sh"
source "$work/pg_env.sh"
target_users="$(psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM auth.users')"
target_migrations_table="$(psql -X -v ON_ERROR_STOP=1 -Atqc \"SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL\")"
if [[ "$target_migrations_table" == "t" ]]; then
  target_migrations="$(psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM supabase_migrations.schema_migrations')"
else
  target_migrations=0
fi
if [[ "$target_migrations" != "0" ]]; then
  echo "ERROR: target already has $target_migrations migration-history rows. Restore refused." >&2; exit 32
fi
if [[ "$target_users" != "0" ]]; then
  echo "ERROR: target Auth database is not empty ($target_users users). Restore refused." >&2; exit 28
fi
target_buckets="$(psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM storage.buckets')"
if [[ "$target_buckets" != "0" ]]; then
  echo "ERROR: target Storage already has $target_buckets buckets. Restore refused." >&2; exit 31
fi
for table in profiles factory_state customers suppliers products inventory invoices invoice_items returns vouchers production_orders factory_accounting_state production_catalog production_factory_config; do
  exists="$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT to_regclass('public.$table') IS NOT NULL")"
  if [[ "$exists" == "t" ]]; then
    rows="$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public.$table")"
    if [[ "$rows" != "0" ]]; then
      echo "ERROR: target public.$table already contains $rows rows. Restore refused." >&2; exit 29
    fi
  fi
done

echo "Target verified as empty QA project $RESTORE_TARGET_PROJECT_REF."
psql -X -v ON_ERROR_STOP=1 -f roles.sql
# Supabase's CLI restore guidance requires revoking target defaults before applying schema grants.
psql -X -v ON_ERROR_STOP=1 -c 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated'
psql -X -v ON_ERROR_STOP=1 -f schema.sql
psql -X -v ON_ERROR_STOP=1 -f migration-history-schema.sql
# Prevent the custom profile trigger from creating duplicate profiles during Auth import.
psql -X -v ON_ERROR_STOP=1 -c 'DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users'
psql -X -v ON_ERROR_STOP=1 -f auth-users.sql
psql -X -v ON_ERROR_STOP=1 -f data.sql
# Restore the exact source migration history so future CLI pushes do not replay old migrations.
psql -X -v ON_ERROR_STOP=1 -f migration-history.sql
# Restore the trigger only after profiles and Auth users have both been restored.
psql -X -v ON_ERROR_STOP=1 -f auth-trigger.sql

restored_users="$(psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM auth.users')"
expected_users="$(cat auth-user-count.txt)"
[[ "$restored_users" == "$expected_users" ]] || {
  echo "ERROR: restored Auth user count ($restored_users) does not match backup ($expected_users)." >&2; exit 30;
}
restored_profiles="$(psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM public.profiles')"
while IFS='=' read -r table expected; do
  [[ "$table" =~ ^[a-z_][a-z0-9_]*$ && "$expected" =~ ^[0-9]+$ ]] || { echo "ERROR: invalid public row-count manifest entry." >&2; exit 34; }
  actual="$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM public.\"$table\"")"
  [[ "$actual" == "$expected" ]] || { echo "ERROR: restored public.$table row count ($actual) does not match backup ($expected)." >&2; exit 35; }
done < public-row-counts.txt
while IFS='=' read -r table expected; do
  [[ "$table" =~ ^(users|identities|mfa_factors|mfa_recovery_code_sets|mfa_recovery_codes|webauthn_credentials)$ && "$expected" =~ ^[0-9]+$ ]] || { echo "ERROR: invalid Auth row-count manifest entry." >&2; exit 36; }
  actual="$(psql -X -v ON_ERROR_STOP=1 -Atqc "SELECT count(*) FROM auth.\"$table\"")"
  [[ "$actual" == "$expected" ]] || { echo "ERROR: restored auth.$table row count ($actual) does not match backup ($expected)." >&2; exit 37; }
done < auth-row-counts.txt
restored_migrations="$(psql -X -v ON_ERROR_STOP=1 -Atqc 'SELECT count(*) FROM supabase_migrations.schema_migrations')"
expected_migrations="$(cat migration-count.txt)"
[[ "$restored_migrations" == "$expected_migrations" ]] || {
  echo "ERROR: restored migration history ($restored_migrations) does not match backup ($expected_migrations)." >&2; exit 33;
}
echo "RESTORE COMPLETE: Auth users=$restored_users, profiles=$restored_profiles, all public/Auth table counts verified, migrations=$restored_migrations, target=$RESTORE_TARGET_PROJECT_REF"
echo "Next: deploy the archived Edge Functions, configure Auth providers, and run the QA login/invoice/production/ledger/stock checks."
