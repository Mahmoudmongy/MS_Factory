# MS Factory — Release readiness and test report
Date: 2026-11-08
Branch: `migration/cloudflare-workers-hosting`
Pull request: #6
Production Supabase ref: `yvrislcbbhtruwdnuooz`
Isolated QA Supabase ref: `bjjouupxxodhbniqkjbs`

## Latest verified CI
- GitHub Actions run `42491082860` completed successfully on the latest tested branch commit before this report update.
- `npm ci`, `npm audit --audit-level=high` (0 reported vulnerabilities), Playwright Chromium install, Vite production build, Cloudflare Wrangler dry-run, pinned Supabase CLI backup flag checks, JavaScript/shell syntax checks, and `npm test` all passed.
- Browser regression suite: **218/218 checks passed, 0 failed**.
- Coverage includes desktop/mobile rendering, 19 application screens, purchasing/sales/returns/vouchers/production, balanced ledger and stock movements, barcode/print flow, CSV import/export, offline shell, sync conflict safeguards, local user-data isolation, and XSS regression checks.
- The automated browser suite stubs live Supabase cloud sync. It does not prove a real authenticated multi-device sync session.

## Isolated QA database
- QA project is separate from production and contains administrator, production-only and invoice-only test profiles.
- Transactional SQL regression tests and permission/RLS assertions passed previously; test fixtures were rolled back.
- QA schema contains the newer versioned sync, accounting/stock, production read-model and soft-delete migrations.
- Real browser sign-in and two-device offline/reconnect tests remain outstanding.

## Production Supabase — read-only inspection
- 11 public application tables were found; RLS is enabled on all 11.
- Production currently has 13 applied migrations. Newer branch migrations have **not** been applied to production.
- Read-only row counts observed: factory_state 1, customers 9, products 3, invoices 0, production_orders 0, vouchers 0.
- Supabase Storage bucket count: **0**.
- Security advisor currently reports **Leaked Password Protection Disabled**. This must be enabled and verified before release.
- No production data or schema was changed during this inspection.

## Backblaze B2 backup preflight
- Target bucket: `ms-factory-backups-2026`; endpoint: `https://s3.us-east-005.backblazeb2.com`.
- Latest B2 preflight run `42491082890` succeeded: credentials/configuration, Compliance Object Lock 90-day retention, lifecycle rule, and dedicated backup-prefix size check all passed.
- The prefix listing now uses S3 `ListObjectsV2`.
- The backup job was **skipped** because actual backup creation remains deliberately disabled.
- No production database export, encrypted archive upload, checksum read-back, or restore drill has been performed.
- `SUPABASE_DB_URL` is required as a GitHub Actions secret before a controlled backup run. Keep `BACKUP_ENABLED=false` until a disposable QA restore succeeds.
- The private age identity must remain offline in two secure copies. Never commit it to GitHub.

## Outstanding release gates
1. Verify the dedicated `SUPABASE_DB_URL` GitHub secret is configured without exposing its value.
2. Run an explicitly approved encrypted backup, then restore it into a new disposable QA Supabase project and verify Auth, schema, row counts and login.
3. Run real manager and production-only employee sign-ins against QA.
4. Test offline create → reconnect → second-device pull, conflict handling and retry idempotency using two actual browsers/devices.
5. Enable Supabase Auth leaked-password protection and verify it.
6. Test barcode printing on the actual Android device/printer.
7. Review all branch migrations and RLS policies against production data before any production migration.
8. Only after these gates, separately approve production migrations and Cloudflare deployment. Keep Vercel as fallback.

## Release decision
**Not ready for production deployment.** CI and B2 storage preflight are green, but backup/restore, real authenticated multi-device behavior, Auth password protection, Android printing and production migration review remain incomplete.

No PR merge, production migration, Cloudflare production deployment, DNS change, backup activation or test-data cleanup has been performed.
