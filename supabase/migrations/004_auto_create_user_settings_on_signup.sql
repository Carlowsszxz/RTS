-- Migration: Add trigger to auto-create user_settings on user signup
-- Issue #4: No Auto-Creation of user_settings on Signup (HIGH)
--
-- Context: When a new user is created, no row is created in user_settings.
-- Website code uses .single() which throws if 0 rows, causing crashes.
-- 
-- Solution: Create trigger to auto-insert default settings on new user
--
-- Applied: May 7, 2026
-- Impact: Ensures every user has settings row with sensible defaults

-- Create function to auto-create user_settings
CREATE OR REPLACE FUNCTION public.create_user_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_settings (user_id, notifications_enabled, dark_mode, auto_lights, auto_pc, auto_fan)
  VALUES (NEW.id, true, false, true, true, true)
  ON CONFLICT (user_id) DO NOTHING;  -- Idempotent: don't error if already exists
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old trigger if it exists
DROP TRIGGER IF EXISTS trg_create_user_settings ON public.users;

-- Create trigger to fire AFTER user insert
CREATE TRIGGER trg_create_user_settings
AFTER INSERT ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.create_user_settings();

-- Backfill: Create settings for any existing users without settings rows
INSERT INTO public.user_settings (user_id, notifications_enabled, dark_mode, auto_lights, auto_pc, auto_fan)
SELECT 
  u.id, 
  true, 
  false, 
  true, 
  true, 
  true
FROM public.users u
LEFT JOIN public.user_settings us ON u.id = us.user_id
WHERE us.user_id IS NULL;

-- Verify
-- SELECT u.id, u.email, us.user_id IS NOT NULL as has_settings
-- FROM public.users u
-- LEFT JOIN public.user_settings us ON u.id = us.user_id;
