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
- The service worker cache was bumped to `factory-v11` and now precaches the accounting sync module.

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
