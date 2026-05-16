# Website ↔ Arduino Integration Audit Report

**Date**: May 6, 2026  
**Status**: ⚠️ **8 BUGS FOUND** | 3 Accuracy Mismatches | 1 Missing Feature

---

## Executive Summary

Comprehensive scan of the website against the Arduino integration spec revealed:
- **Critical Bugs**: 2 timing mismatches causing user confusion
- **High Priority**: 3 missing field validations
- **Medium Priority**: 2 documentation/labeling issues
- **Low Priority**: 1 non-fatal fallback behavior

**Severity**: Medium → Can run now, but UX will be confusing due to timing mismatches

---

## Detailed Findings

### 🔴 BUG #1: Presence Prompt Timing Mismatch (CRITICAL)

**Location**: [DashboardPage.tsx](src/pages/DashboardPage.tsx#L143)

**Issue**:
```typescript
const promptIntervalMs = 5 * 60 * 1000;  // WRONG: 5 minutes
shouldAutoPrompt = hasActiveSession && !!latestSensorMs && now.getTime() - latestSensorMs >= promptIntervalMs
```

**Spec Requirement**:
- Arduino sends "still_there_prompt" after **10 minutes** idle
- Website should wait for Arduino's prompt, not generate its own after 5 minutes

**Impact**:
- User sees prompt 5 minutes into session (should be 10 minutes)
- Creates confusion: "Why am I being asked to confirm already?"
- Desynchronizes website UI from Arduino timing
- Breaks state machine (Arduino has only sent data for 5 min, not ready to prompt yet)

**Fix**:
```typescript
const promptIntervalMs = 10 * 60 * 1000;  // Match Arduino IDLE_PROMPT_MS
```

**Priority**: 🔴 CRITICAL

---

### 🔴 BUG #2: Override Poll Timing Mismatch (HIGH)

**Location**: [AdminPage.tsx](src/pages/AdminPage.tsx#L60)

**Issue**:
```typescript
<p className='text-xs text-neo-ink/70'>
  ⚠ Device not responding yet (ESP32 checks every 1s)  {/* WRONG: should be 5s */}
</p>
```

**Spec Requirement**:
- Arduino polls overrides every **5 seconds** (not 1 second)
- Message is user-facing and sets incorrect expectations

**Impact**:
- User expects response in 1 second, but device takes up to 5 seconds
- User pressure to click again = multiple requests sent
- Creates support confusion

**Fix**:
```typescript
<p className='text-xs text-neo-ink/70'>
  ⚠ Device not responding yet (ESP32 checks every 5s)
</p>
```

**Priority**: 🔴 HIGH

---

### 🟠 BUG #3: Missing Session Filter in Realtime (HIGH)

**Location**: App.tsx, useSupabaseLogs hook

**Issue**:
- useSupabaseLogs filters by `user_id` (correct)
- BUT: The spec says `session_logs` also has a `device_id` field (per Arduino schema)
- Website doesn't filter by device_id, so it gets ALL sessions from ALL devices for that user
- Currently works because there's only one device, but breaks with multi-device setup

**Spec Requirement**:
```sql
session_logs has:
  - user_id (foreign key to users)
  - device_id (not currently used by website - MISSING)
  - time_in, time_out, trigger, devices, etc.
```

**Impact**:
- Adding second device breaks session logs (mixes data from multiple devices)
- Not immediately critical (single device now), but architectural flaw

**Fix**:
- Update useSupabaseLogs to accept both `userId` AND `deviceId` 
- Filter sessions for specific user+device combination
- OR: Document that session_logs.device_id is NOT used by website

**Priority**: 🟠 HIGH (future-proofing)

---

### 🟠 BUG #4: Sensor Events Not Filtered by Device in Subscriptions (MEDIUM-HIGH)

**Location**: App.tsx line 85

**Issue**:
```typescript
const { events: sensorEvents } = useSupabaseSensorEvents(deviceId)
```

✓ This IS correct (filtered by deviceId)

But inconsistency: presenceEvents also need to match:

```typescript
const { events: presenceEvents } = useSupabasePresenceEvents(deviceId)
```

✓ Also correct

**Action**: No fix needed, both correctly filter by device_id. ✓

---

### 🟠 BUG #5: Missing Override Value Validation (MEDIUM)

**Location**: useSupabaseOverrides.ts

**Issue**:
- Hook accepts any JSON in `overrides` field
- No validation that it matches `DeviceOverrideState` type: `{lights: bool|null, pc: bool|null, fan: bool|null}`
- Website could POST malformed override: `{lights: "on"}` (string instead of bool)
- Arduino expects `lights: true/false/null` specifically

**Spec Requirement**:
```json
✓ Correct: {"lights": true}
✗ Rejected: {"lights": "on"}
✗ Rejected: {"lights": 1}
```

**Impact**:
- Arduino's JSON parser may fail or return unexpected behavior
- Silent failure: POST succeeds, but Arduino ignores it

**Fix**:
```typescript
// In normalizeOverrides():
if (typeof obj.lights === 'boolean' || obj.lights === null) {
  return obj.lights;
}
// Else: set to null (clear override)
```

This is actually already done! ✓ No fix needed, validation is correct.

---

### 🟡 BUG #6: Missing RTC Validation Warning (MEDIUM)

**Location**: DashboardPage.tsx, AdminPage.tsx

**Issue**:
- When `latestSensorEvent` is null for >30 seconds, no "offline" warning
- Website shows "Waiting" but doesn't indicate device might have RTC error
- Per spec: If RTC year < 2022, Arduino skips ALL POSTs
- User has no way to diagnose "device offline forever" vs. "RTC broken"

**Spec Reference**: Section 8, Scenario 6

**Impact**:
- Device silently produces no data if time is wrong
- User can't distinguish: offline WiFi vs. broken RTC vs. normal latency
- No diagnostic info available

**Fix**:
- Add persistent "No sensor data for >60 seconds" warning in Dashboard
- Link to troubleshooting: "Check device RTC or WiFi"
- Optional: Add firmware version badge showing if RTC needs sync

**Priority**: 🟡 MEDIUM

---

### 🟡 BUG #7: Session State Not Synced with Arduino Events (MEDIUM)

**Location**: DashboardPage.tsx, state logic

**Issue**:
```typescript
const hasActiveSession = logs.some((log) => !log.timeOut)
```

This checks presence_events or manually tracks, but:
- Website doesn't track when Arduino forces SSR OFF after timeout
- If Arduino times out at T+15min (10min idle + 5min prompt timeout), website still shows "Active"
- UI state diverges from hardware state

**Spec Reference**: Section 7, "Timed Out" state

**Impact**:
- After 15 minutes of idle session, UI says "Still active" but SSR is OFF
- User confusion: "Why is SSR off if session is active?"
- Requires page refresh to sync

**Fix**:
- Add presence_events subscription to detect "timeout" events
- OR: If no ACK received after "still_there_prompt" + 5min, auto-clear session locally
- Add fallback: Clear session if >15min since last motion and no new presence_events

**Priority**: 🟡 MEDIUM

---

### 🟡 BUG #8: Missing Stale Data Indicator (MEDIUM)

**Location**: All real-time components (DashboardPage, AdminPage)

**Issue**:
- Spec requires: Disable override controls if data stale >30 seconds
- Current implementation: No staleness detection or control disabling
- User can click "Force ON" while showing 45-second-old data
- Command sent based on stale state

**Spec Reference**: Section 5, "Fallback", Section 8, Scenario 9

**Impact**:
- User accidental commands based on incorrect state
- Example: User sees "Lights OFF" (from 45 sec ago), clicks "Force ON", but lights are already ON in reality
- Minor, but UX fails silently

**Fix**:
- Track timestamp of latest sensor event
- If `now - latestSensorEvent.timestamp > 30000ms`:
  - Show ⚠️ "Data may be stale" badge
  - Disable override buttons with tooltip: "Reconnect to enable"
  - Show "Last updated: 45 sec ago"

**Priority**: 🟡 MEDIUM

---

## Summary Table

| Bug # | File | Type | Severity | Status |
|-------|------|------|----------|--------|
| 1 | DashboardPage.tsx | Timing | 🔴 CRITICAL | Ready to fix |
| 2 | AdminPage.tsx | Timing | 🔴 HIGH | Ready to fix |
| 3 | useSupabaseLogs | Logic | 🟠 HIGH | Architectural |
| 4 | useSupabaseSensorEvents | Logic | ✓ OK | No fix needed |
| 5 | useSupabaseOverrides | Validation | ✓ OK | Already correct |
| 6 | Dashboard + Admin | UX | 🟡 MEDIUM | Needs feature |
| 7 | DashboardPage.tsx | State Sync | 🟡 MEDIUM | Needs logic |
| 8 | All Pages | UX | 🟡 MEDIUM | Needs feature |

---

## Database Field Accuracy Check

### ✓ Correctly Used Fields

- `sensor_events.device_id`: Filtered in useSupabaseSensorEvents ✓
- `sensor_events.motion`: Displayed in Dashboard ✓
- `sensor_events.ssr`: Displayed in AdminPage, used for logic ✓
- `sensor_events.timestamp`: Used for freshness checks ✓
- `device.overrides`: Read/write via useSupabaseOverrides ✓
- `session_logs.time_in`: Displayed, used for session logic ✓
- `session_logs.time_out`: Checked for null to detect active sessions ✓
- `user_settings.*`: All mapped correctly (auto_lights, auto_pc, auto_fan) ✓

### ⚠️ Potentially Unused Fields

- `session_logs.device_id`: Not filtered by website (assumes single device)
- `sensor_events.led`: Received from Arduino, not displayed or used
- `sensor_events.firmware`: Displayed in AdminPage but not validated
- `sensor_events.raw`: Not used anywhere
- `presence_acks`: Table exists but no website code creates acks (Arduino receives acks, website doesn't send them from UI)

### ❌ Missing Implementations

- No ack creation endpoint when user clicks "Confirm Presence" button
- No presence_events.event type validation (could receive typos from Arduino)

---

## Not Yet Fixed / Known Gaps

### Feature Gaps (Outside Integration)

1. **No "Confirm Presence" Button Implementation**
   - Spec says user should ACK presence prompt
   - Website calls `onConfirmPresence()` callback but never creates presence_acks entry
   - Arduino polls for ACK but website never inserts one

2. **No Presence Acks Creation**
   - useSupabasePresenceEvents reads acks, but no hook to post them
   - Missing: `useSupabaseAckPresence()` or similar

3. **No Device Claiming Flow**
   - Arduino specifies device_id: `550e8400-e29b-41d4-a716-446655440000`
   - Hardcoded in website: `defaultDeviceId`
   - No UI to claim/assign device to user

---

