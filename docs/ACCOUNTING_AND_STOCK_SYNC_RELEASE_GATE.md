# Accounting and stock synchronization — release gate

Audit date: 2026-11-08

## Status

A source-scoped, versioned synchronization implementation is present on `migration/cloudflare-workers-hosting` and its database migrations have been applied to the isolated QA Supabase project. It has **not** been applied to production and has **not** been deployed to Cloudflare.

## Implemented in the branch

- `factory_accounting_state` stores independent `invoices`, `production`, and administrator-only `settings` snapshots.
- `sync_factory_accounting` uses optimistic version checks; stale writes return SQLSTATE `40001`.
- The RPC checks source permissions, account IDs against the factory chart, balanced debit/credit totals per source transaction, document/order references, product references, payload shape and a 5 MiB payload ceiling.
- RLS exposes only the source categories granted to the signed-in profile. Manual journals/opening balances are administrator-only.
- Production-only users receive a restricted `production_catalog` view with item identity, unit, warehouse, stock quantities and material buy cost. It omits retail/wholesale prices and raw product JSON.
- Browser sync keeps per-source version/hash baselines, merges only the authorized source, recalculates stock from movement history, preserves local changes on conflicts, and offers an administrator restore-from-cloud action after saving a local conflict copy.
- The service worker cache was bumped to `factory-v12` and now precaches the accounting sync module.

## QA SQL tests executed

All QA tests ran inside explicit transactions and ended with `ROLLBACK`; no test rows were retained.

- Administrator: creates and updates all three source snapshots.
- Production-only employee: updates production source only; sees only the production accounting row; cannot write invoices or settings.
- Invoice-only employee: updates invoice source only; sees only the invoice accounting row; cannot write production or settings.
- Stale source versions are rejected.
- Unknown account IDs are rejected.
- Unbalanced ledger batches are rejected.
- Ledger rows that do not reference a synchronized invoice or production order are rejected.
- Movements that reference unknown products are rejected.
- Production-only catalog returns allowed item and quantity fields; invoice-only account sees zero catalog rows.

## Remaining release blockers

1. The current browser test harness disables the authentication bootstrap and `js/cloud-sync.js`; therefore it does not prove a real login/session sync in Chromium. QA SQL role-claim tests are not a substitute for real Auth sign-in.
2. No real two-device offline/reconnect and concurrent-edit cycle has yet been run against the browser app.
3. Full end-to-end cycles still need verification for sales, purchases, returns, vouchers, production issue/receipt, waste, journal entries, reversals and their matching ledger/stock totals.
4. The production database has not received the new migrations. Do not deploy the new frontend until backup and migration ordering are complete.
5. The encrypted R2 backup workflow is prepared but inactive: R2 must be enabled, bucket retention configured, and GitHub secrets/variables set. A restore drill has not yet been completed.
6. The app's shared browser-local state needs a final multi-account isolation review before declaring employee data confidentiality complete.

## Release rule

Do not merge/deploy this branch to production until the remaining blockers are tested and documented. A green static build or unit suite alone is not production approval.


## Additional full QA regression run — 2026-11-08

The complete `supabase/tests/qa_sync_regression.sql` script was executed successfully against the isolated `ms-factory-qa` Supabase project. The script runs inside one transaction and ends with `ROLLBACK`; a follow-up count query confirmed zero retained QA fixture rows in customers, suppliers, products, invoices, returns, vouchers, production orders and accounting snapshots.

Coverage includes:
- Administrator, production-only employee and invoice-only employee JWT/RLS contexts, including full factory snapshot version increment and stale snapshot rejection.
- Production order create/update, stale update rejection, soft-delete, idempotent delete retry and restore.
- Sale invoice create/update and invoice line replacement; purchase invoice create.
- Sale return and purchase return creation.
- Receipt voucher and outgoing payment voucher.
- Source-scoped ledger batches with per-source debit/credit balancing.
- Production/sale/purchase/return stock movement netting and manager opening-stock adjustment.
- Duplicate retry does not double-apply movement quantity; stale version does not alter inventory.
- Master-data create/update/stale-write tests for customers, suppliers and products, including custom raw fields and permitted negative stock.
- Cross-permission denial for production-only and invoice-only profiles, and checks that production users cannot read full factory state, canonical products, customer invoices, cash balances or retail/wholesale prices.

Two defects were found by running the complete suite and corrected in follow-up migrations applied to QA only:
1. The versioned delete RPC referenced `updated_by` on returns, vouchers and production orders although those columns were missing. Migration `20261108280000_add_detail_sync_audit_columns.sql` adds the columns and audit triggers.
2. Updating an existing invoice used an ambiguous unqualified `invoice_id` reference because it collided with the RPC output variable. Migration `20261108290000_fix_invoice_item_delete_ambiguity.sql` qualifies the invoice_items table alias.
3. The QA performance advisor found seven unindexed `updated_by` foreign keys. Migration `20261108300000_index_updated_by_foreign_keys.sql` adds covering indexes; a follow-up advisor run reports no remaining unindexed foreign keys. The remaining unused-index notices are informational on a small QA dataset and were not removed without real workload evidence.

Production has not received these migrations. They must be included in the final migration sequence and reviewed before production rollout.
