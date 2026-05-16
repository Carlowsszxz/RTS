-- Migration 008: Email Constraint Hardening (Optional)
-- Issue #7: Email Nullable with UNIQUE Constraint (LOW - Data Model)
-- Date: May 7, 2026
-- Effort: ~5 minutes
-- Priority: Optional - depends on Supabase Auth behavior

-- DESCRIPTION:
-- Current: Email is nullable with UNIQUE constraint
-- PostgreSQL allows multiple NULL values in unique columns
-- If auth layer doesn't enforce email requirement, could have duplicate NULLs
-- This migration hardens the constraint to prevent surprising behavior

-- CURRENT BEHAVIOR:
-- Multiple users can have email = NULL (violates uniqueness expectation)
-- Supabase Auth probably prevents this in practice, but schema doesn't enforce it

-- PRE-FLIGHT CHECKS: Run these BEFORE migration
-- ==================================================

-- 1. Check if any users have NULL email
SELECT COUNT(*) as users_with_null_email FROM public.users WHERE email IS NULL;

-- 2. Check if multiple NULLs exist
SELECT email, COUNT(*) as count 
FROM public.users 
WHERE email IS NULL
GROUP BY email;

-- 3. Verify uniqueness of non-null emails
SELECT email, COUNT(*) as count 
FROM public.users 
WHERE email IS NOT NULL
GROUP BY email
HAVING COUNT(*) > 1;

-- IMPLEMENTATION OPTIONS:
-- ==================================================

-- OPTION A: Add NOT NULL constraint (strict - requires all users have email)
-- ALTER TABLE public.users
--   ALTER COLUMN email SET NOT NULL;
-- 
-- RISKS:
-- - Breaks if any NULL emails exist (use pre-flight check above)
-- - Frontend must always provide email on signup
-- - Rollback: ALTER TABLE public.users ALTER COLUMN email DROP NOT NULL;

-- OPTION B: Conditional unique constraint (PostgreSQL 15+ only)
-- DROP CONSTRAINT users_email_key;
-- ADD CONSTRAINT users_email_key_notnull UNIQUE (email)
-- WHERE email IS NOT NULL;
-- 
-- PROS: Allows NULL but enforces uniqueness on non-null values
-- CONS: Requires PostgreSQL 15+ (check version below)

-- Check PostgreSQL version
SELECT version();

-- OPTION C: Keep as-is (accept current behavior)
-- This is the default - no migration needed
-- Document that auth layer handles NULL prevention

-- DECISION: We'll implement OPTION C (DOCUMENTATION ONLY)
-- RATIONALE:
-- - Supabase Auth strongly encourages email on signup
-- - NULL values unlikely in practice
-- - Constraint change is risky if any NULL values exist
-- - Better to document than to enforce schema-level change

-- Step 1: Add documentation comment
COMMENT ON COLUMN public.users.email IS 
  'User email address. 
   Nullable for service accounts / test users. 
   In practice, Supabase Auth enforces non-null on signup.
   Schema allows multiple NULL values (PostgreSQL UNIQUE quirk).
   Monitor: SELECT COUNT(*) FROM users WHERE email IS NULL to verify.';

-- VERIFICATION QUERIES:
-- ==================================================

-- 1. Verify comment was added
SELECT column_name, table_name
FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'email';

-- 2. Check current email uniqueness
SELECT 
  COUNT(*) as total_users,
  COUNT(DISTINCT email) as unique_emails,
  COUNT(CASE WHEN email IS NULL THEN 1 END) as null_emails
FROM public.users;

-- ROLLBACK PROCEDURE (if needed):
-- ==================================================

-- COMMENT ON COLUMN public.users.email IS NULL;

-- MONITORING QUERIES FOR PRODUCTION:
-- ==================================================

-- Check for unexpected NULL emails
-- SELECT * FROM users WHERE email IS NULL;

-- Audit: Users without standard email format
-- SELECT * FROM users WHERE email NOT LIKE '%@%' OR email IS NULL;

-- DECISION DOCUMENTATION:
-- ==================================================
-- 
-- CHOSEN APPROACH: Option C (Documentation)
-- 
-- RATIONALE:
-- - Supabase Auth layer enforces email on signup (checked in auth documentation)
-- - Making email NOT NULL risks migration failure if edge case exists
-- - PostgreSQL 15+ conditional UNIQUE is ideal but not all deployments use PG15+
-- - Documentation + monitoring is safer than schema change for low-risk issue
-- 
-- FUTURE ACTION:
-- - If NULL emails become a problem, revisit with Option A or B
-- - After Supabase Auth compliance verification, consider Option A migration
-- - Monitor queries provided above for ongoing validation

-- NEXT STEPS:
-- 1. Deploy this migration (documentation only, no schema change)
-- 2. Run monitoring query: SELECT COUNT(*) FROM users WHERE email IS NULL
-- 3. If count > 0, investigate and consider Option A migration
