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

A complete pure baseline pair now sits above the stock-only helpers:

- `buildFactoryBaseline(state)` packages the absolute stock manifest, account definitions, partner identities, opening-ledger lines, and opening-stock movement history. It refuses to publish if any source-scoped effects still need backfill, if an unscoped ledger/movement row is not clearly an opening balance, or if the opening journal is unbalanced.
- `applyFactoryBaseline(state, baseline)` validates all account/partner/item references before mutation, adds missing account definitions, links legacy partners by a unique name/phone match, restores stock as absolute quantities, and imports opening ledger/movement history without replaying stock deltas. Reapplying the same baseline is idempotent.
- Default SKU generation for new items now derives from the unique item ID rather than the local item count, reducing cross-device collisions while preserving manually entered SKUs.

The baseline fingerprint is a deterministic corruption check, not an authentication mechanism; publication and access must be enforced by the server-side RPC and permissions.

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

The branch now wires the baseline and source-effect helpers into normal client upload/download. The latest verified GitHub Actions run on the tested head passed **213/213 browser checks** and `npm run build`. Backup-code validation passed, while B2 preflight and backup remained skipped because `BACKUP_ENABLED=false`.

**Implemented on this isolated branch (not applied to Supabase):**
- New migration `20261108213000_factory_sync_baseline.sql` creates an immutable, one-time version-1 baseline and separate inventory/accounting read RPCs. Publication validates synchronized master references, balanced opening ledger, empty source-effect history, and uses a factory-level advisory lock shared with source writes.
- Client upload syncs products/partners first, then publishes the baseline once. Client download applies the inventory section as absolute stock plus history-only opening movements, and applies accounting definitions/partners/opening ledger separately. Each section has its own version cursor and failure does not advance that cursor.
- Source effects are now wired into upload/download with per-source optimistic versions, conflict preservation, and queued tombstones. SQL merges only the authorized section and preserves the hidden section atomically.
- Reports-only access is explicitly excluded from inventory/accounting source-effect and baseline reads. Deleting a transaction requires both its module permission and inventory permission because a tombstone removes both effect sections.
- A source effect with populated sections that the current role cannot write is not partially uploaded; it is retained as a permission conflict.

These paths remain dormant against Supabase until both draft migrations are reviewed and applied. The migration has not been executed against production or QA. The existing production data preflight found only opening ledger/movement rows and no source-scoped transactions, so the initial baseline is eligible once the migrations are safely validated. No two-device QA test has been performed.

## Rollout sequence

1. Source-scoped effect collection, stable identities, baseline publication/read, section-specific local apply, normal upload/download wiring, optimistic versions, and conflict preservation are implemented on this isolated branch.
2. The two feature migrations remain unapplied. Review them against the restored QA schema before applying them to QA.
3. Run the new manual-only `restore-supabase-backup-to-qa.yml` workflow after a complete encrypted B2 backup with its checksum sidecar exists. It restores roles/schema/data through the Supabase logical-restore sequence, leaves Supabase-managed Auth/Storage schemas intact, restores durable Auth rows and the custom `auth.users` trigger separately, and restores migration history only when the target lacks that schema.
4. The restore workflow refuses a non-empty target and hard-checks the QA project reference against the production reference. It verifies archive/file checksums, row counts, RLS coverage, Auth counts, migration counts, and the exact custom Auth trigger.
5. Read-only preflight confirmed QA currently has zero public tables, zero Auth users, zero Storage buckets, and no `supabase_migrations` schema. Production and QA Auth table column sets match; production has no custom Auth/Storage policies and one custom `auth.users` trigger. The restore script recreates only the missing migration-history schema rather than replacing managed Auth/Storage schemas.
6. The previous Run #36 archive is incomplete (no checksum sidecar), so the restore workflow will refuse it. The backup workflow now allows a one-time manual backup request while scheduled backups remain disabled by `BACKUP_ENABLED=false`.
7. The restore workflow has not been run. It requires `QA_SUPABASE_DB_URL` and a secure way to make the external age identity available to the runner. The private age identity has not been copied into GitHub or requested in chat; no secret was created or changed.
8. After a verified QA restore, apply both feature migrations to that restored QA copy only, then run two-device tests for baseline publication, section permissions, hidden-section preservation, create/edit/delete, tombstones, retries, offline/reconnect, idempotency, and version conflicts.
9. Review results, then separately approve production migrations. Keep scheduled backup activation and deployment separately gated.

## Explicitly out of scope for this branch

- No SQL execution or migration on the production Supabase project or QA.
- No writes to production data.
- No secrets, auth settings, or existing RLS policies changed.
- No enabling scheduled backups or changing deployment settings.
- No deployment or DNS changes.

## Remaining gate — QA restore and verification

The combined `applyFactoryBaseline` helper remains an administrator-only utility. Employee clients use only the section-specific apply helpers. The FNV fingerprint is a deterministic corruption check, not an authentication mechanism; authorization and database-side validation are the security boundary.