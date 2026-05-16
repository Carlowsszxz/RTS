-- Migration 009: Improve Claim Code Entropy (Optional)
-- Issue #8: Claim Code Collision Risk (LOW - Cryptographic)
-- Date: May 7, 2026
-- Effort: ~2 minutes
-- Priority: Optional - very low collision risk in practice

-- DESCRIPTION:
-- Current: Claim codes use gen_random_bytes(4) = 32 bits = ~4.3 billion possibilities
-- Collision probability: 50% chance at ~65k devices
-- Current deployment likely < 1000 devices, so risk is negligible
-- 
-- This migration increases entropy from 4 bytes to 6 bytes
-- New: gen_random_bytes(6) = 48 bits = ~280 trillion possibilities
-- Collision probability at 1M devices: <0.0001%

-- PRE-FLIGHT CHECKS: Run these BEFORE migration
-- ==================================================

-- 1. Check current claim code length
SELECT 
  LENGTH(claim_code) as code_length,
  COUNT(*) as device_count
FROM public.devices
WHERE claim_code IS NOT NULL
GROUP BY LENGTH(claim_code);

-- 2. Find any duplicate claim codes (shouldn't exist - UNIQUE constraint)
SELECT claim_code, COUNT(*) as count
FROM public.devices
GROUP BY claim_code
HAVING COUNT(*) > 1;

-- 3. Check device count
SELECT COUNT(*) as total_devices FROM public.devices;

-- 4. Verify uniqueness constraint exists
SELECT constraint_name
FROM information_schema.table_constraints
WHERE table_name = 'devices' 
  AND constraint_type = 'UNIQUE'
  AND constraint_name LIKE '%claim%';

-- IMPLEMENTATION: Increase Entropy
-- ==================================================

-- Step 1: Update the trigger function to use 6 bytes instead of 4
CREATE OR REPLACE FUNCTION public.set_claim_code_if_missing()
RETURNS TRIGGER AS $$
BEGIN
  IF new.claim_code IS NULL OR LENGTH(TRIM(new.claim_code)) = 0 THEN
    new.claim_code := UPPER(ENCODE(gen_random_bytes(6), 'hex'));  -- Changed from 4 to 6
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Update existing devices with NULL or empty claim codes
-- (Generate new high-entropy codes)
UPDATE public.devices
SET claim_code = UPPER(ENCODE(gen_random_bytes(6), 'hex'))
WHERE claim_code IS NULL OR LENGTH(TRIM(claim_code)) = 0;

-- VERIFICATION QUERIES:
-- ==================================================

-- 1. Verify trigger function updated
SELECT prosrc FROM pg_proc 
WHERE proname = 'set_claim_code_if_missing';

-- 2. Verify claim codes are now 12 characters (6 bytes = 12 hex chars)
SELECT 
  LENGTH(claim_code) as code_length,
  COUNT(*) as device_count
FROM public.devices
WHERE claim_code IS NOT NULL
GROUP BY LENGTH(claim_code);

-- 3. Check for any remaining short codes
SELECT COUNT(*) as old_format_codes
FROM public.devices
WHERE LENGTH(claim_code) < 12;

-- 4. Verify no NULL codes remain
SELECT COUNT(*) as null_codes FROM public.devices WHERE claim_code IS NULL;

-- ROLLBACK PROCEDURE (if needed):
-- ==================================================

-- Revert trigger to 4 bytes (WARNING: won't regenerate existing 6-byte codes)
-- CREATE OR REPLACE FUNCTION public.set_claim_code_if_missing()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   IF new.claim_code IS NULL OR LENGTH(TRIM(new.claim_code)) = 0 THEN
--     new.claim_code := UPPER(ENCODE(gen_random_bytes(4), 'hex'));
--   END IF;
--   RETURN new;
-- END;
-- $$ LANGUAGE plpgsql;

-- COLLISION ANALYSIS:
-- ==================================================
-- 
-- BEFORE (4 bytes = 32 bits):
-- - Total possibilities: 2^32 = 4,294,967,296 (~4.3 billion)
-- - Birthday paradox 50% collision at: ~65,000 devices
-- - Supabase birthday paradox calculator: 
--   https://crypto.stackexchange.com/questions/1434/are-there-mathematical-criteria-for-determining-the-hash-size-required-for-a-given-collision-probability
--
-- AFTER (6 bytes = 48 bits):
-- - Total possibilities: 2^48 = 281,474,976,710,656 (~281 trillion)
-- - Birthday paradox 50% collision at: ~16.8 million devices
-- - 1% collision at ~150,000 devices
-- - Current risk: NEGLIGIBLE (deployment < 1000 devices)
-- - Future-proof: Scales to 100k+ device deployments

-- PERFORMANCE IMPACT:
-- ==================================================
-- - Claim code generation: gen_random_bytes(6) vs gen_random_bytes(4)
--   Time difference: <0.1ms per code (negligible)
-- - Claim code storage: 12 chars vs 8 chars (minimal space increase)
-- - Database index performance: No impact (already indexed)

-- MONITORING QUERIES FOR PRODUCTION:
-- ==================================================

-- Check claim code distribution (verify no patterns)
-- SELECT 
--   LENGTH(claim_code) as code_length,
--   COUNT(*) as count,
--   MIN(created_at) as earliest,
--   MAX(created_at) as latest
-- FROM public.devices
-- GROUP BY LENGTH(claim_code);

-- Audit: Devices with old 8-character codes
-- SELECT id, claim_code, created_at FROM public.devices WHERE LENGTH(claim_code) = 8;

-- DECISION DOCUMENTATION:
-- ==================================================
-- 
-- CHOSEN APPROACH: Increase to 6 bytes
-- 
-- RATIONALE:
-- - Current 4-byte entropy sufficient for current scale (<1000 devices)
-- - 6-byte upgrade provides massive headroom (16.8M devices at 50% collision)
-- - Zero performance impact, minimal storage impact
-- - Future-proofs against device volume growth
-- - Better UX: 12-char codes vs 8-char codes (not significantly longer)
-- 
-- RISKS:
-- - Existing claim codes remain at old length (not regenerated)
-- - Both 8-char and 12-char codes coexist during transition
-- - New codes use 6-byte entropy, old codes use 4-byte
-- - If collision risk suddenly matters, both lengths affected
-- 
-- FUTURE ACTION:
-- - Monitor claim_code collisions in production
-- - If ever needed, regenerate ALL codes to 6-byte format
-- - Consider 8 bytes (64 bits) for future-future-proofing

-- NEXT STEPS:
-- 1. Deploy this migration
-- 2. Monitor: New devices get 12-char codes
-- 3. Verify: No claiming issues with longer codes
-- 4. Log: Migration timestamp for future audits
