-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — Audit from request headers  (008)
--
--  Problem 007 left open: actions logged *server-side* (imports, target-stock
--  updates, order/draft confirmations…) call `log_audit` with no client context,
--  so they had NULL device / IP / source. But those calls still arrive through
--  PostgREST inside the user's HTTP request — which means we CAN read the
--  User-Agent and client IP from `request.headers`.
--
--  This migration upgrades `log_audit` to fall back to the request headers when
--  the caller didn't pass them in `p_context`. Result: every audited action now
--  records user_agent + ip_address + source, even server-initiated ones. The UI
--  derives browser/OS/device from the user_agent when the structured `device`
--  jsonb is absent.
--
--  Same 5-arg signature as 007 → plain `create or replace`, no drop, no caller
--  changes. Safe to re-run.
-- ══════════════════════════════════════════════════════════════════════════════

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
  v_email   text;
  v_ctx     jsonb := coalesce(p_context, '{}'::jsonb);
  v_headers jsonb;
  v_ua      text;
  v_ip      text;
  v_source  text;
begin
  select email into v_email from auth.users where id = auth.uid();

  -- PostgREST exposes the incoming HTTP headers as a JSON GUC. Header names are
  -- lower-cased. Guard with a sub-block so auditing never fails if it's absent.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;

  -- User-Agent: prefer the client-supplied value, else the request header.
  v_ua := coalesce(nullif(v_ctx->>'user_agent', ''), v_headers->>'user-agent');

  -- IP: prefer client context, else the first x-forwarded-for hop, else x-real-ip.
  v_ip := coalesce(
    nullif(v_ctx->>'ip_address', ''),
    nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), ''),
    nullif(v_headers->>'x-real-ip', '')
  );

  -- Source: client value, else "Dashboard" when the call came via the web app.
  v_source := coalesce(
    nullif(v_ctx->>'source', ''),
    case when v_headers is not null then 'Dashboard' else null end
  );

  insert into public.audit_log (
    action, entity_type, entity_id, actor_id, actor_email, metadata,
    session_id, request_id, source, user_agent, ip_address, geo, device
  )
  values (
    p_action, p_entity_type, p_entity_id, auth.uid(), v_email, coalesce(p_metadata, '{}'::jsonb),
    nullif(v_ctx->>'session_id', ''),
    nullif(v_ctx->>'request_id', ''),
    v_source,
    v_ua,
    v_ip,
    case when jsonb_typeof(v_ctx->'geo')    = 'object' then v_ctx->'geo'    else null end,
    case when jsonb_typeof(v_ctx->'device') = 'object' then v_ctx->'device' else null end
  );
exception when others then
  -- Auditing must never break the primary operation.
  null;
end;
$$;

grant execute on function public.log_audit(text, text, text, jsonb, jsonb) to authenticated;

-- Make PostgREST pick up the refreshed function immediately.
notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════════════════════
--  DONE — server-initiated audits now also capture user_agent + ip + source.
--  Device/browser/OS are derived from user_agent in the UI; geo (city/region)
--  still only comes from client context (Vercel edge geo headers).
-- ══════════════════════════════════════════════════════════════════════════════
