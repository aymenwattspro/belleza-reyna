-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — User Approval Migration (using public schema)
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. CREATE USER APPROVALS TABLE ───────────────────────────────────────────────
-- Create a simple table to track user approvals
CREATE TABLE IF NOT EXISTS public.user_approvals (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  approved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. BACKFILL EXISTING USERS ───────────────────────────────────────────────────
-- Add existing users to the approvals table
INSERT INTO public.user_approvals (user_id, approved)
SELECT id, false
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_approvals ua WHERE ua.user_id = u.id
)
ON CONFLICT (user_id) DO NOTHING;

-- ── 3. CREATE RPC FUNCTION TO GET USER APPROVAL ───────────────────────────────
-- This function allows users to read their own approval status
CREATE OR REPLACE FUNCTION public.get_user_approval(user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_approved BOOLEAN;
BEGIN
    -- Return the approved status for the given user
    SELECT approved INTO user_approved FROM public.user_approvals WHERE user_id = user_id;
    RETURN COALESCE(user_approved, false);
END;
$$;

-- ── 4. CREATE FUNCTION TO HANDLE NEW USER APPROVAL ─────────────────────────────
-- This function will automatically create approval record for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Insert approval record for new user
    INSERT INTO public.user_approvals (user_id, approved)
    VALUES (NEW.id, false)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

-- ── 5. CREATE TRIGGER FOR NEW USERS ─────────────────────────────────────────────
-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created_approval ON auth.users;

-- Create trigger to automatically create approval record for new users
CREATE TRIGGER on_auth_user_created_approval
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user_approval();

-- ── 6. ENABLE RLS ─────────────────────────────────────────────────────────────────
-- Enable Row Level Security
ALTER TABLE public.user_approvals ENABLE ROW LEVEL SECURITY;

-- Create policy so users can read their own approval status
CREATE POLICY "users can read own approval"
  ON public.user_approvals FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- ── 7. DONE ───────────────────────────────────────────────────────────────────
-- Now you can approve users in the Table Editor:
--   UPDATE public.user_approvals SET approved = true WHERE user_id = 'USER_UUID';
-- 
-- Or find the user_id from auth.users and update in the user_approvals table
--   SELECT id, email FROM auth.users;
--   UPDATE public.user_approvals SET approved = true WHERE user_id = 'UUID_FROM_ABOVE';
