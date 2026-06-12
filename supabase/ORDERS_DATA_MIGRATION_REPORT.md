# Browser Data Migration Report — Orders (Phase 2)

This report inventories **every browser-side store the live Orders feature uses today**
and defines exactly how each is migrated into Supabase, how duplicates are prevented,
how to roll back, and how to verify. It ends with the precise first-run sequence that
executes on an existing user's device.

---

## Scope

**In scope (the live Orders system):**
- IndexedDB database **`BellezaReynaOrdersDB`** (version 4), object stores:
  `confirmedOrders`, `orderItems`, `draftOrders`, `excludedProducts`, `deselectedProducts`.
- localStorage keys: **`belleza_confirmed_claves`**, **`belleza_confirmed_snap_id`**.

These are read/written by `src/contexts/OrderContext.tsx` via `src/lib/db/orders-db.ts`
— the only Orders provider mounted in `src/app/layout.tsx`.

**Explicitly OUT of scope (legacy / not mounted — NOT migrated by Phase 2):**
| Store | Where | Why excluded |
|---|---|---|
| `localStorage['orderHistory']` | `src/contexts/OrderHistoryContext.tsx` | Provider is **not** mounted in `layout.tsx`; dead legacy path. |
| `localStorage['reyna_order_history']`, `reyna_inventory`, `reyna_supplier`, `reyna_targets` | `src/app/upload/page.tsx` | Pre-IndexedDB legacy upload flow; superseded by InventoryContext. |
| `localStorage['stockTargets']` | `src/contexts/StockTargetContext.tsx` | Not mounted; legacy. |
| `localStorage['reyna_lang']` | `LanguageContext` | UI language, not order data. |

> These are noted for completeness so nothing is silently double-migrated. They will be
> addressed (if ever) in a later cleanup phase, not here.

---

## Per-source migration matrix

### 1. IndexedDB `BellezaReynaOrdersDB` → `draftOrders`
- **Source location:** `orders-db.ts` store `draftOrders` (keyPath `id`, string `draft_…`), each with embedded `items[]`.
- **Purpose:** Pending (work-in-progress) orders that must not affect dashboards until confirmed.
- **Target tables:** `public.draft_orders` (+ `public.draft_order_items`, FK cascade).
- **Migration strategy:** For each local draft, `INSERT` a `draft_orders` row (DB generates a new `uuid` id; legacy `draft_…` id is dropped — it was never a real uuid), preserving `name`, `supplier_name`, `total_products`, `total_value`, `created_at`, `updated_at`; then bulk-`INSERT` its `draft_order_items`.
- **Duplicate prevention:** Per-device run-once flag (below). `draft_order_items` has a `UNIQUE(draft_id, clave)`; items are de-duped per draft before insert.
- **Rollback:** Local IndexedDB is **never deleted** by the migrator. If anything fails, the device still has its source of truth; re-running is blocked (see flag) to avoid dupes; a failed migration can be cleared by deleting the flag after manually removing any partial rows.
- **Verification:** After migration, `draft_orders` count ≥ local draft count for this device; open **Pending Orders** in two browsers and confirm the same drafts appear.

### 2. IndexedDB `BellezaReynaOrdersDB` → `confirmedOrders` + `orderItems`
- **Source location:** stores `confirmedOrders` (keyPath `id`, string `ord_…`) and `orderItems` (autoincrement, index `orderId`).
- **Purpose:** Confirmed order history (counts toward dashboards/metrics).
- **Target tables:** `public.confirmed_orders` (+ `public.order_items`, FK cascade).
- **Migration strategy:** Direct `INSERT` (NOT the `confirm_order_lines` RPC) so the **original `confirmed_at`** timestamp is preserved and confirmed-claves/deselect side-effects are NOT re-triggered. New `uuid` per order; items linked by it.
- **Duplicate prevention:** Per-device run-once flag. (Confirmed orders have no natural key, so the device flag is the guard — see "started→done" semantics below.)
- **Rollback:** Local IndexedDB retained; flag-gated re-run prevents duplicate history.
- **Verification:** Order history list shows the migrated orders with their original dates; totals match the pre-migration local totals.

### 3. IndexedDB `BellezaReynaOrdersDB` → `excludedProducts`
- **Source location:** store `excludedProducts` (keyPath `clave`).
- **Purpose:** Permanent "Do Not Order" list (survives imports/reloads).
- **Target table:** `public.excluded_products`.
- **Migration strategy:** `UPSERT` keyed on `clave`, preserving `descripcion`, `proveedor`, `excluded_at`.
- **Duplicate prevention:** Idempotent by design — PK is `clave`; `on conflict (clave)` makes re-insert a no-op/update.
- **Rollback:** Local IndexedDB retained.
- **Verification:** Excluded products appear identically across browsers; excluded claves stay out of the Total Order list.

### 4. IndexedDB `BellezaReynaOrdersDB` → `deselectedProducts`
- **Source location:** store `deselectedProducts` (keyPath `clave`).
- **Purpose:** Products temporarily skipped in the current order (shared toggle).
- **Target table:** `public.deselected_products`.
- **Migration strategy:** `UPSERT` keyed on `clave` (`ignoreDuplicates`).
- **Duplicate prevention:** Idempotent — PK `clave`.
- **Rollback:** Local IndexedDB retained.
- **Verification:** Deselected toggles reflected across browsers.

### 5. localStorage `belleza_confirmed_claves` → `confirmed_order_claves`
- **Source location:** `OrderContext.tsx` (`CONFIRMED_KEY`), a JSON array of claves.
- **Purpose:** Claves already confirmed in the **current import cycle** → dropped from the live Total Order list until the next import.
- **Target table:** `public.confirmed_order_claves`.
- **Migration strategy:** `UPSERT` each clave keyed on `clave`.
- **Duplicate prevention:** Idempotent — PK `clave`.
- **Rollback:** localStorage value retained (not removed by migrator).
- **Verification:** Previously-confirmed claves remain hidden from the Total Order list after migration.

### 6. localStorage `belleza_confirmed_snap_id` → (control flag; NOT migrated as data)
- **Source location:** `OrderContext.tsx` (`CONFIRMED_SNAP_KEY`).
- **Purpose:** Tracked which snapshot the confirmed-claves belonged to, to reset them on a new import.
- **Target:** **None.** This responsibility moves server-side: `import_inventory_snapshot` / `finalize_import` already `DELETE FROM confirmed_order_claves` at the start of every new import cycle (verified in `002`). The key is simply ignored/abandoned.
- **Duplicate prevention / rollback / verification:** N/A (no data carried).

---

## Run-once flag & idempotency

- **Flag:** `localStorage['belleza_orders_migrated_v1']`.
  - Absent → migration eligible.
  - `'started:<ts>'` → an attempt began; **do not auto-run again** (prevents duplicate drafts/confirmed orders if a prior attempt failed mid-way).
  - `'done:<ts>'` → completed successfully.
  - `'empty'` → there was nothing to migrate on this device.
- Clave-keyed tables (excluded/deselected/confirmed_order_claves) are **fully idempotent**
  via `on conflict (clave)`, so even a forced re-run cannot duplicate them.
- Drafts and confirmed orders are guarded by the flag (no natural key), so the migrator
  intentionally **does not** retry automatically after a partial failure.

## Rollback strategy (whole feature)
1. The migrator **never deletes** local IndexedDB or localStorage — they remain the
   device's rollback copy.
2. To force a clean re-migration on a device: remove rows you don't want in Supabase,
   then delete `localStorage['belleza_orders_migrated_v1']` and reload.
3. To abandon Phase 2 entirely: revert the app code; the untouched local stores resume
   serving data exactly as before.

## Verification strategy (whole feature)
- **Automated:** `npx tsc --noEmit` clean; `supabase/verify.sql` all PASS.
- **Cross-client:** Two approved browsers see identical drafts, history, excluded and
  deselected lists in real time (Supabase Realtime).
- **Counts:** For a device with known local data, post-migration Supabase counts equal
  (idempotent tables) or ≥ (drafts/confirmed, because other users may have added rows).
- **Approval gate:** An unapproved user sees none of it and cannot write (RLS).

---

## Exact first-run migration sequence (on an existing device)

Executed by `migrateOrdersToSupabaseOnce()` (in `src/lib/supabase/orders-migration.ts`),
invoked from `OrderContext` once the user is **signed-in AND approved**:

1. **Guard:** if Supabase is not configured → return. If `belleza_orders_migrated_v1`
   is set (`started`/`done`/`empty`) → return.
2. **Read legacy data** from this device:
   `drafts = ordersDB.getDraftOrders()`, `confirmed = ordersDB.getConfirmedOrders()`,
   `excluded = ordersDB.getExcludedProducts()`, `deselected = ordersDB.getDeselectedClaves()`,
   `confirmedClaves = JSON.parse(localStorage['belleza_confirmed_claves'] || '[]')`.
3. **Nothing to do?** If all five are empty → set flag = `'empty'` and return.
4. **Mark started:** set flag = `'started:<now>'` (blocks any concurrent/duplicate run).
5. **Write to Supabase, in this order** (idempotent ones first):
   1. `excluded_products`  ← upsert(excluded)
   2. `deselected_products` ← upsert(deselected)
   3. `confirmed_order_claves` ← upsert(confirmedClaves)
   4. `confirmed_orders` + `order_items` ← insert(confirmed, preserving `confirmed_at`)
   5. `draft_orders` + `draft_order_items` ← insert(drafts, preserving timestamps)
6. **Success:** set flag = `'done:<now>'`. Local stores are kept (rollback).
7. **Failure:** log the error; leave flag = `'started:<…>'` (no auto-retry → no dupes);
   local stores remain authoritative for this device.
8. **Reconcile UI:** `OrderContext` then loads all order state from Supabase and
   subscribes to Realtime, so the device immediately shows the shared dataset.

> Because Suppliers/Product-Settings (Phase 1) carried no historical browser data worth
> preserving, this device-migration step is unique to Orders.
