-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — OPTIONAL Multi-Workspace Scaffold  (004)
--
--  ⚠️ OPTIONAL / FORWARD-COMPATIBILITY ONLY.
--  Run this ONLY if multi-workspace (multiple independent organizations sharing
--  one Supabase project) is on your near-term roadmap. It is fully ADDITIVE and
--  NON-BREAKING:
--    • creates `workspaces` + `workspace_members`
--    • seeds ONE default workspace
--    • adds a NULLABLE `workspace_id` to each business table, backfilled to the
--      default workspace
--    • DOES NOT change any RLS policy or RPC — the app remains a single shared
--      workspace gated by is_approved(). No application code depends on this file.
--
--  When you actually want per-workspace isolation later, a follow-up migration
--  would: set workspace_id NOT NULL, switch RLS to membership-based, and thread
--  workspace_id through the RPCs. Doing the column-add now avoids a painful
--  backfill/lock on large tables at that time.
--
--  Run AFTER 001/002/003.  Safe to skip entirely.
-- ══════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- 1. Workspaces + membership ---------------------------------------------------
create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Seed exactly one default workspace
insert into public.workspaces (name, is_default)
select 'Belleza Reyna', true
where not exists (select 1 from public.workspaces where is_default);

-- All approved users are members of the default workspace (best-effort backfill)
insert into public.workspace_members (workspace_id, user_id, role)
select w.id, p.id, case when p.role = 'admin' then 'admin' else 'member' end
from public.workspaces w
cross join public.profiles p
where w.is_default
on conflict do nothing;

-- 2. Add nullable workspace_id to each business table + backfill ---------------
do $$
declare
  t text;
  v_default uuid;
  biz_tables text[] := array[
    'suppliers','imports','current_inventory','stock_history','product_settings',
    'draft_orders','draft_order_items','confirmed_orders','order_items',
    'excluded_products','deselected_products','confirmed_order_claves','app_settings'
  ];
begin
  select id into v_default from public.workspaces where is_default limit 1;

  foreach t in array biz_tables loop
    execute format('alter table public.%I add column if not exists workspace_id uuid references public.workspaces(id);', t);
    execute format('update public.%I set workspace_id = %L where workspace_id is null;', t, v_default);
    execute format('create index if not exists idx_%s_workspace on public.%I (workspace_id);', t, t);
  end loop;
end $$;

-- 3. RLS for the new tables (membership-based for these two only) ---------------
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists "ws_member_select" on public.workspaces;
create policy "ws_member_select" on public.workspaces for select to authenticated
  using (
    public.is_approved()
    and exists (
      select 1 from public.workspace_members m
      where m.workspace_id = workspaces.id and m.user_id = auth.uid()
    )
  );

drop policy if exists "wsm_self_select" on public.workspace_members;
create policy "wsm_self_select" on public.workspace_members for select to authenticated
  using (public.is_approved() and user_id = auth.uid());

-- NOTE: business-table RLS is intentionally left UNCHANGED (still is_approved()).
-- ══════════════════════════════════════════════════════════════════════════════
--  DONE (optional scaffold)
-- ══════════════════════════════════════════════════════════════════════════════
