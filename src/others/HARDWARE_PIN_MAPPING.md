# ESP32 Hardware Pin Mapping & Components

## GPIO Pin Configuration

| Pin | GPIO | Component | Type | Purpose |
|-----|------|-----------|------|---------|
| 13 | GPIO13 | PIR Motion Sensor | Input | Detects motion/presence (HIGH when motion detected) |
| 12 | GPIO12 | SSR (Solid State Relay) | Output | Controls lights/electrical load (HIGH = ON, LOW = OFF) |
| 2 | GPIO2 | LED Indicator 1 | Output | Session status blink indicator (blinks when session active) |
| 4 | GPIO4 | LED Indicator 2 | Output | Complementary LED (opposite state of LED_PIN for dual-LED effect) |

## I2C Bus Configuration

| Pin | GPIO | Component | Protocol | Purpose |
|-----|------|-----------|----------|---------|
| 21 | GPIO21 | RTC DS3231 (SDA) | I2C Data | Real-time clock synchronization and date/time tracking |
| 22 | GPIO22 | RTC DS3231 (SCL) | I2C Clock | Real-time clock synchronization and date/time tracking |

### I2C Details
- **Component**: DS3231 Precision RTC (Real Time Clock)
- **Features**: 
  - Accurate timekeeping with temperature compensation
  - Persists time across power cycles
  - Communicates via I2C bus at standard 100kHz
  - Used for timestamping sensor events and calculating RTC drift

## Wireless Communication

| Interface | Hardware | Purpose |
|-----------|----------|---------|
| WiFi | Built-in ESP32 | Connects to network for Supabase cloud integration |
| Network | TP-Link Router | SSID: `TP-Link_DE3A` |

## External Services

| Service | Type | Purpose |
|---------|------|---------|
| Supabase API | Cloud Database | Store sensor events, session logs, device settings, and user overrides |
| NTP (pool.ntp.org) | Time Synchronization | Sync RTC to accurate Philippine timezone (UTC+8) |

## Pin States & Logic

### PIR Motion Sensor (GPIO13)
- **Input Type**: Digital
- **State**: HIGH = Motion detected, LOW = No motion
- **Logic**: Debounced with 100ms window to filter noise
- **Warmup Time**: 5 seconds post-boot before responding
- **Refractory Period**: 2 seconds between consecutive motion detections

### SSR Output (GPIO12)
- **Output Type**: Digital (controls external relay)
- **State**: HIGH = SSR energized (lights ON), LOW = SSR de-energized (lights OFF)
- **Control Modes**:
  - **Auto Mode**: Controlled by motion sensor + state machine
  - **Override Mode**: Manually controlled via Supabase override flags
- **Grace Period**: Stays ON briefly after last motion (OFF_GRACE_MS = 5000ms) to prevent flicker

### LED Indicators (GPIO2 & GPIO4)
- **GPIO2 (LED1)**: Blinks when session is active (300ms interval)
- **GPIO4 (LED2)**: Inverse of LED1 (complementary blinking pattern)
- **Purpose**: Visual feedback of device status and activity
- **Blink Interval**: 300ms per state change

## Power & Interface Connections

| Component | Connection Type | Notes |
|-----------|-----------------|-------|
| PIR Sensor | Direct GPIO | Typically 3-5V logic compatible |
| SSR Control | GPIO (5V tolerant) | Drives external relay module |
| RTC DS3231 | I2C (3.3V) | Requires level shifting if powered from 5V source |
| LEDs | GPIO (Current limited) | Built-in protection via GPIO pin |
| Power Supply | USB / External 5V | ESP32 requires stable 5V @ ~500mA |

## Firmware Configuration Constants

```
WIFI_SSID = "TP-Link_DE3A"
SUPABASE_URL = "https://dbfdgeicdapykmmjcrjx.supabase.co"
DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000"
USER_ID = "6b04ff11-cd1e-40be-894a-b6c19405c54b"
FIRMWARE_NAME = "SSR-Lightbulb-Test-v1-OPT"
DEVICE_NAME = "ESP32-PIR-SSR"
DEVICE_LOCATION = "Unassigned"
TIMEZONE_OFFSET = UTC+8 (Philippine Time)
```

## State Machine

The device operates in three states:

1. **IDLE** (0)
   - No motion detected
   - SSR OFF
   - LEDs OFF

2. **ACTIVE** (1)
   - Motion detected
   - SSR ON
   - LEDs blinking (session active)
   - Posts `time_in` event to Supabase

3. **CLOSING** (2)
   - Transitioning from ACTIVE to IDLE
   - SSR remains ON briefly (grace period)
   - Posts `time_out` event to Supabase

## Timing Constants

| Parameter | Value | Purpose |
|-----------|-------|---------|
| POST_INTERVAL_MS | 5000ms | Minimum time between sensor event POSTs |
| OVERRIDE_POLL_INTERVAL_MS | 5000ms | How often to check Supabase overrides |
| WARMUP_MS | 5000ms | Boot delay before PIR sensor responds |
| DEBOUNCE_WINDOW_MS | 100ms | Motion must be HIGH for this duration to register |
| MIN_ON_MS | 1000ms | Minimum motion session duration |
| REFRACTORY_MS | 2000ms | Minimum time between motion detections |
| OFF_GRACE_MS | 5000ms | SSR stays ON after last motion to prevent flicker |
| SESSION_BLINK_INTERVAL_MS | 300ms | LED blink frequency during active session |
| HTTP_TIMEOUT_MS | 3000ms | Default HTTP request timeout |
| POST_HTTP_TIMEOUT_MS | 15000ms | Extended timeout for POST operations |
| RTC_CACHE_MS | 100ms | Cache RTC reads to reduce I2C traffic |
| CLIENT_REFRESH_MS | 60000ms | Recreate WiFi client connection every 60s |
| RTC_RESYNC_INTERVAL_MS | 86400000ms (24h) | Re-sync RTC from NTP daily |
| RTC_DRIFT_CHECK_INTERVAL_MS | 3600000ms (1h) | Check RTC drift every hour |

## Error Handling & Diagnostics

- **RTC Sanity Check**: Refuses to POST events if RTC year < 2022
- **Network Diagnostics**: Tests DNS resolution and internet connectivity at boot
- **Drift Detection**: Monitors RTC accuracy and auto-corrects if drift > 10 seconds
- **Retry Logic**: Exponential backoff (250ms → 5000ms) for failed POST attempts
- **Failed Event Queue**: Stores up to 5 failed events in RAM for retry
- **Post Timeout Warning**: Alerts if no successful POST for >30 seconds

## Circuit Diagram Reference

```
ESP32 DevKit
├── GPIO2 ──────────────→ LED1 (Indicator)
├── GPIO4 ──────────────→ LED2 (Indicator)
├── GPIO12 ──────────────→ SSR Control Module
├── GPIO13 ←─────────────── PIR Sensor Output
├── GPIO21 (SDA) ←───────→ RTC DS3231 (I2C Data)
├── GPIO22 (SCL) ←───────→ RTC DS3231 (I2C Clock)
└── WiFi Module ←────────→ Router (TP-Link_DE3A)
```

---

**Last Updated**: Firmware Version SSR-Lightbulb-Test-v1-OPT  
**Documentation Version**: 1.0
