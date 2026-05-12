-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — User Approval Migration  (idempotent — safe to re-run)
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. PROFILES TABLE ─────────────────────────────────────────────────────────
-- Create the base table if it doesn't exist at all
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Add each column individually, safely (won't fail if column already exists)
alter table public.profiles add column if not exists email      text;
alter table public.profiles add column if not exists full_name  text;
alter table public.profiles add column if not exists approved   boolean not null default false;

-- ── 2. RLS ────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "users can read own profile" on public.profiles;

create policy "users can read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- ── 3. AUTO-CREATE PROFILE ON SIGNUP ─────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, approved)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 4. BACKFILL existing users ────────────────────────────────────────────────
insert into public.profiles (id, email, full_name, approved)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  false
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
)
on conflict (id) do nothing;

-- ── 5. DONE ───────────────────────────────────────────────────────────────────
-- Approve a user:
--   UPDATE public.profiles SET approved = true WHERE email = 'user@example.com';
