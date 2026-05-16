-- Migration: Add missing index for device_id queries on session_logs
-- Issue #1: Missing Index for Device-based Queries (CRITICAL - Performance)
-- 
-- Context: Website code (Bug #3 fix) now queries session_logs by device_id.
-- Without this index, every query performs a full table scan.
-- 
-- Applied: May 7, 2026
-- Impact: Improves query performance for multi-device session lookups

-- Create composite index on (device_id, time_in DESC)
-- This supports queries like:
--   SELECT * FROM session_logs 
--   WHERE user_id = $1 AND device_id = $2 
--   ORDER BY time_in DESC
CREATE INDEX IF NOT EXISTS session_logs_device_id_time_in_idx 
  ON public.session_logs USING BTREE (device_id, time_in DESC);

-- Verify index was created
-- SELECT indexname, indexdef 
-- FROM pg_indexes 
-- WHERE tablename = 'session_logs' AND indexname = 'session_logs_device_id_time_in_idx';
