-- ─────────────────────────────────────────────────────────────────────────────
--  ONE-TIME RECOVERY: reassign existing "ARI" products from General → ARI
--
--  WHY THIS IS NEEDED
--  ------------------
--  The old import parser auto-detected a `marca`/`brand` column (or a category
--  label such as "GENERAL") as if it were the supplier. That per-row value
--  silently overrode the supplier chosen in the import dialog, so ARI's products
--  were written into `current_inventory` with `proveedor = 'General'` even though
--  the import itself was labelled "ARI" (which is why an empty ARI supplier
--  record was still created). The suppliers page groups by `proveedor`, so those
--  products show up under General instead of ARI.
--
--  The forward fix (code) makes the import-chosen supplier authoritative, so this
--  can never happen again. This script repairs the data that already exists.
--
--  WHAT IT TOUCHES
--  ---------------
--    • current_inventory.proveedor  → set to 'ARI'   (MUTABLE canonical state — OK)
--    • stock_history                → NOT touched    (immutable history, migration 011)
--
--  Repairing only `current_inventory` is sufficient: the suppliers list, the
--  supplier detail page, and its behaviour analytics all read the current
--  proveedor from `current_inventory` (via latestSnapshot). History correctly
--  keeps recording exactly what each file contained.
--
--  HOW ARI PRODUCTS ARE IDENTIFIED (no guessing)
--  ---------------------------------------------
--  A product is "from ARI" when it appears in the stock_history of an import
--  whose `imports.supplier_name` is ARI. Every product writes a stock_history
--  row on the import where it first appears, so this reliably captures the whole
--  ARI catalogue via the import → history → clave chain.
--
--  HOW TO RUN (Supabase → SQL Editor)
--  ----------------------------------
--    1) Run STEP 1 (preview) and eyeball the list — these are the exact products
--       that will be moved to ARI. If the list looks right, continue.
--    2) Run STEP 2 (the transaction) to apply the change.
--    3) Run STEP 3 (verify) to confirm the counts.
--  If your ARI import was labelled with a different name, change 'ari' in the
--  `lower(btrim(supplier_name)) = 'ari'` predicate below (it is case-insensitive
--  and whitespace-insensitive already).
-- ─────────────────────────────────────────────────────────────────────────────


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 1 — PREVIEW (read-only). Review this before applying anything.
-- ══════════════════════════════════════════════════════════════════════════════
WITH ari_imports AS (
  SELECT id
  FROM imports
  WHERE lower(btrim(supplier_name)) = 'ari'
),
ari_claves AS (
  SELECT DISTINCT clave
  FROM stock_history
  WHERE import_id IN (SELECT id FROM ari_imports)
)
SELECT
  ci.clave,
  ci.descripcion,
  ci.proveedor AS current_proveedor,
  'ARI'        AS new_proveedor
FROM current_inventory ci
JOIN ari_claves ac ON ac.clave = ci.clave
WHERE lower(btrim(ci.proveedor)) <> 'ari'      -- only the mislabelled ones
ORDER BY ci.descripcion;


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 2 — APPLY (transactional). Run only after the preview looks correct.
--          Safe to run more than once: rows already on 'ARI' are skipped.
-- ══════════════════════════════════════════════════════════════════════════════
BEGIN;

WITH ari_imports AS (
  SELECT id
  FROM imports
  WHERE lower(btrim(supplier_name)) = 'ari'
),
ari_claves AS (
  SELECT DISTINCT clave
  FROM stock_history
  WHERE import_id IN (SELECT id FROM ari_imports)
)
UPDATE current_inventory ci
SET proveedor = 'ARI'
FROM ari_claves ac
WHERE ci.clave = ac.clave
  AND lower(btrim(ci.proveedor)) <> 'ari';

-- Inspect the row count reported by the UPDATE above, then:
COMMIT;
-- ROLLBACK;   -- ← use this instead of COMMIT if anything looks wrong.


-- ══════════════════════════════════════════════════════════════════════════════
-- STEP 3 — VERIFY (read-only). Should now list the ARI products under 'ARI'.
-- ══════════════════════════════════════════════════════════════════════════════
SELECT proveedor, count(*) AS products
FROM current_inventory
WHERE lower(btrim(proveedor)) = 'ari'
GROUP BY proveedor;
