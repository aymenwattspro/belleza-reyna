-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — User Approval System
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. PROFILES TABLE ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  is_approved BOOLEAN DEFAULT false,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ── 2. TRIGGER FUNCTION (created FIRST so it always applies) ──────────────────
-- This function auto-creates a profiles row for every new signup.
-- EXCEPTION block ensures this NEVER blocks a signup even if something goes wrong.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_approved)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
EXCEPTION WHEN OTHERS THEN
  -- Never block signup — silently ignore any error and let auth proceed
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 3. PROFILES TABLE POLICIES ────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Allow authenticated users to insert their own profile (client-side fallback)
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Allow service role full access (needed by trigger and admin operations)
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
CREATE POLICY "Service role can insert profiles"
  ON public.profiles FOR INSERT
  TO service_role
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can update profiles" ON public.profiles;
CREATE POLICY "Service role can update profiles"
  ON public.profiles FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 4. RPC: CHECK APPROVAL STATUS ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_approval(user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    user_approved BOOLEAN;
BEGIN
    SELECT is_approved INTO user_approved FROM public.profiles WHERE id = user_id;
    RETURN COALESCE(user_approved, false);
END;
$$;

-- ── 5. BACKFILL: profiles for any existing auth users ─────────────────────────
INSERT INTO public.profiles (id, email, full_name)
SELECT id, email, COALESCE(raw_user_meta_data->>'full_name', '')
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ── 6. INVENTORY TABLE POLICIES (only applied if tables already exist) ─────────
-- These are wrapped so they don't fail the whole script if schema hasn't been run yet.
DO $$
BEGIN

  -- inventory_snapshots
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_snapshots') THEN
    DROP POLICY IF EXISTS "Users manage own inventory_snapshots" ON public.inventory_snapshots;
    EXECUTE $p$
      CREATE POLICY "Users manage own inventory_snapshots"
        ON public.inventory_snapshots FOR ALL
        TO authenticated
        USING (
          created_by = auth.uid() AND
          EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
        )
        WITH CHECK (
          created_by = auth.uid() AND
          EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
        )
    $p$;
  END IF;

  -- inventory_products
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'inventory_products') THEN
    DROP POLICY IF EXISTS "Users manage own inventory_products" ON public.inventory_products;
    EXECUTE $p$
      CREATE POLICY "Users manage own inventory_products"
        ON public.inventory_products FOR ALL
        TO authenticated
        USING (
          snapshot_id IN (SELECT id FROM public.inventory_snapshots WHERE created_by = auth.uid())
        )
        WITH CHECK (
          snapshot_id IN (SELECT id FROM public.inventory_snapshots WHERE created_by = auth.uid())
        )
    $p$;
  END IF;

  -- confirmed_orders
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'confirmed_orders') THEN
    DROP POLICY IF EXISTS "Users manage own confirmed_orders" ON public.confirmed_orders;
    EXECUTE $p$
      CREATE POLICY "Users manage own confirmed_orders"
        ON public.confirmed_orders FOR ALL
        TO authenticated
        USING (
          created_by = auth.uid() AND
          EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
        )
        WITH CHECK (
          created_by = auth.uid() AND
          EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
        )
    $p$;
  END IF;

  -- order_items
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_items') THEN
    DROP POLICY IF EXISTS "Users manage own order_items" ON public.order_items;
    EXECUTE $p$
      CREATE POLICY "Users manage own order_items"
        ON public.order_items FOR ALL
        TO authenticated
        USING (
          order_id IN (SELECT id FROM public.confirmed_orders WHERE created_by = auth.uid())
        )
        WITH CHECK (
          order_id IN (SELECT id FROM public.confirmed_orders WHERE created_by = auth.uid())
        )
    $p$;
  END IF;

  -- product_settings
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'product_settings') THEN
    DROP POLICY IF EXISTS "Users manage own product_settings" ON public.product_settings;
    EXECUTE $p$
      CREATE POLICY "Users manage own product_settings"
        ON public.product_settings FOR ALL
        TO authenticated
        USING (
          updated_by = auth.uid() AND
          EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
        )
        WITH CHECK (
          updated_by = auth.uid() AND
          EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_approved = true)
        )
    $p$;
  END IF;

END $$;

-- ── DONE ───────────────────────────────────────────────────────────────────────
-- Approve a user:
--   UPDATE public.profiles SET is_approved = true WHERE email = 'user@example.com';
