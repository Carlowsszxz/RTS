-- Migration 005: Add user_id to presence_acks for Direct Query Access
-- Issue #5: presence_acks Not Linked to user_id (MEDIUM - Query Design)
-- Date: May 7, 2026
-- Effort: ~15 minutes

-- DESCRIPTION:
-- Currently, to find all acks for a user, must join: presence_acks -> devices -> get owner_id
-- This migration adds direct user_id link to presence_acks for efficient querying
-- Also solves claiming flow issue where acks created before device owner assigned

-- PRE-FLIGHT CHECKS: Run these BEFORE migration
-- ==================================================

-- 1. Check current presence_acks count by device
SELECT 
  device_id, 
  COUNT(*) as ack_count,
  MAX(ack_at) as latest_ack
FROM public.presence_acks
GROUP BY device_id
LIMIT 10;

-- 2. Verify all devices have valid owners (for backfill)
SELECT COUNT(*) as devices_with_owner
FROM public.devices
WHERE owner_id IS NOT NULL;

SELECT COUNT(*) as devices_without_owner
FROM public.devices
WHERE owner_id IS NULL;

-- 3. Check for any acks pointing to orphaned devices
SELECT COUNT(*) as orphaned_ack_count
FROM public.presence_acks pa
LEFT JOIN public.devices d ON pa.device_id = d.id
WHERE d.id IS NULL;

-- MIGRATION STEPS:
-- ==================================================

-- Step 1: Add user_id column to presence_acks
ALTER TABLE public.presence_acks
ADD COLUMN user_id uuid null;

-- Step 2: Add foreign key constraint to users
ALTER TABLE public.presence_acks
ADD CONSTRAINT presence_acks_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE SET NULL;

-- Step 3: Backfill user_id from existing device relationships
UPDATE public.presence_acks pa
SET user_id = d.owner_id
FROM public.devices d
WHERE pa.device_id = d.id 
  AND d.owner_id IS NOT NULL;

-- Step 4: Add index for efficient querying by user_id + time
CREATE INDEX IF NOT EXISTS presence_acks_user_id_ack_at_idx 
  ON public.presence_acks USING BTREE (user_id, ack_at DESC);

-- VERIFICATION QUERIES:
-- ==================================================

-- 1. Verify backfill completed
SELECT 
  COUNT(*) as total_acks,
  COUNT(CASE WHEN user_id IS NOT NULL THEN 1 END) as acks_with_user,
  COUNT(CASE WHEN user_id IS NULL THEN 1 END) as acks_without_user
FROM public.presence_acks;

-- 2. Verify new index exists
SELECT 
  schemaname,
  tablename,
  indexname
FROM pg_indexes
WHERE tablename = 'presence_acks'
  AND indexname = 'presence_acks_user_id_ack_at_idx';

-- 3. Test query performance (should use index)
EXPLAIN ANALYZE
SELECT * FROM public.presence_acks 
WHERE user_id = 'test-user-id'::uuid
ORDER BY ack_at DESC
LIMIT 20;

-- 4. Validate FK relationships
SELECT 
  COUNT(*) as acks_with_valid_users
FROM public.presence_acks
WHERE user_id IS NOT NULL
  AND user_id IN (SELECT id FROM public.users);

-- ROLLBACK PROCEDURE (if needed):
-- ==================================================

-- DROP INDEX presence_acks_user_id_ack_at_idx;
-- ALTER TABLE public.presence_acks DROP CONSTRAINT presence_acks_user_id_fkey;
-- ALTER TABLE public.presence_acks DROP COLUMN user_id;

-- NOTES:
-- - Acks with NULL device_id (claiming phase) will have NULL user_id initially
-- - As devices are claimed and owner_id set, those acks remain at NULL
--   (Consider adding UPDATE trigger on devices.owner_id change to backfill)
-- - This enables efficient queries: SELECT * FROM presence_acks WHERE user_id = $1
--   Previously required: SELECT pa.* FROM presence_acks pa JOIN devices d ON pa.device_id = d.id WHERE d.owner_id = $1
-- - Backfill is idempotent; can be rerun without issues
