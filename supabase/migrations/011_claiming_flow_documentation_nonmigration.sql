-- Documentation 011: Claiming Flow User Context (NON-MIGRATION)
-- Issue #10: Claiming Flow User Context Gap (LOW - Workflow)
-- Date: May 7, 2026
-- Type: Documentation / Design Decision (no SQL execution needed)

-- DESCRIPTION:
-- This is NOT a bug or schema issue, but an architectural decision that should be documented.
-- When devices are claimed via claim code, sessions created during unclaimed period
-- inherit the new owner's user context after claiming completes.

-- CURRENT BEHAVIOR:
-- ==================================================

-- Timeline:
-- 1. Device created in factory (owner_id = NULL)
-- 2. Device connects to Arduino code, starts sensing (time_in logged)
-- 3. Session created: session_logs(user_id=NULL, device_id=X)
-- 4. User claims device with code: claim_device_by_code('...)
-- 5. Device.owner_id updated to User Y
-- 6. Now old session appears in User Y's history (because device_id = X and User Y owns X)

-- SQL showing this behavior:
-- SELECT u.id, d.id, sl.user_id, sl.device_id, sl.time_in
-- FROM users u
-- JOIN devices d ON d.owner_id = u.id
-- JOIN session_logs sl ON sl.device_id = d.id
-- WHERE d.claim_code = 'ABC123';

-- Result: Sessions created BEFORE claim now show user_id = User Y (through device.owner_id)

-- WHY THIS HAPPENS:
-- ==================================================

-- session_logs.user_id is auto-filled by trigger:
-- 
-- CREATE TRIGGER trg_set_session_logs_user_id
-- AFTER INSERT ON public.session_logs
-- FOR EACH ROW
-- EXECUTE FUNCTION public.set_session_logs_user_id();
--
-- CREATE FUNCTION public.set_session_logs_user_id()
-- BEGIN
--   IF new.user_id IS NULL AND new.device_id IS NOT NULL THEN
--     SELECT owner_id INTO new.user_id FROM devices WHERE id = new.device_id;
--   END IF;
-- END;
--
-- When session_logs INSERT happens:
-- - device_id = X
-- - Look up devices.owner_id (currently NULL during unclaimed period)
-- - Set user_id = NULL
--
-- After device claimed, there's no UPDATE to session_logs to backfill user_id
-- Instead, queries join through device: WHERE device_id = X AND user_id IN (SELECT owner_id FROM devices)

-- IMPACT ASSESSMENT:
-- ==================================================

-- POSITIVE:
-- ✓ Sessions don't disappear when device is claimed
-- ✓ Full activity history preserved
-- ✓ User sees "devices did this before I claimed it" (transparent)
-- ✓ Factory can verify devices were working before shipping

-- NEGATIVE:
-- ⚠️ User sees activity they didn't directly authorize
-- ⚠️ Session timestamps may confuse (pre-claim activity shown)
-- ⚠️ If device reassigned multiple times, sessions from multiple users visible

-- ACCEPTABLE?
-- ==================================================
-- 
-- For single-device single-user scenario: YES
-- For multi-user shared devices: MAYBE (depends on use case)
-- For resale/reassignment: PROBLEMATIC (old sessions visible to new owner)

-- POSSIBLE SOLUTIONS (NOT IMPLEMENTED - LOW PRIORITY):
-- ==================================================

-- SOLUTION A: Backfill user_id when device is claimed
-- CREATE TRIGGER trg_claim_device
-- AFTER UPDATE ON public.devices
-- FOR EACH ROW
-- WHEN (NEW.owner_id IS NOT NULL AND OLD.owner_id IS NULL)
-- BEGIN
--   UPDATE session_logs 
--   SET user_id = NEW.owner_id
--   WHERE device_id = NEW.id AND user_id IS NULL;
-- END;
--
-- PRO: Sessions directly associated with new owner
-- CON: Loses context that sessions were pre-claim
-- CON: If device reassigned, overwrites previous user

-- SOLUTION B: Add "claimed_at" flag to sessions
-- ALTER TABLE session_logs ADD COLUMN claimed_before BOOLEAN DEFAULT FALSE;
-- 
-- CREATE TRIGGER trg_mark_pre_claim_sessions
-- AFTER UPDATE ON devices
-- WHEN (NEW.owner_id IS NOT NULL AND OLD.owner_id IS NULL)
-- BEGIN
--   UPDATE session_logs 
--   SET claimed_before = TRUE
--   WHERE device_id = NEW.id;
-- END;
--
-- PRO: Transparently shows which sessions were pre-claim
-- CON: Adds schema complexity
-- CON: Requires UI to display "claimed" status

-- SOLUTION C: Segregate pre-claim sessions
-- ALTER TABLE session_logs ADD COLUMN claimed BOOLEAN DEFAULT TRUE;
--
-- In UI: Filter OUT sessions where claimed = FALSE to hide pre-claim activity
--
-- PRO: Clean separation of concerns
-- CON: History is hidden (may violate audit requirements)
-- CON: Factory can't verify pre-claim operation

-- SOLUTION D: Keep as-is, document in UI
-- Display tooltip: "This device created sessions before you claimed it"
-- 
-- PRO: Simplest - no schema changes
-- CON: UX burden on frontend
-- CON: Users confused by unexplained pre-claim sessions

-- CURRENT RECOMMENDATION: Solution D + Documentation
-- ==================================================
-- 
-- RATIONALE:
-- - Single-device scenario doesn't need complexity
-- - Pre-claim visibility valuable for debugging
-- - Schema change carries maintenance burden
-- - UI tooltip clearly explains behavior
-- - If multi-user sharing needed later, revisit with Solution A or B

-- DOCUMENTATION FOR STAKEHOLDERS:
-- ==================================================

-- For Product Owners:
-- When a user completes device claiming, they inherit any sessions that device
-- created before claiming (e.g., factory testing, setup phase). This is expected
-- behavior. Users should be informed that device activity history includes pre-claim.

-- For Frontend Developers:
-- When displaying device history, you may see sessions dated before the device
-- was claimed. Add UI indicator: [ICON] Pre-claim activity
-- Query to find pre-claim sessions:

-- SELECT * FROM session_logs sl
-- WHERE EXISTS (
--   SELECT 1 FROM devices d 
--   WHERE sl.device_id = d.id 
--   AND d.owner_id = auth.uid()
--   AND sl.time_in < d.claimed_date  -- Would need to track claimed_date
-- );

-- For Arduino Developers:
-- Devices will create session entries before they're claimed by a user. When a
-- user later claims the device, those pre-claim sessions become associated with
-- the claiming user. This is intentional - it allows verification that hardware
-- was working during factory phase.

-- For Database Administrators:
-- Sessions created for unclaimed devices (device.owner_id = NULL) will not have
-- a user_id auto-filled. After device is claimed, those sessions remain orphaned
-- (NULL user_id) but are associated through device_id. This is a known design
-- pattern and is not a bug. To audit pre-claim sessions:

-- SELECT COUNT(*) FROM session_logs 
-- WHERE user_id IS NULL AND device_id IN (SELECT id FROM devices WHERE owner_id IS NOT NULL);

-- MONITORING QUERIES (Optional):
-- ==================================================

-- Find devices with pre-claim sessions
-- SELECT 
--   d.id,
--   d.owner_id,
--   COUNT(sl.id) as pre_claim_sessions,
--   MIN(sl.time_in) as earliest_activity
-- FROM devices d
-- LEFT JOIN session_logs sl ON d.id = sl.device_id AND sl.user_id IS NULL
-- WHERE d.owner_id IS NOT NULL
-- GROUP BY d.id, d.owner_id
-- HAVING COUNT(sl.id) > 0;

-- Find sessions that might be orphaned (neither user nor device)
-- SELECT * FROM session_logs 
-- WHERE user_id IS NULL AND device_id NOT IN (SELECT id FROM devices);

-- DEPLOYMENT NOTES:
-- ==================================================
-- 
-- No schema changes required - this is documentation only.
-- Add the Product/UI documentation to your deployment runbook.
-- Consider adding a "pre-claim sessions" indicator to your device dashboard.
-- Monitor the queries above to ensure no unexpected orphaned sessions accumulate.

-- FUTURE DECISION POINTS:
-- ==================================================
-- 
-- Revisit this if:
-- 1. Users complain about unexplained pre-claim sessions
-- 2. Device reassignment becomes common (need Solution A backfill)
-- 3. Multi-user shared devices launched (need Solution B or C)
-- 4. Regulatory audit requires session ownership clarity (need Solution B traceability)

-- RELATED DOCUMENTATION:
-- ==================================================
-- - DATABASE_SCHEMA_ISSUES.md (Issue #10)
-- - websiteprocess.md (Claiming flow section)
-- - schema.sql (devices table, set_session_logs_user_id trigger)
