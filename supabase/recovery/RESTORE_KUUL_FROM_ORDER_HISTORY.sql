-- ════════════════════════════════════════════════════════════════════════════
--  RECOVERY — restore the "kuul" products (and therefore the supplier) from the
--  confirmed order in Order History.
--
--  CONTEXT / ROOT CAUSE
--  --------------------
--  Confirming an order NEVER touches current_inventory or stock_history — it only
--  writes confirmed_orders + order_items + confirmed_order_claves
--  (see supabase/migrations/002_shared_workspace_functions.sql, confirm_order_lines).
--  A read-only check showed kuul = 0 rows in BOTH current_inventory AND
--  stock_history, which proves the loss came from a DESTRUCTIVE INVENTORY action
--  (a deleted import → delete_import() rebuilds current_inventory from the
--  remaining history, or a clear/re-import), NOT from confirming the order.
--
--  WHY THIS RECOVERY IS TRUSTWORTHY
--  --------------------------------
--  order_items is the immutable record of the confirmed order and still holds,
--  per line:
--      clave, descripcion, proveedor, unit_cost, and
--      current_stock  ← the product's stock AT THE MOMENT YOU CONFIRMED
--                        = exactly the "original stock before confirming".
--
--  SAFETY GUARANTEES
--  -----------------
--   • Read-only PREVIEW first (STEP 1) — change nothing until you like the list.
--   • STEP 2 runs in a single transaction.
--   • INSERT ... ON CONFLICT (clave) DO NOTHING  → it can NEVER overwrite an
--     existing current_inventory row, and re-running the script is a no-op.
--   • Nothing else in the database is modified. Suppliers reappear automatically
--     because the Suppliers tab is derived from current_inventory.
--
--  HOW TO RUN
--  ----------
--   1. Open the Supabase SQL editor.
--   2. Run STEP 1 alone and review the products/stock that will be restored.
--   3. If it looks right, run STEP 2. It verifies inside the transaction and
--      COMMITs. If the numbers look wrong, change COMMIT; to ROLLBACK; and rerun.
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
--  STEP 1 — PREVIEW (READ-ONLY). Review this list before restoring anything.
--  One row per product, using the MOST RECENT confirmed kuul order for each.
-- ─────────────────────────────────────────────────────────────────────────────
select distinct on (btrim(oi.clave))
  btrim(oi.clave)                                   as clave,
  oi.descripcion,
  coalesce(nullif(btrim(oi.proveedor), ''), 'kuul') as proveedor,
  oi.current_stock                                  as stock_to_restore,  -- pre-order stock
  oi.unit_cost                                      as precio_c,
  oi.units_to_order                                 as units_that_were_ordered,
  co.supplier_name                                  as order_supplier,
  co.confirmed_at
from order_items oi
join confirmed_orders co on co.id = oi.order_id
where lower(btrim(co.supplier_name)) like '%kuul%'
   or lower(btrim(oi.proveedor))     like '%kuul%'
order by btrim(oi.clave), co.confirmed_at desc;


-- ─────────────────────────────────────────────────────────────────────────────
--  STEP 2 — RESTORE into current_inventory (transactional + idempotent).
--  existencia is set to the pre-order stock (order_items.current_stock).
-- ─────────────────────────────────────────────────────────────────────────────
begin;

with kuul_lines as (
  select distinct on (btrim(oi.clave))
    btrim(oi.clave)                                   as clave,
    coalesce(oi.descripcion, '')                      as descripcion,
    coalesce(nullif(btrim(oi.proveedor), ''), 'kuul') as proveedor,
    coalesce(oi.current_stock, 0)                     as existencia,   -- original pre-order stock
    coalesce(oi.unit_cost, 0)                         as precio_c,
    co.confirmed_at                                   as confirmed_at
  from order_items oi
  join confirmed_orders co on co.id = oi.order_id
  where lower(btrim(co.supplier_name)) like '%kuul%'
     or lower(btrim(oi.proveedor))     like '%kuul%'
  order by btrim(oi.clave), co.confirmed_at desc
)
insert into current_inventory
  (clave, descripcion, proveedor, existencia, precio_c, precio_v,
   stock_objetivo, piezas, first_seen_date, last_updated_date, history_count)
select
  clave, descripcion, proveedor, existencia, precio_c, null,
  null, null, confirmed_at, confirmed_at, 1
from kuul_lines
on conflict (clave) do nothing;   -- never overwrite an existing product row

-- Verify INSIDE the transaction before committing.
select count(*) as kuul_now_in_current_inventory
from current_inventory
where lower(btrim(proveedor)) like '%kuul%';

commit;   -- ←←← If the count above looks wrong, change this line to:  rollback;


-- ─────────────────────────────────────────────────────────────────────────────
--  STEP 3 (OPTIONAL) — reload the app. "kuul" now appears on the Suppliers tab
--  under "Suppliers found in inventory"; click "Add to DB" to save it as a
--  managed supplier (safer than inserting into the suppliers table by hand).
--
--  NOTE ON BEHAVIOUR ANALYTICS
--  ---------------------------
--  This restores kuul to the CURRENT state so it shows in Inventory + Suppliers.
--  It intentionally does NOT fabricate historical stock_history points (there is
--  only one known observation — the pre-order stock). The behaviour/consumption
--  engine will start accumulating real history for kuul again from your next
--  inventory import onward. If you later want the single confirmed-order snapshot
--  seeded into stock_history for continuity, ask and I'll provide a guarded
--  add-on that inserts one dated observation per clave.
-- ─────────────────────────────────────────────────────────────────────────────
