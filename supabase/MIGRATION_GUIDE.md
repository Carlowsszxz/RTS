# Database Migration Execution Guide

**Critical Fixes for Issue #1-4 (Phase 1)**

Execute these migrations in order to fix the 4 critical/high priority issues identified in DATABASE_SCHEMA_ISSUES.md.

---

## Migration Order & Execution

### ✅ Migration 001: Add Device-ID Index (5 minutes)
**File**: `001_add_device_id_index_to_session_logs.sql`
**Issue**: #1 - Missing Index for Device-based Queries (CRITICAL - Performance)
**Impact**: Low risk - read-only index addition
**Rollback**: `DROP INDEX IF EXISTS session_logs_device_id_time_in_idx;`

```sql
-- Execute in Supabase SQL Editor
CREATE INDEX IF NOT EXISTS session_logs_device_id_time_in_idx 
  ON public.session_logs USING BTREE (device_id, time_in DESC);
```

**Verify**:
```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'session_logs' AND indexname = 'session_logs_device_id_time_in_idx';
```

---

### ✅ Migration 002: Add NOT NULL Constraint to device_id (10 minutes)
**File**: `002_add_not_null_constraint_to_device_id.sql`
**Issue**: #2 - Nullable device_id with Dependent Trigger Logic (CRITICAL - Data Integrity)
**Impact**: Medium risk - modifies table structure
**Rollback**: `ALTER TABLE public.session_logs ALTER COLUMN device_id DROP NOT NULL;`

**Pre-Flight Check** (must pass before proceeding):
```sql
-- Find orphaned sessions that would block this migration
SELECT COUNT(*) as orphaned_sessions 
FROM session_logs 
WHERE device_id IS NULL;

-- Result should be 0. If > 0, delete them first:
-- DELETE FROM session_logs WHERE device_id IS NULL;
```

**Execute**:
```sql
ALTER TABLE public.session_logs
  ALTER COLUMN device_id SET NOT NULL;
```

**Verify**:
```sql
\d public.session_logs
-- Look for: device_id | uuid | not null
```

---

### ✅ Migration 003: Document Cascade Delete Asymmetry (1 minute)
**File**: `003_document_cascade_delete_asymmetry.sql`
**Issue**: #3 - Cascade Delete Asymmetry (CRITICAL - Data Safety)
**Impact**: Low risk - metadata/comments only
**Rollback**: None needed (comments only)

**Execute**:
```sql
COMMENT ON CONSTRAINT session_logs_device_id_fkey ON public.session_logs IS
  'CASCADE DELETE: When device is deleted, all related sessions are deleted. This is intentional.';

COMMENT ON CONSTRAINT session_logs_user_id_fkey ON public.session_logs IS
  'SET NULL on DELETE: When user is deleted, user_id is set to NULL but session remains (preserved history). Sessions remain joined to device if device still exists.';
```

**Ongoing Monitoring** (run monthly):
```sql
-- Check for orphaned sessions
SELECT COUNT(*) as orphaned_sessions
FROM session_logs
WHERE user_id IS NULL AND device_id IS NOT NULL;

-- Result should be 0 under normal operation
-- If > 0, investigate which users were deleted
```

---

### ✅ Migration 004: Auto-Create user_settings on Signup (5 minutes)
**File**: `004_auto_create_user_settings_on_signup.sql`
**Issue**: #4 - No Auto-Creation of user_settings on Signup (HIGH)
**Impact**: Low risk - new trigger, idempotent
**Rollback**: `DROP TRIGGER IF EXISTS trg_create_user_settings ON public.users;`

**Execute**:
```sql
CREATE OR REPLACE FUNCTION public.create_user_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_settings (user_id, notifications_enabled, dark_mode, auto_lights, auto_pc, auto_fan)
  VALUES (NEW.id, true, false, true, true, true)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_create_user_settings ON public.users;

CREATE TRIGGER trg_create_user_settings
AFTER INSERT ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.create_user_settings();

-- Backfill existing users
INSERT INTO public.user_settings (user_id, notifications_enabled, dark_mode, auto_lights, auto_pc, auto_fan)
SELECT 
  u.id, 
  true, 
  false, 
  true, 
  true, 
  true
FROM public.users u
LEFT JOIN public.user_settings us ON u.id = us.user_id
WHERE us.user_id IS NULL;
```

**Verify**:
```sql
SELECT COUNT(*) as users_total, 
       COUNT(DISTINCT us.user_id) as users_with_settings
FROM public.users u
LEFT JOIN public.user_settings us ON u.id = us.user_id;

-- Should show identical counts (all users have settings)
```

---

## Testing After All Migrations

### Performance Test
```sql
-- Test new index on device_id queries
EXPLAIN ANALYZE
SELECT * FROM session_logs 
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000' 
  AND device_id = '550e8400-e29b-41d4-a716-446655440001' 
ORDER BY time_in DESC
LIMIT 10;

-- Should show: "Index Scan using session_logs_device_id_time_in_idx"
-- NOT: "Seq Scan on session_logs"
```

### Data Integrity Test
```sql
-- Verify no orphaned sessions (null device_id)
SELECT COUNT(*) FROM session_logs WHERE device_id IS NULL;
-- Result: 0

-- Verify all users have settings
SELECT COUNT(*) FROM users u WHERE NOT EXISTS (SELECT 1 FROM user_settings us WHERE us.user_id = u.id);
-- Result: 0

-- Verify foreign key constraints still work
-- Try inserting invalid device_id (should fail)
INSERT INTO session_logs (device_id, user_id, time_in, devices)
VALUES ('00000000-0000-0000-0000-000000000000', NULL, NOW(), '{}');
-- Should error: "insert or update on table "session_logs" violates foreign key constraint"
```

---

## Timeline & Approvals

| Migration | Severity | Est. Duration | Status | Applied |
|-----------|----------|----------------|--------|---------|
| 001 - Index | CRITICAL | 5 min | Ready | ⏳ |
| 002 - NOT NULL | CRITICAL | 10 min | Blocked by pre-flight | ⏳ |
| 003 - Cascade docs | CRITICAL | 1 min | Ready | ⏳ |
| 004 - Auto-create | HIGH | 5 min | Ready | ⏳ |
| **Total Phase 1** | | **21 minutes** | | |

---

## Execution Steps (Copy-Paste Ready)

### Step 1: Execute in Supabase SQL Editor
1. Go to **Supabase Dashboard** → Your Project → **SQL Editor**
2. Click **+ New Query**
3. Copy content from `001_add_device_id_index_to_session_logs.sql`
4. Click **Run**
5. Verify success (no errors)

### Step 2: Repeat for migrations 002-004
Execute each migration file in order, verifying success before proceeding.

### Step 3: Run All Tests
Copy verification queries from testing section and run them.

### Step 4: Document Applied Changes
Once all pass, update this file marking migrations as "Applied: [Date]"

---

## Rollback Plan (If Issues Occur)

If any migration causes problems, rollback in reverse order:

```sql
-- Rollback 004
DROP TRIGGER IF EXISTS trg_create_user_settings ON public.users;

-- Rollback 003 (optional - just comments, no operational impact)

-- Rollback 002
ALTER TABLE public.session_logs ALTER COLUMN device_id DROP NOT NULL;

-- Rollback 001
DROP INDEX IF EXISTS session_logs_device_id_time_in_idx;
```

---

# Phase 2 Migrations (Issues #5-6)

**Query Optimization & Timing Alignment**

Execute these migrations after Phase 1 is complete and validated. These are "Medium" priority and improve query performance and timing accuracy.

---

## Migration Order & Execution

### ✅ Migration 005: Add user_id to presence_acks (15 minutes)
**File**: `005_add_user_id_to_presence_acks.sql`
**Issue**: #5 - presence_acks Not Linked to user_id (MEDIUM - Query Design)
**Impact**: Low risk - adds new column with backfill
**Rollback**: Drop column and index

**Pre-Flight Check**:
```sql
-- Verify all devices have valid owners for backfill
SELECT COUNT(*) as devices_with_owner FROM public.devices WHERE owner_id IS NOT NULL;
SELECT COUNT(*) as devices_without_owner FROM public.devices WHERE owner_id IS NULL;
```

**Execute**:
```sql
-- Add column
ALTER TABLE public.presence_acks
ADD COLUMN user_id uuid null;

-- Add foreign key
ALTER TABLE public.presence_acks
ADD CONSTRAINT presence_acks_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE SET NULL;

-- Backfill from devices
UPDATE public.presence_acks pa
SET user_id = d.owner_id
FROM public.devices d
WHERE pa.device_id = d.id AND d.owner_id IS NOT NULL;

-- Add index
CREATE INDEX IF NOT EXISTS presence_acks_user_id_ack_at_idx 
  ON public.presence_acks USING BTREE (user_id, ack_at DESC);
```

**Verify**:
```sql
SELECT 
  COUNT(*) as total_acks,
  COUNT(CASE WHEN user_id IS NOT NULL THEN 1 END) as acks_with_user
FROM public.presence_acks;

-- Should show most acks have user_id set
```

---

### ✅ Migration 006: Increase Cron Timeout to 16 Minutes (2 minutes)
**File**: `006_increase_cron_timeout_to_16_minutes.sql`
**Issue**: #6 - Cron Job Timeout Conflicts with Arduino Timeout (MEDIUM - Timing)
**Impact**: Very low risk - timing parameter only
**Rollback**: `SELECT cron.schedule('close-stale-sessions', '* * * * *', 'select public.close_stale_sessions(10);');`

**Context**:
- Arduino timeout: 10min idle + 5min prompt = 15min total
- Old cron: 10min (closes BEFORE Arduino prompt arrives)
- New cron: 16min (allows full Arduino timeout cycle)

**Execute**:
```sql
SELECT cron.unschedule('close-stale-sessions');

SELECT cron.schedule(
  'close-stale-sessions',
  '* * * * *',
  'select public.close_stale_sessions(16);'
);
```

**Verify**:
```sql
SELECT command FROM cron.job WHERE jobname = 'close-stale-sessions';
-- Should show: select public.close_stale_sessions(16);

-- Verify timing (sessions won't close until 16 min of inactivity)
SELECT COUNT(*) as would_be_closed
FROM public.session_logs
WHERE time_out IS NULL
  AND EXTRACT(EPOCH FROM (NOW() - time_in)) > 960;  -- 16 min in seconds
```

---

## Phase 2 Testing

Run these tests after both migrations:

```sql
-- Test 1: Verify presence_acks queries are now efficient
EXPLAIN ANALYZE
SELECT * FROM public.presence_acks 
WHERE user_id = 'test-id'::uuid
ORDER BY ack_at DESC;
-- Should use presence_acks_user_id_ack_at_idx index

-- Test 2: Verify cron job is scheduled correctly
SELECT jobname, command FROM cron.job WHERE jobname = 'close-stale-sessions';

-- Test 3: Monitor timing (no sessions should close at 10-15 min anymore)
SELECT 
  COUNT(*) as total_sessions,
  COUNT(CASE WHEN time_out IS NOT NULL THEN 1 END) as closed_sessions,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (time_out - time_in)))::INT as median_session_duration_sec
FROM public.session_logs
WHERE time_out IS NOT NULL;
```

---

## Next Steps

After Phase 1 is complete:
- ✅ Commit these migration files to git
- ✅ Document in upgrade guide
- ✅ Execute Phase 2 migrations (issues #5-6)
- ⏳ Schedule Phase 3-4 (issues #7-10) for future releases
- ⏳ Plan multi-device testing with new indexes

---

# Phase 3 Migrations (Issue #3)

**Data Safety & Orphan Session Monitoring**

Execute this migration after Phase 1 and 2 are complete. This addresses the critical cascade delete asymmetry by adding monitoring and audit infrastructure.

---

## Migration Order & Execution

### ✅ Migration 007: Cascade Delete Asymmetry Monitoring (20 minutes)
**File**: `007_cascade_delete_asymmetry_monitoring.sql`
**Issue**: #3 - Cascade Delete Asymmetry - Sessions Orphaned on User Delete (CRITICAL - Data Safety)
**Approach**: Option C (monitoring) - Keeps current FK behavior but detects orphaned sessions
**Impact**: Medium - Adds audit table and trigger, no schema changes to session_logs
**Rollback**: Simple - drop trigger, function, table

**Context**:
- Device delete: Cascades delete ALL related sessions ✓
- User delete: Sets session.user_id to NULL (orphaned sessions)
- Problem: If device reassigned to new user, old sessions become visible
- Solution: Monitor with audit table, allow manual remediation

**Pre-Flight Check**:
```sql
-- Find existing orphaned sessions (should be zero)
SELECT COUNT(*) as orphaned_sessions
FROM public.session_logs
WHERE user_id IS NULL AND device_id IS NOT NULL;
```

**Execute Key Steps**:
```sql
-- Create audit table for tracking orphaned sessions
CREATE TABLE IF NOT EXISTS public.orphaned_session_audit (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  user_id uuid,
  device_id uuid,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  reason text,
  resolution_status text DEFAULT 'pending',
  PRIMARY KEY (id)
);

-- Create trigger to detect when sessions become orphaned
CREATE OR REPLACE FUNCTION public.detect_orphaned_session()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id IS NULL AND NEW.device_id IS NOT NULL AND OLD.user_id IS NOT NULL THEN
    INSERT INTO public.orphaned_session_audit 
    (session_id, user_id, device_id, reason)
    VALUES (NEW.id, NEW.user_id, NEW.device_id, 'User deletion');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_detect_orphaned_session
AFTER UPDATE ON public.session_logs
FOR EACH ROW
EXECUTE FUNCTION public.detect_orphaned_session();

-- Add index for monitoring
CREATE INDEX IF NOT EXISTS orphaned_session_audit_status_idx 
  ON public.orphaned_session_audit (resolution_status, detected_at DESC);
```

**Verify**:
```sql
-- Verify audit table and trigger
SELECT * FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name = 'orphaned_session_audit';

SELECT trigger_name FROM information_schema.triggers
WHERE trigger_name = 'trg_detect_orphaned_session';

-- Check for current orphaned sessions
SELECT COUNT(*) FROM public.session_logs
WHERE user_id IS NULL AND device_id IS NOT NULL;
```

**Important Notes**:
- This implements Option C (monitoring) from the audit report
- Foreign key constraint remains `ON DELETE SET NULL` (no change to existing behavior)
- New audit table logs when orphaning occurs
- Can switch to Option A (cascade) or Option B (restrict) later if needed
- See migration file for commented SQL for alternative approaches

---

## Phase 3 Testing

Run these tests after migration 007:

```sql
-- Test 1: Verify audit infrastructure
SELECT COUNT(*) FROM orphaned_session_audit;

-- Test 2: Monitor detection capability
SELECT 
  COUNT(*) as total_audited,
  COUNT(CASE WHEN resolution_status = 'pending' THEN 1 END) as pending
FROM public.orphaned_session_audit;

-- Test 3: Verify cascade delete still works for devices
-- (Device deletion should still cascade to sessions)
```

---

## Alternative Options for Issue #3

If monitoring approach isn't sufficient:

**Option A: Cascade Delete (Destructive)**
```sql
ALTER TABLE public.session_logs 
  DROP CONSTRAINT session_logs_user_id_fkey,
  ADD CONSTRAINT session_logs_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;
```

**Option B: Prevent Deletion (Restrictive)**
```sql
ALTER TABLE public.session_logs 
  DROP CONSTRAINT session_logs_user_id_fkey,
  ADD CONSTRAINT session_logs_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE RESTRICT;
```

---

## Migration Plan Summary

| Phase | Issues | Status | Effort | Release |
|-------|--------|--------|--------|---------|
| Phase 1 | #1-4 | ✅ Completed | ~30 min | This week |
| Phase 2 | #5-6 | ✅ Completed | ~17 min | Next week |
| Phase 3 | #3 (monitoring) | ✅ Completed | ~20 min | This week+ |
| Phase 4 | #7-10 (optional) | ✅ Completed | ~20 min | Later |

---

# Phase 4 Migrations (Issues #7-10)

**Optional Improvements & Data Quality**

Execute these migrations after Phase 1-3 are complete. These are "LOW" priority observations that provide incremental improvements. Each is independent and can be selectively deployed.

---

## Migration Order & Execution

### ⏸️ Migration 008: Email Constraint Hardening (5 minutes) - OPTIONAL
**File**: `008_email_constraint_hardening_optional.sql`
**Issue**: #7 - Email Nullable with UNIQUE Constraint (LOW - Data Model)
**Impact**: Very low - documentation only
**Approach**: Option C (monitoring + documentation)

**Context**:
- Current: Email nullable with UNIQUE constraint allows multiple NULLs
- Risk: Low - Supabase Auth likely prevents NULL in practice
- Solution: Add documentation, monitor via queries

**Execute** (Documentation Only):
```sql
COMMENT ON COLUMN public.users.email IS 
  'User email address. Nullable for service accounts / test users.
   Supabase Auth enforces non-null on signup in practice.
   Schema allows multiple NULLs (PostgreSQL UNIQUE quirk).
   Monitor: SELECT COUNT(*) FROM users WHERE email IS NULL';
```

**Verification**:
```sql
-- Check for unexpected NULL emails
SELECT COUNT(*) FROM users WHERE email IS NULL;

-- Monitor email uniqueness
SELECT email, COUNT(*) as count FROM users 
WHERE email IS NOT NULL
GROUP BY email HAVING COUNT(*) > 1;
```

**Note**: If NULL emails become a problem, upgrade to Option A (add NOT NULL constraint) in future migration.

---

### ⏸️ Migration 009: Improve Claim Code Entropy (2 minutes) - OPTIONAL
**File**: `009_improve_claim_code_entropy_optional.sql`
**Issue**: #8 - Claim Code Collision Risk (LOW - Cryptographic)
**Impact**: Low - improves collision resistance
**Approach**: Increase gen_random_bytes from 4 to 6 bytes

**Context**:
- Current entropy: 4 bytes = 2^32 = ~4.3 billion possibilities
- Collision risk: 50% at ~65k devices (current: <1000 devices)
- Improvement: 6 bytes = 2^48 = ~281 trillion possibilities
- New risk: 50% at ~16.8 million devices (negligible)

**Execute**:
```sql
CREATE OR REPLACE FUNCTION public.set_claim_code_if_missing()
RETURNS TRIGGER AS $$
BEGIN
  IF new.claim_code IS NULL OR LENGTH(TRIM(new.claim_code)) = 0 THEN
    new.claim_code := UPPER(ENCODE(gen_random_bytes(6), 'hex'));  -- 6 bytes = 12 hex chars
  END IF;
  RETURN new;
END;
$$ LANGUAGE plpgsql;

UPDATE public.devices
SET claim_code = UPPER(ENCODE(gen_random_bytes(6), 'hex'))
WHERE claim_code IS NULL OR LENGTH(TRIM(claim_code)) = 0;
```

**Verification**:
```sql
-- Check claim code length distribution
SELECT LENGTH(claim_code) as length, COUNT(*) as count
FROM public.devices
WHERE claim_code IS NOT NULL
GROUP BY LENGTH(claim_code);

-- Should show 12-character codes (6 bytes = 12 hex chars)
```

**Note**: Provides future-proofing with zero performance impact. No risk of collision for foreseeable deployment scale.

---

### ⏸️ Migration 010: Sensor Events Retention Tuning (5 minutes) - OPTIONAL
**File**: `010_sensor_events_retention_tuning_optional.sql`
**Issue**: #9 - Sensor Events Auto-Trim (LOW - Data Retention)
**Impact**: Low resource usage increase (~10x per device)
**Approach**: Increase event limit from 100 to 1000 events

**Context**:
- Current window: 100 events × 10s interval = 16 minutes
- New window: 1000 events × 10s interval = 2.8 hours
- Benefit: "What happened today?" analytics queries now possible
- Storage: ~450KB additional per 1000 devices (negligible)

**Execute**:
```sql
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
```

**Verification**:
```sql
-- Check distribution (should be under 1000 per device)
SELECT 
  device_id,
  COUNT(*) as event_count,
  EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60 as window_minutes
FROM public.sensor_events
GROUP BY device_id
ORDER BY event_count DESC;

-- Should show events evenly distributed under 1000
```

**Note**: Optional based on analytics requirements. Can adjust threshold later if needed. Use session_logs as primary history source.

---

### 📖 Documentation 011: Claiming Flow Context (Non-Migration)
**File**: `011_claiming_flow_documentation_nonmigration.sql`
**Issue**: #10 - Claiming Flow User Context Gap (LOW - Workflow)
**Type**: Documentation only (no SQL execution)
**Impact**: Zero - clarifies design decision

**Context**:
- NOT a bug - this is expected architectural behavior
- When device is claimed, pre-claim sessions inherit new owner's context
- Factory can verify devices worked before shipping
- Users see complete activity history including pre-claim

**No SQL execution needed**, but read the documentation file for:
- Product owner explanation
- Frontend developer guidance
- Arduino developer notes
- Database administrator queries
- Monitoring recommendations

**Recommendation**: Add UI indicator for pre-claim sessions (tooltip or badge)

---

## Phase 4 Testing

Run these tests if deploying any Phase 4 migrations:

```sql
-- Test 1: Email constraint (Migration 008)
SELECT COUNT(*) FROM users WHERE email IS NULL;

-- Test 2: Claim code entropy (Migration 009)
SELECT 
  LENGTH(claim_code) as length,
  COUNT(*) as count
FROM public.devices
WHERE claim_code IS NOT NULL
GROUP BY LENGTH(claim_code);

-- Test 3: Sensor events retention (Migration 010)
SELECT 
  COUNT(*) as total_events,
  COUNT(DISTINCT device_id) as devices,
  MAX(COUNT(*)) FILTER (PARTITION BY device_id) as max_per_device
FROM public.sensor_events;

-- Test 4: Pre-claim sessions (Documentation 011)
SELECT COUNT(*) as orphaned_sessions
FROM session_logs
WHERE user_id IS NULL AND device_id IS NOT NULL;
```

---

## Phase 4 Deployment Strategy

**Recommendation**: Deploy Phase 4 selectively after Phase 1-3 validation

**Suggested Deployment Order**:
1. **First**: Migration 009 (claim code entropy) - zero risk, improves security posture
2. **Second**: Migration 010 (sensor retention) - optional but improves analytics
3. **Third**: Migration 008 (email constraint) - low priority, documentation only
4. **Always**: Read Documentation 011 and add UI tooltips

**Optional Deployments**:
- Skip Migration 008 if Supabase Auth compliance is verified
- Skip Migration 010 if 16-minute sensor history sufficient
- Documentation 011 is always recommended reading

---

## Migration Completion Summary

✅ **Phase 1**: Critical database foundations (issues #1-4) - 30 min
✅ **Phase 2**: Query optimization & timing (issues #5-6) - 17 min
✅ **Phase 3**: Data safety monitoring (issue #3) - 20 min
✅ **Phase 4**: Optional improvements (issues #7-10) - 20 min

**Total Time**: ~87 minutes to fix all 10 database issues

**Critical Path** (recommended minimum):
- Phase 1 (MUST): 30 min - Enables multi-device support
- Phase 2 (SHOULD): 17 min - Aligns timing, optimizes queries
- Phase 3 (SHOULD): 20 min - Adds orphan monitoring
- Phase 4 (MAY): 20 min - Incremental improvements

---

## Next Steps

After all phases are planned:
1. ✅ Review all 11 migration files
2. ✅ Decide which Phase 4 migrations to deploy
3. ✅ Execute Phase 1 migrations in production
4. ✅ Execute Phase 2 migrations after Phase 1 validates
5. ✅ Execute Phase 3 migrations after Phase 2 validates
6. ✅ Plan Phase 4 deployment schedule
7. ⏳ Deploy multi-device testing after Phase 1-3 complete
8. ⏳ Performance testing with new indexes (Phase 1-2)
9. ⏳ Orphan monitoring dashboard (Phase 3)
10. ⏳ Claim code + sensor event monitoring (Phase 4)
