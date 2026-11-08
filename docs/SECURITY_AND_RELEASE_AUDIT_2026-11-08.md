# Security and release audit notes — 8 November 2026

## Scope and environments

- Repository: `Mahmoudmongy/MS_Factory`
- Production Supabase project: `yvrislcbbhtruwdnuooz`
- Isolated QA Supabase project: `bjjouupxxodhbniqkjbs`
- Cloudflare account: linked to this workspace; Workers static-assets path is configured on the migration branch.
- No production database migration was applied during this QA pass. The new SQL migrations were exercised only against the isolated QA project.
- No Cloudflare production deployment was performed.

## Accounting and stock synchronization

- The accounting RPC is intentionally `SECURITY DEFINER`: production/invoice employees must update a narrowly scoped accounting source and its shared inventory delta without receiving direct write access to the full accounting table or inventory table.
- The RPC verifies the authenticated user, resolves their factory owner, checks the source permission, validates accounts/products/source references, enforces balanced ledger groups, checks the optimistic version, and applies the snapshot plus inventory delta in one transaction.
- Direct authenticated `INSERT/UPDATE/DELETE` privileges on `factory_accounting_state` are revoked. Employees read only their permitted source rows through RLS.
- For a first employee snapshot, only movement rows newer than the current inventory row's timestamp are applied; this avoids replaying historical movements already included in the inventory baseline. For later versions, the RPC applies the difference between the old and new movement snapshots, including reversals and edits.
- The administrator remains responsible for the full inventory and accounting snapshot. The employee RPC updates only the stock delta for the invoice or production source they are authorized to write.

## Production-only read access

- The previous owner-executed production views have been replaced with two narrow tables: `production_catalog` and `production_factory_config`.
- Both tables have RLS. Production employees can read only safe product/variant fields and the production configuration needed for their work.
- Private, non-API-exposed triggers maintain these projections from the canonical products, inventory, and factory_state tables.
- The full `factory_state` snapshot remains administrator-only; the production projection does not expose journal entries, customer balances, bank balances, or the full state JSON.
- A final field-level review found that the account chart array included a `cash` opening-amount field. A follow-up migration (`20261108220000_redact_account_balances_from_production_config.sql`) now allowlists only account id/code/name/type/category/currency fields and rebuilds existing projections. It deliberately strips `cash`, `balance`, and any unapproved account properties. This was exercised in a rolled-back QA transaction with sentinel values; the production employee could read the sanitized projection but could not read the full snapshot.

## Intentional Supabase advisor exception

The security advisor reports the public `sync_factory_accounting` RPC as a SECURITY DEFINER function. This is intentional and required for the atomic, permission-scoped inventory delta described above. It uses an empty search path, fully qualified table/function references, validates `auth.uid()` and module permissions, and is executable only by authenticated users. The underlying accounting table has no direct authenticated write grants.

The QA security advisor no longer reports the two previous SECURITY DEFINER view errors after replacing those views with RLS-protected tables.

## Remaining security action

Supabase Auth leaked-password protection is currently disabled according to the security advisor. This is an Auth project setting, not a SQL setting, and the available Supabase connector does not expose a control to change it. Enable it in the Supabase Dashboard under Authentication → Settings → Password Security before public production release.

## Backup status

- The backup workflow is present but deliberately disabled until R2 is enabled, a private bucket is created, immutable 90-day retention and 120-day lifecycle rules are configured, and the required GitHub variables/secrets are supplied.
- The workflow stops if any Supabase Storage bucket exists because Storage object bytes are not yet included.
- The archive uses age public-key encryption; the private key must remain offline and outside GitHub.
- It checksums database exports, verifies the uploaded encrypted object by downloading and byte-comparing it, and enforces a 9 GB ceiling below the 10 GB-month R2 free allowance.
- R2 is not enabled on the Cloudflare account at audit time; therefore no real backup object or restore drill exists yet. Do not claim recoverability until a complete restore has been performed in QA.

## Detailed QA synchronization test results

The isolated `ms-factory-qa` database was exercised using its existing administrator, production-only employee, and invoice-only employee profiles. The tests ran inside explicit SQL transactions and ended with `ROLLBACK`; a follow-up query confirmed that all QA test products, invoices, returns, vouchers, production orders, accounting snapshots, and factory snapshots were absent afterward.

Passed checks:
- Production employee created and version-updated a production order; stale order update was rejected with a serialization/version conflict.
- Production accounting accepted a balanced two-line ledger group and rejected an unbalanced group.
- Production movement quantity changed from +5 to +7; inventory changed from 10 to 15 to 17. A stale retry with +9 was rejected and inventory remained 17 (no duplicate movement).
- Invoice employee created a sale invoice, sale return, and receipt voucher using the versioned detail RPC.
- Invoice accounting synchronized balanced ledger groups for invoice, return, and voucher, and movement deltas changed stock from 17 to 15 after the sale/return net movement. Production-only and invoice-only users were denied the other module's write path.
- Production employee could read the production order and the restricted production configuration/catalog, but could not read the full factory snapshot or invoice rows. Invoice-only employee could not read production orders.
- The administrator could synchronize the manual settings source.
- The production configuration projection was tested with sentinel cash/balance values; the new allowlist migration removed those fields before the employee could read the projection.
- The production catalog projection was also exercised with a QA product carrying retail price 250, wholesale price 190, buy cost 12, and stock 7. The production-only user saw only the allowed product/variant quantity and buy-cost projection; the full `products` row and retail/wholesale/raw columns were not exposed.
- A further end-to-end review found a missing path: the accounting RPC applied inventory deltas for employees but skipped administrator-originated invoice/production/manual-journal movements. That meant a manager's stock changes could leave the production-only catalog stale. Migration `20261108230000_apply_admin_stock_deltas_to_production_catalog.sql` now applies the versioned movement delta for manager sources too. In QA, manager stock went 10 → 7 after a sale, 7 → 6 after editing the sale, and 6 → 8 after a manual stock journal; the production catalog reflected 8. A stale retry did not alter the quantity. This migration is applied to QA only, not production.

These are live Postgres/RLS/RPC integration tests against the QA project, not merely static mocks. They do not replace a real browser password-login test or a full restore drill.

## Latest CI result

Commit `daaaea44195ada43add1d3e104aa5665c793b08b` passed GitHub Actions:
- `npm audit --audit-level=high`: passed (no high-severity dependency audit failure).
- `npm run build`: passed.
- `wrangler deploy --dry-run`: passed; no deployment was performed.
- JavaScript and restore shell syntax checks: passed.
- Browser regression suite: **198/198 checks passed, 0 failed**, including all 19 screens, sales/purchases/returns/vouchers/production flows, stock/ledger balancing, XSS regressions, mobile layout, offline shell, customer/supplier field preservation and cloud refresh checks.

The browser suite intentionally runs without live Auth/cloud modules; the separate QA SQL tests above cover the database authorization and RPC layer.

## Authentication test limitation

The QA SQL tests ran as the `authenticated` database role with controlled JWT claims for administrator, production-only employee, and invoice-only employee profiles. This exercises RLS, RPC authorization, source isolation, version conflicts, and inventory effects. The browser regression suite deliberately disables live Auth/cloud modules; it does not prove a real password sign-in session. A final live login test with actual QA Auth credentials remains a release gate.

## Master-data concurrency hardening

The remaining last-write-wins path for customers, suppliers and products has now been replaced on the migration branch with `sync_factory_master_record` and migration `20261108250000_version_master_data_sync.sql`.

- Each customer, supplier and product row now carries `sync_version`, `updated_at` and `updated_by`.
- Writes use optimistic compare-and-swap: a new record must submit version 0; edits must submit the current version. Stale edits return SQLSTATE `40001` and cannot overwrite the newer copy.
- The RPC is permission-scoped: customers → customers permission, suppliers → suppliers permission, products → inventory permission. It validates the record ID, required name, customer type, nonnegative product quantities/prices and payload size.
- The browser sync now calls the RPC for all three master-data types, carries the version metadata across offline saves, preserves the remote copy on conflicts and counts conflicts instead of silently overwriting local edits.
- The new migration was applied only to the isolated QA project and passed rolled-back SQL tests for create, update, stale-write rejection, profile-field preservation, product update, and denial of production-only/invoice-only employee writes.
- Production remains unchanged; do not deploy this branch until the backup and remaining release gates are satisfied.

This removes the identified silent last-write-wins write path. It does not prove a real multi-browser offline race; that remains part of the live Auth/two-device release test.

## Release decision

Do not merge to production or deploy the Cloudflare worker until:
1. the complete CI suite passes on the final branch head;
2. the production DB migrations are reviewed and applied only after a verified backup;
3. R2 is enabled and a full backup plus QA restore drill succeeds;
4. real administrator and employee password logins are tested in QA;
5. Android device printing is checked on a physical device.
6. Customer/supplier/product master records pass versioned compare-and-swap tests (QA SQL passed); a real two-browser offline conflict-resolution drill remains required.

## Edge Function source verification

The two active production Edge Functions were read from Supabase and compared byte-for-byte with the repository sources on this branch:

- `create-employee-account`, deployed version 5 — identical to `supabase/functions/create-employee-account/index.ts`.
- `change-initial-password`, deployed version 1 — identical to `supabase/functions/change-initial-password/index.ts`.

Both have JWT verification enabled. The backup archive includes the repository function sources; this is currently an exact source backup of both deployed functions. The functions use Supabase-provided environment variables only; any future custom function secrets must be separately escrowed outside the repository.
