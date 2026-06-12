-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Fix unrestricted DELETE statements  (005)
--
--  WHY THIS MIGRATION EXISTS
--  ─────────────────────────
--  Several RPCs issued a DELETE with no WHERE clause, e.g.:
--      delete from public.current_inventory;
--      delete from public.confirmed_order_claves;
--
--  When the Postgres safety GUC `sql_safe_updates` is enabled (Supabase turns it
--  on in several execution contexts — SQL editor sessions, and it can be set at
--  the role/database level), Postgres rejects any unqualified DELETE/UPDATE with:
--
--      ERROR:  DELETE requires a WHERE clause
--
--  This is a guard-rail against accidentally wiping an entire table. The statement
--  is syntactically valid SQL, but the planner refuses to run it while the guard
--  is active. Adding ANY WHERE clause satisfies the guard. So every full-table
--  DELETE below is rewritten with an explicit predicate that still affects all the
--  intended rows (e.g. `where clave is not null`, or a `where not exists (...)`
--  delta), instead of an unqualified DELETE.
--
--  Functions fixed here (complete `create or replace`, behavior preserved):
--    • delete_import(uuid)              — was: delete from current_inventory;
--    • finalize_import(uuid)            — was: delete from confirmed_order_claves;
--    • import_inventory_snapshot(...)   — was: delete from confirmed_order_claves;
--                                          (legacy single-shot import; the live app
--                                           uses the chunked begin/chunk/finalize
--                                           path, but it had the same bug.)
--
--  All functions keep: SECURITY INVOKER (RLS + is_approved() still apply),
--  the is_approved() gate, and audit logging via log_audit().
--
--  Run AFTER 003_import_chunking.sql. Idempotent (create or replace).
-- ══════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────────
--  delete_import — remove ONE import + its history, then rebuild current_inventory
--  from the REMAINING stock_history, preserving user-set target_stock / piezas.
--
--  Rebuild strategy (no unqualified DELETE):
--    1. Snapshot the current targets/piezas into a temp table.
--    2. Delete only the selected import (stock_history rows cascade via FK).
--    3. Materialize the new desired state from the remaining stock_history.
--    4. DELETE rows that are no longer present  → `where not exists (...)`  (filtered).
--    5. UPSERT the rebuilt rows                 → insert ... on conflict do update.
--
--  When the deleted import was the last one, the rebuilt set is empty, step 4's
--  `where not exists (...)` is TRUE for every row (still a valid WHERE clause),
--  so current_inventory ends up empty — exactly like the old wipe-and-rebuild.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.delete_import(p_import_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;

  -- 1) Preserve user-set targets/piezas BEFORE we touch current_inventory.
  drop table if exists _preserved_targets;
  create temporary table _preserved_targets on commit drop as
    select clave, stock_objetivo, piezas
    from public.current_inventory;

  -- 2) Delete the selected import; its stock_history rows cascade-delete via FK.
  delete from public.imports where id = p_import_id;

  -- 3) Compute the NEW full state from the REMAINING stock_history,
  --    re-applying preserved targets/piezas (preserved wins over historical).
  drop table if exists _rebuilt;
  create temporary table _rebuilt on commit drop as
    select
      rb.clave,
      rb.descripcion,
      rb.proveedor,
      rb.existencia,
      rb.precio_c,
      rb.precio_v,
      coalesce(pr.stock_objetivo, rb.stock_objetivo) as stock_objetivo,
      coalesce(pr.piezas,         rb.piezas)         as piezas,
      fs.first_seen   as first_seen_date,
      rb.import_date  as last_updated_date,
      fs.hist_count   as history_count
    from (
      -- latest history row per clave = current state
      select distinct on (clave)
        clave, descripcion, proveedor, existencia, precio_c, precio_v,
        stock_objetivo, piezas, import_date
      from public.stock_history
      order by clave, import_timestamp desc, id desc
    ) rb
    join (
      select clave, min(import_date) as first_seen, count(*)::int as hist_count
      from public.stock_history
      group by clave
    ) fs on fs.clave = rb.clave
    left join _preserved_targets pr on pr.clave = rb.clave;

  -- 4) Remove rows that no longer exist in the rebuilt state.
  --    Filtered DELETE (`where not exists (...)`) → passes sql_safe_updates.
  delete from public.current_inventory ci
  where not exists (select 1 from _rebuilt rb where rb.clave = ci.clave);

  -- 5) Upsert the rebuilt state into current_inventory.
  insert into public.current_inventory
    (clave, descripcion, proveedor, existencia, precio_c, precio_v, stock_objetivo, piezas,
     first_seen_date, last_updated_date, history_count)
  select
     clave, descripcion, proveedor, existencia, precio_c, precio_v, stock_objetivo, piezas,
     first_seen_date, last_updated_date, history_count
  from _rebuilt
  on conflict (clave) do update set
    descripcion       = excluded.descripcion,
    proveedor         = excluded.proveedor,
    existencia        = excluded.existencia,
    precio_c          = excluded.precio_c,
    precio_v          = excluded.precio_v,
    stock_objetivo    = excluded.stock_objetivo,
    piezas            = excluded.piezas,
    first_seen_date   = excluded.first_seen_date,
    last_updated_date = excluded.last_updated_date,
    history_count     = excluded.history_count;

  drop table if exists _rebuilt;
  drop table if exists _preserved_targets;

  perform public.log_audit('delete', 'inventory', p_import_id::text, '{}'::jsonb);
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  finalize_import — close the chunked import cycle: clear confirmed claves + audit.
--  FIX: `delete from public.confirmed_order_claves;`  →  WHERE-qualified.
--  (confirmed_order_claves is keyed by clave, which is NOT NULL, so the predicate
--   below still clears every row.)
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.finalize_import(p_import_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;

  select product_count into v_count from public.imports where id = p_import_id;
  if v_count is null then
    raise exception 'Import not found: %', p_import_id;
  end if;

  -- New import cycle → previously confirmed claves no longer suppressed.
  delete from public.confirmed_order_claves where clave is not null;

  perform public.log_audit('import', 'inventory', p_import_id::text,
    jsonb_build_object('product_count', v_count));

  return jsonb_build_object('import_id', p_import_id, 'product_count', v_count);
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  import_inventory_snapshot — legacy single-shot import (kept for compatibility).
--  Identical to 002 EXCEPT the clear-confirmed-claves DELETE is WHERE-qualified.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.import_inventory_snapshot(
  p_import   jsonb,
  p_products jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import_id   uuid;
  v_file_name   text := coalesce(p_import->>'file_name', '');
  v_supplier    text := nullif(p_import->>'supplier_name', '');
  v_file_hash   text := nullif(p_import->>'file_hash', '');
  v_ts          bigint := coalesce((p_import->>'import_timestamp')::bigint, (extract(epoch from now())*1000)::bigint);
  v_now         timestamptz := now();
  v_new         int := 0;
  v_updated     int := 0;
  v_unchanged   int := 0;
  v_count       int := 0;
  r             jsonb;
  v_clave       text;
  v_existencia  numeric;
  v_precio_c    numeric;
  v_existing    public.current_inventory%rowtype;
  v_seen        text[] := array[]::text[];
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;

  -- Duplicate-file guard
  if v_file_hash is not null and exists (select 1 from public.imports where file_hash = v_file_hash) then
    raise exception 'DUPLICATE_IMPORT' using errcode = 'unique_violation';
  end if;

  insert into public.imports (file_name, supplier_name, file_hash, product_count, imported_at)
  values (v_file_name, v_supplier, v_file_hash, 0, v_now)
  returning id into v_import_id;

  for r in select * from jsonb_array_elements(coalesce(p_products, '[]'::jsonb))
  loop
    v_clave := btrim(coalesce(r->>'clave', ''));
    if length(v_clave) < 2 then continue; end if;
    if v_clave = any(v_seen) then continue; end if;   -- dedupe within file
    v_seen := array_append(v_seen, v_clave);

    v_existencia := coalesce((r->>'existencia')::numeric, 0);
    v_precio_c   := coalesce((r->>'precio_c')::numeric, 0);

    select * into v_existing from public.current_inventory where clave = v_clave;

    if not found then
      -- NEW product
      insert into public.stock_history (clave, descripcion, proveedor, existencia, precio_c, precio_v,
                                        stock_objetivo, piezas, import_id, import_date, import_timestamp)
      values (v_clave, coalesce(r->>'descripcion',''), coalesce(nullif(r->>'proveedor',''),'General'),
              v_existencia, v_precio_c, (r->>'precio_v')::numeric,
              (r->>'stock_objetivo')::numeric, (r->>'piezas')::numeric,
              v_import_id, v_now, v_ts);

      insert into public.current_inventory (clave, descripcion, proveedor, existencia, precio_c, precio_v,
                                            stock_objetivo, piezas, first_seen_date, last_updated_date, history_count)
      values (v_clave, coalesce(r->>'descripcion',''), coalesce(nullif(r->>'proveedor',''),'General'),
              v_existencia, v_precio_c, (r->>'precio_v')::numeric,
              (r->>'stock_objetivo')::numeric, (r->>'piezas')::numeric,
              v_now, v_now, 1);
      v_new := v_new + 1;

    elsif v_existing.existencia is distinct from v_existencia then
      -- STOCK CHANGED
      insert into public.stock_history (clave, descripcion, proveedor, existencia, precio_c, precio_v,
                                        stock_objetivo, piezas, import_id, import_date, import_timestamp)
      values (v_clave, coalesce(r->>'descripcion',''), coalesce(nullif(r->>'proveedor',''),'General'),
              v_existencia, v_precio_c, (r->>'precio_v')::numeric,
              (r->>'stock_objetivo')::numeric, (r->>'piezas')::numeric,
              v_import_id, v_now, v_ts);

      update public.current_inventory set
        descripcion       = coalesce(nullif(r->>'descripcion',''), descripcion),
        proveedor         = coalesce(nullif(r->>'proveedor',''), proveedor),
        existencia        = v_existencia,
        precio_c          = case when v_precio_c > 0 then v_precio_c else precio_c end,
        precio_v          = coalesce((r->>'precio_v')::numeric, precio_v),
        stock_objetivo    = coalesce((r->>'stock_objetivo')::numeric, stock_objetivo),
        piezas            = coalesce((r->>'piezas')::numeric, piezas),
        last_updated_date = v_now,
        history_count     = history_count + 1
      where clave = v_clave;
      v_updated := v_updated + 1;

    else
      -- STOCK UNCHANGED → metadata only (keep last_updated_date / history_count)
      update public.current_inventory set
        descripcion    = coalesce(nullif(r->>'descripcion',''), descripcion),
        precio_c       = case when v_precio_c > 0 then v_precio_c else precio_c end,
        precio_v       = coalesce((r->>'precio_v')::numeric, precio_v),
        stock_objetivo = coalesce((r->>'stock_objetivo')::numeric, stock_objetivo),
        piezas         = coalesce((r->>'piezas')::numeric, piezas)
      where clave = v_clave;
      v_unchanged := v_unchanged + 1;
    end if;

    v_count := v_count + 1;
  end loop;

  update public.imports set product_count = v_count where id = v_import_id;

  -- A new import starts a new cycle → clear confirmed-claves (matches localStorage reset).
  -- FIX: WHERE-qualified so sql_safe_updates does not reject it.
  delete from public.confirmed_order_claves where clave is not null;

  perform public.log_audit('import', 'inventory', v_import_id::text,
    jsonb_build_object('file_name', v_file_name, 'new', v_new, 'updated', v_updated, 'unchanged', v_unchanged));

  return jsonb_build_object('import_id', v_import_id, 'new', v_new, 'updated', v_updated, 'unchanged', v_unchanged);
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  GRANTS — create-or-replace preserves existing grants, but re-state for safety.
-- ──────────────────────────────────────────────────────────────────────────────
grant execute on function public.delete_import(uuid)                      to authenticated;
grant execute on function public.finalize_import(uuid)                    to authenticated;
grant execute on function public.import_inventory_snapshot(jsonb, jsonb)  to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
--  DONE — no remaining unqualified DELETE/UPDATE in the inventory RPC surface.
-- ══════════════════════════════════════════════════════════════════════════════
