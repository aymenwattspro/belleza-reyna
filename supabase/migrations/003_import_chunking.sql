-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Chunked Import RPCs  (003)
--  For large inventory files. The client drives a 3-step flow in batches
--  (recommended 500–1000 products per chunk), all sharing one import_id, so each
--  RPC call stays well under the PostgREST statement timeout.
--
--  Flow:
--    1) v_id := begin_import('{ file_name, supplier_name, file_hash, import_timestamp }')
--    2) for each batch:  import_inventory_chunk(v_id, batch_jsonb)
--    3) finalize_import(v_id)   -- clears confirmed_order_claves + audit
--
--  Run AFTER 002_shared_workspace_functions.sql.
-- ══════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────────
--  merge_inventory_product — single-product smart-merge (shared by chunk RPC)
--  Returns 'new' | 'updated' | 'unchanged' | 'skipped'.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.merge_inventory_product(
  p_import_id uuid,
  p_now       timestamptz,
  p_ts        bigint,
  r           jsonb
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_clave      text;
  v_existencia numeric;
  v_precio_c   numeric;
  v_existing   public.current_inventory%rowtype;
begin
  v_clave := btrim(coalesce(r->>'clave', ''));
  if length(v_clave) < 2 then return 'skipped'; end if;

  v_existencia := coalesce((r->>'existencia')::numeric, 0);
  v_precio_c   := coalesce((r->>'precio_c')::numeric, 0);

  select * into v_existing from public.current_inventory where clave = v_clave;

  if not found then
    insert into public.stock_history (clave, descripcion, proveedor, existencia, precio_c, precio_v,
                                      stock_objetivo, piezas, import_id, import_date, import_timestamp)
    values (v_clave, coalesce(r->>'descripcion',''), coalesce(nullif(r->>'proveedor',''),'General'),
            v_existencia, v_precio_c, (r->>'precio_v')::numeric,
            (r->>'stock_objetivo')::numeric, (r->>'piezas')::numeric,
            p_import_id, p_now, p_ts);

    insert into public.current_inventory (clave, descripcion, proveedor, existencia, precio_c, precio_v,
                                          stock_objetivo, piezas, first_seen_date, last_updated_date, history_count)
    values (v_clave, coalesce(r->>'descripcion',''), coalesce(nullif(r->>'proveedor',''),'General'),
            v_existencia, v_precio_c, (r->>'precio_v')::numeric,
            (r->>'stock_objetivo')::numeric, (r->>'piezas')::numeric,
            p_now, p_now, 1);
    return 'new';

  elsif v_existing.existencia is distinct from v_existencia then
    insert into public.stock_history (clave, descripcion, proveedor, existencia, precio_c, precio_v,
                                      stock_objetivo, piezas, import_id, import_date, import_timestamp)
    values (v_clave, coalesce(r->>'descripcion',''), coalesce(nullif(r->>'proveedor',''),'General'),
            v_existencia, v_precio_c, (r->>'precio_v')::numeric,
            (r->>'stock_objetivo')::numeric, (r->>'piezas')::numeric,
            p_import_id, p_now, p_ts);

    update public.current_inventory set
      descripcion       = coalesce(nullif(r->>'descripcion',''), descripcion),
      proveedor         = coalesce(nullif(r->>'proveedor',''), proveedor),
      existencia        = v_existencia,
      precio_c          = case when v_precio_c > 0 then v_precio_c else precio_c end,
      precio_v          = coalesce((r->>'precio_v')::numeric, precio_v),
      stock_objetivo    = coalesce((r->>'stock_objetivo')::numeric, stock_objetivo),
      piezas            = coalesce((r->>'piezas')::numeric, piezas),
      last_updated_date = p_now,
      history_count     = history_count + 1
    where clave = v_clave;
    return 'updated';

  else
    update public.current_inventory set
      descripcion    = coalesce(nullif(r->>'descripcion',''), descripcion),
      precio_c       = case when v_precio_c > 0 then v_precio_c else precio_c end,
      precio_v       = coalesce((r->>'precio_v')::numeric, precio_v),
      stock_objetivo = coalesce((r->>'stock_objetivo')::numeric, stock_objetivo),
      piezas         = coalesce((r->>'piezas')::numeric, piezas)
    where clave = v_clave;
    return 'unchanged';
  end if;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  begin_import — create the import row (with duplicate-file guard). Returns id.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.begin_import(p_import jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id   uuid;
  v_hash text := nullif(p_import->>'file_hash', '');
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;

  if v_hash is not null and exists (select 1 from public.imports where file_hash = v_hash) then
    raise exception 'DUPLICATE_IMPORT' using errcode = 'unique_violation';
  end if;

  insert into public.imports (file_name, supplier_name, file_hash, product_count, imported_at)
  values (coalesce(p_import->>'file_name',''), nullif(p_import->>'supplier_name',''), v_hash, 0, now())
  returning id into v_id;

  return v_id;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  import_inventory_chunk — smart-merge one batch into an existing import.
--  Safe to call repeatedly. Increments imports.product_count by processed rows.
--  Returns { new, updated, unchanged, processed }.
--  NOTE: the client should pre-dedupe by clave so a clave never spans two chunks.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.import_inventory_chunk(
  p_import_id uuid,
  p_products  jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r        jsonb;
  v_new    int := 0;
  v_upd    int := 0;
  v_unch   int := 0;
  v_proc   int := 0;
  v_seen   text[] := array[]::text[];
  v_clave  text;
  v_ts     bigint;
  v_now    timestamptz := now();
  outcome  text;
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;

  if not exists (select 1 from public.imports where id = p_import_id) then
    raise exception 'Import not found: %', p_import_id;
  end if;

  select (extract(epoch from imported_at) * 1000)::bigint into v_ts
  from public.imports where id = p_import_id;

  for r in select * from jsonb_array_elements(coalesce(p_products, '[]'::jsonb))
  loop
    v_clave := btrim(coalesce(r->>'clave', ''));
    if length(v_clave) < 2 then continue; end if;
    if v_clave = any(v_seen) then continue; end if;   -- dedupe within this chunk
    v_seen := array_append(v_seen, v_clave);

    outcome := public.merge_inventory_product(p_import_id, v_now, v_ts, r);
    if    outcome = 'new'       then v_new  := v_new  + 1;
    elsif outcome = 'updated'   then v_upd  := v_upd  + 1;
    elsif outcome = 'unchanged' then v_unch := v_unch + 1;
    end if;
    if outcome <> 'skipped' then v_proc := v_proc + 1; end if;
  end loop;

  update public.imports set product_count = product_count + v_proc where id = p_import_id;

  return jsonb_build_object('new', v_new, 'updated', v_upd, 'unchanged', v_unch, 'processed', v_proc);
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  finalize_import — close the import cycle: clear confirmed claves + audit.
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
  delete from public.confirmed_order_claves;

  perform public.log_audit('import', 'inventory', p_import_id::text,
    jsonb_build_object('product_count', v_count));

  return jsonb_build_object('import_id', p_import_id, 'product_count', v_count);
end;
$$;


-- Grants
grant execute on function public.merge_inventory_product(uuid, timestamptz, bigint, jsonb) to authenticated;
grant execute on function public.begin_import(jsonb)                  to authenticated;
grant execute on function public.import_inventory_chunk(uuid, jsonb)  to authenticated;
grant execute on function public.finalize_import(uuid)                to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
--  DONE
-- ══════════════════════════════════════════════════════════════════════════════
