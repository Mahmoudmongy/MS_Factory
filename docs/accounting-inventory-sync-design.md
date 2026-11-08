# Accounting and inventory synchronization — implementation design

Status: investigation complete; implementation must remain gated until the data contract and migration are reviewed.

## Verified current behavior

- The administrator uploads the complete `factory_state.state` snapshot through `sync_factory_state`. This snapshot includes `accts`, `items`, `L`, `mv`, `docs`, `vch`, `po`, `je`, and `wo`.
- Non-admin users use detail-table synchronization. They upload invoices, returns, vouchers, production orders, products and partner records, subject to profile permissions.
- Detail-table uploads do not include the associated `S.L` ledger rows or `S.mv` stock movements. Detail-table downloads likewise merge documents/orders/products but do not merge those effects.
- `post()` creates ledger rows with `src` and `rid`, but no per-line immutable ID. `stk()` creates movement rows with `src` and `rid`; its `rid` identifies the originating operation.
- `rev(rid)` removes all ledger and stock rows with the matching `rid`, and reverses stock locally. The identifier is not globally unique across all source categories; the source category must be part of any synchronization key.
- Source categories in active code include `doc`, `po`, `vch`, `je`, and `wo`. Production order receipt/material effects use the production-order ID; waste uses its own waste-operation ID. Opening stock uses `je` with the item ID.
- Invoice, return, voucher and production-order raw records are independently synchronized. Their existence does not imply that their ledger and stock effects are synchronized.
- Product upsert currently exports the current aggregate quantity and raw product object. Applying that quantity and also replaying movements would double-count stock unless one representation is explicitly authoritative.
- The client currently generates local numeric IDs and SKU values. Account IDs and item IDs are therefore not safe cross-device foreign keys without a stable mapping strategy.
- Detail-record conflict handling stores a newer remote copy in `_cloudConflict`; it does not merge or apply it. This is a deliberate safety boundary that must be preserved.

## Verified live production baseline (read-only inspection)

A read-only aggregate inspection of the linked production project found:

- The current `factory_state.state` contains 19 accounts and 3 products.
- Its ledger contains 4 rows, all tagged `je`, but none has a `rid`. Their shape is the legacy opening-balance journal, not source-scoped transactions.
- Its stock movement array contains 3 rows, all with reference `رصيد افتتاحي`, and none has `src` or `rid`. These are opening-stock baselines, not replayable transactions.
- The snapshot currently has 0 sales/purchase documents, 0 production orders, 0 vouchers, and 0 waste records.
- The 3 product records contain absolute variant quantities and item valuation. The live detail tables currently have no duplicate product SKUs, no duplicate product external IDs, and no products/customers/suppliers missing external IDs.

**Consequence:** for the current factory, there are no historical source-scoped movements or ledger effects to backfill. The four legacy ledger rows and three opening movements must remain part of the opening baseline and must never be replayed as transactions. The first employee bootstrap needs an absolute stock baseline plus the opening ledger snapshot; future movements then use source-scoped effects.

A pure helper pair has now been added to `js/cloud-sync.js`:

- `buildStockBaseline(state)` creates a deterministic, sorted manifest of item external IDs, variants, absolute quantities, and valuation, and rejects duplicate IDs or invalid stock values.
- `applyStockBaseline(state, manifest)` verifies the manifest checksum and validates every item before changing anything. It replaces absolute quantities (never adds deltas), is idempotent, refuses partial application if any referenced item is missing, and preserves non-stock fields and local-only items.

The draft SQL RPCs were also tightened during review: privileged `SECURITY DEFINER` implementations now live in the unexposed `private` schema behind `SECURITY INVOKER` public RPC wrappers. The read RPC exposes ledger and movement sections independently according to permissions. **Writes currently reject role-redacted/partial payloads and require both source-category and inventory write permissions**; this is an intentional fail-closed gate until atomic section-aware merging is implemented. This prevents an inventory-only client from replacing a full effect with an empty hidden ledger section.

These helpers are not yet wired into the live sync flow. The baseline must be published and versioned before employee devices use it; only then may post-baseline movement effects be applied as deltas.

## Canonical master-record identity

New inventory items and customer/supplier records now carry a `cloudId` while keeping their existing local numeric `id` for the UI and local references. Uploads use `cloudId` as the detail-table `external_id`; source-effect normalization maps local item/partner IDs to that canonical identity, and remote effect application resolves either the canonical ID or the local ID. Legacy rows without `cloudId` retain their existing external ID based on the original ID.

When a device already has a legacy item/contact under a different local ID, the merge helper links it only when there is exactly one matching SKU/name (items) or name/phone (contacts). Ambiguous or mismatched matches are preserved as conflicts instead of silently creating duplicates or merging unrelated records. The database's per-factory unique SKU index is a final guard against two independently created items claiming the same operational SKU.

## Non-negotiable correctness requirements

1. **Idempotency:** retrying an upload or download must not duplicate ledger rows, movements, balances, or costs.
2. **Source-scoped identity:** all effect identity must include factory owner, source category, and source record ID. Never key by `rid` alone.
3. **Atomic replacement:** editing a source replaces its complete effect set as one transaction; it must not append a second copy.
4. **Tombstones:** deleting a source must publish an explicit versioned deletion marker. Absence from a device is not proof of deletion.
5. **Optimistic concurrency:** a stale device must receive a conflict and preserve both copies; it must not silently overwrite a newer source.
6. **Stable account mapping:** ledger account references must resolve by a stable account code/identity, not device-local numeric account IDs.
7. **Stable item mapping:** stock movements must resolve to a stable item identity plus variant and warehouse identity. Existing SKU values cannot be assumed globally unique.
8. **Single stock authority:** choose either (a) authoritative opening/current stock plus movement deltas from a known baseline, or (b) movement-ledger reconstruction. Never apply both aggregate quantity and the same movements.
9. **Permissions:** non-admin users may only publish/read effect sets for source categories they are authorized to operate. This must be enforced server-side, not only in JavaScript.
10. **Admin snapshot:** keep the full snapshot admin-only. Do not broaden snapshot access to make employee synchronization appear to work.
11. **Compatibility:** existing production data and local browser caches must remain readable. No destructive backfill or production migration is part of this branch.

## Proposed data contract (design only; not deployed)

Introduce a source-effect record keyed by `(user_id, source_type, source_id)`, containing:
- monotonic `sync_version`;
- `deleted_at` tombstone (nullable);
- canonical JSON payload with the complete ledger rows and stock movements generated by that source;
- server-managed `updated_at` and `updated_by`.

Publish/replace through one authenticated, permission-checking RPC using compare-and-swap version semantics. Read only effect rows permitted by the caller's source-category permissions. Keep the effect payload separate from the raw invoice/order JSON so raw-document synchronization cannot accidentally be mistaken for accounting synchronization.

The RPC must validate source categories, ownership, payload shape/size, and permission mapping. It must not trust client-supplied `user_id`, account IDs, item IDs, or permission claims. Account/item references should be canonical external keys resolved server-side, or be stored as stable code/identity strings and resolved by the receiving client with explicit conflict reporting.


## Findings confirmed against the live schema (read-only)

- Employee ownership is resolved by `profiles.created_by`; the admin owns the factory row. Existing RLS policies call `private.can_access_factory_owner(user_id, permission, write)`. The draft RPC derives the owner from the authenticated profile and calls this function; it never accepts a client-supplied owner ID.
- Existing detail tables use `external_id` scoped by `user_id`. The app currently writes product `external_id = String(item.id)`, and partner `external_id = String(partner.id)`. The normalizer therefore translates local account IDs to account codes, and local item/partner IDs to the same external IDs already used by detail sync.
- The live factory snapshot has account codes and the live products table currently has no duplicate non-empty SKU values. The draft migration adds a per-factory unique SKU index so two devices cannot silently register different products under the same operational SKU. If a pre-existing duplicate appears before migration rollout, index creation will fail safely rather than choose one record.
- The app's first-launch opening ledger rows have `src='je'` but no `rid`; opening stock rows have no source identity. The collector explicitly excludes rows marked `رصيد افتتاحي` from replayable deltas. They remain part of the admin snapshot / opening baseline and must not be replayed as transactions.
- Stock movements contain item, variant, quantity and value, but do not record a historical warehouse ID. The normalizer can attach the item's current warehouse label for context only; it cannot reconstruct historical warehouse changes or true multi-warehouse stock from the existing data model.

## Implemented on the isolated branch (not enabled)

- `collectSourceEffects` groups `S.L` and `S.mv` by `(src,rid)`, keeping equal IDs from different source categories separate and excluding legacy seed opening rows that have no source ID.
- `normalizeSourceEffects` maps local account IDs to account codes, item IDs to the product external ID already used by detail sync, and partner IDs to partner external IDs. It carries account metadata and rejects missing/ambiguous mappings, duplicate account codes/SKUs, and unbalanced ledger groups.
- Upload and download planners handle new effects, exact-version replacement, remote-version conflicts, tombstones, and no-resurrection behavior.
- The local apply helper can replace one source effect, resolve local foreign keys, and reverse/reapply only that source's stock deltas. It supports redacted payloads so inventory-only access does not overwrite or expose ledger lines.
- `rev()` and all edit/delete call sites now scope reversals by both source type and source ID. Previously, equal IDs from different categories could reverse unrelated rows.
- Deleting a source now persists an offline tombstone in `mgr6-cloud-effect-tombstones` before local reversal.
- The draft migration creates versioned source-effect storage, a compare-and-swap write RPC, per-source locking, tombstones, and per-factory SKU uniqueness. Direct table reads are revoked; `get_source_effects()` returns role-redacted ledger/movement sections.

Executed 26 focused helper/static checks directly against the branch files: **26/26 passed**. These checks are not a substitute for the full Playwright suite or a two-device QA restore.

**Not wired/enabled yet:** normal sync does not call the new RPCs or fetch/apply effect rows. The migration has not been executed against Supabase. Stock replay must wait until the full historical effect backfill is complete, because product raw records currently carry aggregate stock and replaying movements on top of that would double-count. The migration and helpers have no live effect on production or QA.

## Rollout sequence

1. Add pure client helpers to collect and normalize effects by `(src,rid)`, without changing existing upload behavior.
2. Add tests for every source category and for repeated collection, edit/replacement, deletion tombstones, and same `rid` under different `src` values.
3. Finalize stable account/item/warehouse identity rules and the single stock-authority rule against the actual app data model.
4. Add a migration and RPC with RLS/grants and server-side permission checks. Review against the live schema before applying anywhere.
5. Add client upload/download behind a disabled feature flag. Preserve conflict copies and do not auto-apply unresolved effects.
6. Test against a disposable, schema-matched QA restore with two independent clients. Verify ledger balances, stock by variant/warehouse, edit, delete, retries, and permission boundaries.
7. Only after QA passes, consider enabling for a controlled employee role. Keep the admin snapshot path unchanged.

## Explicitly out of scope for this branch

- No SQL execution or migration on the production Supabase project.
- No writes to the production database.
- No secrets, auth settings, or RLS policy changes.
- No automatic application of remote ledger/movement effects to a local cache.
- No enabling automated backups or changing deployment settings.
