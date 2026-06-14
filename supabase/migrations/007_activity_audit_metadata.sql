-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Activity Audit Metadata  (007)
--
--  Goal: enrich the existing `audit_log` so the new Activity Details page can show
--  device / browser / session / IP / location and source context — WITHOUT
--  breaking any existing activity record or any existing caller.
--
--  Design principles (per spec):
--    • Every new column is NULLABLE (no defaults that fabricate data).
--    • Historical rows keep NULL for the new columns — we never reconstruct
--      location / IP / device that was never recorded.
--    • `log_audit(...)` stays backward-compatible: the new `p_context` argument
--      has a DEFAULT, so existing 4-arg callers (server RPCs + the typed client
--      call) keep working untouched.
--    • A small SECURITY DEFINER reader (`get_actor_profile`) lets an approved user
--      view the *limited* public profile of any actor for investigation, since the
--      base `profiles` RLS only exposes a user's own row.
--
--  Run AFTER 001..006 in Supabase → SQL Editor. Safe to re-run (idempotent).
-- ══════════════════════════════════════════════════════════════════════════════


-- ──────────────────────────────────────────────────────────────────────────────
--  1. NEW NULLABLE AUDIT COLUMNS
-- ──────────────────────────────────────────────────────────────────────────────
alter table public.audit_log add column if not exists session_id text;
alter table public.audit_log add column if not exists request_id text;
alter table public.audit_log add column if not exists source     text;   -- Dashboard | API | Webhook | Automation | Background Job | Import
alter table public.audit_log add column if not exists user_agent text;
alter table public.audit_log add column if not exists ip_address text;
alter table public.audit_log add column if not exists geo        jsonb;  -- { country, region, city, timezone, latitude, longitude }
alter table public.audit_log add column if not exists device     jsonb;  -- { browser, browserVersion, os, osVersion, deviceType }

-- Helpful indexes for the new "by user" and "by session" queries.
create index if not exists idx_audit_actor_created on public.audit_log (actor_id, created_at desc);
create index if not exists idx_audit_actor_email   on public.audit_log (actor_email, created_at desc);
create index if not exists idx_audit_session       on public.audit_log (session_id);


-- ──────────────────────────────────────────────────────────────────────────────
--  2. log_audit — now accepts an optional client audit-context object.
--
--  We DROP the old 4-arg version and recreate it with an extra defaulted arg so
--  that:
--    • internal callers using `perform public.log_audit('x','y', id, meta)` still
--      resolve (4 args → p_context defaults to '{}').
--    • the client `supabase.rpc('log_audit', { ..., p_context })` can attach the
--      collected device / session / ip / geo / source.
--
--  Server-initiated logs (imports, confirmations…) simply omit p_context, leaving
--  the new columns NULL — we never fabricate context the server cannot observe.
-- ──────────────────────────────────────────────────────────────────────────────
drop function if exists public.log_audit(text, text, text, jsonb);

create or replace function public.log_audit(
  p_action      text,
  p_entity_type text,
  p_entity_id   text  default null,
  p_metadata    jsonb default '{}'::jsonb,
  p_context     jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_ctx   jsonb := coalesce(p_context, '{}'::jsonb);
begin
  select email into v_email from auth.users where id = auth.uid();

  insert into public.audit_log (
    action, entity_type, entity_id, actor_id, actor_email, metadata,
    session_id, request_id, source, user_agent, ip_address, geo, device
  )
  values (
    p_action, p_entity_type, p_entity_id, auth.uid(), v_email, coalesce(p_metadata, '{}'::jsonb),
    nullif(v_ctx->>'session_id', ''),
    nullif(v_ctx->>'request_id', ''),
    nullif(v_ctx->>'source', ''),
    nullif(v_ctx->>'user_agent', ''),
    nullif(v_ctx->>'ip_address', ''),
    case when jsonb_typeof(v_ctx->'geo')    = 'object' then v_ctx->'geo'    else null end,
    case when jsonb_typeof(v_ctx->'device') = 'object' then v_ctx->'device' else null end
  );
exception when others then
  -- Auditing must never break the primary operation.
  null;
end;
$$;

grant execute on function public.log_audit(text, text, text, jsonb, jsonb) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
--  3. get_actor_profile — limited, read-only actor lookup for investigation.
--
--  The base `profiles` table only lets a user read their OWN row (RLS). For the
--  Activity Details "User Investigation" panel, an approved user needs to see the
--  actor's email / role / account-creation date. This SECURITY DEFINER reader
--  exposes ONLY those non-sensitive fields, and only to approved users.
-- ──────────────────────────────────────────────────────────────────────────────
create or replace function public.get_actor_profile(p_actor_id uuid)
returns table (
  id          uuid,
  email       text,
  role        text,
  created_at  timestamptz
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.role, p.created_at
  from public.profiles p
  where public.is_approved()        -- caller must be approved
    and p.id = p_actor_id;
$$;

grant execute on function public.get_actor_profile(uuid) to authenticated;


-- ──────────────────────────────────────────────────────────────────────────────
--  4. Realtime — make the activity feed live (non-breaking add).
--     The Activity tab already subscribes to `audit_log`; ensure it's published.
-- ──────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_log'
  ) then
    execute 'alter publication supabase_realtime add table public.audit_log';
  end if;
end $$;


-- ══════════════════════════════════════════════════════════════════════════════
--  DONE — audit_log enriched. Existing rows keep NULL for the new columns;
--  new client-initiated activity records device/session/ip/geo/source going
--  forward. No historical data is fabricated.
-- ══════════════════════════════════════════════════════════════════════════════
