-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Fix stamp_actor() unguarded created_by  (006)
--
--  SYMPTOM
--  ───────
--  Importing a file inserts 0 products. The INSERT into public.current_inventory
--  fails with:
--      ERROR:  record "new" has no field "created_by"
--
--  ROOT CAUSE
--  ──────────
--  The BEFORE INSERT/UPDATE trigger `stamp_actor()` (from 001) stamps actor
--  columns from auth.uid(). It guards the `updated_by` assignment against tables
--  that don't have that column:
--        begin new.updated_by := ... ; exception when undefined_column then null; end;
--  …but the `created_by` assignment was NOT guarded:
--        if (new.created_by is null) then new.created_by := auth.uid(); end if;
--
--  Referencing a NEW field that the table doesn't have raises SQLSTATE 42703
--  (undefined_column) and aborts the statement. Three "current-state" tables carry
--  the actor trigger but intentionally have only `updated_by` (no `created_by`):
--      • public.current_inventory   (trg_curinv_actor)   ← breaks inventory import
--      • public.product_settings    (trg_prodset_actor)  ← breaks target-stock saves
--      • public.app_settings        (trg_appset_actor)   ← breaks app-settings writes
--  (suppliers and draft_orders DO have created_by, so they were unaffected.)
--
--  FIX
--  ───
--  Wrap the `created_by` assignment in the same undefined_column guard as
--  `updated_by`, so the trigger is a no-op for that column on tables that lack it.
--  No schema/column changes; matches the original author's evident intent
--  (the updated_by guard shows the trigger was meant to be column-agnostic).
--
--  Idempotent (create or replace). Run AFTER 001 (order vs 002–005 doesn't matter).
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public.stamp_actor()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    -- Guard BOTH columns: a table may have created_by, updated_by, both, or
    -- neither. Referencing a missing NEW field raises undefined_column (42703),
    -- which we swallow so the insert proceeds.
    begin
      if (new.created_by is null) then new.created_by := auth.uid(); end if;
    exception when undefined_column then null; end;

    begin
      new.updated_by := coalesce(new.updated_by, auth.uid());
    exception when undefined_column then null; end;

  elsif (tg_op = 'UPDATE') then
    begin
      new.updated_by := auth.uid();
    exception when undefined_column then null; end;
  end if;

  return new;
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
--  DONE — inventory import (and product_settings / app_settings writes) now insert
--  successfully; new products will persist and appear in current_inventory.
-- ══════════════════════════════════════════════════════════════════════════════
