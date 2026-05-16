-- Migration: Add NOT NULL constraint to session_logs.device_id
-- Issue #2: Nullable device_id with Dependent Trigger Logic (CRITICAL - Data Integrity)
--
-- Context: Arduino always POSTs with device_id, but column is nullable.
-- Trigger auto-fills user_id ONLY if device_id is NOT NULL.
-- This creates risk of orphaned sessions (no user, no device).
--
-- Applied: May 7, 2026
-- Impact: Ensures data integrity - every session must have a device

-- Step 1: Find any orphaned sessions (should be none, but verify first)
-- SELECT COUNT(*) as orphaned_sessions 
-- FROM session_logs 
-- WHERE device_id IS NULL;

-- Step 2: If orphaned sessions exist, fill from time_in heuristic or delete them
-- For safety, we document but don't auto-delete
-- Uncomment if you find orphans and want to handle them:
-- DELETE FROM session_logs WHERE device_id IS NULL;

-- Step 3: Add NOT NULL constraint
ALTER TABLE public.session_logs
  ALTER COLUMN device_id SET NOT NULL;

-- Verify constraint was applied
-- \d public.session_logs
-- Look for: device_id uuid not null

-- Optional: Add comment explaining why
COMMENT ON COLUMN public.session_logs.device_id IS 
  'NOT NULL: Every session must be associated with a device. Auto-filled by trigger from device.owner_id if not provided.';
