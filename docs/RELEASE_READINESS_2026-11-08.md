# MS Factory — Release readiness and test report
Date: 2026-11-08
Branch: `migration/cloudflare-workers-hosting`
Pull request: #6
Production Supabase ref: `yvrislcbbhtruwdnuooz`
Isolated QA Supabase ref: `bjjouupxxodhbniqkjbs`

## Latest verified CI
- GitHub Actions run `42491172536` completed successfully on commit `21b70e7d7c8326b0838d138cb1605b5b57fe4688`.
- `npm ci`, dependency audit (0 high-severity vulnerabilities reported), Playwright Chromium installation, Vite production build, Cloudflare Wrangler dry-run, Supabase CLI backup-flag checks, JavaScript/shell syntax checks, and `npm test` all passed.
- Browser regression suite: **218/218 checks passed, 0 failed**.
- Coverage includes desktop/mobile rendering, 19 application screens, sales/purchases/returns/vouchers/production, ledger and stock movement rules, barcode/print flow, CSV import/export, offline shell, sync conflict safeguards, local user-data isolation, and XSS regression checks.
- Browser tests stub live Supabase cloud sync; they do not prove real authenticated multi-device synchronization.

## Isolated QA database
- QA currently has 38 applied migrations; production has 13. The additional QA schema changes have not been applied to production.
- The QA-only transactional regression suite was rerun on 2026-11-08 and completed successfully. It uses explicit test identities and ends with ROLLBACK; it must never be run against production.
- Previous QA checks cover module permissions, restricted production read models, accounting balance validation, stock delta/idempotency, stale-version rejection, returns, vouchers, soft-delete behavior and protection of account balances.
- The QA security advisor reports the two permission-checked SECURITY DEFINER synchronization RPCs (`sync_factory_accounting`, `sync_factory_master_record`) plus leaked-password protection disabled. The RPC warnings are documented as intentional architecture and require manual code review; do not blindly revoke them.
- Real browser sign-in and two-device offline/reconnect tests remain outstanding.

## Production Supabase — read-only inspection
- Project status: ACTIVE_HEALTHY, region eu-west-2.
- 11 public application tables were found; RLS is enabled on all 11.
- Production currently has 13 applied migrations. No newer branch migration has been applied.
- Last observed row counts: factory_state 1, customers 9, products 3, invoices 0, production_orders 0, vouchers 0.
- Supabase Storage bucket count: **0**.
- Security advisor reports **Leaked Password Protection Disabled**. Enable and verify this Auth setting before public release.
- No production data or schema was changed during this inspection.

## Backblaze B2 backup preflight
- Target bucket: `ms-factory-backups-2026`; endpoint: `https://s3.us-east-005.backblazeb2.com`.
- Latest B2 preflight run `42491172561` succeeded: credentials/configuration, 90-day Compliance Object Lock, lifecycle configuration and backup-prefix size listing all passed.
- Backup job was **skipped intentionally** because backup activation remains disabled.
- No production database export, encrypted archive upload, checksum read-back or restore drill has been performed.
- `SUPABASE_DB_URL` must exist as a GitHub Actions secret before a controlled backup run. Its value must never be exposed in chat.
- Keep `BACKUP_ENABLED=false` until an encrypted backup has been restored successfully into a disposable QA project.
- The private age identity must remain offline in two secure copies; never commit it to GitHub.
- The workflow currently refuses to proceed if Supabase Storage buckets exist because Storage object bytes are not included in this backup.

## Cloudflare and Vercel
- Cloudflare Worker `ms-factory` exists, but its current script metadata reports `has_assets=false`, `deployment_id=""`, and no routes. This is not a verified live static-app deployment.
- Cloudflare deployment workflow is manual-only and additionally requires the main branch and `CLOUDFLARE_RELEASE_APPROVED=true`.
- No Cloudflare production deployment or DNS change was made.
- Vercel remains the fallback. Vercel Hobby daily deployment limits were reached during earlier attempts; avoid repeated preview deploys.

## Outstanding release gates
1. Verify the dedicated `SUPABASE_DB_URL` GitHub secret exists without exposing its value.
2. Run an explicitly approved encrypted backup, then restore it into a new disposable QA Supabase project and verify Auth, schema, row counts and login.
3. Run real manager and production-only employee sign-ins against QA.
4. Test offline create → reconnect → second-device pull, conflict handling and retry idempotency using two actual browsers/devices.
5. Enable Supabase Auth leaked-password protection and verify it.
6. Test barcode printing on the actual Android device/printer.
7. Review all pending migrations and RLS policies against production data before any production migration.
8. Only after these gates, separately approve production migrations and Cloudflare deployment. Keep Vercel as rollback/fallback.

## Release decision
**Not ready for production deployment.** CI and B2 preflight are green, but backup/restore, real authenticated multi-device behavior, Auth password protection, Android printing, migration review and a real Cloudflare static-assets deployment remain incomplete.

No PR merge, production migration, Cloudflare production deployment, DNS change, backup activation or test-data cleanup has been performed.
