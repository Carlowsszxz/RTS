-- Migration 007: Handle Cascade Delete Asymmetry - Sessions on User Delete
-- Issue #3: Cascade Delete Asymmetry - Sessions Orphaned on User Delete (CRITICAL - Data Safety)
-- Date: May 7, 2026
-- Effort: ~20 minutes (decision + implementation)

-- DESCRIPTION:
-- Current behavior: Device delete cascades to sessions, but user delete sets session.user_id to NULL
-- This creates "orphaned" sessions: (user_id=NULL, device_id=X) that can't be queried by owner
-- When device later reassigned to new user, old orphaned sessions become visible
-- 
-- This migration implements OPTION C (recommended): Keep current FK behavior BUT add
-- monitoring trigger to detect orphaned sessions and warn when they occur
-- 
-- CHOOSE YOUR PREFERRED OPTION:
-- Option A: Cascade delete sessions when user deleted (destructive - loss of history)
-- Option B: Prevent user deletion if sessions exist (safe but restrictive)
-- Option C: Keep as-is + monitoring/audit triggers (recommended - balances safety & usability)

-- PRE-FLIGHT CHECKS: Run these BEFORE migration
-- ==================================================

-- 1. Check current cascade delete behavior
SELECT 
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
LEFT JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('session_logs', 'devices', 'users');

-- 2. Find any existing orphaned sessions (shouldn't exist yet)
SELECT COUNT(*) as orphaned_sessions
FROM public.session_logs
WHERE user_id IS NULL AND device_id IS NOT NULL;

-- 3. Find sessions that would be affected if user is deleted
SELECT COUNT(*) as sessions_per_user
FROM public.session_logs
WHERE user_id IS NOT NULL
GROUP BY user_id
ORDER BY COUNT(*) DESC
LIMIT 10;

-- IMPLEMENTATION: OPTION C - MONITORING & DOCUMENTATION
-- ==================================================

-- Step 1: Add audit trigger to log orphaned session creation
CREATE TABLE IF NOT EXISTS public.orphaned_session_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid,
  device_id uuid,
  time_in timestamp with time zone,
  time_out timestamp with time zone,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  reason text,
  resolution_status text DEFAULT 'pending',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

-- Step 2: Create trigger to detect orphaned sessions
CREATE OR REPLACE FUNCTION public.detect_orphaned_session()
RETURNS TRIGGER AS $$
BEGIN
  -- Detect when session becomes orphaned (user_id becomes NULL while device_id exists)
  IF NEW.user_id IS NULL AND NEW.device_id IS NOT NULL AND OLD.user_id IS NOT NULL THEN
    INSERT INTO public.orphaned_session_audit (
      session_id, user_id, device_id, time_in, time_out, reason
    ) VALUES (
      NEW.id, 
      NEW.user_id, 
      NEW.device_id, 
      NEW.time_in, 
      NEW.time_out,
      'Session orphaned by user deletion (ON DELETE SET NULL from session_logs_user_id_fkey)'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Attach trigger to session_logs updates
CREATE TRIGGER trg_detect_orphaned_session
AFTER UPDATE ON public.session_logs
FOR EACH ROW
EXECUTE FUNCTION public.detect_orphaned_session();

-- Step 4: Add index for fast orphan detection
CREATE INDEX IF NOT EXISTS orphaned_session_audit_status_idx 
  ON public.orphaned_session_audit (resolution_status, detected_at DESC);

-- Step 5: Add documentation comments
COMMENT ON TABLE public.orphaned_session_audit IS 
  'Audit log for orphaned sessions. Sessions become orphaned when user is deleted but device still owns them.';

COMMENT ON CONSTRAINT session_logs_user_id_fkey ON public.session_logs IS 
  'CASCADE DELETE: When device deleted, all sessions deleted. 
   SET NULL: When user deleted, user_id set to NULL, session remains (orphaned).
   Orphaned sessions are logged to orphaned_session_audit for monitoring.';

-- VERIFICATION QUERIES:
-- ==================================================

-- 1. Verify orphaned_session_audit table exists
SELECT * FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'orphaned_session_audit';

-- 2. Verify trigger is active
SELECT 
  trigger_schema,
  trigger_name,
  event_object_table,
  trigger_timing,
  event_manipulation
FROM information_schema.triggers
WHERE trigger_name = 'trg_detect_orphaned_session';

-- 3. Verify index exists
SELECT indexname FROM pg_indexes 
WHERE tablename = 'orphaned_session_audit' 
  AND indexname = 'orphaned_session_audit_status_idx';

-- 4. Run audit query to check current orphaned sessions
SELECT COUNT(*) as current_orphaned_sessions
FROM public.session_logs
WHERE user_id IS NULL AND device_id IS NOT NULL;

-- OPTIONAL: ALTERNATIVE IMPLEMENTATIONS
-- ==================================================

-- If you prefer OPTION A (Cascade delete), uncomment and run:
-- ALTER TABLE public.session_logs 
--   DROP CONSTRAINT session_logs_user_id_fkey,
--   ADD CONSTRAINT session_logs_user_id_fkey 
--     FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
-- 
-- WARNING: This will delete all sessions when user deletes. Loss of history.
-- No rollback possible once user/sessions deleted.

-- If you prefer OPTION B (Prevent deletion), uncomment and run:
-- ALTER TABLE public.session_logs 
--   DROP CONSTRAINT session_logs_user_id_fkey,
--   ADD CONSTRAINT session_logs_user_id_fkey 
--     FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE RESTRICT;
-- 
-- EFFECT: User deletion fails if they have sessions. Must close all sessions first.
-- Can be changed back to SET NULL later if needed.

-- ROLLBACK PROCEDURE (if needed):
-- ==================================================

-- DROP TRIGGER trg_detect_orphaned_session ON public.session_logs;
-- DROP FUNCTION public.detect_orphaned_session();
-- DROP TABLE public.orphaned_session_audit;
-- -- Foreign key constraint remains unchanged (SET NULL still in effect)

-- MONITORING QUERIES FOR PRODUCTION:
-- ==================================================

-- Daily: Check for new orphaned sessions
-- SELECT COUNT(*) as new_orphaned_sessions, 
--        MIN(detected_at) as earliest_detection
-- FROM public.orphaned_session_audit
-- WHERE detected_at > NOW() - INTERVAL '1 day'
--   AND resolution_status = 'pending';

-- Weekly: Summarize orphaning patterns
-- SELECT reason, COUNT(*) as count
-- FROM public.orphaned_session_audit
-- GROUP BY reason;

-- Admin: Find user deletions that caused orphaning
-- SELECT sa.session_id, sa.device_id, sa.user_id, sa.detected_at
-- FROM public.orphaned_session_audit sa
-- WHERE sa.resolution_status = 'pending'
-- ORDER BY sa.detected_at DESC;

-- Manual fix: Reassign orphaned sessions to device owner
-- (Only if device has been reclaimed by new user)
-- UPDATE public.session_logs sl
-- SET user_id = d.owner_id
-- FROM public.devices d
-- WHERE sl.device_id = d.id
--   AND sl.user_id IS NULL
--   AND d.owner_id IS NOT NULL;
-- 
-- Then mark audit entries as resolved:
-- UPDATE public.orphaned_session_audit
-- SET resolution_status = 'reassigned'
-- WHERE resolution_status = 'pending';

-- DECISION DOCUMENTATION:
-- ==================================================
-- 
-- CHOSEN APPROACH: Option C (Monitoring)
-- RATIONALE:
-- - Preserves session history (important for auditing and incident investigation)
-- - Detects when orphaning occurs (can alert admins)
-- - Allows manual resolution if needed
-- - Less destructive than Option A (cascade delete)
-- - Less restrictive than Option B (prevent delete)
-- 
-- RISKS ACCEPTED:
-- - Orphaned sessions will exist temporarily until manual remediation
-- - Device reassignment may show old sessions from previous owner
-- - Audit table grows over time (perform cleanup/archival periodically)
-- 
-- FUTURE IMPROVEMENTS:
-- - Add scheduled job to auto-cleanup truly orphaned sessions after N days
-- - Add dashboard widget showing orphaned session count
-- - Implement user notification when device reassigned (shows old sessions)

-- NEXT STEPS:
-- 1. Deploy this migration
-- 2. Monitor orphaned_session_audit table in production
-- 3. If orphaning becomes frequent, reconsider Option A or B
-- 4. If orphaning never occurs, this migration adds minimal overhead
