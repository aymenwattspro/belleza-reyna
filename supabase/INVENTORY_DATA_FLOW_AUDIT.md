# Inventory / Order Data‑Flow Audit & Root‑Cause Analysis

**Scope:** Why Supabase inventory/order tables stay empty and realtime does not sync, even though imports report SUCCESS.
**Method:** Followed every UI click → context → persistence layer. No assumptions; every claim is tied to a file + function. **No fixes applied** (audit only).

---

## TL;DR (Root Cause)

The app is running in **HYBRID mode**:

| Domain | Source of truth | Writes to Supabase? |
|---|---|---|
| **Inventory** (imports, current stock, history, target stock) | **IndexedDB** (`BellezaReynaOrdersDB`/inventory DB) | ❌ **NO** |
| Suppliers | Supabase | ✅ yes (`suppliersRepo`) |
| Product settings | Supabase | ✅ yes (`productSettingsRepo`) |
| Orders (drafts / confirmed / excluded / deselected / claves) | Supabase **after the Phase‑2 rewrite** of `OrderContext` | ✅ yes (`ordersRepo`) — see note |

**The precise point where inventory data stops reaching Supabase:**
`src/app/inventory-hub/page.tsx → handleConfirmImport()` calls `useInventory().addSnapshot()` and `useInventory().updateTargetStock()`. Both live in `src/contexts/InventoryContext.tsx` and write **only** to `inventoryDB` (IndexedDB). **There is no `inventoryRepo`, and no client code anywhere calls the Supabase import RPCs (`begin_import` / `import_inventory_chunk` / `finalize_import`) or writes to `imports` / `current_inventory` / `stock_history`.** The Supabase backend for inventory is fully built (migration `003_import_chunking.sql`) but **completely unreachable from the UI.**

This single fact explains every symptom: import "succeeds" (IndexedDB write works), no errors (no network call is attempted), Supabase inventory tables stay empty, and Browser A ≠ Browser B (IndexedDB is per‑device, so realtime has nothing to broadcast).

---

## A. Current import execution path (UI click → persistence)

File: `src/app/inventory-hub/page.tsx`

1. User clicks **Import** → `<input type="file">` → `handleFileSelect(file)` (line ~364)
   → `parseCSVToPreview` / `parseExcelToPreview` (from `src/lib/utils/timeline-parsers.ts`) → sets `preview` state.
2. `GuidedImportModal` renders; user maps columns and clicks **Import** → `onConfirm` → `handleConfirmImport(mapping, supplier, mode)` (line ~374).
3. Inside `handleConfirmImport`:
   - `applyMappingToRows(...)` → transforms raw rows into `ProductSnapshot[]` (transform step).
   - `await addSupplierByName(supplier)` → **Supabase** via `SupplierContext`/`suppliersRepo` (this is why `suppliers` has data).
   - **Mode `targetstock`:** `await updateTargetStock(targetUpdates)` →
     `InventoryContext.updateTargetStock` → **`inventoryDB.updateTargetStock(...)` (IndexedDB)**.
   - **Mode `snapshot`:**
     - `hashProducts(...)` → `checkFileDuplicate(hash)` → `inventoryDB.isFileDuplicate` (**IndexedDB**).
     - `await addSnapshot(snapshot, fileHash)` →
       `InventoryContext.addSnapshot` → **`inventoryDB.saveSnapshot(...)` (IndexedDB)**.
     - Optionally `await updateTargetStock(...)` → **IndexedDB**.
   - `toast.success(...)` → reports SUCCESS regardless of Supabase.

**Persistence destination reached:** IndexedDB only. **Supabase REST/RPC calls in this path:** none (other than the unrelated supplier upsert).

---

## B. Actual storage destination (where writes really land)

All inventory writes go through `src/contexts/InventoryContext.tsx`, which imports `inventoryDB` from `src/lib/db/inventory-db.ts` (a hand‑rolled IndexedDB service, DB name in `orders-db.ts` family = `BellezaReyna*`). Concretely:

- `addSnapshot()` → `inventoryDB.saveSnapshot()` → IndexedDB stores `imports`, `current_inventory`, `stock_history` **(these are IndexedDB object stores, not Postgres tables)**.
- `updateTargetStock()` → `inventoryDB.updateTargetStock()` → IndexedDB `current_inventory` store.
- `refreshData()` → reads `inventoryDB.getImports()/getCurrentInventory()/getAllStockHistoryItems()` → IndexedDB.
- `deleteSnapshot()`, `clearAllData()` → IndexedDB.

> ⚠️ Naming collision that hides the bug during code search: the IndexedDB **object stores** are literally named `current_inventory` and `stock_history`, identical to the Supabase **tables**. Grepping those strings yields hits in `inventory-db.ts` that look Supabase‑related but are pure IndexedDB.

Other IndexedDB write sites for inventory (legacy/duplicate UI):
- `src/components/inventory/UploadZone.tsx` → `inventoryDB.saveSnapshot`
- `src/components/inventory/InventoryLayout.tsx` → `inventoryDB.saveSnapshot`
- `src/app/inventory-timeline/page.tsx` → `inventoryDB.init/getSnapshots/clearAll`

---

## C. Expected Supabase destination (what the backend is built to receive)

Migration `001_shared_workspace_schema.sql` creates the tables: `imports`, `current_inventory`, `stock_history`, `product_settings`, `draft_orders`, `draft_order_items`, `confirmed_orders`, `order_items`, `excluded_products`, `deselected_products`, `confirmed_order_claves`, `suppliers`, `app_settings`, `audit_log` — all with RLS `approved_all` (`is_approved()`) and all added to the `supabase_realtime` publication.

Migration `003_import_chunking.sql` provides the **intended inventory import pipeline**:
- `begin_import(jsonb) → uuid`
- `import_inventory_chunk(uuid, jsonb) → {new,updated,unchanged,processed}`
- `finalize_import(uuid)` → clears `confirmed_order_claves` + audit.

These RPCs are even typed in `src/lib/supabase/types.ts` (`Functions.begin_import / import_inventory_chunk / finalize_import`). **They are never called by any client code.**

---

## D. Missing repository calls

- **There is no `inventoryRepo` / `inventoryRepository` file at all.** (`src/lib/supabase/repos/` contains only `orders-repo.ts`, `suppliers-repo.ts`, `product-settings-repo.ts`.)
- `InventoryContext` imports `inventoryDB` (IndexedDB) and nothing from `@/lib/supabase`.
- No call site for `supabase.rpc('begin_import' | 'import_inventory_chunk' | 'finalize_import')`.
- No `supabase.from('imports' | 'current_inventory' | 'stock_history').insert/upsert(...)` anywhere in `src/`.

---

## E. Missing Supabase writes (per inventory table)

| Supabase table | Backend ready? | Client write path exists? | Reachable? | Result |
|---|---|---|---|---|
| `imports` | ✅ (table + `begin_import`) | ❌ none | — | empty |
| `current_inventory` | ✅ (table + `merge_inventory_product`) | ❌ none | — | empty |
| `stock_history` | ✅ | ❌ none | — | empty |
| `confirmed_order_claves` | ✅ (cleared by `finalize_import`) | read‑only in `ordersRepo`; cleared only by `finalize_import` which is never called | partial | empty (also never reset) |

---

## F. Dead / legacy code still in use or stranded

- **Stranded backend:** `003_import_chunking.sql` (all three RPCs) + the `imports`/`current_inventory`/`stock_history` tables — built, deployed, unused.
- **Active legacy persistence:** `src/lib/db/inventory-db.ts` (IndexedDB) is the live inventory store. `src/lib/db/orders-db.ts` is still used by the one‑time migrator `src/lib/supabase/orders-migration.ts` (intended) and as the type source for order shapes.
- **Duplicate import UIs** writing to IndexedDB: `UploadZone.tsx`, `InventoryLayout.tsx`, `inventory-timeline/page.tsx` — these will keep writing to IndexedDB even after inventory is migrated, unless retired/redirected.
- **Minor dead code:** `src/lib/supabase/repos/orders-repo.ts` `confirmDraft()` has an unreachable `console.log('CONFIRM DRAFT RPC CALLED')` after `return data` (line ~435).

---

## 6. Source of truth determination

**HYBRID.**
- **IndexedDB is the source of truth for inventory** (stock, history, imports, target stock) and therefore for everything derived from it (dashboard KPIs, product behavior charts, and the *order line candidates* shown on the Orders page, which are built by `buildOrderFromSnapshot(latestSnapshot.products, …)` in `inventory-hub/page.tsx` from the IndexedDB `latestSnapshot`).
- **Supabase is the source of truth for suppliers, product settings, and (post Phase‑2 rewrite) orders.**

Because the order *candidate list* is computed from IndexedDB inventory, orders remain coupled to per‑device IndexedDB even though order persistence now targets Supabase.

---

## 7–8. Why the order tables specifically stay empty

The order tables (`draft_orders`, `draft_order_items`, `confirmed_orders`, `order_items`, `confirmed_order_claves`, `deselected_products`, `excluded_products`) now **do** have a reachable Supabase write path after the Phase‑2 `OrderContext` rewrite:

- `src/app/orders/page.tsx` uses `useOrder()` → `saveDraftFromLines` / `addLinesToDraft` / `confirmOrder` → `ordersRepo.createDraft / updateDraft / confirmOrderLines` (Supabase insert + `confirm_order_lines` RPC).
- `src/app/draft-orders/page.tsx` and `draft-orders/[id]/page.tsx` → `confirmDraft` → `ordersRepo.confirmDraft` (`confirm_draft_order` RPC).

So if those tables are still empty during testing, the cause is **one of the following (in priority order)**, not missing code:

1. **The observation predates the Phase‑2 rewrite.** The "no REST/RPC requests during order creation" symptom matches the *previous* IndexedDB‑backed `OrderContext`. Re‑test after the rewrite with a hard reload.
2. **No inventory in Supabase ⇒ nothing natural to order from in a second browser.** Because order candidates come from IndexedDB inventory, Browser B (empty IndexedDB) shows no order lines to save, so it never creates rows. This is a *downstream* effect of the inventory root cause.
3. **Approval/RLS gate.** All order tables enforce `is_approved()`. Reads/realtime in `OrderContext` are gated on `approved`; writes call `ordersRepo` directly. If the signed‑in user is **not approved**, inserts return 401/403 (a visible REST error + toast), and realtime delivers nothing. (Note: `suppliers`/`product_settings` having data implies at least one approved user exists, so this is more likely a per‑session/user state issue than a global block.)

**Bottom line:** the order layer is wired to Supabase; the inventory layer is not, and inventory is what feeds the order workflow.

---

## 9. Migration readiness assessment

**Already on Supabase (done):**
- Suppliers — `SupplierContext` → `suppliersRepo` (+ realtime via `subscribeTable('suppliers')`).
- Product settings — `ProductSettingsContext` → `productSettingsRepo` (+ realtime).
- Orders — `OrderContext` → `ordersRepo` (+ realtime on all 7 order tables, + one‑time IndexedDB→Supabase migrator).

**Still browser‑only (blocking):**
- **Inventory** — `InventoryContext` + `inventory-hub/page.tsx` + `UploadZone.tsx` + `InventoryLayout.tsx` + `inventory-timeline/page.tsx`, all via `inventoryDB` (IndexedDB). This is the **primary remaining migration** and the reason Supabase inventory tables are empty.

**What is blocking realtime sync:**
- Inventory never reaches Supabase, so there are no row changes to broadcast on `imports`/`current_inventory`/`stock_history`; Browser A↔B can't sync inventory.
- Order realtime is wired but only meaningful once there is shared inventory to generate orders from, and only for **approved** sessions.

**Recommended migration order (for the eventual fix — not implemented here):**
1. Create `src/lib/supabase/repos/inventory-repo.ts` wrapping `begin_import` → chunked `import_inventory_chunk` → `finalize_import`, plus reads for `current_inventory` and `stock_history`.
2. Rewrite `InventoryContext` to call `inventoryRepo` (keep the same public API: `addSnapshot`, `updateTargetStock`, `refreshData`, `deleteSnapshot`, `clearAllData`, `checkFileDuplicate`), and subscribe to `imports`/`current_inventory`/`stock_history` realtime.
3. Add a one‑time IndexedDB→Supabase inventory migrator (mirror `orders-migration.ts`).
4. Retire or redirect the duplicate import UIs (`UploadZone`, `InventoryLayout`, `inventory-timeline`) so they don't keep writing to IndexedDB.
5. Verify the approval state of every test user (RLS `is_approved()`), then re‑test cross‑browser realtime for both inventory and orders.

---

### Exact files & functions referenced
- `src/app/inventory-hub/page.tsx` → `handleConfirmImport`, `handleFileSelect` (import UI; calls `addSnapshot`/`updateTargetStock`/`buildOrderFromSnapshot`)
- `src/contexts/InventoryContext.tsx` → `addSnapshot`, `updateTargetStock`, `refreshData`, `deleteSnapshot`, `clearAllData`, `checkFileDuplicate` (all → `inventoryDB`)
- `src/lib/db/inventory-db.ts` → `saveSnapshot`, `updateTargetStock`, `getCurrentInventory`, `getAllStockHistoryItems` (IndexedDB)
- `src/components/inventory/UploadZone.tsx`, `InventoryLayout.tsx`, `src/app/inventory-timeline/page.tsx` → `inventoryDB.saveSnapshot` (duplicate IndexedDB writers)
- `supabase/migrations/001_shared_workspace_schema.sql` → tables + RLS + realtime publication
- `supabase/migrations/003_import_chunking.sql` → `begin_import`, `import_inventory_chunk`, `finalize_import` (unused by client)
- `src/lib/supabase/types.ts` → `Functions.begin_import/import_inventory_chunk/finalize_import` (typed, never called)
- `src/lib/supabase/repos/orders-repo.ts` → order writes (reachable); dead `console.log` after `return` in `confirmDraft`
- `src/contexts/OrderContext.tsx` → `saveDraftFromLines`/`confirmOrder`/`confirmDraft` (→ `ordersRepo`, Supabase)
- `src/contexts/SupplierContext.tsx` → `suppliersRepo` (Supabase); `src/contexts/ProductSettingsContext.tsx` → `productSettingsRepo` (Supabase)
