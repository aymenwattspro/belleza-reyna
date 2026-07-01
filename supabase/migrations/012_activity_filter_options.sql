-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Activity filter options (012)
--
--  The Activity tab's User / Action filter dropdowns were built from the rows
--  currently LOADED on the page (the most-recent ~200), so users/actions that
--  only appear deeper in history were missing from the filters.
--
--  This RPC returns the DISTINCT actor emails and action types across the ENTIRE
--  audit_log, so the dropdowns can list every user/action since the very first
--  recorded activity — independent of how many rows are loaded.
--
--  SECURITY INVOKER → the caller's RLS applies (approved users can read the
--  shared audit_log; see migration 010).
-- ══════════════════════════════════════════════════════════════════════════════

create or replace function public.activity_filter_options()
returns jsonb
language sql
security invoker
set search_path = public
stable
as $$
  select jsonb_build_object(
    'actors', coalesce(
      (select jsonb_agg(distinct actor_email order by actor_email)
         from public.audit_log
        where actor_email is not null and actor_email <> ''),
      '[]'::jsonb
    ),
    'actions', coalesce(
      (select jsonb_agg(distinct action order by action)
         from public.audit_log
        where action is not null and action <> ''),
      '[]'::jsonb
    )
  );
$$;

grant execute on function public.activity_filter_options() to authenticated;
