# Arduino ↔ Website Integration Checklist

## 1. Database Schema & API Endpoints

Expected Tables:
# Database Reference

This document summarizes the database schema used by the project for quick reference.

## Schema Overview

The database contains the following public tables:

- app_meta
- devices
- sensor_events
- session_logs
- presence_events
- presence_acks
- user_settings
- users

## Table Definitions

### app_meta

Stores application-level metadata as key/value pairs.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| key | text | No | — | Primary key |
| value | jsonb | Yes | — | Arbitrary JSON metadata |

**Primary key:** key

---

### users

Stores registered user accounts.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| full_name | text | Yes | — | User's full name |
| email | text | Yes | — | Unique email address |
| password_hash | text | Yes | — | Hashed password |
| created_at | timestamp with time zone | Yes | now() | Account creation time |
| last_seen | timestamp with time zone | Yes | — | Last activity timestamp |

**Constraints:**

- Primary key: id
- Unique: email

---

### devices

Stores IoT or controlled devices linked to users.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| name | text | Yes | — | Device name |
| location | text | Yes | — | Device location |
| owner_id | uuid | Yes | — | References users.id |
| state | jsonb | Yes | '{}'::jsonb | Current device state |
| overrides | jsonb | Yes | '{}'::jsonb | Manual override values |
| metadata | jsonb | Yes | '{}'::jsonb | Additional device metadata |
| created_at | timestamp with time zone | Yes | now() | Creation time |
| last_seen | timestamp with time zone | Yes | — | Last heartbeat / activity time |

**Constraints:**

- Primary key: id
- Foreign key: owner_id references users(id) on delete set null

---

### sensor_events

Stores sensor readings and device activity events.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| device_id | uuid | Yes | — | References devices.id |
| timestamp | timestamp with time zone | Yes | now() | Event timestamp |
| motion | boolean | Yes | — | Motion detected flag |
| ssr | boolean | Yes | — | SSR state |
| led | boolean | Yes | — | LED state |
| firmware | text | Yes | — | Firmware version or tag |
| raw | jsonb | Yes | '{}'::jsonb | Raw payload / extra data |

**Constraints:**

- Primary key: id
- Foreign key: device_id references devices(id) on delete cascade

**Index:**

- sensor_events_device_id_timestamp_idx on (device_id, timestamp DESC)

---

### session_logs

Stores user session history and device activity summaries.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| user_id | uuid | Yes | — | References users.id |
| time_in | timestamp with time zone | No | — | Session start time |
| time_out | timestamp with time zone | Yes | — | Session end time |
| source | text | Yes | — | Login source or origin |
| trigger | text | Yes | — | What started the session |
| devices | jsonb | No | — | Snapshot of related devices |
| created_at | timestamp with time zone | Yes | now() | Record creation time |

**Constraints:**

- Primary key: id
- Foreign key: user_id references users(id) on delete set null

**Index:**

- session_logs_user_id_time_in_idx on (user_id, time_in DESC)

---

### presence_events

Stores presence-related events emitted by firmware.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| device_id | uuid | No | — | References devices.id |
| timestamp | timestamp with time zone | No | now() | Event time |
| event | text | No | — | Event type, e.g. still_there_prompt |
| note | text | Yes | — | Optional detail |
| firmware | text | Yes | — | Firmware version or tag |

**Constraints:**

- Primary key: id
- Foreign key: device_id references devices(id) on delete cascade

**Index:**

- presence_events_device_id_timestamp_idx on (device_id, timestamp DESC)

---

### presence_acks

Stores user acknowledgements of presence prompts.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| id | uuid | No | gen_random_uuid() | Primary key |
| device_id | uuid | No | — | References devices.id |
| ack_at | timestamp with time zone | No | now() | Acknowledgement time |

**Constraints:**

- Primary key: id
- Foreign key: device_id references devices(id) on delete cascade

**Index:**

- presence_acks_device_id_ack_at_idx on (device_id, ack_at desc)

---

### user_settings

Stores per-user preferences and automation settings.

| Column | Type | Nullable | Default | Notes |
| --- | --- | --- | --- | --- |
| user_id | uuid | No | — | Primary key and foreign key to users.id |
| notifications_enabled | boolean | Yes | true | Enable notifications |
| dark_mode | boolean | Yes | false | Enable dark mode |
| display_name | text | Yes | — | Preferred display name |
| auto_lights | boolean | Yes | true | Auto-control lights |
| auto_pc | boolean | Yes | true | Auto-control PC power |
| auto_fan | boolean | Yes | true | Auto-control fan |
| updated_at | timestamp with time zone | Yes | now() | Last update time |

**Constraints:**

- Primary key: user_id
- Foreign key: user_id references users(id) on delete cascade

## Relationships

- devices.owner_id → users.id
- sensor_events.device_id → devices.id
- session_logs.user_id → users.id
- presence_events.device_id → devices.id
- presence_acks.device_id → devices.id
- user_settings.user_id → users.id

## Notes

- JSONB fields are used for flexible state storage and extensible metadata.
- devices, sensor_events, and session_logs are indexed to support common lookups and sorting.
- The source SQL included a repeated devices definition; this reference lists it once.


## 2. Real-Time Data Flow

### Arduino → Supabase Payloads:

**sensor_events** (POST every 10 seconds or on state change):
```json
{
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-05-06T10:30:00Z",
  "motion": true,
  "ssr": true,
  "firmware": "SSR-Lightbulb-Test-v1-OPT"
}
```

**session_logs** (POST when motion detected, PATCH when timeout):
- **time_in POST**: `device_id, time_in, trigger: "presence-detected", devices: {lights, pc, fan, motion, ssr, led}`
- **time_out PATCH**: Updates `time_out` timestamp (closes session)

**presence_events** (POST when idle detected or ack received):
```json
{
  "device_id": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2026-05-06T10:40:00Z",
  "event": "still_there_prompt" | "still_there_ack",
  "note": "idle 10 minutes",
  "firmware": "SSR-Lightbulb-Test-v1-OPT"
}
```

### POST Intervals & Timing:
| Operation | Interval | Details |
|---|---|---|
| Sensor POST | 10 seconds | Or immediately on SSR state change |
| Override poll | 5 seconds | Checks `devices.overrides.lights` |
| Presence ACK poll | 15 seconds | Only when `promptSent = true` |
| HTTP timeout | 3 seconds | Single attempt, no retries |
| Main loop | 100ms | Faster PIR sampling |
| Session idle prompt | 10 minutes | After no motion detected |
| Prompt ack timeout | 5 minutes | Forces SSR OFF if no ACK |

### Error Handling:
- HTTP Timeout Enforced: 3-second max per request (prevents hangs)
- Single Attempt Only: No retry loop (failed POST skipped, retry next interval)
- WiFi Check Non-Blocking: If disconnected, loop continues next cycle
- Graceful Degradation: Skips POST if `networkTaskBusy` or WiFi down
- RTC Validation: Skips all POSTs if RTC time invalid (year < 2022)
- State Loss Recovery: Device maintains SSR state across network outages until timeout

## 3. Control Flow (Website → Arduino)

### How Website Sends Override Commands:

**Endpoint**: `PATCH /rest/v1/devices?id=eq.550e8400-e29b-41d4-a716-446655440000`

**Payload** (update `overrides` column):
```json
{
  "overrides": {
    "lights": true,
    "pc": false,
    "fan": null
  }
}
```

**Override Values**:
- `"lights": true` → Force SSR ON
- `"lights": false` → Force SSR OFF
- `"lights": null` → Clear override (return to motion logic)

### How Arduino Reads Override:
- Polls every **5 seconds**: `GET /rest/v1/devices?select=overrides&id=eq.550e8400...`
- Parses `overrides.lights` field (first) or `overrides.pc` field (fallback)
- If value not null → `overrideActive = true`, applies value to SSR
- If value is null → `overrideActive = false`, SSR returns to motion-based logic

### Priority Logic (in order):
1. **If forced off after timeout** → SSR is OFF (cannot override)
2. **Else if override active** → SSR = override value
3. **Else** → SSR = session state (motion-based)

### Expected Response Time:
- Website sends override → 0-5 seconds (next Arduino poll) → SSR changes state
- **Typical**: 2-3 seconds from website click to physical relay actuation

### Code Reference:
```cpp
// Arduino polls every 5 seconds
if (nowMs - lastOverridePollMs >= OVERRIDE_POLL_INTERVAL_MS) {
  pollOverridesOptimized();
  lastOverridePollMs = nowMs;
}

// SSR output decision
bool ssrFinal = forcedOffAfterTimeout ? false : (overrideActive ? overrideValue : sessionActive);
digitalWrite(SSR_PIN, ssrFinal ? HIGH : LOW);
```

## 4. Pages/Components Using Sensor Data

### Pages That Display Data:

**DashboardPage** (main view):
- Real-time motion status indicator  
- Current SSR state (ON/OFF)
- Last sensor reading timestamp (from sensorEvents)
- Active session info (if any)
- Calendar of activity
- Latest 10 presence events (prompts, acks)
- Manual override toggles (lights, PC, fan)
- Current override status badge

**LogsPage** (session history):
- Table of session_logs
- Columns: Trigger, Time In, Time Out, Lights state, PC state, Fan state, Source
- Shows merged sessions (combined if within 10 min threshold)
- Updated on-demand when page loads

**AdminPage** (monitoring):
- Device list with status
- Raw sensor events feed
- Override controls
- Real-time updates

**SettingsPage** (user preferences):
- User settings from user_settings table
- Auto-control toggles (auto_lights, auto_pc, auto_fan)

### Realtime Subscriptions (Active):
- `useSupabaseSensorEvents()` → `sensor_events` table (INSERT, filtered by device_id)
- `useSupabasePresenceEvents()` → `presence_events` table (INSERT, filtered by device_id)
- `useSupabaseOverrides()` → `devices` table (UPDATE, filtered by device_id)
- `useSupabaseLogs()` → `session_logs` table (on-demand/polling)

### Update Strategies:

| Component | Data Source | Update Type | Frequency |
|---|---|---|---|
| Motion status | sensor_events | Realtime INSERT | <500ms push |
| SSR state | sensor_events | Realtime INSERT | <500ms push |
| Active session  | session_logs | Realtime INSERT | <500ms push |
| Presence prompts | presence_events | Realtime INSERT | <500ms push |
| Override status | devices | Realtime UPDATE | <500ms push |
| Session logs table | session_logs | On-demand | User clicks to refresh |
| Activity history | session_logs | On-demand | Load on page open |

### Data Freshness Requirements:
- **Real-time critical**: Motion, SSR state, presence prompts (must reflect within 1 second)
- **Near real-time**: Session start/end events (within 5 seconds acceptable)
- **On-demand ok**: Historical logs, completed sessions (load when user navigates)

### Fallback (If Realtime Down):
- Show last known state with "Updated X seconds ago" timestamp
- Poll fallback: manual refresh button
- Disable control overrides if data stale >30 seconds
- Reconnection indicator: "Syncing..."

## 5. Supabase Realtime Subscriptions

### Active Subscriptions (Realtime):

**sensor_events** (via useSupabaseSensorEvents hook):
```typescript
channel = supabase.channel('sensor_events_updates_{deviceId}')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'sensor_events',
    filter: `device_id=eq.{deviceId}`
  }, (payload) => {
    // Add new sensor event to UI
  })
  .subscribe()
```

**presence_events** (via useSupabasePresenceEvents hook):
```typescript
channel = supabase.channel('presence_events_updates_{deviceId}')
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'presence_events',
    filter: `device_id=eq.{deviceId}`
  }, (payload) => {
    // Add presence event (prompt/ack) to UI
  })
  .subscribe()
```

**session_logs** (via useSupabaseLogs hook):
```typescript
channel = supabase.channel(`session_logs_updates_{userId}`)
  .on('postgres_changes', {
    event: 'INSERT' | 'UPDATE',
    schema: 'public',
    table: 'session_logs',
    filter: `user_id=eq.{userId}`
  }, (payload) => {
    // Update session logs in real-time
  })
  .subscribe()
```

**devices** (override changes):
```typescript
channel = supabase.channel('devices_updates_{deviceId}')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'devices',
    filter: `id=eq.{deviceId}`
  }, (payload) => {
    // Update override UI indicator
  })
  .subscribe()
```

### Expected Event Payloads:

**sensor_events INSERT**:
```json
{
  "new": {
    "id": "uuid",
    "device_id": "550e8400-...",
    "timestamp": "2026-05-06T10:30:00Z",
    "motion": true,
    "ssr": true,
    "led": true,
    "firmware": "SSR-Lightbulb-Test-v1-OPT"
  }
}
```

**presence_events INSERT**:
```json
{
  "new": {
    "id": "uuid",
    "device_id": "550e8400-...",
    "timestamp": "2026-05-06T10:40:00Z",
    "event": "still_there_prompt",
    "note": "idle 10 minutes",
    "firmware": "SSR-Lightbulb-Test-v1-OPT"
  }
}
```

**session_logs INSERT/UPDATE**:
```json
{
  "new": {
    "id": "uuid",
    "user_id": "user-uuid",
    "time_in": "2026-05-06T10:30:00Z",
    "time_out": null,
    "trigger": "presence-detected",
    "source": "machine-learning",
    "devices": {
      "lights": true,
      "pc": false,
      "fan": false
    }
  }
}
```

### Connection Loss Handling:

**In React components** (useSupabase* hooks):
1. Display offline indicator when subscription fails
2. Keep showing last known state (don't clear data)
3. Show "Updated X seconds ago" timestamp
4. Disable interactive controls if >30s stale
5. Retry subscription with exponential backoff
6. Resume subscriptions when connection restores
7. Fetch fresh data on reconnect to avoid gaps

**UI Indicators**:
- Green dot + "Live" when connected
- Gray dot + "Offline" when disconnected
- "Syncing..." during reconnection

### Subscription Lifecycle:
1. Component mounts → Initial fetch from DB
2. Subscribe to realtime channel
3. New inserts/updates stream in via websocket
4. Component unmounts → Unsubscribe from channel
5. On network loss → Stop receiving updates, show offline state
6. On network restore → Reconnect, fetch latest, resume streaming

## 6. Timing Expectations

### Arduino Timing (from optimized firmware):

| Event | Interval | Notes |
|---|---|---|
| Main loop | 100ms | PIR sampled 10x per second |
| Override poll | 5 seconds | Checks `devices.overrides.lights` value |
| Sensor POST | 10 seconds | Or immediately on SSR state change |
| Session idle detection | 10 minutes | No motion → send presence_prompt |
| Prompt timeout | 5 minutes | No ACK received → force SSR OFF |
| Presence ACK poll | 15 seconds | Poll `presence_acks` when prompt sent |
| HTTP timeout per request | 3 seconds | Max wait time, single attempt |
| RTC cache window | 100ms | Avoid repeated I2C reads |
| Persistent client refresh | 60 seconds | Recreate TLS connection every 60s |

### Website Expected Response Times:

| Action | Expected Time | Notes |
|---|---|---|
| **User clicks override toggle** | 0-5 seconds | Next Arduino poll picks it up |
| **SSR physically actuates** | <1 second | After override poll (so 1-6s total) |
| **Motion detected in UI** | <500ms | Via Realtime subscription |
| **Sensor event displayed** | <500ms | sensor_events INSERT arrives |
| **Presence prompt shown** | 10min +2s | Firmware sends (10min idle) + network latency |
| **User acks presence** | <500ms | presence_acks INSERT streamed to UI |
| **Session starts** | <1 second | Motion debounce (200ms) + next loop |
| **Session ends** | 5min +10s | After prompt timeout expires + POST |
| **Page loads** | 2-5 seconds | Initial data fetch from Supabase |
| **Real-time refresh** | <1 second | Push via Websocket |

### Synchronization Points:

**Arduino Sends sensor_events**:
- Every 10 seconds (regular interval)
- Immediately on SSR state change

**Website Receives**:
- Via Realtime: <500ms after POST to Supabase
- Via polling fallback: up to 10 seconds

**Visibility Matches Reality**:
- UI shows SSR state within 1 second of actual hardware state
- Override changes visible <6 seconds after website click
- Presence events <1 second after detection

### Polling Fallback Strategy (if Realtime fails):
- Sensor events: Poll every 5 seconds
- Session logs: On-demand (user refresh)
- Presence events: On-demand (user refresh)
- Override status: No polling needed (computed locally)

## 7. State Management

### Session States (on Arduino and Website):

**Inactive** (default, no motion):
- `sessionActive = false`
- `promptSent = false`  
- `forcedOffAfterTimeout = false`
- SSR state: OFF (or override value)
- Appearance: Gray "Idle" badge, LED not blinking

**Active** (motion detected, session started):
- Motion debounced (2 consecutive HIGH reads)
- `sessionActive = true` → POST session_logs with `time_in`
- `promptSent = false`
- `lastMotionMs = current_time`
- SSR state: ON (or override value)
- Appearance: Green "Active" badge, LED blinking indicator

**Idle with Prompt Sent** (10 min+ no new motion):
- Idle timer reaches 10 minutes (600,000 ms)
- POST presence_events: `{"event": "still_there_prompt", "note": "idle 10 minutes"}`
- `promptSent = true`
- Start polling presence_acks every 15 seconds
- SSR remains ON
- Appearance: Yellow "Awaiting Confirmation" badge, LED still blinking

**Acknowledged** (user responds to prompt):
- Website writes to presence_acks table
- Arduino polls and finds new ack entry
- `lastMotionMs = current_time` (resets idle counter)
- `promptSent = false`
- Stays in Active state
- Appearance: Green "Active" badge, LED continues blinking

**Timed Out** (5 min no ack):
- Prompt sent at time X, no ACK received by time X+300,000ms
- `forcedOffAfterTimeout = true`
- SSR forced to OFF (overrides session and overrideActive)
- POST presence_events: implicit timeout (session closes)
- PATCH session_logs: set `time_out` = now
- Return to Inactive state
- Appearance: Red "Session Expired" badge, then reset to "Idle"

### State Transitions:

```
INACTIVE --[motion detected]--> ACTIVE
ACTIVE --[10 min idle]--> IDLE_WITH_PROMPT
IDLE_WITH_PROMPT --[user acks]--> ACTIVE (reset idle counter)
IDLE_WITH_PROMPT --[5 min no ack]--> INACTIVE (forced off)
ACTIVE --[clear debounce + min_on_ms]--> INACTIVE
```

### Managed Variables (Arduino):

| Variable | Scope | Purpose |
|---|---|---|
| `sessionActive` | bool | Tracks if motion session is ongoing |
| `promptSent` | bool | True if "still_there_prompt" sent, waiting for ACK |
| `forcedOffAfterTimeout` | bool | True if timeout occurred, forces SSR OFF |
| `overrideActive` | bool | True if website has set an override |
| `overrideValue` | bool | True = force ON, False = force OFF |
| `lastMotionMs` | unsigned long | Time of last motion/ACK (used for idle detection) |
| `motionState` | bool | Debounced PIR motion flag |
| `lastClearedAtMs` | unsigned long | Time motion last cleared (refractory period) |
| `promptSentAtMs` | unsigned long | Time prompt was sent (for timeout calc) |
| `promptSentAtEpoch` | uint32_t | Epoch time of prompt for ACK validation |

### Website State (React Components):

- `sensorEvents`: Latest motion/SSR/LED readings (realtime)
- `presenceEvents`: Prompts and acks received
- `sessionLogs`: Session history with time_in/time_out
- `overrideActive`: Whether override is currently set
- Local UI state: "Updated X sec ago", offline indicator

### State Consistency Check:

**Arduino to Website alignment**:
1. ✓ Motion state → sensor_events.motion (POST every 10s)
2. ✓ SSR output → sensor_events.ssr (POST every 10s)
3. ✓ Session start → session_logs.time_in (INSERT on motion)
4. ✓ Session end → session_logs.time_out (PATCH on timeout)
5. ✓ Presence check → presence_events (INSERT on idle/ack)
6. ✓ Override request → devices.overrides (Website PATCH, Arduino poll every 5s)

## 8. Error Cases & Edge Cases

### Scenario 1: WiFi Drops During Active Session

**What happens**:
- Arduino loses internet connection
- `WiFi.status() != WL_CONNECTED` all operations skip
- `sessionActive = true` maintained in local state
- SSR stays in last-known state (still ON if session was active)

**Expected behavior**:
- No new sensor_events POSTed (queuing not implemented)
- Session remains "open" (time_out not sent to DB)
- UI shows "Updated X seconds ago" with offline badge
- Override checks skip (won't accept new commands)

**Recovery**:
- WiFi reconnects → `connectWiFi()` succeeds
- `ensureDeviceRowOptimized()` re-provisions device
- Next sensor POST includes current SSR state
- Session eventually closes when timeout (5min) expires
- UI syncs with Supabase data

**Expected outcome**: Session logs show gap, but time_out eventually recorded

---

### Scenario 2: Website Sends Override While Session Active

**What happens**:
1. Website POSTs `{"overrides": {"lights": true}}` to devices table
2. Arduino polls every 5 seconds
3. Next poll finds override set
4. `overrideActive = true`, `overrideValue = true`
5. SSR logic: `ssrFinal = forcedOffAfterTimeout ? false : (overrideActive ? true : sessionActive)`
6. SSR immediately switched to TRUE

**Expected behavior**:
- Override takes precedence over motion logic
- SSR actuates within <1 second of poll
- Session state unchanged (still Active)
- LED continues blinking (session ongoing)

**Expected outcome**: SSR switches to override value in 0-5 seconds

---

### Scenario 3: Missed POST Due to Network Transient

**What happens**:
- Arduino attempts POST sensor_events
- HTTP request times out (3 seconds) or fails
- No retry loop (optimized version)
- Next interval (10s), Arduino tries again

**Expected behavior**:
- One data point gap in sensor_events table
- No error logged if `DEBUG_SKIP_POST_LOGGING = true`
- Data stream resumes at next interval

**UI impact**:
- If 30+ seconds pass without new events, show "Stale data" warning
- Last value remains displayed
- No automatic retry (user must refresh)

**Expected outcome**: <20 second data gap, recovers automatically

---

### Scenario 4: Presence ACK Sent While SSR Forced Off

**What happens**:
1. Prompt sent at T=0
2. Timeout set to T+300,000ms
3. At T+250,000ms user ACKs via website
4. Arduino polls, finds `ack_at > promptSentAtEpoch`
5. `promptSent = false` (ack received)
6. `lastMotionMs = now` (idle counter reset)
7. But `forcedOffAfterTimeout` NOT checked in override logic

**Expected behavior**:
- ACK recorded in presence_acks (database OK)
- PresenceEvent logged "still_there_ack"
- Session remains closed (if timeout already exceeded)
- SSR stays OFF

**Issue to watch**: ACK accepted even if timeout already fired

**Workaround**:
- Website should check if session still open before accepting ACK
- Or Arduino re-opens session on valid late ACK (not current behavior)

**Expected outcome**: "Still_there_ack" event recorded, but no action

---

### Scenario 5: User Clears Override During Active Session

**What happens**:
1. Website PATCHes `{"overrides": {"lights": null}}`
2. Arduino polls, finds lights = null
3. `overrideActive = false`
4. `ssrFinal = sessionActive` (reverts to session logic)
5. Session still Active, so SSR stays ON

**Expected behavior**:
- Override disabled
- SSR logic reverts to motion-based
- Session continues uninterrupted
- Smooth handoff

**Expected outcome**: Transparent, SSR state unchanged (both override and session wanted ON)

---

### Scenario 6: RTC Out of Sync (Year < 2022)

**What happens**:
- On boot, if RTC time invalid AND NTP fails:
  - `rtc.now().year() < 2022`
- Arduino skips ALL POSTs: `if (now.year() < 2022) { http.end(); return false; }`
- No sensor data stored
- Only local PIR/SSR logic runs

**UI impact**:
- No sensor_events generated
- No timestamps recorded
- Dashboard shows "No data"

**Recovery**:
- Manually set RTC via Serial
- Or NTP sync on next boot (if network available)
- Requires firmware reconnect

**Expected outcome**: Complete data loss until RTC fixed, device continues locally

---

### Scenario 7: Realtime Subscription Disconnects on Website

**What happens**:
1. Supabase Realtime channel closes
2. `useSupabase*` hooks catch error
3. Display offline badge
4. Keep showing last known values
5. Set timeout for "stale" data (>30s)

**Expected behavior**:
- UI doesn't crash
- Data frozen at last update
- Controls disabled (don't send commands to stale state)
- Retry button or auto-reconnect after delay

**Expected outcome**: Graceful degradation, resume when network restored

---

### Scenario 8: Multiple Overrides Set (lights + pc)

**What happens**:
- Website sets `{"lights": true, "pc": false}`
- Arduino polls: checks `lights` first (priority)
- If `lights` found and not null → uses lights value
- Fallback to `pc` only if `lights` not found

**Expected behavior**:
- Only `lights` override applied
- `pc` value ignored

**Expected outcome**: Single value precedence, not merged

---

### Scenario 9: Stale Data on Frontend >30 seconds

**What happens**:
1. No Realtime updates received for 30+ seconds
2. UI timestamps show "30s ago", "45s ago", etc.
3. CSS class adds "stale" styling (gray out)
4. Action buttons disabled

**Expected behavior**:
- User can't accidentally send commands based on outdated state
- Warning badge shows: ⚠️ "Data may be outdated"
- Manual refresh kicks off new fetch

**Expected outcome**: User awareness, prevent mistakes

---

### Scenario 10: Session Active After Long WiFi Outage

**What happens**:
1. Session starts at T=0
2. WiFi drops at T=5min (session_logs.time_in POSTed, but time_out is NULL)
3. WiFi down for 15 minutes
4. WiFi restores, Arduino reconnects
5. Session still shows Active in DB (time_out is null)
6. Eventually times out naturally (10+5 min cycle)

**Expected behavior**:
- Session remains open in DB during outage
- No active session prompt (device lost its state locally)
- Database shows artificially long session duration

**Expected outcome**: ~20 minute session recorded (5min actual + 15min outage)

**Improvement**: Arduino should POST stale session updates after outage detected

---

### Scenario 11: Motion During Presence Prompt Timeout

**What happens**:
1. Idle prompt sent at T=0, forcedOffAfterTimeout will be set at T=300s
2. At T=250s (mid-timeout), motion detected
3. `consecHigh >= DEBOUNCE_REQUIRED` (debounce satisfied)
4. BUT `forcedOffAfterTimeout` is NOT yet true
5. Motion doesn't change session state (already Active)
6. `lastMotionMs` updated (resets idle counter? NO - not implemented)

**Issue**: Motion during timeout doesn't prevent timeout

**Expected behavior** (current):
- Timeout clock still runs (10 min from original, not reset by middle motion)
- Need explicit ACK to prevent timeout
- Motion alone can't rescue session

**Expected outcome**: Timeout proceeds regardless of motion

---

### Recommended Monitoring Checks:

**Website should alert if**:
1. No sensor_events for >30 seconds (device offline?)
2. Session open for >1 hour (stuck session?)
3. presence_events.event = "still_there_prompt" but no corresponding ACK after 6+ min (check if user saw it)
4. Multiple prompts sent to same device in <10 min (flaky motion detection?)
5. RTC mismatch: sensor timestamps wildly different from server time

