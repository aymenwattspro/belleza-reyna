-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Import Type + Target-Stock history events  (009)
--
--  Adds an `import_type` column to `imports` so every history entry records WHAT
--  kind of file produced it:
--     • 'snapshot'    → Current Inventory file (begin_import / chunk flow)
--     • 'targetstock' → Target Stock file (update_target_stock flow)
--
--  Target-Stock imports previously updated stock_objetivo/piezas WITHOUT creating
--  any history row, so they never appeared in Import History. `record_target_import`
--  logs them as first-class import events (with the real product count) WITHOUT
--  touching existencia / stock_history.
--
--  Run AFTER 003_import_chunking.sql. Safe to run multiple times (idempotent).
-- ══════════════════════════════════════════════════════════════════════════════

-- 1) Column ────────────────────────────────────────────────────────────────────
alter table public.imports
  add column if not exists import_type text not null default 'snapshot';

-- 2) begin_import — now persists the import_type from the meta JSON ──────────────
create or replace function public.begin_import(p_import jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id   uuid;
  v_hash text := nullif(p_import->>'file_hash', '');
  v_type text := coalesce(nullif(p_import->>'import_type', ''), 'snapshot');
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;

  if v_hash is not null and exists (select 1 from public.imports where file_hash = v_hash) then
    raise exception 'DUPLICATE_IMPORT' using errcode = 'unique_violation';
  end if;

  insert into public.imports (file_name, supplier_name, file_hash, product_count, import_type, imported_at)
  values (coalesce(p_import->>'file_name',''), nullif(p_import->>'supplier_name',''), v_hash, 0, v_type, now())
  returning id into v_id;

  return v_id;
end;
$$;

-- 3) record_target_import — log a Target-Stock import as a history event ─────────
--    Does NOT write stock_history or change existencia; the target values are
--    applied separately by update_target_stock(). Returns the new import id.
create or replace function public.record_target_import(p_import jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id    uuid;
  v_hash  text := nullif(p_import->>'file_hash', '');
  v_count int  := coalesce((p_import->>'product_count')::int, 0);
begin
  if not public.is_approved() then
    raise exception 'Not authorized (account not approved).';
  end if;

  if v_hash is not null and exists (select 1 from public.imports where file_hash = v_hash) then
    raise exception 'DUPLICATE_IMPORT' using errcode = 'unique_violation';
  end if;

  insert into public.imports (file_name, supplier_name, file_hash, product_count, import_type, imported_at)
  values (coalesce(p_import->>'file_name',''), nullif(p_import->>'supplier_name',''),
          v_hash, v_count, 'targetstock', now())
  returning id into v_id;

  perform public.log_audit('import', 'inventory', v_id::text,
    jsonb_build_object('product_count', v_count, 'import_type', 'targetstock'));

  return v_id;
end;
$$;

-- Grants
grant execute on function public.begin_import(jsonb)          to authenticated;
grant execute on function public.record_target_import(jsonb)  to authenticated;

-- ══════════════════════════════════════════════════════════════════════════════
--  DONE
-- ══════════════════════════════════════════════════════════════════════════════
