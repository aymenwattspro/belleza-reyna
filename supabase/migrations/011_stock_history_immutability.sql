-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — stock_history immutability guardrail  (011)
--
--  WHY THIS MIGRATION EXISTS
--  ─────────────────────────
--  `stock_history` is the event-sourced spine of the behaviour/demand analytics.
--  Every import is a historical OBSERVATION and must stay immutable:
--      • Never modify a previous import.
--      • Never overwrite a recorded observation.
--      • Never delete individual imported products.
--
--  Audit of the current write surface (migrations 002/003/005 + inventory-repo.ts):
--      INSERT stock_history : merge_inventory_product(), import_inventory_snapshot()
--      UPDATE stock_history : (none — nowhere in the codebase)
--      DELETE stock_history : ONLY via FK ON DELETE CASCADE when a whole `imports`
--                             row is removed, through exactly two sanctioned paths:
--                               1) delete_import(uuid)  RPC          (single import)
--                               2) clearAll(): from('imports').delete() (full wipe)
--
--  NB: NO order path (confirm_order_lines / confirm_draft_order / confirmed_orders)
--      touches stock_history. Confirming an order can NOT delete inventory history.
--
--  WHAT THIS MIGRATION ENFORCES (defense-in-depth, additive, reversible)
--  ─────────────────────────────────────────────────────────────────────
--    A) BEFORE UPDATE trigger → hard error. A recorded observation can never be
--       rewritten. (There is no legitimate UPDATE, so this breaks nothing.)
--    B) REVOKE UPDATE, DELETE on stock_history from client roles. Clients can still
--       INSERT (imports) and SELECT (analytics), but cannot directly mutate or
--       delete history rows. Whole-import deletion still works because referential
--       integrity CASCADE is performed by the system and bypasses the child
--       table's role privileges — so delete_import() and clearAll() are unaffected.
--
--  This preserves ALL existing functionality (imports, delete-import, clear-all,
--  analytics) while making silent history corruption structurally impossible.
--
--  Run AFTER 005 (and any later function migrations). Idempotent.
--
--  ── ROLLBACK ────────────────────────────────────────────────────────────────
--    drop trigger if exists trg_stock_history_no_update on public.stock_history;
--    drop function if exists public.stock_history_block_update();
--    grant update, delete on public.stock_history to authenticated;
-- ══════════════════════════════════════════════════════════════════════════════


-- ── A) Block UPDATEs on stock_history ─────────────────────────────────────────
create or replace function public.stock_history_block_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception
    'stock_history is immutable: recorded imports cannot be modified (row id=%). '
    'To remove data, delete the whole import via delete_import().', old.id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists trg_stock_history_no_update on public.stock_history;
create trigger trg_stock_history_no_update
  before update on public.stock_history
  for each row execute function public.stock_history_block_update();


-- ── B) Remove direct UPDATE/DELETE privileges from client roles ───────────────
--  INSERT (imports) and SELECT (analytics) remain granted. FK CASCADE deletes
--  triggered by removing an `imports` row are NOT affected by these grants.
revoke update, delete on public.stock_history from authenticated;
revoke update, delete on public.stock_history from anon;

-- ══════════════════════════════════════════════════════════════════════════════
--  DONE — stock_history is now append-only from every client path; whole-import
--  removal (delete_import / clearAll) continues to work via RI cascade.
-- ══════════════════════════════════════════════════════════════════════════════
