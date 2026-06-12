-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Shared Workspace Functions / RPC  (002)
--  Atomic, transactional, audited operations callable from the client via
--  supabase.rpc(...). Each runs as SECURITY INVOKER so RLS + is_approved() apply,
--  EXCEPT audit insertion which is allowed by the audit_insert policy.
--
--  Run AFTER 001_shared_workspace_schema.sql.
--
--  Provided RPCs:
--    • log_audit(...)                       internal helper, also callable
--    • import_inventory_snapshot(...)       atomic smart-merge import
--    • delete_import(...)                   atomic delete + rebuild current_inventory
--    • update_target_stock(...)             bulk target/piezas upsert
--    • confirm_order_lines(...)             create confirmed order from selected lines
--    • confirm_draft_order(...)             draft → confirmed order (atomic)
-- ══════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────────
--  log_audit — append a row to audit_log (best-effort; never blocks the caller)
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.log_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text default null,
  p_metadata    jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select email into v_email from auth.users where id = auth.uid();
  insert into public.audit_log (action, entity_type, entity_id, actor_id, actor_email, metadata)
  values (p_action, p_entity_type, p_entity_id, auth.uid(), v_email, coalesce(p_metadata, '{}'::jsonb));
exception when others then
  -- never let auditing break the primary operation
  null;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  import_inventory_snapshot — ATOMIC smart-merge of a parsed file
--
--  p_import   : { file_name, supplier_name, file_hash, import_timestamp }
--  p_products : [ { clave, descripcion, proveedor, existencia, precio_c,
--                   precio_v, stock_objetivo, piezas }, ... ]
--
--  Rules (mirrors inventory-db.smartMergeProduct):
--    • clave trimmed; rows with clave length < 2 skipped; dedupe within file
--    • new product            → stock_history row + insert current_inventory
--    • existencia changed     → stock_history row + update (bump last_updated, history_count)
--    • existencia unchanged   → update metadata only (keep last_updated/history_count)
--  Returns: { import_id, new, updated, unchanged }
--  Everything happens in ONE transaction (the function body) → no partial imports.
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

  -- A new import starts a new cycle → clear confirmed-claves (matches localStorage reset)
  delete from public.confirmed_order_claves;

  perform public.log_audit('import', 'inventory', v_import_id::text,
    jsonb_build_object('file_name', v_file_name, 'new', v_new, 'updated', v_updated, 'unchanged', v_unchanged));

  return jsonb_build_object('import_id', v_import_id, 'new', v_new, 'updated', v_updated, 'unchanged', v_unchanged);
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  delete_import — remove an import + its history, then rebuild current_inventory
--  from the remaining stock_history (preserving user-set target/piezas).
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

  -- Preserve user-set targets/piezas BEFORE we clear current_inventory.
  drop table if exists _preserved_targets;
  create temporary table _preserved_targets on commit drop as
    select clave, stock_objetivo, piezas from public.current_inventory;

  -- stock_history rows cascade-delete via FK; delete the import row.
  delete from public.imports where id = p_import_id;

  -- Rebuild current_inventory from the REMAINING stock_history.
  delete from public.current_inventory;

  insert into public.current_inventory
    (clave, descripcion, proveedor, existencia, precio_c, precio_v, stock_objetivo, piezas,
     first_seen_date, last_updated_date, history_count)
  select rb.clave, rb.descripcion, rb.proveedor, rb.existencia, rb.precio_c, rb.precio_v,
         coalesce(pr.stock_objetivo, rb.stock_objetivo),
         coalesce(pr.piezas, rb.piezas),
         fs.first_seen, rb.import_date, fs.hist_count
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

  drop table if exists _preserved_targets;

  perform public.log_audit('delete', 'inventory', p_import_id::text, '{}'::jsonb);
end;
$$;



-- ──────────────────────────────────────────────────────────────────────────────
--  update_target_stock — bulk upsert target stock / piezas on current_inventory
--  p_updates : [ { clave, stock_objetivo, piezas, descripcion?, proveedor? }, ... ]
--  Returns the number of rows affected.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.update_target_stock(p_updates jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_count int := 0;
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb))
  loop
    insert into public.current_inventory
      (clave, descripcion, proveedor, existencia, precio_c, stock_objetivo, piezas,
       first_seen_date, last_updated_date, history_count)
    values
      (r->>'clave', coalesce(nullif(r->>'descripcion',''), r->>'clave'),
       coalesce(nullif(r->>'proveedor',''),'General'), 0, 0,
       (r->>'stock_objetivo')::numeric, (r->>'piezas')::numeric,
       now(), now(), 0)
    on conflict (clave) do update set
      stock_objetivo = excluded.stock_objetivo,
      piezas         = excluded.piezas,
      descripcion    = coalesce(nullif(excluded.descripcion,''), public.current_inventory.descripcion),
      proveedor      = coalesce(nullif(excluded.proveedor,''), public.current_inventory.proveedor);
    v_count := v_count + 1;
  end loop;

  perform public.log_audit('update', 'target_stock', null, jsonb_build_object('count', v_count));
  return v_count;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  confirm_order_lines — create a confirmed order from selected order lines
--  p_supplier : text
--  p_items    : [ { clave, descripcion, proveedor, current_stock, units_to_order,
--                   unit_cost, line_total }, ... ]
--  Side effects: marks claves as confirmed, clears their deselect flag. Atomic.
--  Returns the new order id.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.confirm_order_lines(
  p_supplier text,
  p_items    jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
  v_total    numeric := 0;
  v_count    int := 0;
  r jsonb;
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;
  if coalesce(jsonb_array_length(p_items), 0) = 0 then
    raise exception 'No items to confirm.';
  end if;

  select coalesce(sum((it->>'line_total')::numeric),0), count(*)
    into v_total, v_count
  from jsonb_array_elements(p_items) it;

  insert into public.confirmed_orders (supplier_name, total_products, total_value)
  values (coalesce(nullif(p_supplier,''),'Mixed'), v_count, v_total)
  returning id into v_order_id;

  for r in select * from jsonb_array_elements(p_items)
  loop
    insert into public.order_items
      (order_id, clave, descripcion, proveedor, current_stock, units_to_order, unit_cost, line_total)
    values
      (v_order_id, r->>'clave', coalesce(r->>'descripcion',''), coalesce(nullif(r->>'proveedor',''),'General'),
       coalesce((r->>'current_stock')::numeric,0), coalesce((r->>'units_to_order')::numeric,0),
       coalesce((r->>'unit_cost')::numeric,0), coalesce((r->>'line_total')::numeric,0));

    insert into public.confirmed_order_claves (clave, confirmed_at)
    values (r->>'clave', now())
    on conflict (clave) do update set confirmed_at = now();

    delete from public.deselected_products where clave = r->>'clave';
  end loop;

  perform public.log_audit('order.confirm', 'order', v_order_id::text,
    jsonb_build_object('products', v_count, 'value', v_total));

  return v_order_id;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  confirm_draft_order — promote a pending (draft) order to a confirmed order,
--  then delete the draft. All in one transaction.
--  Returns the new confirmed order id.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.confirm_draft_order(p_draft_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
  v_supplier text;
  v_total    numeric := 0;
  v_count    int := 0;
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;

  select supplier_name into v_supplier from public.draft_orders where id = p_draft_id;
  if v_supplier is null then
    raise exception 'Draft not found.';
  end if;

  select coalesce(sum(line_total),0), count(*) into v_total, v_count
  from public.draft_order_items where draft_id = p_draft_id;

  if v_count = 0 then
    raise exception 'Cannot confirm an empty draft.';
  end if;

  insert into public.confirmed_orders (supplier_name, total_products, total_value)
  values (coalesce(v_supplier,'Mixed'), v_count, v_total)
  returning id into v_order_id;

  insert into public.order_items
    (order_id, clave, descripcion, proveedor, current_stock, units_to_order, unit_cost, line_total)
  select v_order_id, clave, descripcion, proveedor, current_stock, units_to_order, unit_cost, line_total
  from public.draft_order_items where draft_id = p_draft_id;

  insert into public.confirmed_order_claves (clave, confirmed_at)
  select clave, now() from public.draft_order_items where draft_id = p_draft_id
  on conflict (clave) do update set confirmed_at = now();

  delete from public.draft_orders where id = p_draft_id;  -- items cascade

  perform public.log_audit('draft.confirm', 'order', v_order_id::text,
    jsonb_build_object('draft_id', p_draft_id, 'products', v_count, 'value', v_total));

  return v_order_id;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  GRANTS — allow authenticated clients to call the RPCs (RLS still applies)
-- ──────────────────────────────────────────────────────────────────────────────
grant execute on function public.import_inventory_snapshot(jsonb, jsonb) to authenticated;
grant execute on function public.delete_import(uuid)                      to authenticated;
grant execute on function public.update_target_stock(jsonb)              to authenticated;
grant execute on function public.confirm_order_lines(text, jsonb)        to authenticated;
grant execute on function public.confirm_draft_order(uuid)               to authenticated;
grant execute on function public.log_audit(text, text, text, jsonb)      to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
--  DONE — schema + functions ready. Application code migration follows (Phases 1–4).
-- ══════════════════════════════════════════════════════════════════════════════
