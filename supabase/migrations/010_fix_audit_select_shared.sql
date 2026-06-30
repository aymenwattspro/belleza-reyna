-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Fix shared Activity feed visibility  (010)
--
--  Symptom: in the Activity tab a user only sees the changes THEY made, even
--  though every other user's rows exist in `audit_log` (visible in the Supabase
--  dashboard, which bypasses RLS).
--
--  Cause: the deployed SELECT policy on public.audit_log is scoped to the current
--  user (e.g. `using (actor_id = auth.uid())`) instead of the intended SHARED
--  model where every APPROVED user can read the whole feed. The repo's 001
--  migration already declares the correct policy, but the live DB drifted.
--
--  This migration is idempotent and self-correcting: it drops EVERY existing
--  policy on audit_log (whatever its name / type) and recreates exactly the two
--  intended ones —
--      • audit_select : any approved user may READ all rows (shared feed)
--      • audit_insert : any approved user may APPEND rows
--  …leaving UPDATE / DELETE with no policy (so the log stays append-only).
--
--  It also makes sure audit_log is part of the realtime publication so the feed
--  updates live for everyone.
--
--  Safe to run multiple times. Run AFTER 001–009.
-- ══════════════════════════════════════════════════════════════════════════════

-- 1) Make sure RLS is on (no-op if already enabled).
alter table public.audit_log enable row level security;

-- 2) Drop ALL existing policies on audit_log, regardless of their name or whether
--    they were created as PERMISSIVE or RESTRICTIVE. A lingering per-user or
--    RESTRICTIVE policy is exactly what hides other users' rows.
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'audit_log'
  loop
    execute format('drop policy if exists %I on public.audit_log;', pol.policyname);
  end loop;
end $$;

-- 3) Recreate the intended SHARED policies.
--    SELECT: every approved user reads the entire activity feed.
create policy "audit_select" on public.audit_log
  as permissive for select to authenticated
  using (public.is_approved());

--    INSERT: every approved user may append (writes still stamp actor_id server-side).
create policy "audit_insert" on public.audit_log
  as permissive for insert to authenticated
  with check (public.is_approved());

-- (Intentionally no UPDATE / DELETE policy → audit_log remains append-only.)

-- 4) Ensure the activity feed is live for everyone (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'audit_log'
  ) then
    execute 'alter publication supabase_realtime add table public.audit_log';
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════════════════════
--  DONE — every approved user now sees the full shared Activity feed.
-- ══════════════════════════════════════════════════════════════════════════════
