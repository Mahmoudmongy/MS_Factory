# MS Factory — Release readiness and test report
Date: 2026-11-08
Branch: `migration/cloudflare-workers-hosting`
Pull request: #6
Production Supabase ref: `yvrislcbbhtruwdnuooz`
Isolated QA Supabase ref: `bjjouupxxodhbniqkjbs`

## Verified in this run

### Automated application CI
- GitHub Actions run `42467143505` completed successfully.
- `npm ci`, `npm audit --audit-level=high`, Vite production build, Cloudflare Wrangler dry-run, Supabase CLI backup flag validation, JavaScript syntax checks, restore shell syntax checks, and Playwright browser suite all passed.
- Browser suite: **218/218 checks passed, 0 failed**.
- Coverage includes desktop and mobile UI, 19 screens, invoice/purchase/return/voucher/production flows, ledger balance, stock effects, item variants, barcode/print, CSV import/export, offline cache, pending-sync retry, user-local-storage isolation, role UI, and XSS regression cases in partner/item forms, report tables, and print metadata.
- The CI test runner disables the live Supabase cloud-sync module during browser tests. Therefore these 218 checks are not evidence of a complete real-browser authenticated cloud-sync session.

### Isolated Supabase QA integration
- QA project is separate from production and has 3 test profiles: administrator, production-only, invoice-only.
- QA database contains the branch's current schema/migrations, including versioned detail sync, accounting snapshots, production read models, scoped master-data sync, soft-delete tombstones and related security hardening.
- Executed `supabase/tests/qa_sync_regression.sql` against QA. It completed without SQL exceptions; the script uses a transaction and rolls all test fixtures back.
- Additional QA RLS assertions passed: production-only account cannot read invoices, vouchers, the full factory snapshot, or full accounting snapshots; invoice-only account cannot read production catalog/orders or full factory snapshot.
- QA application business tables returned to zero fixture rows after rollback; the three QA profiles remain.

### Production database — read-only inspection only
- Production has 11 public application tables and RLS is enabled on all 11.
- Production currently has 13 applied migrations, while QA has the newer sync/accounting migrations. The new migrations have **not** been applied to production.
- Read-only counts at inspection: factory_state 1, customers 9, products 3, invoices 0, production_orders 0, vouchers 0.
- No production records were modified during this test run.
- Database connections require SSL; password hashing is SCRAM-SHA-256.

## Security and synchronization work in this branch

- Added source-scoped accounting/stock synchronization for invoice, production and administrator journal categories.
- Added version checks, stale-write conflict handling, payload validation, balanced-ledger validation, source-record references, and atomic inventory deltas.
- Added narrow production catalog/config read models so a production-only user does not receive the full factory snapshot or accounting balances.
- Added versioned soft deletes and retry-safe deletion behavior for business records.
- Added local account storage isolation and offline pending-sync retry behavior.
- Hardened multiple HTML rendering paths and added XSS regression tests.
- CI now blocks release if the accounting/stock upload-and-pull path or R2 storage guard regresses.

## Backup design committed, but not yet operational

The backup workflow is designed to:
- run daily at 01:35 UTC after explicitly enabled;
- export roles, schema, public data, Auth users/identities/MFA/WebAuthn data, migration history, migration files, Edge Function source and row-count manifests;
- encrypt the archive locally with `age` before upload (private decryption key remains offline);
- upload only ciphertext to a private R2 bucket;
- enforce a 90-day R2 bucket-lock rule and 120-day lifecycle expiry;
- refuse Infrequent Access storage and stop before exceeding a 9 GB account-wide Standard storage safety ceiling;
- read the uploaded object back and byte-compare it, with SHA-256 checks;
- restore only to a verified empty QA project and explicitly refuse the production project.

### Current backup blocker
Cloudflare API currently returns error 10042: **R2 must first be enabled through the Cloudflare Dashboard**. No R2 bucket exists yet, and no real encrypted backup or restore drill has run. The backup workflow remains disabled until the bucket, lock/lifecycle rules, encryption recipient and scoped credentials are configured. Do not treat backups as active yet.

## Release decision — do not deploy or merge yet

The PR is clean and CI is green, but the following production gates remain:
1. Enable R2 in the Cloudflare Dashboard, create a private EU bucket, configure lock/lifecycle rules and credentials.
2. Run the first encrypted production backup, verify read-back, then restore it into QA and validate Auth, public rows and login.
3. Perform authenticated browser integration tests against QA using real manager and employee sessions, including offline create → reconnect → pull on a second browser/device, conflict resolution, retry idempotency, and ledger/stock parity.
4. Review and apply the new Supabase migrations to production only after the verified backup and QA restore drill.
5. Deploy Cloudflare only after those gates; keep the existing Vercel production deployment as fallback.

Cloudflare Workers deployment remains behind a manual workflow input and the `CLOUDFLARE_RELEASE_APPROVED=true` repository variable. The public `workers.dev` subdomain and previews are disabled. No Cloudflare production deployment was made.
