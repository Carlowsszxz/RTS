-- Migration 010: Sensor Events Retention Tuning (Optional)
-- Issue #9: Sensor Events Auto-Trim (LOW - Data Retention)
-- Date: May 7, 2026
-- Effort: ~5 minutes
-- Priority: Optional - depends on data retention requirements

-- DESCRIPTION:
-- Current: Keeps max 100 sensor events per device, deletes 20 oldest when >100
-- History window: ~100 events * 10s = 1000 seconds = ~16 minutes
-- 
-- Problem: Dashboard "last 24 hours" shows gaps after 16 minutes
-- Solution: Increase retention based on requirements
--   - 1000 events = 160 minutes (2.7 hours)
--   - 5000 events = 800 minutes (13+ hours)
--   - 50000 events = 8000+ minutes (133+ hours / 5+ days)
--
-- Trade-off: More storage used, but better analytics visibility
-- Note: session_logs is primary history source, sensor_events is supplementary

-- PRE-FLIGHT CHECKS: Run these BEFORE migration
-- ==================================================

-- 1. Check current sensor_events count distribution
SELECT 
  device_id,
  COUNT(*) as event_count,
  MAX(timestamp) as latest_event,
  MIN(timestamp) as oldest_event,
  EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60 as history_minutes
FROM public.sensor_events
GROUP BY device_id
ORDER BY event_count DESC
LIMIT 20;

-- 2. Check storage size of sensor_events table
SELECT 
  pg_size_pretty(pg_total_relation_size('public.sensor_events')) as table_size,
  COUNT(*) as total_events
FROM public.sensor_events;

-- 3. Check trim function parameters
SELECT prosrc FROM pg_proc WHERE proname = 'trim_sensor_events';

-- ANALYSIS: DETERMINE YOUR RETENTION NEEDS
-- ==================================================
-- 
-- Question 1: What is your reporting requirement?
-- - Realtime dashboard (16 min window): Keep current (100 events)
-- - Session history (24 hours): Increase to 14,400 events
-- - Analytics/trends (7 days): Increase to 100,800 events
-- 
-- Question 2: Storage constraints?
-- - Run: SELECT pg_size_pretty(pg_total_relation_size('public.sensor_events'))
-- - Note: 100 events = ~5KB per device, scales linearly
-- 
-- Question 3: Query performance?
-- - sensor_events table rarely joined, mainly queried per-device
-- - Performance impact minimal until >500k total events

-- IMPLEMENTATION OPTIONS:
-- ==================================================

-- OPTION A: Modest increase to 1000 events (2.7 hours history)
-- CREATE OR REPLACE FUNCTION public.trim_sensor_events()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF (SELECT count(*) FROM public.sensor_events WHERE device_id = new.device_id) > 1000 THEN
--     DELETE FROM public.sensor_events
--     WHERE ctid IN (
--       SELECT ctid
--       FROM public.sensor_events
--       WHERE device_id = new.device_id
--       ORDER BY "timestamp" ASC
--       OFFSET 1000
--       LIMIT 100  -- Delete 100 oldest instead of 20
--     );
--   END IF;
--   RETURN new;
-- END;
-- $$ LANGUAGE plpgsql;

-- OPTION B: Aggressive increase to 10000 events (27 hours history)
-- Same as Option A but threshold = 10000, offset = 10000, limit = 500

-- OPTION C: Keep as-is (100 events, 16 minutes)
-- Use session_logs as sole history source, sensor_events for realtime only

-- DECISION: We'll implement OPTION A (1000 events = 2.7 hours)
-- RATIONALE:
-- - 2.7 hour window good for "what happened today" queries
-- - 10x increase in retention, minimal storage impact (~50KB per device)
-- - Backward compatible: Old trim triggers still work on <1000 events
-- - Easy to adjust later if retention needs change

-- Step 1: Update trim_sensor_events function
CREATE OR REPLACE FUNCTION public.trim_sensor_events()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT count(*) FROM public.sensor_events WHERE device_id = new.device_id) > 1000 THEN
    DELETE FROM public.sensor_events
    WHERE ctid IN (
      SELECT ctid
      FROM public.sensor_events
      WHERE device_id = new.device_id
      ORDER BY "timestamp" ASC
      OFFSET 1000
      LIMIT 100  -- Delete 100 oldest when limit exceeded
    );
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Optional backfill - No cleanup needed (old events will naturally trim)
-- The new limit only applies to NEW events, doesn't touch existing data

-- VERIFICATION QUERIES:
-- ==================================================

-- 1. Verify function updated
SELECT prosrc FROM pg_proc WHERE proname = 'trim_sensor_events';

-- 2. Check current distribution after update
SELECT 
  COUNT(*) as total_events,
  COUNT(DISTINCT device_id) as device_count,
  MAX(COUNT(*)) FILTER (PARTITION BY device_id) as max_per_device,
  MIN(COUNT(*)) FILTER (PARTITION BY device_id) as min_per_device
FROM public.sensor_events;

-- 3. Estimate new storage usage (if applied to all devices)
SELECT 
  device_id,
  COUNT(*) as current_events,
  CASE WHEN COUNT(*) < 1000 THEN 'Will grow to ~1000'
       WHEN COUNT(*) = 1000 THEN 'At new limit'
       ELSE 'Will trim to 1000'
  END as expected_behavior
FROM public.sensor_events
GROUP BY device_id
ORDER BY COUNT(*) DESC
LIMIT 10;

-- ROLLBACK PROCEDURE (if needed):
-- ==================================================

-- Revert trim_sensor_events to original (100 events)
-- CREATE OR REPLACE FUNCTION public.trim_sensor_events()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF (SELECT count(*) FROM public.sensor_events WHERE device_id = new.device_id) > 100 THEN
--     DELETE FROM public.sensor_events
--     WHERE ctid IN (
--       SELECT ctid
--       FROM public.sensor_events
--       WHERE device_id = new.device_id
--       ORDER BY "timestamp" ASC
--       OFFSET 100
--       LIMIT 20
--     );
--   END IF;
--   RETURN new;
-- END;
-- $$ LANGUAGE plpgsql;

-- HISTORY WINDOW ANALYSIS:
-- ==================================================
-- 
-- Arduino POST interval: Every 10 seconds (or on change)
-- Calculation: Event count * 10 seconds = history minutes
-- 
-- 100 events  = 1,000 sec  = 16 minutes
-- 500 events  = 5,000 sec  = 83 minutes (1.4 hours)
-- 1000 events = 10,000 sec = 167 minutes (2.8 hours) <-- NEW
-- 5000 events = 50,000 sec = 833 minutes (13.9 hours)
-- 10000 events = 100,000 sec = 1,667 minutes (27.8 hours)

-- STORAGE IMPACT:
-- ==================================================
-- 
-- Assuming ~500 bytes per sensor_event record (UUID, device_id, data, timestamp)
-- 
-- Current:  100 events/device * 500 bytes = 50 KB per device
-- New:     1000 events/device * 500 bytes = 500 KB per device
-- At scale: 1000 devices * 500 KB = 500 MB total
--
-- Acceptable? Yes (negligible for modern cloud storage)

-- MONITORING QUERIES FOR PRODUCTION:
-- ==================================================

-- Daily check: Verify events are trimming correctly
-- SELECT 
--   device_id,
--   COUNT(*) as current_events,
--   MAX(timestamp) as latest,
--   MIN(timestamp) as oldest,
--   EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60 as window_minutes
-- FROM public.sensor_events
-- GROUP BY device_id
-- HAVING COUNT(*) < 100 OR COUNT(*) > 1100  -- Alert if outside expected range

-- Check storage growth over time
-- SELECT 
--   DATE(CURRENT_DATE) as date,
--   pg_size_pretty(pg_total_relation_size('public.sensor_events')) as size,
--   COUNT(*) as event_count
-- FROM public.sensor_events
-- GROUP BY DATE(CURRENT_DATE);

-- DECISION DOCUMENTATION:
-- ==================================================
-- 
-- CHOSEN APPROACH: Increase limit to 1000 events (2.8 hour window)
-- 
-- RATIONALE:
-- - 2.8 hour window sufficient for "today's activity" queries
-- - 10x improvement over previous 16-minute window
-- - Minimal storage impact: ~450 KB additional per 1000 devices
-- - Easy to tweak later if requirements change
-- - Backward compatible: Existing trim logic still works
-- 
-- RISKS:
-- - Slight increase in per-device query payload
-- - Storage growth: ~10x (still minimal on cloud)
-- - If analytics needs require >24 hours, must use session_logs instead
-- 
-- FUTURE ACTIONS:
-- - Monitor sensor_events table size quarterly
-- - If storage becomes concern, reduce back to 500 events
-- - If 24-hour history needed, consider dedicated analytics table
-- - Eventually migrate sensor_events to time-series DB (TimescaleDB, ClickHouse)

-- NEXT STEPS:
-- 1. Deploy this migration
-- 2. Verify trim function works on new inserts
-- 3. Monitor storage over next 2 weeks for growth
-- 4. If acceptable, commit as permanent change
