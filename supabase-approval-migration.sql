-- ══════════════════════════════════════════════════════════════════════════════
--  BELLEZA REYNA — User Approval Migration (using auth.users directly)
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. ADD APPROVED COLUMN TO AUTH.USERS ───────────────────────────────────────
-- Add approved column directly to auth.users table
ALTER TABLE auth.users 
ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT false;

-- ── 2. SET DEFAULT FOR EXISTING USERS ───────────────────────────────────────────
-- Update any existing users to have approved = false by default
UPDATE auth.users 
SET approved = false 
WHERE approved IS NULL;

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
    SELECT approved INTO user_approved FROM auth.users WHERE id = user_id;
    RETURN COALESCE(user_approved, false);
END;
$$;

-- ── 4. CREATE FUNCTION TO HANDLE NEW USER APPROVAL ─────────────────────────────
-- This function will automatically set approved = false for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Set approved to false for new users
    NEW.approved := false;
    RETURN NEW;
END;
$$;

-- ── 5. CREATE TRIGGER FOR NEW USERS ─────────────────────────────────────────────
-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created_approval ON auth.users;

-- Create trigger to automatically set approved = false for new users
CREATE TRIGGER on_auth_user_created_approval
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user_approval();

-- ── 6. DONE ───────────────────────────────────────────────────────────────────
-- Now you can approve users directly in the Authentication tab:
--   UPDATE auth.users SET approved = true WHERE email = 'user@example.com';
-- 
-- Or simply edit the approved column in the Authentication → Users table
