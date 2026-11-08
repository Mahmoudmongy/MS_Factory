# MS Factory — Database backup and recovery

## Current implementation status

The encrypted backup workflow now targets the dedicated Backblaze B2 bucket, not Cloudflare R2. It is intentionally inert until the repository variable `BACKUP_ENABLED` is set to `true`. A manual workflow run performs a B2-only preflight by default; it does not export production data unless the explicit run checkbox is selected and the enable variable is true.

No production backup has been uploaded and no restore drill has been completed yet.

## Backup design

1. GitHub Actions runs daily at 01:35 UTC. Manual runs can perform a storage preflight without touching Supabase data.
2. The workflow verifies the B2 S3 endpoint and bucket, then checks the bucket's default Object Lock configuration is exactly Compliance mode for 90 days and that a lifecycle rule expires objects under `backups/database/ms-factory/` after at least 120 days. It stops if either rule is absent or incorrect.
3. Supabase CLI exports database roles, schema and public data. A separate pg_dump exports selected Auth user/identity/MFA/WebAuthn rows, excluding active sessions and refresh tokens.
4. If any Supabase Storage buckets exist, the export stops. Storage object bytes are not yet included, so the workflow refuses to produce a misleadingly incomplete backup.
5. The archive is encrypted with an age public recipient on the GitHub runner before upload. Only the encrypted archive and its SHA-256 sidecar are uploaded.
6. The uploaded archive is checked for Compliance retention, downloaded again, and byte-compared with the original. The checksum sidecar is also downloaded and compared.
7. The workflow enforces a 9 GB ceiling on the dedicated MS Factory backup prefix. This is not an account-wide usage meter; monitor total B2 account usage separately.

## GitHub Actions configuration

Repository → Settings → Secrets and variables → Actions.

### Variables

- `B2_BUCKET`: `ms-factory-backups-2026`
- `B2_ENDPOINT`: `https://s3.us-east-005.backblazeb2.com`
- The public age recipient is pinned in the workflow file; it is not secret.
- `BACKUP_ENABLED`: keep `false` until all prerequisites and a QA restore drill have passed. Do not enable yet.

### Secrets

- `B2_KEY_ID`: bucket-scoped Backblaze Application Key ID.
- `B2_APPLICATION_KEY`: matching Backblaze Application Key.
- `SUPABASE_DB_URL`: dedicated production database connection string from Supabase Connect, preferably the Session Pooler URL suitable for GitHub-hosted runners. Never paste it into chat.

Do not store the age private identity in GitHub. Keep it offline in two encrypted copies in separate secure locations.

### Backblaze bucket requirements

- Bucket must remain private.
- Object Lock must be enabled.
- Default Bucket Retention must be explicitly configured as **Compliance / 90 days**. Merely seeing “Object Lock: Enabled” is not enough.
- Configure a lifecycle rule for prefix `backups/database/ms-factory/` to expire objects after 120 days. The workflow checks the rule but does not create or modify it.
- The Application Key must allow listing, reading and writing objects under the `backups/` prefix. The preflight also needs permission to read bucket Object Lock retention and lifecycle configuration; Backblaze documents `readBucketRetentions` for lock settings. Some bucket-restricted UI keys do not receive Object Lock capabilities, so a simple “Read and Write” label may not be sufficient. Do not use the master key in GitHub.

The workflow uses the prefix `backups/`, matching the filename prefix restriction on the configured Application Key.

## Create the encryption identity

On a trusted computer with age installed:

```bash
age-keygen -o ms-factory-backup-identity.txt
```

The workflow already contains the public recipient. Keep the private identity file offline in two encrypted copies; losing it makes the encrypted backups unrecoverable. Never commit or upload the private identity.

## Safe activation sequence

1. Confirm the bucket name and exact S3 endpoint shown in the Backblaze bucket details. A `NoSuchBucket` response usually means the bucket name/region endpoint do not match, or the key cannot access that bucket. Backblaze B2 accounts are associated with a single region; use the bucket's own endpoint. Confirm the default retention is Compliance / 90 days, not merely Object Lock enabled.
2. Configure the 120-day lifecycle rule for the exact prefix.
3. Add `SUPABASE_DB_URL` through GitHub Settings. The public age recipient is already configured in the workflow.
4. Run the workflow manually with the backup checkbox left unchecked. Confirm the B2 preflight succeeds. This checks storage configuration only and does not read Supabase production data.
5. Verify the workflow reports that Storage bucket count is zero. If not, stop and implement/test object backup before proceeding.
6. Keep `BACKUP_ENABLED=false` until an encrypted backup can be restored into a disposable QA Supabase project and Auth login, schema, row counts and application permissions are verified.
7. Only after the QA restore drill, consider enabling the daily schedule.

## Restore drill — QA only

1. Download the encrypted archive and checksum sidecar from B2.
2. Verify the checksum, decrypt with the offline age identity, and inspect the archive.
3. Restore only into a new, empty, disposable QA Supabase project using `scripts/restore-supabase-from-backup.sh`.
4. Verify Auth users, all recorded public/Auth row counts, migration history and representative application logins.
5. Record restore duration and latest recoverable backup timestamp.

Never point the restore script at production. It has a production project-ref guard as an additional safeguard.

## Known exclusions and operational limits

- Supabase Storage object bytes are not currently backed up. The workflow deliberately fails closed if any Storage bucket exists.
- Edge Function secrets, Auth provider settings, SMTP settings and external integration credentials must be escrowed separately in an encrypted offline password manager.
- Browser-only unsynchronized changes are not protected until they sync to Supabase.
- The 9 GB check covers this app's backup prefix only, not all buckets or total account consumption.
- A successful upload/read-back is not a successful recovery. Do not call the backup operational until a complete QA restore drill passes.
