# MS Factory — Security and release audit
Date: 2026-11-08
Repository: `Mahmoudmongy/MS_Factory`
PR: #6 — `migration/cloudflare-workers-hosting`
Production Supabase: `yvrislcbbhtruwdnuooz`
Isolated QA Supabase: `bjjouupxxodhbniqkjbs`

## Scope and safety
This review used the isolated QA project for SQL regression testing and read-only inspection for production. No production migration, data mutation, backup activation, Cloudflare deployment, DNS change, PR merge or test-data cleanup was performed.

## CI and browser coverage
- Latest CI run `42491172536` passed on commit `21b70e7d7c8326b0838d138cb1605b5b57fe4688`.
- Dependency audit reported zero high-severity vulnerabilities.
- Vite build, Wrangler dry-run, backup CLI flag validation, syntax checks and `npm test` passed.
- Browser suite: 218/218 checks passed.
- Important limitation: browser tests stub live Supabase cloud sync. Real authenticated cross-device behavior is not covered.

## Supabase migration state
- Production has 13 applied migrations; isolated QA has 38.
- The additional branch migrations are QA/branch-only and have not been applied to production.
- Production has 11 public application tables with RLS enabled. This does not, by itself, prove every role/policy combination is correct.
- Production Storage currently has zero buckets.
- Last observed production row counts: factory_state 1, customers 9, products 3, invoices 0, production_orders 0, vouchers 0.

## QA synchronization and permission checks
The QA-only SQL regression suite was rerun on 2026-11-08 and completed without SQL error. It runs inside an explicit transaction and rolls back fixtures. Prior QA assertions cover:
- Production-only and invoice-only role boundaries.
- Restricted production catalog/config read models; no full factory snapshot or customer/cash balances exposed to production-only staff.
- Balanced ledger enforcement and invalid source/category rejection.
- Versioned invoice/detail/master/accounting writes and stale-version conflict rejection.
- Inventory delta application, edit/reversal behavior and retry idempotency.
- Returns, vouchers, production orders and soft-delete tombstones.
- QA fixture rollback.

These database tests do not replace real browser password-login tests or a two-device offline/reconnect exercise.

## Security advisor findings
- Production advisor reports **Leaked Password Protection Disabled**. This Auth setting must be enabled in Supabase Dashboard under Authentication → Settings → Password Security, then verified before release.
- QA advisor also reports the two public SECURITY DEFINER RPCs `sync_factory_accounting` and `sync_factory_master_record`. This is intentional in the current design: the RPCs are narrow permission-checked write paths, while direct authenticated writes to the accounting snapshot table are revoked. Both functions require careful manual review of `auth.uid()`, factory ownership, module permission, payload validation, search path and grants. Do not blindly revoke execution or change them to SECURITY INVOKER without redesigning and rerunning the role tests.
- QA performance advisor findings include unused indexes. These are informational in a low-traffic test environment; do not drop indexes based only on this snapshot.

## Hosting
- Cloudflare Worker `ms-factory` currently reports `has_assets=false`, empty deployment_id and no routes. The Worker record exists, but the app is not verified as deployed as Cloudflare Static Assets.
- The Cloudflare deploy workflow is manual-only and requires the main branch plus `CLOUDFLARE_RELEASE_APPROVED=true`.
- No Cloudflare production deploy or DNS change has been made.
- Vercel remains the fallback. Earlier Vercel Hobby daily deployment limits were reached; avoid repeated preview deployments.

## Encrypted backup — Backblaze B2
- Target: private bucket `ms-factory-backups-2026`, endpoint `https://s3.us-east-005.backblazeb2.com`.
- B2 preflight run `42491172561` passed credential/configuration checks, 90-day Compliance Object Lock verification, lifecycle verification and managed-prefix size check.
- The preflight job succeeded; the actual `backup` job was skipped intentionally because `BACKUP_ENABLED` is false.
- No database dump, encrypted archive upload, checksum read-back or restore test has occurred. Recoverability is therefore **not yet proven**.
- Workflow refuses to back up while Storage buckets exist because object bytes are not exported. Current production bucket count is zero.
- `SUPABASE_DB_URL` must be configured as a GitHub Actions secret. Never print its value.
- The age private identity must remain offline in two secure copies and must never be committed to the repository.

## Release gates
1. Verify `SUPABASE_DB_URL` secret presence without revealing it.
2. Obtain explicit approval for one production backup run, then restore into a disposable QA project and verify schema, Auth identities, row counts and login.
3. Test manager and employee password login in a real browser.
4. Test two-device offline creation, reconnect, conflict handling and idempotent retry.
5. Enable and verify leaked-password protection.
6. Test barcode printing on the actual Android device/printer.
7. Review all pending migrations and RLS policies against production data.
8. Separately approve production migration and Cloudflare deployment only after all gates pass.

## Current decision
**Not ready for production release.** CI and B2 preflight are successful, but backup/restore, real authenticated multi-device tests, Auth password protection, Android printing, migration review and verified Cloudflare static-asset deployment remain incomplete.
