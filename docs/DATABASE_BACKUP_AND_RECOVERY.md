# MS Factory — Database backup and recovery

## Current status

This is the backup implementation/runbook. The scheduled job is intentionally disabled until the private R2 bucket and the required GitHub secrets/variables are configured. No database password, encryption private key, or R2 secret is committed to this repository.

The Supabase Free plan does not provide the automatic daily platform backups available on paid plans. A separate encrypted off-site export is therefore required.

## Architecture

1. GitHub Actions runs once daily (01:35 UTC) and can also be started manually from the `main` branch.
2. Supabase CLI exports roles, schema, and public database data. Because the CLI excludes managed Auth schemas, the workflow separately exports only `auth.users` and `auth.identities` using `pg_dump`; it does not export active sessions or refresh tokens.
3. The archive is encrypted with an age public recipient before it leaves the runner.
4. Only the encrypted archive is uploaded to a private Cloudflare R2 bucket over the S3-compatible API.
5. The workflow verifies that the uploaded object exists and records its encrypted SHA-256 in the job log.
6. The workflow never uploads plaintext SQL or a plaintext GitHub Actions artifact. The Auth export contains password hashes and identity metadata, so it is included only inside the age-encrypted archive.

The workflow does not run on pull requests. It requires a bucket-scoped R2 access key and read/write access to the backup bucket only.

## One-time configuration

### A. Create the encryption key offline

On a trusted computer with age installed:

```bash
age-keygen -o ms-factory-backup-identity.txt
```

- Keep the private identity file in an offline password manager / encrypted USB. Do not commit it and do not put it in GitHub.
- Copy only the public recipient (the line beginning `age1`) into the GitHub repository variable `AGE_RECIPIENT`.
- Keep a second offline copy of the private identity. Losing it makes encrypted backups unrecoverable.

### B. Enable and create private Cloudflare R2 storage

R2 is not enabled on this Cloudflare account yet. The API currently responds that R2 must first be enabled in the Cloudflare Dashboard.

After enabling R2, create a private bucket named `ms-factory-db-backups` in the EU jurisdiction if available. Do not connect a public domain and do not enable public access.

Create an R2 API token restricted to this bucket with Object Read & Write. Do not use an account-wide token if a bucket-scoped token is available.

Recommended protection:
- Add an R2 bucket-lock rule for prefix `database/ms-factory/` with a 35-day age retention. This prevents deletion and overwriting during the retention period, including by a compromised upload token.
- Configure lifecycle expiry after 90 days. Bucket-lock retention takes precedence, so objects remain locked for at least 35 days.
- Monitor storage against the R2 free allowance (10 GB-month storage, 1 million Class A operations and 10 million Class B operations per month). If usage exceeds the free allowance, stop the job or reduce retention rather than incur charges.

### C. Add GitHub Actions configuration

Repository → Settings → Secrets and variables → Actions.

**Variables**
- `AGE_RECIPIENT`: public age recipient only.
- `R2_ACCOUNT_ID`: Cloudflare account ID.
- `R2_BUCKET`: `ms-factory-db-backups`.

**Secrets**
- `SUPABASE_DB_URL`: the database connection string from Supabase Connect (use a dedicated database password; never paste it into chat).
- `R2_ACCESS_KEY_ID`: bucket-scoped R2 key.
- `R2_SECRET_ACCESS_KEY`: matching secret.

Never store the age private identity in GitHub. The private key stays offline for recovery.

## Restore drill (must be performed on QA, never directly on production)

1. Download one encrypted object from R2 to a trusted recovery computer.
2. Verify its encrypted checksum if the checksum was saved separately.
3. Decrypt it using the offline private identity:

```bash
age --decrypt --identity ms-factory-backup-identity.txt \
  --output ms-factory-db-backup.tar.gz backup.tar.gz.age
```

4. Verify the archive and extract it:

```bash
tar -tzf ms-factory-db-backup.tar.gz
mkdir restore-check && tar -xzf ms-factory-db-backup.tar.gz -C restore-check
```

5. Restore into a disposable QA Supabase project with a matching Postgres/Auth version. Restore schema first, then import `auth-users.sql` into the existing managed Auth tables, then import `data.sql` with triggers disabled for the data phase so the `auth.users` trigger does not duplicate `profiles`. The exact restore sequence must be proven on QA before any production recovery. Do not point restore commands at production.
6. Compare counts for `auth.users`, `profiles`, `factory_state`, customers, suppliers, products, invoices, invoice items, returns, vouchers and production orders. Then log into the restored QA app and verify representative records and permissions.
7. Record restore duration and the latest recoverable backup timestamp.

## What this database backup does not include

- Cloudflare Worker deployment configuration or GitHub settings (these are in GitHub / Cloudflare).
- Supabase Edge Function deployment settings and Auth provider configuration.
- Supabase Storage object bytes. The current production project has no Storage buckets, but if one is added, its objects need a separate R2 copy/restore process.
- Browser-only unsynchronized data. A device that has pending local changes must reconnect and finish syncing before those changes are protected by the database backup.

## Security notes

No backup system is "100% secure". The design reduces ransomware and credential-leak risk through encryption before upload, an offline-only decryption key, a bucket-scoped upload credential, private R2 access, and object-lock retention. A successful recovery drill is required before calling the backup operational.
