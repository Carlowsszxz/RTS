# Database Schema Audit & Inconsistencies Report

**Date**: May 7, 2026  
**Status**: ⚠️ **10 ISSUES FOUND** | 3 Critical | 3 Medium | 4 Observations

---

## Executive Summary

Comprehensive audit of the Supabase PostgreSQL schema revealed **10 distinct issues** ranging from missing indexes to cascade delete asymmetries. These issues affect performance, data consistency, and multi-device support scalability.

**Severity**: Medium → Can run now, but schema needs hardening before production multi-device deployment.

---

## Critical Issues (Action Required)

### 🔴 ISSUE #1: Missing Index for Device-based Queries (CRITICAL - Performance)

**Location**: `supabase/schema.sql` - `session_logs` table

**Current State**:
```sql
create index if not exists session_logs_user_id_time_in_idx
  on public.session_logs using btree (user_id, time_in desc);
```

**Problem**:
- Index only on `(user_id, time_in DESC)`
- Website code (Bug #3 fix) now queries by `device_id`
- **No index on device_id** → Full table scan for every device-filtered query
- Impact scales with session log volume (1000s of logs = slow queries)

**Database Query Example** (Slow):
```sql
SELECT * FROM session_logs 
WHERE user_id = $1 AND device_id = $2  -- device_id has NO index
ORDER BY time_in DESC;
```

**Impact**:
- Dashboard/LogsPage slow for users with multi-device setups
- Supabase query planner uses sequential scan instead of index seek
- Becomes noticeable with >10k session logs per user-device pair

**Fix**: Add composite index
```sql
CREATE INDEX IF NOT EXISTS session_logs_device_id_time_in_idx 
  ON public.session_logs USING BTREE (device_id, time_in DESC);
```

**Priority**: 🔴 CRITICAL

---

### 🔴 ISSUE #2: Nullable device_id with Dependent Trigger Logic (CRITICAL - Data Integrity)

**Location**: `supabase/schema.sql` - `session_logs` table and `set_session_logs_user_id` trigger

**Current State**:
```sql
create table if not exists public.session_logs (
  id uuid not null default gen_random_uuid(),
  device_id uuid null,  -- NULLABLE
  user_id uuid null,
  ...
)

create or replace function public.set_session_logs_user_id()
returns trigger
language plpgsql
as $$
begin
  if new.user_id is null and new.device_id is not null then  -- Only works if device_id is NOT NULL
    select owner_id into new.user_id
    from public.devices
    where id = new.device_id
    limit 1;
  end if;
  return new;
end;
$$;
```

**Problem**:
- `device_id` is nullable but Arduino always POSTs with it
- Trigger auto-fills `user_id` from `device.owner_id` **only if device_id is NOT NULL**
- If somehow a session is inserted with NULL device_id:
  - Trigger doesn't execute user_id fill logic
  - Results in orphaned session: `(device_id=NULL, user_id=NULL)`
  - Can't be joined to any user or device

**Risk Scenarios**:
1. Manual INSERT into session_logs with NULL device_id
2. Claiming flow: device inserted without owner, session created, device claimed later
3. Bug in Arduino code that POSTs session without device_id

**Impact**:
- Orphaned sessions impossible to reconcile
- Query filters by device_id will miss these sessions
- User has sessions they can't see

**Fix**:
```sql
-- Option A: Make device_id NOT NULL (preferred)
ALTER TABLE public.session_logs
  ALTER COLUMN device_id SET NOT NULL;

-- Option B: Add constraint to prevent orphans
ALTER TABLE public.session_logs
  ADD CONSTRAINT session_logs_device_user_consistency 
  CHECK (device_id IS NOT NULL OR user_id IS NOT NULL);
```

**Priority**: 🔴 CRITICAL

---

### 🔴 ISSUE #3: Cascade Delete Asymmetry - Sessions Orphaned on User Delete (CRITICAL - Data Safety)

**Location**: `supabase/schema.sql` - foreign key constraints

**Current State**:
```sql
constraint session_logs_device_id_fkey 
  foreign key (device_id) references public.devices (id) on delete cascade,

constraint session_logs_user_id_fkey 
  foreign key (user_id) references public.users (id) on delete set null  -- Sets NULL, doesn't delete
```

**Problem**:
- **Device deleted**: Cascades delete ALL related sessions ✓
- **User deleted**: Sessions remain with `user_id=NULL`, but `device_id` still points to valid device
- Results in sessions "orphaned" with no owner but still tied to device
- If device is later reassigned to new user, they inherit old orphaned sessions

**Risk Scenario**:
1. User A creates sessions with Device X
2. User A deleted
3. Session remains with `(user_id=NULL, device_id=X)` (orphaned)
4. User B claims Device X
5. User B now owns Device X, but Query `WHERE user_id = B AND device_id = X` returns 0 results
6. Old sessions are invisible to User B but queryable by admin as orphans

**Impact**:
- Data inconsistency: Sessions exist but aren't associated with any user
- Confusing for multi-tenant deployments (if adding multi-user devices)
- Admin reports show orphaned sessions that shouldn't exist

**Fix - Choose One**:
```sql
-- Option A: Cascade delete sessions when user deleted (loss of history)
ALTER TABLE public.session_logs 
  DROP CONSTRAINT session_logs_user_id_fkey,
  ADD CONSTRAINT session_logs_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE CASCADE;

-- Option B: Prevent user deletion if sessions exist (safer)
ALTER TABLE public.session_logs 
  DROP CONSTRAINT session_logs_user_id_fkey,
  ADD CONSTRAINT session_logs_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE RESTRICT;

-- Option C: Keep as-is but add audit trigger to warn on orphaned sessions
-- (Document this as known limitation)
```

**Current Behavior**: `ON DELETE SET NULL` (Option C + documentation)

**Priority**: 🔴 CRITICAL

---

## Medium Issues (Plan To Fix)

### 🟠 ISSUE #4: No Auto-Creation of user_settings on Signup (HIGH)

**Location**: Website signup handler (not in schema, but related)

**Problem**:
- `user_settings` table has no INSERT trigger to auto-create rows
- When user signs up, no row is created in `user_settings`
- If website lazy-loads settings and query returns no rows, it crashes
- Must explicitly INSERT on signup or handle NULL gracefully

**Current Code Risk**:
```typescript
// If row doesn't exist, this returns undefined
const settings = await supabase
  .from('user_settings')
  .select('*')
  .eq('user_id', userId)
  .single(); // Throws error if 0 rows
```

**Fix**:
```sql
-- Add trigger to auto-create row on user insert
CREATE OR REPLACE FUNCTION public.create_user_settings()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_create_user_settings
AFTER INSERT ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.create_user_settings();
```

**Website Check**:
- Verify signup handler creates `user_settings` row
- Or handle `.single()` with `.maybeSingle()` + fallback defaults

**Priority**: 🟠 HIGH

---

### 🟠 ISSUE #5: presence_acks Not Linked to user_id (MEDIUM - Query Design)

**Location**: `supabase/schema.sql` - `presence_acks` table

**Current State**:
```sql
create table if not exists public.presence_acks (
  id uuid not null default gen_random_uuid(),
  device_id uuid not null,
  ack_at timestamp with time zone not null default now(),
  constraint presence_acks_pkey primary key (id),
  constraint presence_acks_device_id_fkey foreign key (device_id) references public.devices (id) on delete cascade
) tablespace pg_default;
```

**Problem**:
- No direct link to `user_id`
- To find "all acks for User X", must join: `presence_acks → devices → devices.owner_id`
- Could query directly if `presence_acks` had `user_id` column
- During claiming flow (device has no owner), acks created with no user context

**Query Examples**:

Current (Slow/Convoluted):
```sql
SELECT pa.* FROM presence_acks pa
JOIN devices d ON pa.device_id = d.id
WHERE d.owner_id = $1;  -- Extra join
```

Better (Direct):
```sql
SELECT * FROM presence_acks WHERE user_id = $1;
```

**Impact**:
- Low (~3ms slower per query), but architectural smell
- Claiming flow: Acks created before device owner assigned
- Cannot easily find all unprocessed acks for a user

**Fix**:
```sql
-- Add user_id column
ALTER TABLE public.presence_acks
ADD COLUMN user_id uuid null;

-- Add foreign key
ALTER TABLE public.presence_acks
ADD CONSTRAINT presence_acks_user_id_fkey 
  FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE SET NULL;

-- Backfill existing acks
UPDATE public.presence_acks pa
SET user_id = d.owner_id
FROM public.devices d
WHERE pa.device_id = d.id AND d.owner_id IS NOT NULL;

-- Add index
CREATE INDEX presence_acks_user_id_ack_at_idx 
  ON public.presence_acks USING BTREE (user_id, ack_at DESC);
```

**Priority**: 🟠 MEDIUM

---

### 🟠 ISSUE #6: Cron Job Timeout Conflicts with Arduino Timeout (MEDIUM - Timing)

**Location**: `supabase/schema.sql` - scheduled job `close-stale-sessions`

**Current State**:
```sql
perform cron.schedule(
  'close-stale-sessions',
  '* * * * *',  -- Every minute
  'select public.close_stale_sessions(10);'  -- Close sessionsinactive >10 minutes
);
```

**Arduino Spec** (from websiteprocess.md):
- Idle detection: 10 minutes
- Prompt timeout: 5 minutes
- **Total timeout**: 15 minutes before Arduino forces SSR OFF

**Conflict**:
- Postgres cron closes sessions at 10 minutes (after idle detection)
- Arduino closes at 15 minutes (10min idle + 5min prompt timeout)
- Sessions close in Postgres BEFORE Arduino sends `still_there_prompt`
- Website shows session already closed, but Arduino still sending prompts

**Race Condition Timeline**:
```
T=0min    Session starts (motion detected)
T=10min   Postgres cron closes session (time_out set)
T=10min   Arduino detects idle, sends still_there_prompt
T=10min+  Website receives prompt, but session shows closed already
T=15min   Arduino times out (no ACK), forces SSR OFF
```

**Impact**:
- Presence prompts arrive for already-closed sessions
- UI confusion: session shows ended, but prompt appears
- Async state: Postgres and Arduino disagree on session lifetime

**Fix**:
```sql
-- Option A: Increase cron timeout to match Arduino (15+ minutes)
perform cron.schedule(
  'close-stale-sessions',
  '* * * * *',
  'select public.close_stale_sessions(16);'  -- >15 min to avoid conflicts
);

-- Option B: Disable cron, rely on Arduino timeout (NOT recommended)
-- Arduino could crash/disconnect, sessions stuck open forever

-- Option C: Keep at 10 but update websiteprocess.md to document this
-- (Acknowledge sessions close via cron, not Arduino prompt)
```

**Recommended**: Use Option A (increase to 16 minutes)

**Priority**: 🟠 MEDIUM (impacts timeout state machine accuracy)

---

## Observations & Warnings (Monitor)

### 🟡 ISSUE #7: Email Nullable with UNIQUE Constraint (MEDIUM - Data Model)

**Location**: `supabase/schema.sql` - `users` table

**Current State**:
```sql
create table if not exists public.users (
  ...
  email text null,  -- Nullable
  ...
  constraint users_email_key unique (email)  -- UNIQUE includes NULL
) tablespace pg_default;
```

**PostgreSQL Quirk**:
- UNIQUE constraint allows multiple NULL values
- Two users can both have `email = NULL`
- Violates data integrity expectation (each user should have unique email)

**Risk Scenario**:
```sql
INSERT INTO users (email) VALUES (NULL);  -- OK
INSERT INTO users (email) VALUES (NULL);  -- OK - violates expectation!
```

**Assumption**: Auth system (Supabase Auth) probably requires email on signup, so NULL users shouldn't exist in practice.

**Fix** (Optional):
```sql
-- Add NOT NULL constraint (if you always require email)
ALTER TABLE public.users
  ALTER COLUMN email SET NOT NULL;

-- OR: Add unique constraint only on non-null emails
ALTER TABLE public.users
  DROP CONSTRAINT users_email_key;
ALTER TABLE public.users
  ADD CONSTRAINT users_email_key_notnull UNIQUE (email)
  WHERE email IS NOT NULL;  -- PostgreSQL 15+ feature
```

**Priority**: 🟡 LOW (auth layer likely prevents this issue)

---

### 🟡 ISSUE #8: Claim Code Collision Risk (LOW - Cryptographic)

**Location**: `supabase/schema.sql` - `set_claim_code_if_missing()` trigger

**Current State**:
```sql
create or replace function public.set_claim_code_if_missing()
returns trigger
language plpgsql
as $$
begin
  if new.claim_code is null or length(trim(new.claim_code)) = 0 then
    new.claim_code := upper(encode(gen_random_bytes(4), 'hex'));  -- 4 bytes = 32 bits
  end if;
  return new;
end;
$$;
```

**Math**:
- `gen_random_bytes(4)` = 32 bits = 2^32 possibilities = ~4.3 billion unique codes
- UNIQUE constraint enforces no duplicates, so INSERT fails on collision
- Collision probability with N codes: ~√(2^32) ≈ 65k codes needed for ~50% collision chance

**Risk Scenario**:
- Unlikely with <1000 devices, but possible with 100k+ devices
- If collision occurs, second device insert fails with UNIQUE constraint violation
- User gets error instead of code

**Impact**:
- Very low probability in practice
- If occurs: Retry mechanism handles it (UI can regenerate)
- Acceptable risk

**Improvement** (Optional):
```sql
-- Use 6 bytes instead of 4 (48-bit = 280 trillion codes)
new.claim_code := upper(encode(gen_random_bytes(6), 'hex'));
```

**Priority**: 🟡 LOW (acceptable risk, rare occurrence)

---

### 🟡 ISSUE #9: Sensor Events Auto-Trim (LOW - Data Retention)

**Location**: `supabase/schema.sql` - `trg_trim_sensor_events` trigger

**Current State**:
```sql
create or replace function public.trim_sensor_events()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from public.sensor_events where device_id = new.device_id) > 100 then
    delete from public.sensor_events
    where ctid in (
      select ctid
      from public.sensor_events
      where device_id = new.device_id
      order by "timestamp" asc
      offset 100
      limit 20  -- Deletes 20 oldest when >100
    );
  end if;
  return new;
end;
$$;
```

**Data Retention**:
- Keeps max 100 events per device
- Arduino POSTs every 10 seconds (or on change)
- **History**: ~100 events × 10s = ~1000 seconds = **~16 minutes**
- After 16 min, oldest events start deleting

**Impact**:
- Short history window (16 minutes)
- Dashboard showing "last 24 hours" activity may have gaps
- Analytics/reporting rely on logs, not sensor_events

**Acceptable?**:
- ✓ Yes, if `session_logs` is primary history source
- ⚠️ No, if you need granular sensor data for analytics

**Fix** (if needed):
```sql
-- Increase limit to 1000 events (160 minutes of history)
limit 100  -- Delete 100 oldest instead of 20
-- OR: Keep 50000 events (8+ hours at 10s interval)
-- Depends on your Supabase storage plan and data retention goals
```

**Priority**: 🟡 LOW (depends on reporting requirements)

---

### 🟡 ISSUE #10: Claiming Flow User Context Gap (LOW - Workflow)

**Location**: Device claiming flow (devices.sql, schema.sql)

**Current State**:
```sql
create or replace function public.claim_device_by_code(p_claim_code text)
returns public.devices
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  update public.devices
  set owner_id = auth.uid(),
      last_seen = now()
  where upper(public.devices.claim_code) = upper(p_claim_code)
    and public.devices.owner_id is null
  returning * into result;
  ...
end;
$$;
```

**Gap**:
- Devices can be pre-created without an owner (`owner_id = NULL`)
- Sessions/ACKs created for unclaimed devices have no user context
- When device is claimed, old sessions now belong to the new owner
- **Not a bug**, but architectural decision to document

**Example Timeline**:
```
1. Factory creates Device X, session_logs entry created (no owner_id on device, no user_id on session)
2. User Y claims Device X via claim code (owner_id set to Y)
3. Now session appears in User Y's history, but was created before they owned it
```

**Impact**:
- ✓ Expected behavior for claiming flow
- ⚠️ Sessions "inherit" user after claim
- Monitor: Ensure users understand they see pre-claim data

**Priority**: 🟡 LOW (by design, document in claiming docs)

---

## Summary Table

| Issue # | Component | Type | Severity | Status | Fix Effort |
|---------|-----------|------|----------|--------|-----------|
| 1 | session_logs index | Performance | 🔴 CRITICAL | Ready to apply | 5 min |
| 2 | device_id nullable | Data Integrity | 🔴 CRITICAL | Ready to apply | 10 min |
| 3 | Cascade delete | Data Safety | 🔴 CRITICAL | Document + Plan | 20 min |
| 4 | user_settings auto-create | Missing Logic | 🟠 HIGH | Ready to apply | 5 min |
| 5 | presence_acks user_id | Query Design | 🟠 MEDIUM | Ready to apply | 15 min |
| 6 | Cron timeout conflict | Timing | 🟠 MEDIUM | Tune timing | 2 min |
| 7 | Email nullable+unique | Data Model | 🟡 LOW | Document | 1 min |
| 8 | Claim code collision | Cryptographic | 🟡 LOW | Monitor | 2 min |
| 9 | Sensor events trim | Data Retention | 🟡 LOW | Evaluate | 5 min |
| 10 | Claiming user context | Workflow | 🟡 LOW | Document | 1 min |

---

## Recommended Fix Order

### Phase 1 (This Week - Critical)
1. ✅ Add `session_logs_device_id_time_in_idx` index
2. ✅ Add NOT NULL or CHECK constraint to `device_id`
3. ✅ Add trigger to auto-create `user_settings` on user insert

### Phase 2 (Next Week - Important)
4. ✅ Increase cron timeout to 16 minutes
5. ✅ Add `user_id` to `presence_acks` table
6. ✅ Decide on cascade delete policy (Option A, B, or C)

### Phase 3 (Before Multi-Device Launch)
7. Run audit query to find orphaned sessions (if any)
8. Document claiming flow user context behavior
9. Test email NULL handling in auth

### Phase 4 (Nice To Have)
10. Consider increasing sensor_events trim limit based on retention needs

---

## Audit Queries (For Validation)

```sql
-- Find orphaned sessions (no user, no device)
SELECT COUNT(*) FROM session_logs 
WHERE user_id IS NULL AND device_id IS NULL;

-- Find users with multiple NULL emails (shouldn't happen)
SELECT COUNT(*) FROM users WHERE email IS NULL GROUP BY email HAVING COUNT(*) > 1;

-- Find devices with NULL owner_id (claiming phase)
SELECT COUNT(*) FROM devices WHERE owner_id IS NULL;

-- Check session_logs index usage
EXPLAIN ANALYZE 
SELECT * FROM session_logs 
WHERE user_id = $1 AND device_id = $2 
ORDER BY time_in DESC;

-- Validate cron job is running
SELECT * FROM cron.job WHERE jobname = 'close-stale-sessions';

-- Find sessions closed by cron vs Arduino
SELECT COUNT(*), 
  CASE 
    WHEN EXTRACT(EPOCH FROM (time_out - time_in)) > 10*60 THEN 'Arduino timeout'
    WHEN EXTRACT(EPOCH FROM (time_out - time_in)) > 5*60 THEN 'Prompt timeout'
    ELSE 'Early close'
  END AS close_reason
FROM session_logs 
WHERE time_out IS NOT NULL
GROUP BY close_reason;
```

---

## References

- Arduino Spec: `websiteprocess.md` (Section 6, 7)
- Website Bug #3 Fix: Device-based session_logs filter
- Schema: `supabase/schema.sql` (Lines 1-359)
- Audit Report: `WEBSITE_AUDIT_REPORT.md` (Database Field Accuracy Check section)

