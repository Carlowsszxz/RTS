-- Migration 006: Increase Cron Job Timeout to 16 Minutes
-- Issue #6: Cron Job Timeout Conflicts with Arduino Timeout (MEDIUM - Timing)
-- Date: May 7, 2026
-- Effort: ~2 minutes

-- DESCRIPTION:
-- Current cron timeout: 10 minutes (close_stale_sessions trigger)
-- Arduino timeout: 15 minutes (10min idle + 5min prompt timeout)
-- CONFLICT: Sessions close in Postgres BEFORE Arduino completes prompt cycle
-- 
-- This migration increases cron timeout to 16 minutes, giving Arduino full
-- 15-minute window to complete idle detection + prompt cycle before closure
-- Prevents presence prompts arriving for already-closed sessions

-- TIMING ANALYSIS:
-- ==================================================
-- T=0min    Session starts (motion detected)
-- T=10min   Arduino detects idle (no motion in 10 minutes)
-- T=10min   Arduino sends still_there_prompt to website
-- T=10min+  Website receives prompt and displays to user
-- T=15min   Arduino times out (no ACK received) and forces SSR OFF
-- 
-- PROBLEM: Old cron at 10min closed session BEFORE Arduino sent prompt at T=10min
-- NEW: Cron at 16min allows full 15min window for Arduino timeout to complete

-- PRE-FLIGHT CHECKS: Run these BEFORE migration
-- ==================================================

-- 1. Verify cron job exists and current settings
SELECT 
  jobid,
  jobname,
  schedule,
  command,
  nodename
FROM cron.job
WHERE jobname = 'close-stale-sessions';

-- 2. Check current stale session count (sessions older than 10 min)
SELECT COUNT(*) as sessions_older_than_10min
FROM public.session_logs
WHERE time_out IS NULL
  AND EXTRACT(EPOCH FROM (NOW() - time_in)) > 600;  -- 600 sec = 10 min

-- 3. Check current stale session count (10-16 min range - affected by this migration)
SELECT COUNT(*) as sessions_in_10_to_16min_range
FROM public.session_logs
WHERE time_out IS NULL
  AND EXTRACT(EPOCH FROM (NOW() - time_in)) BETWEEN 600 AND 960;  -- 960 sec = 16 min

-- 4. Verify Arduino timeout spec (from websiteprocess.md)
-- Arduino constants should be:
-- - Idle detection: 10 minutes (IDLE_TIMEOUT_MS = 600000 ms)
-- - Prompt timeout: 5 minutes (PROMPT_TIMEOUT_MS = 300000 ms)
-- - Total: 15 minutes before SSR forced OFF

-- MIGRATION STEPS:
-- ==================================================

-- Step 1: Update cron job to use 16 minutes (960 seconds) instead of 10 (600)
-- This unschedules and reschedules the job with new timeout parameter
SELECT cron.unschedule('close-stale-sessions');

SELECT cron.schedule(
  'close-stale-sessions',
  '* * * * *',  -- Every minute
  'select public.close_stale_sessions(16);'  -- Close sessions inactive >16 minutes
);

-- VERIFICATION QUERIES:
-- ==================================================

-- 1. Verify new timeout is registered
SELECT 
  jobid,
  jobname,
  schedule,
  command,
  nodename
FROM cron.job
WHERE jobname = 'close-stale-sessions';

-- 2. Confirm command shows "16" parameter
SELECT 
  command,
  CASE 
    WHEN command LIKE '%close_stale_sessions(16)%' THEN '✓ CORRECT (16 min timeout)'
    WHEN command LIKE '%close_stale_sessions(10)%' THEN '✗ WRONG (still 10 min)'
    ELSE '? UNKNOWN'
  END AS status
FROM cron.job
WHERE jobname = 'close-stale-sessions';

-- 3. Test the close_stale_sessions function with new timeout
-- (Dry run - doesn't actually delete)
SELECT COUNT(*) as sessions_that_would_be_closed
FROM public.session_logs
WHERE time_out IS NULL
  AND EXTRACT(EPOCH FROM (NOW() - time_in)) > 960;  -- 16 minutes in seconds

-- ROLLBACK PROCEDURE (if needed):
-- ==================================================

-- SELECT cron.unschedule('close-stale-sessions');
-- SELECT cron.schedule(
--   'close-stale-sessions',
--   '* * * * *',
--   'select public.close_stale_sessions(10);'  -- Revert to 10 minutes
-- );

-- VALIDATION CHECKLIST:
-- ==================================================

-- [ ] Confirm cron.job shows "close_stale_sessions(16)"
-- [ ] Verify Arduino timeout constants match: 10min idle + 5min prompt
-- [ ] Monitor session logs: no sessions closed at 10min mark (now at 16min)
-- [ ] Test that presence prompts complete normally (no early closure)
-- [ ] Validate no performance impact (scheduled job runs every minute regardless)

-- NOTES:
-- - This is a timing alignment fix, not a schema change
-- - No data migration needed; old sessions unaffected
-- - New sessions closing after this migration will wait 16min (not 10min)
-- - Test recommended: Set Arduino to 1min idle + 30s prompt, verify timing
-- - Related to: websiteprocess.md Section 6 (Arduino Timing) and Section 7 (Website Timing)

-- MIGRATION IMPACT:
-- ==================================================
-- Sessions will stay open 6 minutes longer (10 -> 16 minutes)
-- Impact on storage: Minimal (6min × 1000 devices = 6000 extra session rows if active)
-- Impact on performance: None (scheduled job runs every minute regardless of timeout value)
-- User experience: Better (presence prompts now complete before session auto-closes)
