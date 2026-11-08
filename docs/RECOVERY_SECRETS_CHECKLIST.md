# MS Factory — recovery secrets and configuration escrow

This checklist is deliberately separate from the database archive. Never commit secrets, service-role keys, database passwords, cloud tokens, or the age private identity to GitHub.

## Keep offline in an encrypted password manager

- Supabase production project reference, region, project URL and current database connection information.
- A dedicated database password and Session Pooler connection string for backup automation.
- Supabase publishable key (public) and current secret/service-role key (private). The private key must never be included in the browser bundle.
- Supabase Auth configuration: redirect URLs, email confirmation/password policy, SMTP settings, provider configuration, templates and MFA policy.
- Edge Function secret values required by deployed functions; source code is archived but secret values are not.
- Backblaze B2 region/endpoint, private bucket name, bucket-scoped Application Key ID and Application Key.
- Vercel project identifiers and environment variable names/values needed to keep the fallback deployment available.
- GitHub repository Actions variable/secret names and recovery contact details.

## Encryption identity — separate from the online vault

- Keep the `age` private identity on two offline encrypted media copies in separate physical locations.
- Keep only the public `age` recipient in GitHub Actions variable `AGE_RECIPIENT`.
- Never upload the private identity to GitHub, Supabase, Backblaze B2, Cloudflare or Vercel.

## GitHub Actions configuration names

Variables:
- `B2_BUCKET` — `ms-factory-backups-2026`
- `B2_ENDPOINT` — `https://s3.us-east-005.backblazeb2.com`
- `AGE_RECIPIENT` — public age recipient only.
- `BACKUP_ENABLED` — keep `false` until a QA restore drill succeeds.

Secrets:
- `B2_KEY_ID`
- `B2_APPLICATION_KEY`
- `SUPABASE_DB_URL` — dedicated Session Pooler connection string.

The restore machine needs `AGE_IDENTITY_FILE` and `RESTORE_SUPABASE_DB_URL` supplied locally at run time; do not store either in the online backup archive.

## Compromise response

If the production app, GitHub account, Supabase project, or Backblaze account is suspected compromised:

1. Disable backup/deploy automation while preserving immutable backup objects.
2. Revoke compromised GitHub, B2, Supabase secret/service-role and database credentials; rotate Auth signing keys/configuration as appropriate.
3. Create a clean Supabase project and restore only into that isolated project using the guarded restore script.
4. Reconfigure Auth providers, redirect URLs, SMTP and Edge Function secrets from the offline vault.
5. Redeploy the app against the new project URL and publishable key; never reuse a leaked service-role key.
6. Verify Auth login, permissions, invoice and voucher writes, production-only access, ledger, stock quantities and row counts before switching traffic.
7. Keep the previous production project isolated for forensic review; do not reconnect it to the new app.

## Recovery objective

- Scheduled backup cadence: daily; target RPO is up to 24 hours only after the schedule is enabled and a successful backup is verified.
- RTO is not yet known. It must be measured by a successful end-to-end restore drill on QA.
- No backup design can promise 100% security. The goal is encrypted, private, immutable, independently restorable copies plus separately protected recovery credentials.
