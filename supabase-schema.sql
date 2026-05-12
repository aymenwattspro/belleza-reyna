-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Supabase Database Schema
--  Run this entire file in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable UUID extension (usually already enabled)
create extension if not exists "pgcrypto";


-- ── 1. INVENTORY SNAPSHOTS ────────────────────────────────────────────────────
-- Each row = one file import event.
create table if not exists public.inventory_snapshots (
  id               uuid primary key default gen_random_uuid(),
  date             timestamptz not null default now(),
  supplier_name    text not null default 'General',
  source_file_name text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id) on delete set null
);

-- ── 2. INVENTORY PRODUCTS ─────────────────────────────────────────────────────
-- Each row = one product in one snapshot.
-- stock_objetivo is merged from product_settings at query time.
create table if not exists public.inventory_products (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references public.inventory_snapshots(id) on delete cascade,
  clave         text not null,
  descripcion   text not null default '',
  proveedor     text,
  existencia    numeric not null default 0,
  precio_c      numeric,
  precio_v      numeric,
  stock_objetivo numeric
);

-- Index for fast lookup by clave
create index if not exists idx_inv_products_clave on public.inventory_products(clave);
create index if not exists idx_inv_products_snapshot on public.inventory_products(snapshot_id);


-- ── 3. PRODUCT SETTINGS ───────────────────────────────────────────────────────
-- Shared stock targets for each product reference.
-- One row per unique clave — upserted every time a target is changed.
create table if not exists public.product_settings (
  id            uuid primary key default gen_random_uuid(),
  clave         text not null unique,
  stock_objetivo numeric not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users(id) on delete set null
);

create index if not exists idx_product_settings_clave on public.product_settings(clave);


-- ── 4. CONFIRMED ORDERS ──────────────────────────────────────────────────────
-- Each row = one confirmed purchase order.
create table if not exists public.confirmed_orders (
  id             uuid primary key default gen_random_uuid(),
  supplier_name  text not null default 'General',
  total_products integer not null default 0,
  total_value    numeric not null default 0,
  confirmed_at   timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null
);


-- ── 5. ORDER ITEMS ────────────────────────────────────────────────────────────
-- Line items for each confirmed order.
create table if not exists public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.confirmed_orders(id) on delete cascade,
  clave          text not null,
  descripcion    text not null default '',
  proveedor      text not null default '',
  current_stock  numeric not null default 0,
  units_to_order numeric not null default 0,
  unit_cost      numeric not null default 0,
  line_total     numeric not null default 0
);

create index if not exists idx_order_items_order on public.order_items(order_id);
create index if not exists idx_order_items_clave on public.order_items(clave);


-- ══════════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS)
--  All authenticated users share the same database (no per-user isolation).
--  Any logged-in user can read and write all records.
-- ══════════════════════════════════════════════════════════════════════════════

-- Enable RLS on all tables
alter table public.inventory_snapshots  enable row level security;
alter table public.inventory_products   enable row level security;
alter table public.product_settings     enable row level security;
alter table public.confirmed_orders     enable row level security;
alter table public.order_items          enable row level security;

-- Policies: allow all operations for authenticated users
create policy "authenticated users can read snapshots"
  on public.inventory_snapshots for select
  to authenticated using (true);

create policy "authenticated users can insert snapshots"
  on public.inventory_snapshots for insert
  to authenticated with check (true);

create policy "authenticated users can delete snapshots"
  on public.inventory_snapshots for delete
  to authenticated using (true);

-- ── inventory_products
create policy "authenticated read products"
  on public.inventory_products for select
  to authenticated using (true);

create policy "authenticated insert products"
  on public.inventory_products for insert
  to authenticated with check (true);

create policy "authenticated delete products"
  on public.inventory_products for delete
  to authenticated using (true);

-- ── product_settings
create policy "authenticated read settings"
  on public.product_settings for select
  to authenticated using (true);

create policy "authenticated upsert settings"
  on public.product_settings for insert
  to authenticated with check (true);

create policy "authenticated update settings"
  on public.product_settings for update
  to authenticated using (true);

create policy "authenticated delete settings"
  on public.product_settings for delete
  to authenticated using (true);

-- ── confirmed_orders
create policy "authenticated read orders"
  on public.confirmed_orders for select
  to authenticated using (true);

create policy "authenticated insert orders"
  on public.confirmed_orders for insert
  to authenticated with check (true);

create policy "authenticated delete orders"
  on public.confirmed_orders for delete
  to authenticated using (true);

-- ── order_items
create policy "authenticated read order items"
  on public.order_items for select
  to authenticated using (true);

create policy "authenticated insert order items"
  on public.order_items for insert
  to authenticated with check (true);

create policy "authenticated delete order items"
  on public.order_items for delete
  to authenticated using (true);


-- ══════════════════════════════════════════════════════════════════════════════
--  HELPER: updated_at trigger for product_settings
-- ══════════════════════════════════════════════════════════════════════════════
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_product_settings_updated_at
  before update on public.product_settings
  for each row execute function public.handle_updated_at();
