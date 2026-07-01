# Belleza Reyna — Inventory Integrity & Behaviour Analytics
## Phase 1 Deliverable: Audit, Mathematical Validation & Proposed Architecture

> **Status: PLAN / AUDIT ONLY — no code changed. Awaiting approval before Phase 2.**
> Every claim is tied to a specific file + function so you can verify it independently.
> Priorities honored throughout: **1) data integrity · 2) historical accuracy · 3) mathematical correctness · 4) explainability · 5) maintainability · 6) backward compatibility · 7) performance.**

---

# Deliverable 1 — Complete understanding of the current architecture

## 1.1 Two persistence layers (Supabase = source of truth; IndexedDB = offline cache)

| Layer | Files | Role |
|---|---|---|
| **Supabase (Postgres)** | `supabase/migrations/001..010`, `src/lib/supabase/repos/*` | **Single source of truth** for inventory, orders, suppliers, settings, audit. |
| **IndexedDB** | `src/lib/db/inventory-db.ts`, `src/lib/db/orders-db.ts` | **Offline mirror / legacy cache**, written best-effort (`void inventoryDB.saveSnapshot(...).catch(()=>{})`). |

`InventoryContext` and `OrderContext` choose the source at runtime via `repo.isAvailable()`. When Supabase is configured, it governs everything; IndexedDB is only a fallback.

## 1.2 Inventory data model (migration `001_shared_workspace_schema.sql`) — event-sourced

- **`imports`** — one row per file import (`ImportMeta`), with `import_type ∈ {snapshot, targetstock}` (migration 009).
- **`stock_history`** — **append-only** stock-change events; FK `import_id → imports(id) ON DELETE CASCADE`. The behaviour system reads this.
- **`current_inventory`** — a **mutable projection**, one row per `clave` = latest known state.

## 1.3 Inventory import flow (the "smart-merge")

`inventoryRepo.importInventory()` → chunked RPC: `begin_import` → `import_inventory_chunk × N` → `finalize_import`
(server: `merge_inventory_product` in `003_import_chunking.sql`). Per product (trimmed `clave`):

- **New** → insert `stock_history` **+** insert `current_inventory` (`history_count=1`).
- **`existencia` changed** → insert `stock_history` **+** update `current_inventory` (`last_updated_date`, `history_count++`).
- **`existencia` unchanged** → **update metadata only**; **NO `stock_history` row**.

➡️ **`stock_history` is a "changes-only" log — flat imports are dropped.** This is the single most important fact for the behaviour work (Deliverables 3–6).

Target-stock imports (`update_target_stock` + `record_target_import`) touch only `stock_objetivo`/`piezas` and log an event; they never write `stock_history`/`existencia`. Correct.

## 1.4 Order flow (pending / confirmed / history)

- **Candidates**: `OrderContext.buildOrderFromSnapshot()` from `current_inventory`: `baseOrder = max(0, stockObjetivo − currentStock)` → `adjustOrder()` (case rounding, 50% threshold).
- **Pending (drafts)**: `draft_orders` + `draft_order_items`; hidden from live list (`draftClaves`); never touch inventory.
- **Confirmed**: `confirm_order_lines()` / `confirm_draft_order()` insert `confirmed_orders` + `order_items` (capturing `current_stock` at order time), add claves to `confirmed_order_claves`, delete the draft / deselect flag.
- **`confirmed_order_claves`**: suppresses ordered claves from the live Total-Order list for the cycle; wiped on next import.

---

# Deliverable 2 — Database analysis

## 2.1 Schema support matrix

| Requirement | Current state | Verdict |
|---|---|---|
| Immutable inventory history | `stock_history` append-only; only whole-import delete cascades | ✅ Good, but **no DB guardrail** preventing future UPDATE/DELETE |
| Historical imports | `imports` + `import_type` | ✅ Good |
| Pending orders | `draft_orders`/`draft_order_items` | ✅ Isolated from inventory |
| Confirmed orders + history | `confirmed_orders`/`order_items` (captures `current_stock`) | ✅ Good |
| Behaviour analytics | Only raw `stock_history`; all math client-side; changes-only grid | ⚠️ Needs canonical computation + complete-observation semantics |
| Inventory ↔ orders independence | Orders never write inventory | ✅ Exactly as required |

## 2.2 Every place inventory data is modified (exhaustive)

**Supabase RPCs (write inventory tables):**
- `begin_import` (009) — inserts `imports`.
- `merge_inventory_product` (003) — inserts `stock_history`, upserts `current_inventory`.
- `import_inventory_chunk` (003) — loops `merge_inventory_product`, bumps `imports.product_count`.
- `import_inventory_snapshot` (002, hardened in 005) — legacy single-shot import (not used by live UI).
- `update_target_stock` (002) — upserts `current_inventory.stock_objetivo/piezas` only.
- `record_target_import` (009) — inserts an `imports` row (metadata only).
- `delete_import` (002 → rewritten in 005) — deletes an `imports` row (cascades `stock_history`) then **rebuilds** `current_inventory` from remaining history.
- `finalize_import` (003 → 005) — **does NOT touch inventory**; only clears `confirmed_order_claves`.

**Client repo (`src/lib/supabase/repos/inventory-repo.ts`):** `importInventory`, `updateTargetStock`, `recordTargetImport`, `deleteImport`, `clearAll`.

**Context (`src/contexts/InventoryContext.tsx`):** `addSnapshot`, `updateTargetStock`, `recordTargetImport`, `deleteSnapshot`, `clearAllData`.

**UI entry point:** `src/app/inventory-hub/page.tsx → handleConfirmImport()` (calls the above).

**IndexedDB mirror (`src/lib/db/inventory-db.ts`):** `saveSnapshot`, `smartMergeProduct`, `updateTargetStock`, `deleteSnapshot`, `rebuildCurrentInventory`, `clearAll`, `legacySaveSnapshot` (+ duplicate writers flagged in `INVENTORY_DATA_FLOW_AUDIT.md`: `UploadZone.tsx`, `InventoryLayout.tsx`, `inventory-timeline/page.tsx`).

➡️ **No order path writes to `current_inventory` or `stock_history`.** Confirming an order cannot delete inventory in the current Supabase code.

## 2.3 Legacy-schema risk (needs your confirmation)
The root `supabase-schema.sql` defines an OLDER model — `inventory_snapshots` + `inventory_products (... ON DELETE CASCADE)` and an older `confirmed_orders`. If any environment still runs that instead of `001+`, deleting a snapshot there cascades product rows. **We must confirm the deployed schema is `001+`.**

---

# Deliverable 3 — Behaviour analytics audit (every implementation, formula by formula)

## 3.1 Every place behaviour is calculated (there are THREE engines — the core problem)

1. **`InventoryContext.popularityScores`** — the live one. Consumers: `dashboard/page.tsx`, `orders/page.tsx` (Priority Picks + sort), `product/[clave]/page.tsx`, `suppliers/[id]/page.tsx`, `inventory-hub/page.tsx`, `inventory-hub/behavior/page.tsx`, `inventory-hub/action/*`.
2. **`src/lib/utils/velocity-calculator.ts`** (`calculateVelocity`, `predictStockout`, `identifySlowMovers`) — used by `TimelineView.tsx`.
3. **`src/components/inventory/ProductBehaviorView.tsx`** — its own inline calc.

These three disagree → **must be consolidated into one canonical module.**

## 3.2 Engine 1 — `popularityScores`
```
drop_i        = max(0, existencia_{i-1} − existencia_i)   // consecutive CHANGE-pairs only
days_i        = max(1, Δdays)
dailyVelocity = Σ(drop_i) / Σ(days_i)                     // day-weighting algebraically cancels
consistency   = periodsWithDrop / totalPeriods × 100
overall       = 0.50·min(100, salesVelocity/0.14) + 0.30·min(100, totalSales) + 0.20·consistency
```
- ✅ `max(0,…)` per pair sums consumption across restocks (120→80→200→150 ⇒ 40+0+50=90).
- ⚠️ Uses only **change events** → flat imports invisible → `consistency` inflated & non-discriminating.
- ⚠️ Restock intervals dilute the denominator.
- ⚠️ Arbitrary caps (`/0.14`, `min(100,totalSales)`); lifetime `totalSales` never decays; `velocityAge` shown but unused in score.

## 3.3 Engine 2 — `velocity-calculator.ts` — **mathematically incorrect**
```
stockChange    = oldest − newest        // FIRST vs LAST
weeklyVelocity = stockChange > 0 ? stockChange/weeks : 0
```
- ❌ Restock masking: 120→80→200→150 ⇒ `120−150 = −30 ⇒ 0` velocity though 90 sold. **Understates your best (replenished) SKUs.**
- ❌ NaN risk in `isSlowMover` when `recent[0]=0`. ❌ `predictStockout` inherits the wrong velocity.

## 3.4 Engine 3 — `ProductBehaviorView.tsx` — same first-vs-last flaw.

## 3.5 Reorder engine (`ordering-engine.ts` / `buildOrderFromSnapshot`)
`needed = max(0, target − current)` + case rounding. Correct as a static min/max policy; **no link to measured demand/lead time/safety stock.**

---

# Deliverable 4 — Mathematical validation (assumptions, failures, bias)

**Assumptions:** (a) stock only drops from sales — false under restocks/returns/corrections/transfers; (b) recorded intervals are comparable sales windows — false with the changes-only grid; (c) all history equally trustworthy — no recency weighting/confidence; (d) popularity ≈ priority — false.

**Failure modes & bias direction:**
- **Restock masking** (Engines 2/3): systematic **under-count of replenished bestsellers**.
- **Observation bias** (consistency): measured on movers only ⇒ inflated.
- **Outlier domination**: one 500-unit correction can crown a dead SKU (no robust statistics).
- **Scale arbitrariness**: hard 100-caps aren't portable across catalogs/time.
- **Staleness**: lifetime `totalSales` with no decay keeps last year's hit at #1.
- **No uncertainty**: a 2-point SKU ranks equally with a 30-point SKU — violates your reliability requirement.

---

# Deliverable 5 — Identified weaknesses (summary)

1. Three divergent behaviour engines; two mathematically wrong under restock.
2. Changes-only history discards flat observations you explicitly want kept.
3. No inventory-event classification (decrease/equal/increase/anomaly).
4. No outlier/anomaly detection before demand.
5. No recency weighting, no confidence, no trend based on *demand over time*.
6. Priority = popularity, decoupled from **urgency (days-of-cover)** and **confidence**.
7. Ordering ignores demand/lead time/safety stock.
8. Heavy client-side recompute (whole `stock_history` pulled to the browser).

---

# Deliverable 6 — Proposed architecture (the pipeline you specified)

**One canonical module** `src/lib/utils/demand-analytics.ts` (pure, unit-tested), optionally backed later by a server view. Pipeline:

```
Inventory Snapshots → Inventory Events → Consumption Events → Demand Metrics → Priority Score → Suggested Order
```
Every step explainable and independently inspectable.

## 6.1 Inventory Snapshots — complete observation grid
Reconstruct from `stock_history` a value for **every product at every snapshot import**, carrying forward the last known `existencia` across flat imports. Your example `100,100,95,95,90` is fully preserved and yields the correct cumulative consumption of 10 over the real elapsed span. **No schema change required** (pure reconstruction).

## 6.2 Inventory Events — classify every interval
For (t₀,s₀)→(t₁,s₁), `delta = s₁ − s₀`, using robust bounds (median ± 3.5·MAD of movements, plus a %-of-stock guard):
- **Equal** (`delta = 0`) — demand possibly masked; retained.
- **Decrease** (`delta < 0`, within band) — normal consumption.
- **Increase** (`delta > 0`, within band) — restock.
- **Large Decrease** / **Large Increase** — flagged anomalies (corrections, transfers, bulk restock).
Events are retained for business insight (replenishment cadence, supplier rhythm, unusual movement).

## 6.3 Consumption Events — day-normalized, censored on restock
```
sold_i = (Decrease) ? |delta| : NULL          // Increase/Equal/Large excluded from the rate
rate_i = sold_i / Δdays_i                       // units/day
```
*(Optional enhancement: when a same-cycle confirmed order exists, recover `sold = s₀ + received − s₁` so restock intervals still yield demand.)*

## 6.4 Demand Metrics — one canonical, robust estimator
- **Anomaly winsorizing** (MAD) before aggregation.
- **ADD (Average Daily Demand)** = recency-weighted mean of `rate_i` via **EWMA** (`w_i = Δdays_i·exp(−age_i/τ)`, `τ = half_life/ln2`, default half-life 30d). **AWD = ADD×7.**
- Also expose **MA7, MA30** (trailing calendar windows) and **EMA** for display/forecasting.
- **Trend** = sign of least-squares slope of `rate_i` over time (or recent-EWMA vs older-EWMA): rising / stable / falling — based on *demand over time*, not lifetime totals.
- **Confidence ∈ [0,1]** = `saturate(n_eff) · saturate(span_days) · (1 − clamp(dispersion))`, dispersion = MAD/(median+ε). Low-confidence demand is **shrunk toward the supplier/catalog mean** (Bayesian shrinkage) so thin data can't look important.

## 6.5 Priority Score — demand × urgency × confidence × trend
```
days_of_cover = ADD>0 ? current_stock/ADD : ∞
urgency       = clamp(1 − days_of_cover/cover_target_days, 0, 1)      // default cover_target = 14d
velocity_norm = percentile_rank(ADD across catalog)                   // no arbitrary constants
Priority(0–100) = 100 · confidence · (0.50·urgency + 0.35·velocity_norm + 0.15·trend_positive)
```
A fast seller with plenty of stock is **not** forced to #1; a moderate seller almost out of stock rises. Fully decomposable in the UI ("why #1: urgency 0.8, velocity p95, trend +, confidence 0.9"). **Kept side-by-side with the existing `overallScore` until validated.**

## 6.6 Forecasting suite (simple, explainable — NO ML)
Per product, once enough history exists: ADD, AWD, MA7, MA30, EMA, trend, **expected stockout date** (`today + days_of_cover`), **days of cover**, **safety stock** (`z·σ_demand·√lead_time`, simple default), **reorder point** (`ADD·lead_time + safety`), **recommended reorder date**, **forecast confidence** (= confidence + dispersion). Presented as decision support **beside** the existing workflow.

## 6.7 Ordering logic — additive, non-breaking
Keep `required_order = target_stock − current_stock`. **Add** a demand-based recommendation (ROP/safety-stock) next to it for gradual adoption. The buyer always decides.

---

# Deliverable 7 — Proposed database changes (additive & reversible only)

1. **Immutability guardrail (recommended, tiny):** a trigger blocking `UPDATE`/`DELETE` on `stock_history` except through `delete_import` (defense-in-depth). Reversible (`drop trigger`). Preserves all data.
2. **`lead_time_days` (optional):** additive column on `product_settings` (or a global in `app_settings`) to drive safety stock / reorder point. Default keeps current behaviour.
3. **Analytics acceleration (optional, Phase 5 only if needed):** a read-only `compute_product_behaviour()` RPC or materialized view `product_demand_metrics` so clients read metrics instead of the whole `stock_history`. Purely additive; no change to source tables.
4. **No destructive changes.** Recommend formally retiring the legacy root `supabase-schema.sql` (after confirming `001+` is deployed) to remove the cascade-delete footgun.

*(There is intentionally NO change to the changes-only storage of `stock_history` — the complete grid is reconstructed in computation, so we neither lose history nor bloat storage.)*

---

# Deliverable 8 — Proposed implementation plan (mapped to your Phases 2–5)

**Phase 2 — Architecture cleanup (no DB risk):** create `demand-analytics.ts`; point `InventoryContext`, `TimelineView`, `ProductBehaviorView`, dashboard, orders, product, suppliers at it; delete the two first-vs-last engines. Add the `stock_history` immutability trigger. *Same UI, correct math, one source of truth.*

**Phase 3 — Behaviour engine:** complete-observation reconstruction + event classification + robust demand (EWMA) + trend + confidence + anomaly detection, all in the canonical module, with unit tests (restock, outlier, flat-period, sparse-history cases).

**Phase 4 — Priority engine:** add `priorityScore` (demand·urgency·days-of-cover·trend·confidence); switch Orders "Priority Picks" ranking to it **while keeping `overallScore` visible** until you validate.

**Phase 5 — Forecasting:** stockout date, reorder point, safety stock, reorder date, forecast confidence, as decision-support beside the current ordering flow. Add analytics view/RPC **only if** profiling shows the client compute is too heavy.

Each phase is independently shippable and reversible; nothing removes features or data.

---

## Approved decisions (locked in)
1. **Deployed schema = migrations `001+`.** The legacy root `supabase-schema.sql` is unused and will be treated as dead / retired.
2. **Parameters:** `half_life = 30d`, `cover_target_days = 14d`, `lead_time = per-supplier with a 7-day global default fallback`. These are the defaults in `DEFAULT_CONFIG` (`src/lib/utils/demand-analytics.ts`).
3. **Both scores side-by-side.** The new `priorityScore` does NOT replace the existing `overallScore` until validated across multiple import cycles.
4. **Test-first.** A comprehensive analytics test suite must guard every future change to the demand/priority math.

---

## Progress log

### ✅ Test foundation + canonical engine (done — pre-Phase-2)
- Added **Vitest** (`vitest.config.ts`, `npm run test`; test files excluded from the Next build via `tsconfig` so the production bundle is unaffected).
- Created the canonical engine **`src/lib/utils/demand-analytics.ts`** implementing the full pipeline:
  complete observation grid → event classification → consumption → demand metrics (EWMA ADD, MA7/MA30, EMA, trend, confidence, MAD anomaly winsorizing) → priority (demand·urgency·confidence·trend) → forecast (days-of-cover, stockout date, safety stock, reorder point/date).
- Created **`src/lib/utils/demand-analytics.test.ts`** — **25 tests, all passing** — covering: math primitives, grid reconstruction (flat carry-forward), steady demand, intermittent/flat, no movement, restock (the case the old first-vs-last math got wrong), corrections/anomalies, sparse history, new products, priority (urgency beats raw popularity), forecast wiring, and trend detection.

### ⏭️ Next (awaiting go-ahead): Phase 2 — wire the app to the canonical engine
- Point `InventoryContext.popularityScores`, `TimelineView`, `ProductBehaviorView`, dashboard, orders, product, suppliers at `demand-analytics.ts`; retire the two first-vs-last engines. Keep `overallScore` visible next to the new `priorityScore`.
- Add the `stock_history` immutability guardrail migration (reversible).
- Because Phase 2 edits many UI files, I will proceed only on your go-ahead.


