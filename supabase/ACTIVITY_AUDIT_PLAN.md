# Activity Details & Audit Metadata — Implementation & Migration Plan

This document covers the new **Activity Details** experience and the **audit
metadata** that powers it (device / browser / session / IP / location / source),
plus how to roll it out safely.

---

## 1. What shipped

### Feature 1 — Activity Details page
- New route: **`/activity/[id]`** (e.g. `/activity/482`).
- Every activity card on `/activity` is now a clickable link into the details page.
- Sections (Linear / Stripe-style layout):
  - **Overview** — user (avatar, email, role), action, exact + relative time, location.
  - **Change Summary** — structured added / removed / qty / renamed chips.
  - **Field Diff** — visual before / after diff for update operations.
  - **Related Entity History** — chronological timeline of every change on the same record.
  - **Technical Information** — IP, browser, OS, device, timezone, session, user-agent.
  - **Security Analysis** — risk signals (new device / browser / OS / country / city,
    rapid modifications) + a Low/Medium/High risk level.
  - **User Investigation** — role, account-created, last activity, actions today / week / total.
  - **User Activity History** — recent clickable actions by the same user.
  - **Audit Metadata** — activityId, requestId, sessionId, entityId/type, source, createdAt, actorId.

### Feature 2 — Navigation & micro-interactions
- Subtle, fast page transitions (≈220 ms fade + slight slide), `prefers-reduced-motion` aware.
- Card hover elevation / slight scale / smooth shadow; clickable affordance (chevron) on activity items.
- **Skeleton loaders** for the activity list, the details page, and the history lists.
- **Progressive rendering** — the primary activity renders immediately; user history,
  entity history, profile and stats stream in with their own skeletons.

### Audit metadata captured going forward
For **client-initiated** activity (`activityRepo.log(...)`), each new record now stores:
`session_id`, `source` (`Dashboard`), `user_agent`, `device { browser, browserVersion, os, osVersion, deviceType }`,
and — when the platform provides it — `ip_address` + `geo { country, region, city, timezone, latitude, longitude }`.

> Server-initiated logs (imports, order/draft confirmations…) keep these fields `NULL` —
> the server cannot observe the browser/device, and **we never fabricate audit data**.

---

## 2. Database migration

**File:** `supabase/migrations/007_activity_audit_metadata.sql`

It:
1. Adds **nullable** columns to `audit_log`: `session_id, request_id, source, user_agent, ip_address, geo (jsonb), device (jsonb)`.
2. Adds indexes for "by user" / "by session" queries.
3. Replaces `log_audit(...)` with a backward-compatible version that accepts an
   optional `p_context jsonb` (existing 4-arg callers keep working).
4. Adds `get_actor_profile(uuid)` — a `SECURITY DEFINER` reader so an approved user
   can see another actor's email / role / created_at for investigation (base
   `profiles` RLS only exposes a user's own row).
5. Ensures `audit_log` is in the `supabase_realtime` publication (live feed).

### How to apply
Run it once in **Supabase → SQL Editor** (safe to re-run; idempotent):

```sql
-- paste the contents of supabase/migrations/007_activity_audit_metadata.sql
```

### Rollout order / safety
- The frontend is **backward compatible**: `activityRepo.log()` first calls
  `log_audit` with `p_context`; if migration 007 isn't applied yet it automatically
  retries the original 4-arg call. So you can deploy the frontend before or after
  running the migration without breaking logging.
- All existing `audit_log` rows are untouched and keep `NULL` for the new columns.
- No historical IP / device / location is reconstructed.

---

## 3. Where the IP / location comes from

`GET /api/audit/context` (App Router route handler) reads the request's
`x-forwarded-for` and Vercel's edge geo headers (`x-vercel-ip-*`). No third-party
geolocation service, no extra dependency, and nothing is persisted by the route.
Locally (no Vercel headers) it returns nulls → the UI shows "Not recorded".

GPS (Priority 2) is intentionally **not** collected — it would require explicit
per-user permission and is never needed for normal usage.

---

## 4. Verify

```sql
-- New columns exist
select column_name from information_schema.columns
where table_schema='public' and table_name='audit_log'
order by ordinal_position;

-- New audit context is being written (after a client action such as creating a pending order)
select id, action, source, ip_address, device, geo, session_id, created_at
from public.audit_log
order by created_at desc
limit 10;
```
