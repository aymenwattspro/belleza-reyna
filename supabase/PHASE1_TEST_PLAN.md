# Phase 1 Validation — Suppliers + Product Settings (shared, realtime, RLS)

These four checks must PASS before Phase 2 (Orders) is enabled for production use.
They are **interactive** (two live browsers against your Supabase project), so they
can't be run from the build agent — follow the exact steps below.

## Pre-requisites
1. Run migrations in the SQL Editor **in order**: `001` → `002` → `003` (optionally `004`).
2. Run `supabase/verify.sql` — every row must report `PASS`.
3. Create **two** auth users (e.g. `userA@…`, `userB@…`).
4. Approve **both** for the realtime/uniqueness tests:
   ```sql
   update public.profiles set is_approved = true where email in ('userA@…','userB@…');
   ```
5. Start the app: `npm run dev`. Open it as **User A in Browser 1** and **User B in
   Browser 2** (use two different browsers or one normal + one incognito so the auth
   sessions don't collide).

---

## Test 1 — Two-browser shared state (baseline)
- Browser 1 (User A): go to **Suppliers**, add supplier `"Acme"`.
- Browser 2 (User B): **without reloading**, `"Acme"` appears in the list.
- **PASS** if it appears within ~1–2s in Browser 2.

## Test 2 — Realtime synchronization (both directions)
- Browser 2 (User B): edit `"Acme"` → set phone `5551234`; then in **Product Settings**
  (Inventory Hub product config) set a min-stock value for any `clave`.
- Browser 1 (User A): the supplier edit **and** the product-setting change both appear
  live without reload.
- Delete `"Acme"` in Browser 1 → it disappears live in Browser 2.
- **PASS** if create/update/delete for suppliers AND product_settings all propagate
  both ways without a manual refresh.

## Test 3 — Supplier uniqueness
- Browser 1: add supplier `"Globex"`.
- Browser 2: try to add `"globex"` (different case) and `" Globex "` (whitespace).
- Expected: rejected with a "supplier already exists" style error (the DB has a
  case-insensitive unique index on `lower(trim(name))`); no duplicate row is created.
- **PASS** if both variants are rejected and the list still shows a single `"Globex"`.

## Test 4 — Approval-gated RLS (approved vs unapproved)
Goal: an **unapproved** user can sign in but cannot read/write shared data.
- Mark User B unapproved:
  ```sql
  update public.profiles set is_approved = false where email = 'userB@…';
  ```
  Have User B sign out/in (to refresh the session) and reload.
- Browser 2 (User B, unapproved):
  - Suppliers list should be **empty / blocked** (SELECT denied by RLS), and any
    add/edit/delete must fail (INSERT/UPDATE/DELETE denied).
  - Network tab: the PostgREST calls return `401/403` or empty result sets — **no**
    rows from `suppliers` / `product_settings` are returned.
- Browser 1 (User A, still approved): continues to work normally.
- Re-approve User B (`is_approved = true`), User B reloads → access restored.
- **PASS** if shared data is fully invisible/unwritable while unapproved and restored
  after approval, with no client crash (graceful empty state).

> SQL-only RLS testing is NOT representative: the SQL Editor runs as a privileged role
> that bypasses RLS. RLS must be validated through the app with a logged-in user, as above.

---

## Item 5 — Regenerated types (done in code)
- `src/lib/supabase/types.ts` now mirrors the **final** schema (all tables + RPC
  signatures), replacing the partial manual stub. `npx tsc --noEmit` passes.
- To regenerate authoritatively from the live DB once the CLI is linked
  (`supabase login` + `supabase link --project-ref <ref>`):
  ```bash
  npm run gen:types
  ```

## Sign-off
- [ ] Test 1 pass  - [ ] Test 2 pass  - [ ] Test 3 pass  - [ ] Test 4 pass
- [ ] `verify.sql` all PASS  - [ ] `tsc` clean

When all boxes are checked, proceed to **Phase 2 (Orders)** — implement, stop, test,
then continue. Do **not** migrate Inventory until Orders are validated.
