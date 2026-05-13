-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — User Approval System (inspired by golf project structure)
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. CRÉATION DE LA TABLE DES PROFILS ───────────────────────────────────────────
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

-- ── 2. POLITIQUES DE LECTURE POUR LES PROFILS ───────────────────────────────────────
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Allow service role (trigger function) to insert profiles
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;
CREATE POLICY "Service role can insert profiles"
  ON public.profiles FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── 3. NETTOYAGE DES ANCIENNES RÈGLES (si elles existent) ───────────────────────────
DROP POLICY IF EXISTS "Users manage own inventory_snapshots" ON public.inventory_snapshots;
DROP POLICY IF EXISTS "Users manage own inventory_products" ON public.inventory_products;
DROP POLICY IF EXISTS "Users manage own confirmed_orders" ON public.confirmed_orders;
DROP POLICY IF EXISTS "Users manage own order_items" ON public.order_items;
DROP POLICY IF EXISTS "Users manage own product_settings" ON public.product_settings;

-- ── 4. RÈGLES DE GESTION : Réservé aux UTILISATEURS APPROUVÉS ───────────────────────
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
  );

CREATE POLICY "Users manage own inventory_products"
  ON public.inventory_products FOR ALL
  TO authenticated
  USING (
    snapshot_id IN (SELECT id FROM public.inventory_snapshots WHERE created_by = auth.uid())
  )
  WITH CHECK (
    snapshot_id IN (SELECT id FROM public.inventory_snapshots WHERE created_by = auth.uid())
  );

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
  );

CREATE POLICY "Users manage own order_items"
  ON public.order_items FOR ALL
  TO authenticated
  USING (
    order_id IN (SELECT id FROM public.confirmed_orders WHERE created_by = auth.uid())
  )
  WITH CHECK (
    order_id IN (SELECT id FROM public.confirmed_orders WHERE created_by = auth.uid())
  );

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
  );

-- ── 5. AUTOMATISATION DES PROFILS ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, is_approved)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', false);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 6. CRÉATION DE LA FONCTION RPC POUR VÉRIFIER L'APPROBATION ───────────────────────
CREATE OR REPLACE FUNCTION public.get_user_approval(user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_approved BOOLEAN;
BEGIN
    -- Retourner le statut d'approbation pour l'utilisateur donné
    SELECT is_approved INTO user_approved FROM public.profiles WHERE id = user_id;
    RETURN COALESCE(user_approved, false);
END;
$$;

-- ── 7. INITIALISATION : Créer les profils pour les comptes déjà existants ───────────────
INSERT INTO public.profiles (id, email, full_name) 
SELECT id, email, raw_user_meta_data->>'full_name' FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ── 8. DONE ───────────────────────────────────────────────────────────────────
-- Approuver un utilisateur:
--   UPDATE public.profiles SET is_approved = true WHERE email = 'user@example.com';
-- 
-- Ou modifier directement dans la table profiles dans l'éditeur de table
