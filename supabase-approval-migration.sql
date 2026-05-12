-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — User Approval Migration
--  Run this in: Supabase Dashboard → SQL Editor → New Query
--  This adds a "profiles" table with an `approved` flag.
--  Admin approves users by setting approved = true via the Supabase dashboard.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. PROFILES TABLE ─────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  approved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── 2. RLS ────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

-- Users can only read their own profile (to check approved status)
create policy "users can read own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- No update policy for regular users — only admin can flip approved via dashboard

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
    false  -- NOT approved by default
  );
  return new;
end;
$$;

-- Drop existing trigger if it exists, then recreate
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── 4. BACKFILL existing users (if any already exist) ─────────────────────────
insert into public.profiles (id, email, full_name, approved)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  false
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
);
