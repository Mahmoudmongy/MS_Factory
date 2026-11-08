# Critical release blocker — accounting and inventory synchronization

Audit date: 2026-11-08

## Verified current state

- The browser application stores accounting journal lines in `S.L` and inventory movement history in `S.mv`.
- `js/cloud-sync.js` does not upload or download either collection. Its only references to these fields are in the local-empty check.
- The current Supabase public schema has 11 tables: `customers`, `factory_state`, `inventory`, `invoice_items`, `invoices`, `production_orders`, `products`, `profiles`, `returns`, `suppliers`, and `vouchers`. There is no journal/ledger-line table and no stock-movement history table.
- The full `factory_state` snapshot is administrator-only. A production-only employee cannot use it to send accounting or stock movement history.
- Production orders are synchronized as detail records, but that is not equivalent to synchronizing the associated journal entries and stock movements.

## Consequence

A production-only employee can create/update an order in the cloud while the resulting local ledger entries and stock movements remain on that device. The manager may see the production order but not the complete accounting and inventory consequences. This can cause cloud/local balances and stock movement history to diverge.

## Release decision

Cloudflare production deployment must remain blocked until this is fixed and verified. The CI suite now contains an explicit release-gate assertion for the missing accounting/movement sync path; it is expected to fail until implementation is complete.

## Required implementation shape

Do not let employees overwrite the full factory snapshot. Implement a permission-scoped, versioned synchronization path for the source records that create accounting and inventory effects.

Preferred design:
1. Add a source-scoped accounting synchronization store or normalized append-only journal-line and stock-movement tables, keyed to the factory owner.
2. Use a SECURITY INVOKER RPC with a strict source-to-permission map (invoice/voucher sources require invoices permission; production sources require production permission; manual journal sources require settings/admin permission).
3. Apply optimistic version checks and atomic updates so stale devices cannot silently replace newer data.
4. Pull only the source categories the signed-in employee is authorized to read. A production-only employee must not gain access to customer balances, bank balances, or unrelated accounting sources.
5. Preserve local pending changes and surface conflicts instead of silently overwriting either copy.
6. Keep the admin full snapshot consistent with the merged accounting and movement data after pull.

## Mandatory acceptance tests

- Production-only employee creates a production order offline, reconnects, and the order plus its journal lines and stock movements appear for the manager.
- Manager edits or reverses the order; the employee receives the correct version or an explicit conflict.
- Retry after a lost response does not duplicate journal lines, stock movements, or quantities.
- Two devices updating the same source concurrently cause a version conflict, not a lost update.
- An employee with production-only permission cannot read or write invoices, vouchers, customer data, full snapshots, or other employees' accounting sources.
- Invoice-only employee can synchronize invoice-related journal and stock effects but cannot synchronize production.
- A complete sale, purchase, return, voucher, production, and reversal cycle yields matching local and cloud balances and stock movement totals.
- Offline queue survives refresh/browser restart and clears only after all required writes succeed.
