# Belleza Reyna — Shared Multi-User Workspace Migration Plan

> **Status:** PLAN / FOR APPROVAL — **no application code has been changed yet.**
> This document is the complete audit, the redesigned database model, and a
> detailed file-by-file implementation plan. The accompanying SQL files
> (`supabase/migrations/001_shared_workspace_schema.sql` and
> `002_shared_workspace_functions.sql`) are the proposed migrations. Review and
> approve before I begin Phase 1 implementation.

---

## SECTION A — CURRENT STATE

### A.1 Architecture (as-is)

- **Framework:** Next.js 16 (App Router, Turbopack), React 19, deployed on Vercel.
- **Auth:** Supabase Auth is wired up correctly (`AuthContext.tsx`, `profiles`
  table, approval gate via `is_approved`). **Auth is the only thing actually
  using Supabase today.**
- **Business data:** 100% stored in the **browser** via IndexedDB + localStorage.
  React Contexts are the "data layer" and each one talks to a browser DB module.
- **Providers** (`src/app/layout.tsx`): `AuthProvider → LanguageProvider →
  InventoryProvider → ChatProvider → OrderProvider → ProductSettingsProvider →
  SupplierProvider`.

### A.2 Data flow (as-is)

```
Excel/CSV file ──▶ inventory-hub/page.tsx (parse in browser)
                      │
                      ▼
            InventoryContext.addSnapshot()
                      │
                      ▼
        inventoryDB (IndexedDB: InventoryTimelineDB)   ◀── lives only in THIS browser
                      │
   ┌──────────────────┼─────────────────────────────────────┐
   ▼                  ▼                                       ▼
OrderContext     ProductSettingsContext               SupplierContext
(orders-db:      (product-settings-db:                (suppliers-db:
 BellezaReynaOrdersDB)  BellezaReynaSettingsDB)        BellezaReynaSuppliersDB)
```

Every user therefore sees a **completely different, isolated dataset**. Nothing
is shared. Nothing survives clearing browser storage. Two staff members on two
laptops have two unrelated databases.

### A.3 Persistence model (as-is) — full inventory of stores

**IndexedDB databases (4):**

| DB name | Module | Object stores | Business data |
|---|---|---|---|
| `InventoryTimelineDB` (v3) | `lib/db/inventory-db.ts` | `imports`, `current_inventory`, `stock_history`, legacy `snapshots`/`products` | ✅ products, stock, prices, targets, history |
| `BellezaReynaOrdersDB` (v4) | `lib/db/orders-db.ts` | `confirmedOrders`, `orderItems`, `deselectedProducts`, `draftOrders`, `excludedProducts` | ✅ orders, pending orders, history, exclusions |
| `BellezaReynaSettingsDB` (v1) | `lib/db/product-settings-db.ts` | `productSettings` | ✅ min stock, units/case override, notes |
| `BellezaReynaSuppliersDB` (v1) | `lib/db/suppliers-db.ts` | `suppliers` | ✅ supplier directory |

**localStorage keys:**

| Key | Source | Classification |
|---|---|---|
| `belleza_confirmed_claves` | OrderContext | **Business** — which claves are already confirmed this cycle |
| `belleza_confirmed_snap_id` | OrderContext | **Business** — snapshot id the confirmed set belongs to |
| `inv_v3_migrated` | inventory-db | Local migration flag (OK to stay local) |
| `stockTargets` | StockTargetContext | **Business** (legacy; provider not mounted) |
| `orderHistory` | OrderHistoryContext | **Business** (legacy; provider not mounted) |
| `reyna_lang` | LanguageContext | UI preference (OK to stay local) |
| `reyna_chat_*` + Gemini `API_KEY` | ChatContext | Per-user + **secret** (keep local; do NOT share API key) |
| `reyna_inventory`, `reyna_supplier`, `reyna_targets`, `reyna_order_history` | `app/upload/page.tsx` | **Business** (legacy upload screen, older generation) |
| `reyna_managed_suppliers`, `reyna_inventory`, `reyna_targets`, `reyna_history` | `app/suppliers/[id]/products/[clave]/page.tsx` | **Business** (legacy screen) |

**Supabase (currently):** only `profiles` (auth approval) is actually used.
`supabase-schema.sql` defines `inventory_snapshots`, `inventory_products`,
`product_settings`, `confirmed_orders`, `order_items` — but **no application code
references any of them.** They are orphaned and, critically, their shape
(`snapshots + products`) does **not** match the app's real model
(`imports + current_inventory + stock_history`).

### A.4 Current risks (summary; full list in Section B)

- **Total data loss** on cache clear, browser change, device change, or "Clear
  site data". No backups possible.
- **No sharing** — the product's core promise (shared workspace) is unmet.
- **No realtime** — even the same user on two tabs can desync.
- **No server-side integrity** — imports/orders are multi-step IndexedDB writes
  with no transaction; a mid-operation crash leaves partial state.
- **Two competing legacy storage generations** (`reyna_*` localStorage vs
  IndexedDB) create confusion and dead code.

---

## SECTION B — ISSUES FOUND

### B.1 Data-loss risks
1. All business data is browser-local → cleared with cache/site-data; never backed up.
2. `localStorage` confirmed-claves drive which products disappear from the order;
   losing it silently re-surfaces already-ordered products.
3. IndexedDB schema upgrades (`onupgradeneeded`) can drop stores on version bumps.
4. Vercel deploys do **not** persist anything server-side today, but any future
   filesystem/`/tmp` caching would be wiped on every deploy and per-lambda.

### B.2 Synchronization / multi-user risks
5. Each browser is an island — no user sees another's imports, orders, targets, suppliers.
6. No realtime; no polling; changes never propagate.
7. "Confirmed claves" and "deselected" sets are local toggles that should be a
   shared workflow state in a team setting.

### B.3 Data-consistency / race risks
8. Import = N sequential IndexedDB writes (import row, then per-product history +
   current_inventory upsert) with **no transaction**. Interruption = partial import.
9. `confirmOrder` / `confirmDraft` perform multi-store writes (order header,
   items, deselect cleanup, draft delete) non-atomically.
10. `deleteSnapshot` rebuilds `current_inventory` by clearing then re-inserting —
    a crash mid-rebuild empties the inventory.
11. No uniqueness guarantees beyond the keyPath; concurrent users could create
    duplicate suppliers / settings.

### B.4 Deployment / scalability risks
12. Data cannot scale beyond a single browser; no analytics, no server reporting.
13. No audit trail of who imported/changed/deleted what.
14. Large inventories live entirely in the main thread's IndexedDB — fine for one
    user, but there's no shared cache, CDN, or pagination story.

### B.5 Security issues
15. `supabase-schema.sql` RLS allows **any authenticated user** full access, but
    the app's approval gate (`is_approved`) is **not enforced at the database
    level** — only in the UI. An unapproved-but-authenticated user could call the
    API directly. Shared tables must enforce `is_approved()` in RLS.
16. Gemini **API key is stored in localStorage** (acceptable as per-user secret),
    but must never be migrated into shared tables.
17. No `service_role` key is currently used client-side (good) — the plan keeps it
    server-only.

---

## SECTION C — CODE CHANGES (PLANNED — not yet implemented)

> Nothing below is implemented yet. This is the approval-gated plan. Files are
> grouped by phase. Phase 0 is DB only (safe). Each later phase is independently
> shippable and testable.

### New files to be created
| File | Purpose |
|---|---|
| `supabase/migrations/001_shared_workspace_schema.sql` | **(delivered now)** All shared tables, indexes, FKs, constraints, RLS, realtime, updated_at/actor triggers, audit table. |
| `supabase/migrations/002_shared_workspace_functions.sql` | **(delivered now)** Atomic RPCs: import, confirm order, confirm draft, update targets, delete import; audit logging. |
| `src/lib/supabase/repos/inventory-repo.ts` | Supabase data access for imports / current_inventory / stock_history / target stock (calls `import_inventory_snapshot` RPC). |
| `src/lib/supabase/repos/orders-repo.ts` | Drafts, draft items, confirmed orders, order items, excluded, deselected, confirmed-claves. |
| `src/lib/supabase/repos/product-settings-repo.ts` | Product settings CRUD. |
| `src/lib/supabase/repos/suppliers-repo.ts` | Supplier CRUD. |
| `src/lib/supabase/repos/audit-repo.ts` | Read audit log (write happens in RPC/triggers). |
| `src/lib/supabase/realtime.ts` | Thin helper to subscribe a context to table changes and re-fetch/patch. |
| `src/lib/migrate-local-to-supabase.ts` | One-time, user-triggered uploader that pushes any existing IndexedDB/localStorage data into Supabase so current users don't lose data. |
| `src/lib/supabase/types.ts` | **Regenerated** to include every new table + RPC signature. |

### Files to be modified (swap browser DB → Supabase repo + realtime)
| File | Change |
|---|---|
| `src/contexts/InventoryContext.tsx` | Replace `inventoryDB` calls with `inventory-repo`; subscribe to realtime on `current_inventory`/`imports`/`stock_history`. Keep popularity-score computation unchanged (pure function over fetched data). |
| `src/contexts/OrderContext.tsx` | Replace `ordersDB` + the two `localStorage` confirmed-claves keys with `orders-repo` (drafts, excluded, deselected, confirmed-claves tables) + RPC for confirm; realtime on draft/excluded/deselected/confirmed tables. |
| `src/contexts/ProductSettingsContext.tsx` | Replace `productSettingsDB` with `product-settings-repo`; realtime. |
| `src/contexts/SupplierContext.tsx` | Replace `suppliersDB` with `suppliers-repo`; realtime; server-side unique-name constraint. |
| `src/app/inventory-hub/page.tsx` | Import flow calls `inventory-repo.importSnapshot()` → `import_inventory_snapshot` RPC (atomic, shared). File parsing stays client-side; only parsed rows are sent. |
| `src/contexts/ChatContext.tsx` | **Unchanged storage** — Gemini key + chat stay per-user/local (security). |
| `src/contexts/LanguageContext.tsx` | **Unchanged** — `reyna_lang` stays local (UI pref). |
| `src/app/upload/page.tsx` | Legacy screen — refactor to use repos or remove (decide during Phase 4). |
| `src/app/suppliers/[id]/products/[clave]/page.tsx` | Legacy `reyna_*` localStorage reads/writes → repos, or remove. |
| `src/contexts/StockTargetContext.tsx`, `src/contexts/OrderHistoryContext.tsx` | Legacy, providers not mounted in layout → confirm unused and delete, or migrate if still referenced. |

### Files to be deleted (after migration verified)
- `src/lib/db/inventory-db.ts`, `orders-db.ts`, `product-settings-db.ts`,
  `suppliers-db.ts` (IndexedDB modules) — removed once repos are live and the
  one-time local→Supabase migration has run for all users.

---

## SECTION D — REQUIRED SUPABASE ACTIONS (checklist for you)

### ✅ AUTOMATICALLY IMPLEMENTED BY CODE (once Phase 1+ is approved)
- All Supabase reads/writes from the app via the new repos.
- Atomic imports/orders via RPC calls.
- Realtime subscriptions registered by each context.
- One-time client migration of existing local data into Supabase.

### 🔧 MANUAL ACTION REQUIRED IN SUPABASE (you must do these)
1. **Run migrations** in SQL Editor, in order:
   1. `supabase-approval-migration.sql` (already run for `profiles` — re-run is safe).
   2. `supabase/migrations/001_shared_workspace_schema.sql`.
   3. `supabase/migrations/002_shared_workspace_functions.sql`.
2. **Enable Realtime** for these tables (Dashboard → Database → Replication, or it
   is done in the migration via `alter publication supabase_realtime add table …`):
   `suppliers`, `imports`, `current_inventory`, `stock_history`,
   `product_settings`, `draft_orders`, `draft_order_items`, `confirmed_orders`,
   `order_items`, `excluded_products`, `deselected_products`,
   `confirmed_order_claves`, `app_settings`.
3. **Verify RLS is ON** for every new table (migration enables it). Confirm the
   `is_approved()`-gated policies exist.
4. **Approve users**: Table Editor → `profiles` → set `is_approved = true`.
   (Unapproved users now get **zero** shared-data access at the DB level, not just UI.)
5. **Keep `service_role` key server-only** — never put it in `NEXT_PUBLIC_*`.
   The app uses only the anon key + RLS.
6. **Backups:** enable Point-in-Time Recovery (paid) or schedule daily logical
   backups (Dashboard → Database → Backups). Document a restore runbook.
7. **(Optional) Storage:** if you later want to keep the raw uploaded files, create
   a private `imports` storage bucket; otherwise files remain import-only sources
   (recommended) and only parsed rows are persisted.

---

## SECTION E — FINAL VERIFICATION (target state after full rollout)

| Requirement | After plan is fully implemented |
|---|---|
| Imported data shared between all users | ✅ via `import_inventory_snapshot` RPC → shared tables |
| Product changes shared between all users | ✅ `current_inventory` + `product_settings` shared + realtime |
| Pending orders shared between all users | ✅ `draft_orders` / `draft_order_items` shared + realtime |
| Order history shared between all users | ✅ `confirmed_orders` / `order_items` shared + realtime |
| Changes survive deployments | ✅ data in Postgres, not browser/Vercel |
| Changes survive server restarts | ✅ Postgres-backed |
| Supabase single source of truth | ✅ IndexedDB/localStorage business stores removed |
| Realtime synchronization works | ✅ per-table subscriptions |
| No business data depends on local browser storage | ✅ only `reyna_lang` + Gemini key stay local (UI/secret) |
| No business data depends on Vercel filesystem | ✅ none used |

> These boxes become ✅ **only after Phases 1–4 are implemented and verified.**
> Today they are ❌ (everything is browser-local).

---

## Proposed Phased Rollout (each phase independently shippable)

- **Phase 0 — Database (this PR):** run the two migrations. No app behavior change.
- **Phase 1 — Suppliers + Product Settings:** smallest, lowest-risk contexts →
  Supabase + realtime. Proves the pattern end-to-end.
- **Phase 2 — Orders + Pending Orders + History:** migrate `OrderContext` to
  Supabase tables + `confirm_*` RPCs; remove confirmed-claves localStorage.
- **Phase 3 — Inventory + Imports:** migrate `InventoryContext`; imports go
  through `import_inventory_snapshot` RPC (atomic, shared).
- **Phase 4 — Cleanup:** one-time local→Supabase migration utility, delete the
  4 IndexedDB modules + legacy `reyna_*` screens, regenerate types, final QA.

## Data model mapping (IndexedDB → Postgres)

| IndexedDB store | New Postgres table |
|---|---|
| `InventoryTimelineDB.imports` | `imports` |
| `InventoryTimelineDB.current_inventory` | `current_inventory` |
| `InventoryTimelineDB.stock_history` | `stock_history` |
| `BellezaReynaOrdersDB.draftOrders` | `draft_orders` + `draft_order_items` |
| `BellezaReynaOrdersDB.confirmedOrders` / `orderItems` | `confirmed_orders` / `order_items` |
| `BellezaReynaOrdersDB.excludedProducts` | `excluded_products` |
| `BellezaReynaOrdersDB.deselectedProducts` | `deselected_products` |
| `localStorage.belleza_confirmed_claves` (+ snap id) | `confirmed_order_claves` |
| `BellezaReynaSettingsDB.productSettings` | `product_settings` (extended) |
| `BellezaReynaSuppliersDB.suppliers` | `suppliers` |
| (new) | `audit_log`, `app_settings` |

---

### What I need from you
Approve this plan (and the two SQL files). On approval I will start **Phase 1**
and proceed phase-by-phase, keeping the app working at every step.

---

## ADDENDUM — Pre-implementation review answers

### 1) Should `workspace_id` be added now (future multi-workspace orgs)?

**Recommendation: DEFER full multi-tenancy, but add a cheap additive scaffold now.**

- The app today is a **single shared workspace**. Wiring `workspace_id` into every
  query, RPC, and RLS policy now adds real complexity and risk for zero current
  benefit (classic YAGNI).
- However, **adding a NOT-NULL `workspace_id` to large tables later requires a
  backfill + lock**, which is painful. To keep the future door open at near-zero
  cost, I've prepared an **OPTIONAL** migration
  `004_optional_multi_workspace_scaffold.sql` that:
  - creates `workspaces` + `workspace_members`,
  - seeds a single **default workspace**,
  - adds a **nullable** `workspace_id` column (defaulted/backfilled to the default
    workspace) to each business table,
  - **does NOT** change RLS or RPCs yet (still `is_approved()` global).
- **Decision for you:** run `004` now **only if** multi-org is on the near-term
  roadmap. If not, skip it — the scaffold can be applied later with the same
  additive, non-breaking migration. Phase 1 code does **not** depend on it either way.

### 2) Does clearing `confirmed_order_claves` on every import match current rules?

**Yes — it exactly matches today's behavior, with one intended nuance.**

- Current logic (`OrderContext.buildOrderFromSnapshot`): confirmed claves are keyed
  to a snapshot id (`belleza_confirmed_snap_id`). They are **kept** while the
  snapshot id is unchanged and **cleared when a new snapshot id appears** — i.e.
  on every new **full import**. Each import gets a fresh id, so "clear on new
  import" is equivalent.
- **Target-Stock-Only** updates do **not** create a new import in the current app,
  so they must **not** clear confirmed claves. ✔ My design preserves this: the
  target-only path calls `update_target_stock` (which does **not** touch
  `confirmed_order_claves`); only `finalize_import`/`import_inventory_snapshot`
  clear them.
- **Intended nuance (unchanged from today):** after a new import, a previously
  confirmed product **will** reappear in the Total Order list **if it is still
  below target** in the new snapshot (e.g., the goods haven't arrived yet). This
  is by-design "new cycle" behavior and is identical to the current app. The
  confirmed-claves set only suppresses re-ordering **within the same import
  cycle**, never across imports.
- **Net:** no *unexpected* reappearance — reappearance only happens exactly where
  it does today (new import + still under target). I added an explicit comment in
  the RPC documenting this so the rule is auditable.

### 3) Can `import_inventory_snapshot` handle the largest files? (chunking)

**A single-call RPC is fine for small/medium files but risky at scale → I added a
chunked path and recommend the app use it.**

- Risk: PostgREST/Supabase enforces a **statement timeout** (commonly ~8s on the
  API) and a **request body size limit**. A single `jsonb` payload of, say,
  20k–50k products looped row-by-row in PL/pgSQL can exceed both.
- Mitigation (delivered in `003_import_chunking.sql`): a 3-step transactional flow
  the client drives in batches (e.g. **500–1000 rows/chunk**), all sharing one
  `import_id`:
  1. `begin_import(p_import)` → returns `import_id` (does the duplicate-file guard).
  2. `import_inventory_chunk(import_id, chunk)` → smart-merges one batch; safe to
     call repeatedly; increments `imports.product_count`.
  3. `finalize_import(import_id)` → clears `confirmed_order_claves`, writes the
     audit row, returns totals.
- The single-call `import_inventory_snapshot` is retained for small files and for
  convenience/testing. **Phase 3** will wire the inventory-hub import UI to the
  chunked path with client-side dedupe (already done today via `seenClaves`) and a
  progress indicator.
- Guidance: chunk size 500–1000 keeps each RPC well under the timeout; the client
  should pre-dedupe by `clave` (current code already does) so a clave never spans
  two chunks.

### Hardening applied during this review
- **`delete_import` rewritten** to avoid a fragile single-statement
  `DELETE … + INSERT` CTE; it now uses explicit sequential statements with a temp
  table to preserve user-set targets — far easier to reason about and crash-safe
  inside its transaction.
- Added `003_import_chunking.sql` (chunked import) and
  `004_optional_multi_workspace_scaffold.sql` (optional).
- Added `supabase/verify.sql` — a **Phase 0 verification script** that checks every
  table exists, RLS is enabled, policies exist, Realtime membership is set, and all
  RPCs are present.

---

## PHASE 1 (implemented) — Suppliers + Product Settings

**Status: implemented in this session for your testing. Orders & Inventory are NOT
touched yet.**

New files:
- `src/lib/supabase/realtime.ts` — subscribe a callback to a table's changes.
- `src/lib/supabase/repos/suppliers-repo.ts` — Supabase CRUD for `suppliers`
  (maps snake_case ⇄ the app's camelCase `Supplier`).
- `src/lib/supabase/repos/product-settings-repo.ts` — Supabase CRUD for
  `product_settings` (maps to the app's `ProductSettings`).

Modified:
- `src/contexts/SupplierContext.tsx` — now reads/writes Supabase via the repo and
  subscribes to Realtime; same public API (no page changes needed). Duplicate names
  are blocked by the DB unique index **and** the existing client-side check.
- `src/contexts/ProductSettingsContext.tsx` — now reads/writes Supabase via the
  repo and subscribes to Realtime; same public API.
- `src/lib/supabase/types.ts` — added `suppliers` and replaced `product_settings`
  with the extended shape so the new repos type-check.

**Testing checklist for Phase 1 (please verify before I continue):**
1. Run `001`, `002`, `003` (and optionally `004`) + `supabase/verify.sql`.
2. Ensure your test users are **approved** (`profiles.is_approved = true`).
3. Open the app on **two browsers/accounts**. In one, add/edit/delete a supplier →
   it should appear in the other **without refresh** (Realtime). Same for product
   settings (min stock / units-per-case / notes on a product page).
4. Confirm a duplicate supplier name is rejected.

When Phase 1 is validated, give the go-ahead and I'll proceed to **Phase 2
(Orders + Pending Orders + History)**, then **Phase 3 (Inventory + Imports)**.


