# MS Factory — recovery secrets and configuration escrow

This checklist is deliberately separate from the database archive. Never commit secrets, service-role keys, database passwords, Cloudflare tokens, or the age private identity to GitHub.

## Keep offline in an encrypted password manager

- Supabase production project reference, region, project URL and current database connection information.
- A dedicated database password and Session Pooler connection string for backup automation.
- Supabase publishable key (public) and the current secret/service-role key (private). The private key must never be included in the browser bundle.
- Supabase Auth configuration: allowed redirect URLs, email confirmation/password policy, SMTP settings, provider configuration, templates, and MFA policy.
- Edge Function secrets and configuration names/values required by \`create-employee-account\` and any future functions. The source code is archived; secret values are not.
- Cloudflare account ID, private R2 bucket name/jurisdiction, bucket-scoped S3 access key ID/secret, and the read-only API token used to verify bucket-lock configuration.
- Vercel project identifiers and environment variable names/values needed to keep the fallback deployment available.
- GitHub repository Actions variable/secret names and the recovery contact details for the account.

## Encryption identity — separate from the online vault

- Keep the \`age\` private identity on two offline encrypted media copies in separate physical locations.
- Keep only the public \`age\` recipient in GitHub Actions variable \`AGE_RECIPIENT\`.
- Never upload the private identity to GitHub, Supabase, Cloudflare, Vercel or the R2 bucket.

## GitHub Actions configuration names

Variables:
- \`BACKUP_ENABLED\` — keep \`false\` until a real QA restore succeeds.
- \`AGE_RECIPIENT\` — public key only.
- \`R2_ACCOUNT_ID\`
- \`R2_BUCKET\`

Secrets:
- \`SUPABASE_DB_URL\` — Session Pooler connection string.
- \`R2_ACCESS_KEY_ID\`
- \`R2_SECRET_ACCESS_KEY\`
- \`CLOUDFLARE_R2_LOCK_TOKEN\` — read-only R2 bucket-lock inspection token.

The restore machine needs \`AGE_IDENTITY_FILE\` and \`RESTORE_SUPABASE_DB_URL\` supplied locally at run time; do not store either in the online backup archive.

## Compromise response

If the production app, GitHub account, Supabase project, or Cloudflare account is suspected compromised:

1. Disable backup/deploy automation while preserving the existing immutable backup objects.
2. Revoke the compromised GitHub, Cloudflare R2, Supabase secret/service-role and database credentials; rotate Auth signing keys/configuration as appropriate.
3. Create a clean Supabase project and restore only into that isolated project using the guarded restore script.
4. Reconfigure Auth providers, redirect URLs, SMTP and Edge Function secrets from the offline vault.
5. Redeploy the app against the new project URL and publishable key; never reuse a leaked service-role key.
6. Verify Auth login, permissions, invoice and voucher writes, production-only access, ledger, stock quantities and row counts before switching traffic.
7. Keep the previous production project isolated for forensic review; do not reconnect it to the new app.

## Recovery objective

- Scheduled backup cadence: daily; target RPO is up to 24 hours only after the schedule is enabled and a successful backup is verified.
- RTO is not yet known. It must be measured by a successful end-to-end restore drill on QA.
- No backup design can promise 100% security. The goal is encrypted, private, immutable, independently restorable copies plus separately protected recovery credentials.
