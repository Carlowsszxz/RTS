# Arduino ↔ Website Integration Checklist

## 1. Database Schema & API Endpoints

### Arduino Write Tables:
- **sensor_events**: `device_id, timestamp, motion (bool), ssr (bool), led (bool), firmware`
- **session_logs**: `device_id, time_in, time_out, trigger, devices (jsonb)`
- **presence_events**: `device_id, timestamp, event ("still_there_prompt"|"still_there_ack"), note`
- **presence_acks**: `device_id, ack_at`

### Website Read/Write Tables:
- **devices**: `overrides {lights: bool, pc: bool, fan: bool}`, `last_seen`
- **user_settings**: `auto_lights, auto_pc, auto_fan`

### Key Endpoints:
- **Override poll**: `GET /rest/v1/devices?id=eq.{DEVICE_ID}`
- **Sensor POST**: `POST /rest/v1/sensor_events`
- **Session POST/PATCH**: `POST /rest/v1/session_logs`, `PATCH time_out`
- **Presence POST**: `POST /rest/v1/presence_events`
- **Ack lookup**: `GET /rest/v1/presence_acks?device_id=eq.{DEVICE_ID}&order=ack_at.desc`

### Device ID:
`550e8400-e29b-41d4-a716-446655440000`

---

## 2. Real-Time Data Flow

### Arduino → Supabase (Every 10s or on state change):
- **sensor_events**: Posts motion/ssr/led state
- **session_logs**: time_in when motion detected, time_out when idle timeout expires
- **presence_events**: Sends "still_there_prompt" after 10min idle, "still_there_ack" when acknowledged

### Expected Timing:
- POST interval: 10 seconds (or on state change)
- Session timeout: 10 min idle → 5 min grace period → forced off
- Presence ACK poll: Every 15 seconds (when prompt sent)

### Error Handling:
- HTTP timeout: 3 seconds per request
- No retry loop (skip missed POSTs, retry next interval)
- WiFi reconnection: Non-blocking, retry next cycle

---

## 3. Control Flow (Website → Arduino)

### How Website Controls Device:
1. Website updates `devices.overrides` with `{lights: bool}` or `{pc: bool}`
2. Arduino polls `/rest/v1/devices?id=eq.{DEVICE_ID}` every 5 seconds
3. If override set, SSR is forced ON/OFF (bypasses motion logic)
4. If override cleared (set to null), SSR returns to motion-based logic

### Expected Response Time:
- Override detection: 0-5 seconds (next poll)
- SSR actuation after detection: <1 second

### Override Object Examples:
```json
{"lights": true}      // Force light ON
{"lights": false}     // Force light OFF
{"lights": null}      // Clear override, return to motion logic
```

---

## 4. Pages/Components Using Sensor Data

### Dashboard/Main Pages:
- Real-time motion status display
- Current SSR state (ON/OFF)
- Last sensor reading timestamp
- Presence session status

### Control Pages:
- Manual override toggles (lights, PC, fan)
- Override indicator (showing if currently forced)

### Logs/History Pages:
- sensor_events table (motion/ssr/led timeline)
- session_logs table (start/end times)
- presence_events table (prompts sent/acks received)

### Update Strategy:
- Use Supabase Realtime subscriptions for live updates
- Fallback polling every 5-10 seconds if subscription lost
- Graceful UI handling for stale data (show timestamp)

---

## 5. Supabase Realtime Subscriptions

### Tables to Subscribe To:
- `sensor_events` (device_id filter) → display latest motion/ssr state
- `devices` (id filter) → detect override changes
- `presence_events` (device_id filter) → show prompts, acks
- `session_logs` (device_id filter) → show active session status

### Expected Event Payloads:
```json
// sensor_event
{
  "device_id": "550e8400...",
  "timestamp": "2026-05-06T10:30:00Z",
  "motion": true,
  "ssr": true,
  "led": true,
  "firmware": "SSR-Lightbulb-Test-v1-OPT"
}

// session_log (time_in)
{
  "device_id": "550e8400...",
  "time_in": "2026-05-06T10:30:00Z",
  "time_out": null,
  "trigger": "presence-detected"
}

// presence_event
{
  "device_id": "550e8400...",
  "timestamp": "2026-05-06T10:40:00Z",
  "event": "still_there_prompt",
  "note": "idle 10 minutes"
}
```

### Connection Loss Handling:
- Show offline indicator to user
- Don't clear data (keep last known state)
- Attempt reconnection with exponential backoff
- Resume subscriptions when online

---

## 6. Timing Expectations

### Arduino Intervals (from optimized firmware):
- **Override poll**: Every 5 seconds
- **Sensor POST**: Every 10 seconds (or on state change)
- **ACK poll**: Every 15 seconds (when prompt sent)
- **RTC cache**: 100ms (avoid repeated I2C reads)
- **Main loop delay**: 100ms (faster PIR sampling)
- **Session blink**: 300ms (LED indicator)

### Website Expected Behaviors:
- Realtime subscription updates: <500ms push (via Websocket)
- Manual override click → visible effect: <1 second (next Arduino poll)
- Display should update within 5-10 seconds even without Realtime
- Presence prompt should appear within 10+ min 5 sec window

---

## 7. State Management

### Session States:

**Inactive** (default):
- No motion detected
- SSR OFF
- LED not blinking

**Active** (motion → time_in logged):
- Motion detected (debounced)
- SSR ON (or override value)
- LED blinking (session indicator)
- Last motion updated

**Idle with Prompt Sent** (10 min no motion):
- Still_there_prompt logged
- Waiting for user ACK
- LED still blinking

**Timed Out** (5 min no ACK):
- SSR forced OFF
- Session closed (time_out logged)
- Return to Inactive
- LED stops blinking

### Managed Variables:
- `sessionActive`: Tracks if motion session is ongoing
- `promptSent`: True if "still_there_prompt" sent, waiting for ACK
- `forcedOffAfterTimeout`: True if timeout occurred, forces SSR OFF
- `overrideActive`: True if website has set an override
- `lastMotionMs`: Tracked for idle detection

---

## 8. Error Cases & Edge Cases

### Scenario: WiFi Drops During Active Session
- Arduino keeps SSR in last-known state
- Session remains open (time_out not sent)
- After WiFi restores, Arduino catches up with buffered data
- **Expected**: Session eventually closes when timeout expires or manual override clears

### Scenario: Website Sends Override While Session Active
- Arduino polls override every 5 seconds
- Override takes precedence (motion logic suppressed)
- SSR switches to override value immediately
- **Expected**: <5 second response time

### Scenario: Missed POST Due to Network Failure
- Arduino doesn't retry failed POST
- Skips that sample, posts again at next interval (10s)
- **Expected**: Sensor data gap of up to 10-20s visible in Supabase

### Scenario: Presence ACK Received While SSR Forced Off
- ACK recorded in presence_acks
- lastMotionMs updated
- Session loop acknowledges but SSR stays off (forced timeout state)
- **Expected**: "Still_there_ack" event logged, session eventually closes

### Scenario: User Clears Override During Active Session
- Arduino polls, sees override=null
- Returns to motion-based logic
- SSR continues if session still active
- **Expected**: Transparent handoff, SSR continues (if session active)

### Stale Data on Frontend:
- If Realtime disconnected, show timestamp of last known state
- Add visual indicator (e.g., "Updated 3 min ago")
- Disable override controls if >30 seconds stale
- **Expected**: User doesn't accidentally force stale state

### RTC Out of Sync:
- Arduino skips all POSTs if RTC year < 2022
- NTP syncs RTC on boot (up to 10s wait)
- If sync fails, timestamps invalid
- **Expected**: Check device logs/serial for RTC errors

