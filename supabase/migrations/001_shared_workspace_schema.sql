-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Shared Workspace Schema  (001)
--  Supabase = single source of truth for ALL business data.
--
--  Run order in Supabase → SQL Editor:
--    1) supabase-approval-migration.sql   (profiles + approval; already run)
--    2) 001_shared_workspace_schema.sql   (THIS FILE)
--    3) 002_shared_workspace_functions.sql
--
--  Model mirrors the app's real data shape:
--    imports + current_inventory + stock_history
--    draft_orders + draft_order_items
--    confirmed_orders + order_items
--    excluded_products + deselected_products + confirmed_order_claves
--    product_settings + suppliers + app_settings + audit_log
--
--  Security model: a SHARED workspace. Every APPROVED authenticated user can
--  read & write all business data. Approval is enforced at the DB level via
--  public.is_approved() in RLS (not just the UI).
-- ══════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";

-- ──────────────────────────────────────────────────────────────────────────────
--  HELPERS
-- ──────────────────────────────────────────────────────────────────────────────

-- Is the current user approved? (used in every RLS policy)
create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_approved from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- Maintain updated_at on UPDATE
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Stamp created_by / updated_by from auth.uid()
create or replace function public.stamp_actor()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    if (new.created_by is null) then new.created_by := auth.uid(); end if;
    begin new.updated_by := coalesce(new.updated_by, auth.uid()); exception when undefined_column then null; end;
  elsif (tg_op = 'UPDATE') then
    begin new.updated_by := auth.uid(); exception when undefined_column then null; end;
  end if;
  return new;
end;
$$;

-- Optimistic-concurrency bump: increments version on UPDATE
create or replace function public.bump_version()
returns trigger
language plpgsql
as $$
begin
  new.version = coalesce(old.version, 0) + 1;
  return new;
end;
$$;


-- ──────────────────────────────────────────────────────────────────────────────
--  1. SUPPLIERS
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  contact_person text,
  phone          text,
  email          text,
  address        text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  updated_by     uuid references auth.users(id) on delete set null
);
-- Case-insensitive unique supplier name (prevents duplicates across users)
create unique index if not exists uq_suppliers_name_ci on public.suppliers (lower(name));


-- ──────────────────────────────────────────────────────────────────────────────
--  2. IMPORTS  (= ImportMeta — one row per file import event)
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.imports (
  id            uuid primary key default gen_random_uuid(),
  file_name     text not null default '',
  supplier_name text,
  file_hash     text,
  product_count integer not null default 0,
  imported_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);
create index if not exists idx_imports_imported_at on public.imports (imported_at desc);
-- Duplicate-file guard (only when a hash is provided)
create unique index if not exists uq_imports_file_hash on public.imports (file_hash) where file_hash is not null;


-- ──────────────────────────────────────────────────────────────────────────────
--  3. CURRENT_INVENTORY  (= CurrentInventoryItem — one row per unique product)
--     This is the canonical "current state" of every product.
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.current_inventory (
  clave             text primary key,
  descripcion       text not null default '',
  proveedor         text not null default 'General',
  existencia        numeric not null default 0,
  precio_c          numeric not null default 0,
  precio_v          numeric,
  stock_objetivo    numeric,
  piezas            numeric,
  first_seen_date   timestamptz not null default now(),
  last_updated_date timestamptz not null default now(),
  history_count     integer not null default 1,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id) on delete set null,
  version           integer not null default 0
);
create index if not exists idx_current_inventory_proveedor on public.current_inventory (proveedor);


-- ──────────────────────────────────────────────────────────────────────────────
--  4. STOCK_HISTORY  (= StockHistoryEntry — append-only stock-change events)
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.stock_history (
  id               bigint generated always as identity primary key,
  clave            text not null,
  descripcion      text not null default '',
  proveedor        text not null default 'General',
  existencia       numeric not null default 0,
  precio_c         numeric not null default 0,
  precio_v         numeric,
  stock_objetivo   numeric,
  piezas           numeric,
  import_id        uuid references public.imports(id) on delete cascade,
  import_date      timestamptz not null default now(),
  import_timestamp bigint not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_stock_history_clave on public.stock_history (clave);
create index if not exists idx_stock_history_import on public.stock_history (import_id);
create index if not exists idx_stock_history_ts on public.stock_history (import_timestamp);


-- ──────────────────────────────────────────────────────────────────────────────
--  5. PRODUCT_SETTINGS  (extended — min stock, units/case override, notes)
--     NOTE: replaces the simpler product_settings from supabase-schema.sql.
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.product_settings (
  clave                  text primary key,
  min_stock_units        numeric not null default 0,
  min_stock_cases        numeric not null default 0,
  units_per_case_override numeric,
  notes                  text,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users(id) on delete set null
);


-- ──────────────────────────────────────────────────────────────────────────────
--  6. DRAFT (PENDING) ORDERS  + items
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.draft_orders (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  supplier_name  text not null default 'General',
  total_products integer not null default 0,
  total_value    numeric not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null,
  updated_by     uuid references auth.users(id) on delete set null,
  version        integer not null default 0
);
create index if not exists idx_draft_orders_updated_at on public.draft_orders (updated_at desc);

create table if not exists public.draft_order_items (
  id             uuid primary key default gen_random_uuid(),
  draft_id       uuid not null references public.draft_orders(id) on delete cascade,
  clave          text not null,
  descripcion    text not null default '',
  proveedor      text not null default 'General',
  current_stock  numeric not null default 0,
  units_to_order numeric not null default 0,
  unit_cost      numeric not null default 0,
  line_total     numeric not null default 0
);
create index if not exists idx_draft_items_draft on public.draft_order_items (draft_id);
create unique index if not exists uq_draft_items_draft_clave on public.draft_order_items (draft_id, clave);


-- ──────────────────────────────────────────────────────────────────────────────
--  7. CONFIRMED ORDERS  + items  (order history)
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.confirmed_orders (
  id             uuid primary key default gen_random_uuid(),
  supplier_name  text not null default 'General',
  total_products integer not null default 0,
  total_value    numeric not null default 0,
  confirmed_at   timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null
);
create index if not exists idx_confirmed_orders_at on public.confirmed_orders (confirmed_at desc);

create table if not exists public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.confirmed_orders(id) on delete cascade,
  clave          text not null,
  descripcion    text not null default '',
  proveedor      text not null default 'General',
  current_stock  numeric not null default 0,
  units_to_order numeric not null default 0,
  unit_cost      numeric not null default 0,
  line_total     numeric not null default 0
);
create index if not exists idx_order_items_order on public.order_items (order_id);
create index if not exists idx_order_items_clave on public.order_items (clave);


-- ──────────────────────────────────────────────────────────────────────────────
--  8. EXCLUDED PRODUCTS  ("Do Not Order")
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.excluded_products (
  clave       text primary key,
  descripcion text not null default '',
  proveedor   text not null default 'General',
  excluded_at timestamptz not null default now(),
  excluded_by uuid references auth.users(id) on delete set null
);


-- ──────────────────────────────────────────────────────────────────────────────
--  9. DESELECTED PRODUCTS  (skipped in the current order — shared toggle)
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.deselected_products (
  clave         text primary key,
  deselected_at timestamptz not null default now(),
  deselected_by uuid references auth.users(id) on delete set null
);


-- ──────────────────────────────────────────────────────────────────────────────
-- 10. CONFIRMED ORDER CLAVES  (replaces localStorage belleza_confirmed_claves)
--     Tracks which claves are already confirmed against a given import cycle, so
--     they drop out of the live Total Order list until a new import arrives.
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.confirmed_order_claves (
  clave        text primary key,
  import_id    uuid references public.imports(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete set null
);


-- ──────────────────────────────────────────────────────────────────────────────
-- 11. APP SETTINGS  (shared key/value configuration)
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);


-- ──────────────────────────────────────────────────────────────────────────────
-- 12. AUDIT LOG  (append-only; who did what)
-- ──────────────────────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  action      text not null,           -- e.g. 'import', 'order.confirm', 'draft.delete'
  entity_type text not null,           -- e.g. 'inventory', 'order', 'supplier'
  entity_id   text,                    -- affected row id / clave
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_created_at on public.audit_log (created_at desc);
create index if not exists idx_audit_entity on public.audit_log (entity_type, entity_id);


-- ══════════════════════════════════════════════════════════════════════════════
--  TRIGGERS (updated_at, actor stamping, version bump)
-- ══════════════════════════════════════════════════════════════════════════════

-- updated_at + actor on suppliers
drop trigger if exists trg_suppliers_updated_at on public.suppliers;
create trigger trg_suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();
drop trigger if exists trg_suppliers_actor on public.suppliers;
create trigger trg_suppliers_actor before insert or update on public.suppliers
  for each row execute function public.stamp_actor();

-- current_inventory: updated_at + actor + version
drop trigger if exists trg_curinv_updated_at on public.current_inventory;
create trigger trg_curinv_updated_at before update on public.current_inventory
  for each row execute function public.set_updated_at();
drop trigger if exists trg_curinv_version on public.current_inventory;
create trigger trg_curinv_version before update on public.current_inventory
  for each row execute function public.bump_version();
drop trigger if exists trg_curinv_actor on public.current_inventory;
create trigger trg_curinv_actor before insert or update on public.current_inventory
  for each row execute function public.stamp_actor();

-- product_settings: updated_at + actor
drop trigger if exists trg_prodset_updated_at on public.product_settings;
create trigger trg_prodset_updated_at before update on public.product_settings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_prodset_actor on public.product_settings;
create trigger trg_prodset_actor before insert or update on public.product_settings
  for each row execute function public.stamp_actor();

-- draft_orders: updated_at + actor + version
drop trigger if exists trg_draft_updated_at on public.draft_orders;
create trigger trg_draft_updated_at before update on public.draft_orders
  for each row execute function public.set_updated_at();
drop trigger if exists trg_draft_version on public.draft_orders;
create trigger trg_draft_version before update on public.draft_orders
  for each row execute function public.bump_version();
drop trigger if exists trg_draft_actor on public.draft_orders;
create trigger trg_draft_actor before insert or update on public.draft_orders
  for each row execute function public.stamp_actor();

-- app_settings: updated_at + actor
drop trigger if exists trg_appset_updated_at on public.app_settings;
create trigger trg_appset_updated_at before update on public.app_settings
  for each row execute function public.set_updated_at();
drop trigger if exists trg_appset_actor on public.app_settings;
create trigger trg_appset_actor before insert or update on public.app_settings
  for each row execute function public.stamp_actor();


-- ══════════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY  (approved authenticated users share everything)
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable RLS
alter table public.suppliers              enable row level security;
alter table public.imports                enable row level security;
alter table public.current_inventory      enable row level security;
alter table public.stock_history          enable row level security;
alter table public.product_settings       enable row level security;
alter table public.draft_orders           enable row level security;
alter table public.draft_order_items      enable row level security;
alter table public.confirmed_orders       enable row level security;
alter table public.order_items            enable row level security;
alter table public.excluded_products      enable row level security;
alter table public.deselected_products    enable row level security;
alter table public.confirmed_order_claves enable row level security;
alter table public.app_settings           enable row level security;
alter table public.audit_log              enable row level security;

-- Generic "approved users can do everything" policy generator.
-- We create explicit policies per table (one ALL policy each) gated by is_approved().
do $$
declare
  t text;
  shared_tables text[] := array[
    'suppliers','imports','current_inventory','stock_history','product_settings',
    'draft_orders','draft_order_items','confirmed_orders','order_items',
    'excluded_products','deselected_products','confirmed_order_claves','app_settings'
  ];
begin
  foreach t in array shared_tables loop
    execute format('drop policy if exists "approved_all" on public.%I;', t);
    execute format(
      'create policy "approved_all" on public.%I for all to authenticated
         using (public.is_approved()) with check (public.is_approved());', t);
  end loop;
end $$;

-- audit_log: approved users may INSERT and SELECT, but never UPDATE/DELETE.
drop policy if exists "audit_select" on public.audit_log;
create policy "audit_select" on public.audit_log for select to authenticated
  using (public.is_approved());
drop policy if exists "audit_insert" on public.audit_log;
create policy "audit_insert" on public.audit_log for insert to authenticated
  with check (public.is_approved());


-- ══════════════════════════════════════════════════════════════════════════════
--  REALTIME  (broadcast row changes to all subscribed clients)
-- ══════════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  rt_tables text[] := array[
    'suppliers','imports','current_inventory','stock_history','product_settings',
    'draft_orders','draft_order_items','confirmed_orders','order_items',
    'excluded_products','deselected_products','confirmed_order_claves','app_settings'
  ];
begin
  foreach t in array rt_tables loop
    -- add table to the supabase_realtime publication if not already a member
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;

-- Ensure UPDATE/DELETE realtime payloads include the full old row
alter table public.current_inventory      replica identity full;
alter table public.draft_orders           replica identity full;
alter table public.draft_order_items      replica identity full;
alter table public.product_settings       replica identity full;
alter table public.suppliers              replica identity full;

-- ══════════════════════════════════════════════════════════════════════════════
--  DONE — proceed to 002_shared_workspace_functions.sql
-- ══════════════════════════════════════════════════════════════════════════════
