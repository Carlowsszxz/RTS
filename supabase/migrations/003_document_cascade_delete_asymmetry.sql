-- Migration: Document cascade delete asymmetry and add monitoring
-- Issue #3: Cascade Delete Asymmetry - Sessions Orphaned on User Delete (CRITICAL - Data Safety)
--
-- Context: 
--   - Device DELETE cascades delete sessions (good)
--   - User DELETE sets session.user_id = NULL (orphans sessions)
-- 
-- Decision: Option C (Keep as-is with monitoring)
-- Rationale: Preserves session history when user is deleted
-- 
-- Applied: May 7, 2026
-- Impact: Documented behavior, not changed. Monitor for orphaned sessions.

-- Step 1: Add comments explaining the cascade delete behavior
COMMENT ON CONSTRAINT session_logs_device_id_fkey ON public.session_logs IS
  'CASCADE DELETE: When device is deleted, all related sessions are deleted. This is intentional.';

COMMENT ON CONSTRAINT session_logs_user_id_fkey ON public.session_logs IS
  'SET NULL on DELETE: When user is deleted, user_id is set to NULL but session remains (preserved history). Sessions remain joined to device if device still exists.';

-- Step 2: Query to identify orphaned sessions (run periodically for monitoring)
-- This should return 0 rows under normal operation
-- If users have been deleted, you'll see orphaned sessions here
-- SELECT id, device_id, user_id, time_in, time_out
-- FROM session_logs
-- WHERE user_id IS NULL AND device_id IS NOT NULL
-- LIMIT 10;

-- Step 3: Optional - Add audit trigger to log orphaned sessions
-- CREATE TABLE IF NOT EXISTS public.audit_orphaned_sessions (
--   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
--   session_id uuid NOT NULL,
--   orphaned_at timestamp DEFAULT now(),
--   note text
-- );

-- CREATE OR REPLACE FUNCTION public.audit_orphaned_session()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF NEW.user_id IS NULL AND OLD.user_id IS NOT NULL THEN
--     INSERT INTO audit_orphaned_sessions (session_id, note)
--     VALUES (NEW.id, 'User deleted, session orphaned');
--   END IF;
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql SECURITY DEFINER;

-- CREATE TRIGGER trg_audit_orphaned_session
-- AFTER UPDATE ON public.session_logs
-- FOR EACH ROW
-- EXECUTE FUNCTION public.audit_orphaned_session();

-- Decision Points for Future:
-- A) Cascade delete sessions when user deleted (loses history)
--    ALTER TABLE public.session_logs
--      DROP CONSTRAINT session_logs_user_id_fkey,
--      ADD CONSTRAINT session_logs_user_id_fkey
--        FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
--
-- B) Prevent user deletion if sessions exist (safer)
--    ALTER TABLE public.session_logs
--      DROP CONSTRAINT session_logs_user_id_fkey,
--      ADD CONSTRAINT session_logs_user_id_fkey
--        FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE RESTRICT;
--
-- C) Current - SET NULL (keeps history, creates orphans)
--    [Already applied - no changes needed]
