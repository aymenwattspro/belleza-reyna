-- ═══════════════════════════════════════
-- 1. PROFILES TABLE
-- ═══════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  is_approved BOOLEAN DEFAULT false,
  role TEXT DEFAULT 'user'
);

-- ═══════════════════════════════════════
-- 2. AJOUT COLONNES SAFE (évite erreurs)
-- ═══════════════════════════════════════

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT false;

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- ═══════════════════════════════════════
-- 3. RLS
-- ═══════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════
-- 4. POLICIES
-- ═══════════════════════════════════════

DROP POLICY IF EXISTS "select_own_profile" ON public.profiles;
CREATE POLICY "select_own_profile"
ON public.profiles
FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
CREATE POLICY "update_own_profile"
ON public.profiles
FOR UPDATE
USING (auth.uid() = id);

-- ═══════════════════════════════════════
-- 5. TRIGGER FUNCTION (SAFE)
-- ═══════════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    is_approved,
    role
  )
  VALUES (
    NEW.id,
    NEW.email,
    false,
    'user'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════
-- 6. TRIGGER
-- ═══════════════════════════════════════

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ═══════════════════════════════════════
-- 7. BACKFILL SAFE (OPTIONNEL)
-- ═══════════════════════════════════════

INSERT INTO public.profiles (id, email, is_approved, role)
SELECT id, email, false, 'user'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════
-- 8. DONE
-- ═══════════════════════════════════════
-- APPROVAL LOGIC:
-- false = pending access
-- true = full access
--
-- APPROVAL METHOD (IMPORTANT):
-- Supabase Table Editor → profiles
-- change is_approved = true
