-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Phase 0 Verification Script
--  Run this in Supabase → SQL Editor AFTER applying 001/002/003 (and optionally 004).
--  Every check returns a PASS/FAIL row. Scan for any 'FAIL ❌'.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1) TABLES EXIST ──────────────────────────────────────────────────────────────
with expected(tbl) as (
  values ('suppliers'),('imports'),('current_inventory'),('stock_history'),
         ('product_settings'),('draft_orders'),('draft_order_items'),
         ('confirmed_orders'),('order_items'),('excluded_products'),
         ('deselected_products'),('confirmed_order_claves'),('app_settings'),('audit_log')
)
select '1. TABLE' as check, e.tbl as object,
       case when t.tablename is null then 'FAIL ❌ missing' else 'PASS ✅' end as status
from expected e
left join pg_tables t on t.schemaname = 'public' and t.tablename = e.tbl
order by e.tbl;

-- 2) RLS ENABLED ────────────────────────────────────────────────────────────────
select '2. RLS' as check, c.relname as object,
       case when c.relrowsecurity then 'PASS ✅ enabled' else 'FAIL ❌ disabled' end as status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('suppliers','imports','current_inventory','stock_history','product_settings',
                    'draft_orders','draft_order_items','confirmed_orders','order_items',
                    'excluded_products','deselected_products','confirmed_order_claves',
                    'app_settings','audit_log')
order by c.relname;

-- 3) POLICIES EXIST ─────────────────────────────────────────────────────────────
select '3. POLICY' as check, tablename as object,
       string_agg(policyname, ', ') as status
from pg_policies
where schemaname = 'public'
  and tablename in ('suppliers','imports','current_inventory','stock_history','product_settings',
                    'draft_orders','draft_order_items','confirmed_orders','order_items',
                    'excluded_products','deselected_products','confirmed_order_claves',
                    'app_settings','audit_log')
group by tablename
order by tablename;

-- 4) REALTIME PUBLICATION MEMBERSHIP ────────────────────────────────────────────
with expected(tbl) as (
  values ('suppliers'),('imports'),('current_inventory'),('stock_history'),
         ('product_settings'),('draft_orders'),('draft_order_items'),
         ('confirmed_orders'),('order_items'),('excluded_products'),
         ('deselected_products'),('confirmed_order_claves'),('app_settings')
)
select '4. REALTIME' as check, e.tbl as object,
       case when pt.tablename is null then 'FAIL ❌ not in supabase_realtime' else 'PASS ✅' end as status
from expected e
left join pg_publication_tables pt
  on pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = e.tbl
order by e.tbl;

-- 5) RPC FUNCTIONS EXIST ─────────────────────────────────────────────────────────
with expected(fn) as (
  values ('is_approved'),('log_audit'),('import_inventory_snapshot'),('delete_import'),
         ('update_target_stock'),('confirm_order_lines'),('confirm_draft_order'),
         ('merge_inventory_product'),('begin_import'),('import_inventory_chunk'),('finalize_import')
)
select '5. FUNCTION' as check, e.fn as object,
       case when p.proname is null then 'FAIL ❌ missing' else 'PASS ✅' end as status
from expected e
left join pg_proc p on p.proname = e.fn
left join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
group by e.fn, p.proname
order by e.fn;

-- 6) EXECUTE GRANTS TO authenticated ─────────────────────────────────────────────
select '6. GRANT' as check, p.proname as object,
       case when has_function_privilege('authenticated', p.oid, 'EXECUTE')
            then 'PASS ✅ executable' else 'FAIL ❌ no execute' end as status
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
where p.proname in ('import_inventory_snapshot','delete_import','update_target_stock',
                    'confirm_order_lines','confirm_draft_order','begin_import',
                    'import_inventory_chunk','finalize_import')
order by p.proname;

-- 7) SMOKE TEST (optional; runs as YOUR approved user) ───────────────────────────
-- Uncomment to exercise the import + order RPCs end-to-end, then inspect results.
-- Make sure your profiles.is_approved = true first.
--
-- select public.import_inventory_snapshot(
--   '{"file_name":"verify.csv","supplier_name":"TEST","file_hash":null,"import_timestamp":0}'::jsonb,
--   '[{"clave":"TEST-001","descripcion":"Verify product","proveedor":"TEST","existencia":3,
--      "precio_c":10,"precio_v":20,"stock_objetivo":12,"piezas":6}]'::jsonb
-- );
-- select * from public.current_inventory where clave = 'TEST-001';
-- select public.confirm_order_lines('TEST',
--   '[{"clave":"TEST-001","descripcion":"Verify product","proveedor":"TEST",
--      "current_stock":3,"units_to_order":12,"unit_cost":10,"line_total":120}]'::jsonb);
-- select * from public.confirmed_orders order by confirmed_at desc limit 1;
-- -- cleanup:
-- -- delete from public.current_inventory where clave='TEST-001';
-- -- delete from public.stock_history where clave='TEST-001';
-- ══════════════════════════════════════════════════════════════════════════════
