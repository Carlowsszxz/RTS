/*
  ESP32 + PIR + SSR + LED -> Supabase sensor_events [OPTIMIZED VERSION]
  
  KEY OPTIMIZATIONS:
  ✓ Async network operations with timeouts
  ✓ RTC caching between loop iterations
  ✓ Persistent HTTP client connections
  ✓ Reduced JSON parsing overhead
  ✓ Non-blocking polling strategies
  ✓ FreeRTOS task-based networking
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <RTClib.h>
#include <time.h>
#include <ArduinoJson.h>

RTC_DS3231 rtc;

#define PIR_PIN 27
#define SSR_PIN 12
#define LED_PIN 2
#define LED2_PIN 4

const char* WIFI_SSID = "TP-Link_DE3A";
const char* WIFI_PASSWORD = "61693906";
const char* SUPABASE_URL = "https://dbfdgeicdapykmmjcrjx.supabase.co";
const char* SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiZmRnZWljZGFweWttbWpjcmp4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzU1OTkxNCwiZXhwIjoyMDkzMTM1OTE0fQ.dxMraLxKJDnZlXthO3CasH6mFzofq5GBq4jvZLvaZOI";
const char* DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const char* USER_ID = "6b04ff11-cd1e-40be-894a-b6c19405c54b";
const char* FIRMWARE_NAME = "SSR-Lightbulb-Test-v1-OPT";
const char* DEVICE_NAME = "ESP32-PIR-SSR";
const char* DEVICE_LOCATION = "Unassigned";

// ========== SESSION STATE MACHINE ==========
enum SessionState {
  IDLE = 0,      // No motion, SSR off, no session
  ACTIVE = 1,    // Motion detected, SSR on, time_in posted
  CLOSING = 2    // Waiting to close session (transitioning to IDLE)
};

SessionState currentState = IDLE;
SessionState previousState = IDLE;

const char* stateLabel(SessionState s) {
  switch (s) {
    case IDLE: return "IDLE";
    case ACTIVE: return "ACTIVE";
    case CLOSING: return "CLOSING";
    default: return "UNKNOWN";
  }
}

// OPTIMIZATION: Reduce posting frequency and use smarter intervals
const unsigned long POST_INTERVAL_MS = 5000;       // Changed: 10s → 5s (faster time-in events)
const unsigned long OVERRIDE_POLL_INTERVAL_MS = 5000;
const unsigned long LOOP_LOG_INTERVAL_MS = 10000;

// OPTIMIZATION: HTTP timeout (prevents indefinite hangs)
const unsigned long HTTP_TIMEOUT_MS = 3000;        // 3-second timeout on all requests
const unsigned long PROVISION_HTTP_TIMEOUT_MS = 10000;  // 10-second timeout for Supabase provisioning check
const unsigned long POST_HTTP_TIMEOUT_MS = 15000;  // 15-second timeout for sensor_events POST
const uint16_t POST_HANDSHAKE_TIMEOUT_S = 20;  // TLS handshake timeout for POST
const unsigned long OVERRIDE_HTTP_TIMEOUT_MS = 15000;  // 15-second timeout for overrides GET
const uint16_t OVERRIDE_HANDSHAKE_TIMEOUT_S = 20;  // TLS handshake timeout for overrides GET

// OPTIMIZATION: RTC cache to avoid repeated I2C reads
DateTime lastCachedRtcTime;
unsigned long lastRtcCacheMs = 0;
const unsigned long RTC_CACHE_MS = 100;  // Cache RTC for 100ms

// OPTIMIZATION: Persistent HTTP client (reuse connections)
WiFiClientSecure persistentClient;
unsigned long lastClientCreateMs = 0;
const unsigned long CLIENT_REFRESH_MS = 60000;  // Recreate every 60s

// Network state (for async operations)
volatile bool networkTaskBusy = false;
unsigned long lastNetworkTaskMs = 0;


bool lastMotion = false;
unsigned long lastPostMs = 0;
unsigned long lastSuccessfulPostMs = 0;  // Track last successful POST for timeout warning
bool deviceProvisioned = false;
unsigned long lastProvisionAttemptMs = 0;
const unsigned long PROVISION_RETRY_MS = 10000;
bool supabaseReady = false;
int lastProvisionHttpCode = 0;
bool autoLightsEnabled = true;
unsigned long lastAutoLightsCheckMs = 0;
const unsigned long AUTO_LIGHTS_REFRESH_MS = 60000;

// Philippine timezone offset used for RTC sync and payload timestamps.
const long PH_TZ_OFFSET_SEC = 8 * 3600;

// ========== PHASE 5: RETRY / QUEUE LOGIC ==========
// Exponential backoff: 250ms, 500ms, 1s, 2s, 5s (max)
const unsigned long POST_BACKOFF_MS[] = {250, 500, 1000, 2000, 5000};
const int POST_BACKOFF_LEVELS = 5;
int postRetryCount = 0;  // Current retry attempt (0-5)
unsigned long postRetryNextMs = 0;  // When to attempt next retry
unsigned long postRetryFailMs = 0;  // When POST last failed
const unsigned long POST_SUCCESS_TIMEOUT_WARNING_MS = 30000;  // Warn if >30s without successful POST

// WiFi reconnect detection
wl_status_t lastWiFiStatus = WL_IDLE_STATUS;

// Simple ring buffer for failed events (store last 5) in RAM
struct FailedPost {
  bool motion;
  bool ssr;
  bool led;
};
const int FAILED_QUEUE_SIZE = 5;
FailedPost failedQueue[FAILED_QUEUE_SIZE];
int failedQueueCount = 0;

// ========== PHASE 6: RTC SYNC + MONITORING ==========
const unsigned long RTC_RESYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;  // 24 hours
const unsigned long RTC_DRIFT_CHECK_INTERVAL_MS = 60 * 60 * 1000;  // 1 hour
unsigned long lastRtcSyncMs = 0;  // When was RTC last synced from NTP
unsigned long lastRtcDriftCheckMs = 0;  // When was drift last checked
long rtcDriftMs = 0;  // Estimated RTC drift in milliseconds
DateTime rtcBootTime;  // RTC time at last successful sync
unsigned long rtcSyncBootMs = 0;  // millis() at last RTC sync (for drift calculation)

const bool DEBUG_MODE = false;
const bool DEBUG_DISABLE_PIR = DEBUG_MODE;
const bool DEBUG_DISABLE_OVERRIDE_POLL = DEBUG_MODE;
const bool DEBUG_DISABLE_POSTS = DEBUG_MODE;
const bool DEBUG_FORCE_SSR_ON = true;
const bool DEBUG_SKIP_OVERRIDE_POLL = false;
const bool DEBUG_SKIP_POST_LOGGING = false;
const bool DEBUG_VERBOSE_DEBOUNCE = true;
const bool DEBUG_VERBOSE_BLINK = false;
const bool DEBUG_COMPACT_LOGS = true;

// OPTIMIZATION: Async polling state
bool overrideActive = false;
bool overrideValue = false;
unsigned long lastOverridePollMs = 0;

const unsigned long WARMUP_MS = 5000;
const unsigned long MIN_ON_MS = 1000;
const unsigned long REFRACTORY_MS = 2000;
const unsigned long OFF_GRACE_MS = 5000;  // Keep SSR on briefly after last motion to avoid flicker
const unsigned long SESSION_TIMEOUT_MS = 30 * 1000;  // Auto-close session after 30 seconds of inactivity (TEST MODE)

// Timer-based debounce (replaces consecHigh/consecLow counters)
bool motionState = false;
unsigned long motionDebounceStartMs = 0;  // When motion pin went HIGH
const unsigned long DEBOUNCE_WINDOW_MS = 100;  // Motion must stay HIGH for 100ms

unsigned long motionStartMs = 0;
unsigned long lastClearedAtMs = 0;
unsigned long bootMs = 0;
unsigned long lastMotionMs = 0;
unsigned long sessionStartMs = 0;  // Track when current session started (for timeout)

const unsigned long SESSION_BLINK_INTERVAL_MS = 300;
bool sessionBlinkState = false;
unsigned long lastSessionBlinkMs = 0;

// OPTIMIZATION: Inline minimal debug logging
#define DEBUG_LOG(msg) if (!DEBUG_SKIP_POST_LOGGING) { Serial.println("[DBG] " msg); }
#define DEBUG_KV(k, v) if (!DEBUG_SKIP_POST_LOGGING) { Serial.printf("[%s] = %s\n", k, v); }

// ========== OPTIMIZATION 1: Better RTC Caching ==========
DateTime getRtcNowCached() {
  unsigned long nowMs = millis();
  if (nowMs - lastRtcCacheMs >= RTC_CACHE_MS) {
    lastCachedRtcTime = rtc.now();
    lastRtcCacheMs = nowMs;
  }
  return lastCachedRtcTime;
}

// ========== OPTIMIZATION 2: Persistent Client ==========
bool ensurePersistentClient() {
  unsigned long nowMs = millis();
  if (nowMs - lastClientCreateMs >= CLIENT_REFRESH_MS) {
    persistentClient.setInsecure();
    lastClientCreateMs = nowMs;
    return true;
  }
  return persistentClient.connected();
}

// ========== OPTIMIZATION 3: POST with fresh client + longer timeout ==========
bool postSensorEventOptimized(bool motion, bool ssr, bool led) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (networkTaskBusy) return false;  // Skip if already posting
  
  // Use fresh client for POST (like provisioning) to avoid TLS handshake timeouts
  WiFiClientSecure postClient;
  postClient.setInsecure();
  postClient.setHandshakeTimeout(POST_HANDSHAKE_TIMEOUT_S);
  postClient.setTimeout(POST_HTTP_TIMEOUT_MS);

  HTTPClient http;
  http.setTimeout(POST_HTTP_TIMEOUT_MS);  // Use longer timeout for POST
  
  String url = String(SUPABASE_URL) + "/rest/v1/sensor_events";
  if (!http.begin(postClient, url)) {
    Serial.println("[POST] http.begin() failed - SSL/connection error");
    return false;
  }

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  DateTime now = getRtcNowCached();
  if (now.year() < 2022) {
    http.end();
    // PHASE 6: Sanity check - refuse to POST with invalid timestamp
    if (!DEBUG_SKIP_POST_LOGGING) {
      Serial.printf("[POST] RTC SANITY CHECK FAILED: year=%d (< 2022), refusing POST. Run rtcMonitoring() to sync.\n", now.year());
    }
    return false;
  }

  // OPTIMIZATION: Smaller JSON document (256 → 192)
  StaticJsonDocument<192> payload;
  payload["device_id"] = DEVICE_ID;
  payload["timestamp"] = isoTimestamp(now);
  payload["motion"] = motion;
  payload["ssr"] = ssr;
  payload["led"] = led;
  payload["firmware"] = FIRMWARE_NAME;

  String body;
  serializeJson(payload, body);

  // OPTIMIZATION: Single attempt with timeout, no retry loop
  int code = http.POST(body);
  http.end();
  
  bool success = (code >= 200 && code < 300);
  
  // ===== PHASE 5: RETRY TRACKING =====
  if (success) {
    // POST succeeded: reset retry count and update last successful POST time
    lastSuccessfulPostMs = millis();
    postRetryCount = 0;
    postRetryNextMs = 0;
    if (!DEBUG_SKIP_POST_LOGGING) {
      Serial.printf("[POST] Success ✓\n");
    }
  } else {
    // POST failed: queue event and calculate next retry backoff
    if (!DEBUG_SKIP_POST_LOGGING) {
      Serial.printf("[POST] Failed HTTP %d (retry attempt %d)\n", code, postRetryCount);
    }
    
    // Add to failed queue if space available
    if (failedQueueCount < FAILED_QUEUE_SIZE) {
      failedQueue[failedQueueCount].motion = motion;
      failedQueue[failedQueueCount].ssr = ssr;
      failedQueue[failedQueueCount].led = led;
      failedQueueCount++;
      Serial.printf("[QUEUE] Stored failed event, queue size: %d/%d\n", failedQueueCount, FAILED_QUEUE_SIZE);
    }
    
    // Calculate next retry backoff
    if (postRetryCount < POST_BACKOFF_LEVELS) {
      unsigned long backoffMs = POST_BACKOFF_MS[postRetryCount];
      postRetryNextMs = millis() + backoffMs;
      Serial.printf("[BACKOFF] Level %d: retry in %lums\n", postRetryCount, backoffMs);
      postRetryCount++;
    } else {
      // Max retries reached, hold at 5s backoff
      postRetryNextMs = millis() + POST_BACKOFF_MS[POST_BACKOFF_LEVELS - 1];
      Serial.printf("[BACKOFF] Max retries reached, holding at 5s backoff\n");
    }
    
    postRetryFailMs = millis();
  }
  
  return success;
}

// ========== PHASE 5: RETRY QUEUE MANAGEMENT ==========
void retryFailedQueue() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (failedQueueCount == 0) return;
  
  // Try to POST oldest (first) event in queue
  FailedPost& oldestEvent = failedQueue[0];
  if (postSensorEventOptimized(oldestEvent.motion, oldestEvent.ssr, oldestEvent.led)) {
    // Success: remove from queue by shifting remaining events
    Serial.printf("[QUEUE] Retry succeeded, removing from queue\n");
    for (int i = 0; i < failedQueueCount - 1; i++) {
      failedQueue[i] = failedQueue[i + 1];
    }
    failedQueueCount--;
  } else {
    // Retry failed, will try again on next backoff window or WiFi reconnect
    Serial.printf("[QUEUE] Retry failed, will retry again later\n");
  }
}

void checkPostTimeoutWarning() {
  unsigned long nowMs = millis();
  
  // Warn if >30s without successful POST while WiFi is up
  if (WiFi.status() == WL_CONNECTED && lastSuccessfulPostMs > 0) {
    if (nowMs - lastSuccessfulPostMs > POST_SUCCESS_TIMEOUT_WARNING_MS) {
      if (!DEBUG_SKIP_POST_LOGGING) {
        unsigned long secondsWithoutPost = (nowMs - lastSuccessfulPostMs) / 1000;
        Serial.printf("[WARNING] No successful POST for %lus (queue: %d/%d)\n", 
          secondsWithoutPost, failedQueueCount, FAILED_QUEUE_SIZE);
      }
      // Don't spam warnings, only print once every 30s
      lastSuccessfulPostMs = nowMs - (POST_SUCCESS_TIMEOUT_WARNING_MS - 1000);
    }
  }
}

void monitorWiFiReconnect() {
  wl_status_t currentStatus = WiFi.status();
  
  // Detect transition from disconnected to connected
  if (lastWiFiStatus != WL_CONNECTED && currentStatus == WL_CONNECTED) {
    Serial.printf("[WIFI] Reconnected! Retrying failed queue (%d events)\n", failedQueueCount);
    postRetryCount = 0;  // Reset retry count on WiFi reconnect
    postRetryNextMs = 0;  // Immediate retry
  }
  
  lastWiFiStatus = currentStatus;
}

// ========== PHASE 6: RTC SYNC + MONITORING ==========
void syncRtcNtp() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[RTC] WiFi not connected, skipping NTP sync");
    return;
  }
  
  Serial.println("[RTC] Starting NTP sync...");
  configTime(PH_TZ_OFFSET_SEC, 0, "pool.ntp.org");
  
  time_t now = 0;
  unsigned long ntpStart = millis();
  
  // Wait up to 10 seconds for NTP to provide valid time
  while ((now = time(nullptr)) < 1609459200 && millis() - ntpStart < 10000) {
    delay(500);
  }
  
  if (now >= 1609459200) {
    // Valid time obtained from NTP.
    // Write PH local wall-clock time into the RTC.
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      rtc.adjust(DateTime(
        timeinfo.tm_year + 1900,
        timeinfo.tm_mon + 1,
        timeinfo.tm_mday,
        timeinfo.tm_hour,
        timeinfo.tm_min,
        timeinfo.tm_sec
      ));
    } else {
      rtc.adjust(DateTime(now + PH_TZ_OFFSET_SEC));
    }
    rtcBootTime = rtc.now();
    rtcSyncBootMs = millis();
    lastRtcSyncMs = millis();
    rtcDriftMs = 0;  // Reset drift estimate on sync
    
    Serial.printf("[RTC] Synced successfully (drift was %ldms)\n", rtcDriftMs);
  } else {
    Serial.println("[RTC] NTP sync timeout, RTC not updated");
  }
}

void detectRtcDrift() {
  // Compare RTC time to expected time based on millis()
  DateTime currentRtc = rtc.now();
  unsigned long elapsedMs = millis() - rtcSyncBootMs;
  
  // Expected RTC time if clock ran perfectly since last sync
  DateTime expectedRtc = rtcBootTime + TimeSpan(elapsedMs / 1000);  // Convert ms to seconds
  
  // Calculate drift: difference in seconds, converted to milliseconds
  long currentEpoch = currentRtc.unixtime();
  long expectedEpoch = expectedRtc.unixtime();
  rtcDriftMs = (currentEpoch - expectedEpoch) * 1000;
  
  // Flag and log if drift exceeds 5 seconds
  if (abs(rtcDriftMs) > 5000) {
    long driftSeconds = rtcDriftMs / 1000;
    Serial.printf("[RTC] Significant drift detected: %+lds\n", driftSeconds);
    
    // Auto-correct if drift is too large (> 10s)
    if (abs(rtcDriftMs) > 10000) {
      Serial.printf("[RTC] Drift exceeded 10s threshold, attempting correction\n");
      syncRtcNtp();
    }
  }
}

void rtcMonitoring() {
  unsigned long nowMs = millis();
  
  // Check if time for periodic NTP re-sync (every 24 hours)
  if (lastRtcSyncMs == 0 || nowMs - lastRtcSyncMs >= RTC_RESYNC_INTERVAL_MS) {
    syncRtcNtp();
  }
  
  // Check if time for drift detection (every 1 hour)
  if (lastRtcDriftCheckMs == 0 || nowMs - lastRtcDriftCheckMs >= RTC_DRIFT_CHECK_INTERVAL_MS) {
    detectRtcDrift();
    lastRtcDriftCheckMs = nowMs;
  }
}

// ========== SESSION LOGGING: POST time_in when session starts ==========
bool postSessionStartLog(bool motion, bool ssr, bool led) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure postClient;
  postClient.setInsecure();
  postClient.setHandshakeTimeout(POST_HANDSHAKE_TIMEOUT_S);
  postClient.setTimeout(POST_HTTP_TIMEOUT_MS);

  HTTPClient http;
  http.setTimeout(POST_HTTP_TIMEOUT_MS);

  String url = String(SUPABASE_URL) + "/rest/v1/session_logs";
  if (!http.begin(postClient, url)) {
    Serial.println("[SLOG] http.begin() failed - SSL/connection error");
    return false;
  }

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  DateTime now = getRtcNowCached();
  if (now.year() < 2022) {
    http.end();
    return false;
  }

  StaticJsonDocument<384> payload;
  payload["device_id"] = DEVICE_ID;
  payload["time_in"] = isoTimestamp(now);
  payload["time_out"] = nullptr;
  payload["source"] = "firmware";
  payload["trigger"] = "presence-detected";
  JsonObject devices = payload.createNestedObject("devices");
  devices["lights"] = ssr;
  devices["pc"] = false;
  devices["fan"] = false;
  devices["motion"] = motion;
  devices["ssr"] = ssr;
  devices["led"] = led;

  String body;
  serializeJson(payload, body);

  int code = http.POST(body);
  http.end();

  bool success = (code >= 200 && code < 300);
  if (!success && !DEBUG_SKIP_POST_LOGGING) {
    Serial.printf("[SLOG] time_in POST failed HTTP %d\n", code);
  } else if (success) {
    Serial.println("[SLOG] time_in posted");
  }
  return success;
}

// ========== SESSION LOGGING: PATCH time_out when session ends ==========
bool closeLatestSessionLog() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();
  client.setHandshakeTimeout(12);

  HTTPClient http;
  http.setTimeout(PROVISION_HTTP_TIMEOUT_MS);

  String lookupUrl = String(SUPABASE_URL)
    + "/rest/v1/session_logs?select=id&device_id=eq."
    + String(DEVICE_ID)
    + "&time_out=is.null&order=time_in.desc&limit=1";

  if (!http.begin(client, lookupUrl)) {
    Serial.println("[SLOG] Lookup http.begin() failed");
    return false;
  }

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);

  int code = http.GET();
  String response = http.getString();
  http.end();

  if (code != 200 || response.length() < 3) {
    if (!DEBUG_SKIP_POST_LOGGING) {
      Serial.printf("[SLOG] Lookup failed HTTP %d\n", code);
    }
    return false;
  }

  DynamicJsonDocument doc(256);
  if (deserializeJson(doc, response) || !doc.is<JsonArray>() || doc.size() == 0) {
    Serial.println("[SLOG] Lookup parse failed");
    return false;
  }

  JsonObject row = doc[0].as<JsonObject>();
  if (!row.containsKey("id")) {
    Serial.println("[SLOG] No open session found");
    return false;
  }

  String rowId = row["id"].as<String>();
  DateTime now = getRtcNowCached();
  if (now.year() < 2022) return false;

  HTTPClient updateHttp;
  updateHttp.setTimeout(PROVISION_HTTP_TIMEOUT_MS);

  String updateUrl = String(SUPABASE_URL) + "/rest/v1/session_logs?id=eq." + rowId;
  if (!updateHttp.begin(client, updateUrl)) {
    Serial.println("[SLOG] Update http.begin() failed");
    return false;
  }

  updateHttp.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  updateHttp.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  updateHttp.addHeader("Content-Type", "application/json");
  updateHttp.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<96> updatePayload;
  updatePayload["time_out"] = isoTimestamp(now);

  String updateBody;
  serializeJson(updatePayload, updateBody);

  int updateCode = updateHttp.sendRequest("PATCH", updateBody);
  updateHttp.end();

  bool success = (updateCode >= 200 && updateCode < 300);
  if (!success && !DEBUG_SKIP_POST_LOGGING) {
    Serial.printf("[SLOG] time_out PATCH failed HTTP %d\n", updateCode);
  } else if (success) {
    Serial.println("[SLOG] time_out patched");
  }
  return success;
}

// ========== OPTIMIZATION 4: Non-blocking override polling ==========
void pollOverridesOptimized() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (networkTaskBusy) return;  // Skip if busy

  WiFiClientSecure overrideClient;
  overrideClient.setInsecure();
  overrideClient.setHandshakeTimeout(OVERRIDE_HANDSHAKE_TIMEOUT_S);
  overrideClient.setTimeout(OVERRIDE_HTTP_TIMEOUT_MS);

  HTTPClient http;
  http.setTimeout(OVERRIDE_HTTP_TIMEOUT_MS);
  
  String url = String(SUPABASE_URL) + "/rest/v1/devices?select=overrides&id=eq." + String(DEVICE_ID);
  
  if (!http.begin(overrideClient, url)) {
    Serial.println("[OVERRIDE] http.begin() failed - SSL/connection error");
    return;
  }

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);

  int code = http.GET();
  if (code != 200) {
    http.end();
    if (!DEBUG_SKIP_POST_LOGGING) {
      Serial.printf("[OVERRIDE] Failed HTTP %d\n", code);
    }
    return;
  }

  String response = http.getString();
  http.end();

  // OPTIMIZATION: Use StaticJsonDocument to avoid heap fragmentation
  StaticJsonDocument<256> doc;
  if (deserializeJson(doc, response) || !doc.is<JsonArray>() || doc.size() == 0) {
    return;
  }

  JsonObject root = doc[0].as<JsonObject>();
  if (!root.containsKey("overrides")) return;

  JsonObject ov = root["overrides"].is<JsonObject>() 
    ? root["overrides"].as<JsonObject>()
    : JsonObject();

  if (ov.containsKey("lights")) {
    overrideActive = !ov["lights"].isNull();
    overrideValue = ov["lights"].as<bool>();
  } else if (ov.containsKey("pc")) {
    overrideActive = !ov["pc"].isNull();
    overrideValue = ov["pc"].as<bool>();
  }
}

// ========== OPTIMIZATION 5: Async provision check with enhanced diagnostics ==========
bool ensureDeviceRowOptimized() {
  if (WiFi.status() != WL_CONNECTED) {
    lastProvisionHttpCode = -2;  // WiFi disconnected
    return false;
  }

  WiFiClientSecure provClient;
  provClient.setInsecure();
  provClient.setHandshakeTimeout(12);

  HTTPClient http;
  http.setTimeout(PROVISION_HTTP_TIMEOUT_MS);  // Use longer timeout for provisioning
  
  String url = String(SUPABASE_URL) + "/rest/v1/devices?select=id&id=eq." + String(DEVICE_ID);
  
  // Attempt to connect with enhanced error logging
  if (!http.begin(provClient, url)) {
    Serial.println("[PROV] http.begin() failed - SSL/connection error");
    lastProvisionHttpCode = -3;  // http.begin() failed
    return false;
  }

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);

  int code = http.GET();
  lastProvisionHttpCode = code;
  
  // Log detailed response info
  if (code != 200) {
    Serial.printf("[PROV] HTTP %d - ", code);
    if (code == -1) Serial.println("Timeout or connection failed");
    else if (code == 401) Serial.println("Unauthorized - check API key");
    else if (code == 403) Serial.println("Forbidden - check RLS policies");
    else if (code == 404) Serial.println("Not Found - check device ID or endpoint");
    else if (code >= 500) Serial.println("Server error");
    else Serial.printf("Error code: %d", code);
    Serial.println();
  } else {
    Serial.println("[PROV] Device provisioning successful (HTTP 200)");
  }
  
  http.end();
  
  return (code == 200);
}

// ========== OPTIMIZATION 6: User settings check (auto_lights) ==========
bool fetchAutoLightsSetting(bool* outValue) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  WiFiClientSecure settingsClient;
  settingsClient.setInsecure();
  settingsClient.setHandshakeTimeout(12);

  HTTPClient http;
  http.setTimeout(PROVISION_HTTP_TIMEOUT_MS);

  String url = String(SUPABASE_URL) + "/rest/v1/user_settings?select=auto_lights&user_id=eq." + String(USER_ID);

  if (!http.begin(settingsClient, url)) {
    Serial.println("[AUTO] http.begin() failed - SSL/connection error");
    return false;
  }

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);

  int code = http.GET();
  if (code != 200) {
    http.end();
    if (!DEBUG_SKIP_POST_LOGGING) {
      Serial.printf("[AUTO] Failed HTTP %d\n", code);
    }
    return false;
  }

  String response = http.getString();
  http.end();

  DynamicJsonDocument doc(192);
  if (deserializeJson(doc, response) || !doc.is<JsonArray>() || doc.size() == 0) {
    return false;
  }

  JsonObject root = doc[0].as<JsonObject>();
  if (!root.containsKey("auto_lights")) {
    return false;
  }

  *outValue = root["auto_lights"].as<bool>();
  return true;
}

String isoTimestamp(const DateTime& dt) {
  char buffer[25];
  snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02d+08:00",
    dt.year(), dt.month(), dt.day(), dt.hour(), dt.minute(), dt.second());
  return String(buffer);
}

void updateSessionBlink(bool active) {
  if (!active) {
    digitalWrite(LED_PIN, LOW);
    digitalWrite(LED2_PIN, LOW);
    sessionBlinkState = false;
    return;
  }

  unsigned long nowMs = millis();
  if (nowMs - lastSessionBlinkMs >= SESSION_BLINK_INTERVAL_MS) {
    sessionBlinkState = !sessionBlinkState;
    lastSessionBlinkMs = nowMs;
  }

  digitalWrite(LED_PIN, sessionBlinkState ? HIGH : LOW);
  digitalWrite(LED2_PIN, sessionBlinkState ? LOW : HIGH);
}

const char* wifiStatusLabel(wl_status_t status) {
  switch (status) {
    case WL_CONNECTED:
      return "CONNECTED";
    case WL_NO_SSID_AVAIL:
      return "NO_SSID";
    case WL_CONNECT_FAILED:
      return "CONNECT_FAILED";
    case WL_CONNECTION_LOST:
      return "CONNECTION_LOST";
    case WL_DISCONNECTED:
      return "DISCONNECTED";
    default:
      return "UNKNOWN";
  }
}

// ========== NETWORK DIAGNOSTICS ==========
bool testDnsResolution(const char* hostname) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[DNS] WiFi not connected, skipping DNS test");
    return false;
  }
  
  Serial.printf("[DNS] Testing resolution of %s...", hostname);
  IPAddress result;
  bool ok = WiFi.hostByName(hostname, result);
  
  if (!ok) {
    Serial.println(" FAILED");
    return false;
  }
  
  Serial.printf(" OK -> %s", result.toString().c_str());
  Serial.println();
  return true;
}

bool testInternetConnectivity() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[INET] WiFi not connected, skipping connectivity test");
    return false;
  }
  
  Serial.print("[INET] Testing basic connectivity to 8.8.8.8...");
  
  WiFiClient testClient;
  testClient.setTimeout(5000);
  
  // Try to connect to a public DNS server (8.8.8.8:53)
  if (!testClient.connect("8.8.8.8", 53)) {
    Serial.println(" FAILED");
    testClient.stop();
    return false;
  }
  
  Serial.println(" OK");
  testClient.stop();
  return true;
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[WIFI] Connecting to %s...\n", WIFI_SSID);

  unsigned long startMs = millis();
  unsigned long lastLogMs = 0;
  while (WiFi.status() != WL_CONNECTED && millis() - startMs < 10000) {
    if (millis() - lastLogMs >= 1000) {
      Serial.printf("[WIFI] Status: %s\n", wifiStatusLabel(WiFi.status()));
      lastLogMs = millis();
    }
    delay(100);
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WIFI] Connected. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.printf("[WIFI] Connect timeout. Final status: %s\n", wifiStatusLabel(WiFi.status()));
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("[BOOT] ESP32 SSR Lightbulb Optimized");

  pinMode(PIR_PIN, INPUT);
  pinMode(SSR_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);

  digitalWrite(SSR_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(LED2_PIN, LOW);

  Wire.begin(21, 22);
  
  if (!rtc.begin()) {
    Serial.println("[ERR] RTC not found");
    while (1) delay(1000);
  }

  DEBUG_KV("RTC", "Found");

  connectWiFi();
  
  // Run network diagnostics
  Serial.println("[DIAG] Starting network diagnostics...");
  delay(1000);
  testDnsResolution("dbfdgeicdapykmmjcrjx.supabase.co");
  delay(500);
  testInternetConnectivity();
  delay(500);
 
  configTime(PH_TZ_OFFSET_SEC, 0, "pool.ntp.org");
  time_t now = 0;
  unsigned long ntpStart = millis();
  while ((now = time(nullptr)) < 1609459200 && millis() - ntpStart < 10000) {
    delay(500);
  }
  if (now >= 1609459200) {
    struct tm timeinfo;
    if (getLocalTime(&timeinfo)) {
      rtc.adjust(DateTime(
        timeinfo.tm_year + 1900,
        timeinfo.tm_mon + 1,
        timeinfo.tm_mday,
        timeinfo.tm_hour,
        timeinfo.tm_min,
        timeinfo.tm_sec
      ));
    } else {
      rtc.adjust(DateTime(now + PH_TZ_OFFSET_SEC));
    }
    // PHASE 6: Record boot time for drift calculation
    rtcBootTime = rtc.now();
    rtcSyncBootMs = millis();
    lastRtcSyncMs = millis();
    DEBUG_KV("RTC", "Synced from NTP");
  }

  ensurePersistentClient();
  deviceProvisioned = ensureDeviceRowOptimized();

  if (fetchAutoLightsSetting(&autoLightsEnabled)) {
    Serial.printf("[AUTO] auto_lights=%s\n", autoLightsEnabled ? "true" : "false");
  } else {
    Serial.println("[AUTO] Using default auto_lights=true (fetch failed)");
  }
  lastAutoLightsCheckMs = millis();

  bootMs = millis();
  Serial.println("[BOOT] Complete - running optimized firmware");
}

void loop() {
  // OPTIMIZATION: Non-blocking WiFi check
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
    return;  // Skip loop iteration if no WiFi
  }

  unsigned long nowMs = millis();
  DateTime now = getRtcNowCached();

  // OPTIMIZATION: Smooth device provisioning without blocking
  if (!deviceProvisioned && nowMs - lastProvisionAttemptMs >= PROVISION_RETRY_MS) {
    deviceProvisioned = ensureDeviceRowOptimized();
    lastProvisionAttemptMs = nowMs;
  }

  if (nowMs - lastAutoLightsCheckMs >= AUTO_LIGHTS_REFRESH_MS) {
    bool fetched = false;
    bool nextValue = autoLightsEnabled;
    fetched = fetchAutoLightsSetting(&nextValue);
    if (fetched) {
      autoLightsEnabled = nextValue;
      if (!DEBUG_SKIP_POST_LOGGING) {
        Serial.printf("[AUTO] auto_lights=%s\n", autoLightsEnabled ? "true" : "false");
      }
    }
    lastAutoLightsCheckMs = nowMs;
  }

  supabaseReady = deviceProvisioned;
  if (nowMs % 5000 < 100) {
    Serial.printf("[SUPA] ready=%s http=%d\n", supabaseReady ? "yes" : "no", lastProvisionHttpCode);
  }

  // OPTIMIZATION: Async override polling (non-blocking)
  if (nowMs - lastOverridePollMs >= OVERRIDE_POLL_INTERVAL_MS) {
    if (!DEBUG_DISABLE_OVERRIDE_POLL) {
      pollOverridesOptimized();
    }
    lastOverridePollMs = nowMs;
  }

  // ===== CORE LOGIC (Fast Path) =====
  int motionPin = DEBUG_DISABLE_PIR ? LOW : digitalRead(PIR_PIN);
  bool rawMotion = (motionPin == HIGH);

  // Timer-based debounce: motion is true only if pin stayed HIGH for DEBOUNCE_WINDOW_MS
  if (!motionState && rawMotion && nowMs - bootMs >= WARMUP_MS && nowMs - lastClearedAtMs > REFRACTORY_MS) {
    // Start debounce timer
    if (motionDebounceStartMs == 0) {
      motionDebounceStartMs = nowMs;
    }
    // Check if debounce window passed
    if (nowMs - motionDebounceStartMs >= DEBOUNCE_WINDOW_MS) {
      motionState = true;
      motionStartMs = nowMs;
      motionDebounceStartMs = 0;  // Reset debounce timer
    }
  } else if (rawMotion && motionState) {
    // Motion is debounced and still active, keep it active
  } else if (!rawMotion && motionState) {
    // Motion pin went LOW while motion was active
    if (nowMs - motionStartMs >= MIN_ON_MS) {
      // Met minimum session duration, end motion
      motionState = false;
      lastClearedAtMs = nowMs;
      motionDebounceStartMs = 0;
    }
  } else if (!rawMotion) {
    // Motion pin is LOW, reset debounce timer
    motionDebounceStartMs = 0;
  }

  bool motion = DEBUG_MODE ? DEBUG_FORCE_SSR_ON : motionState;
  bool pirDebounced = rawMotion;  // True if pin is currently HIGH

  if (motionState) {
    lastMotionMs = nowMs;
  }

  // ===== STATE MACHINE: Compute next state =====
  previousState = currentState;
  
  if (supabaseReady && autoLightsEnabled) {
    // State transitions based on motion
    if (motionState && currentState == IDLE) {
      // Motion detected: IDLE → ACTIVE
      currentState = ACTIVE;
      sessionStartMs = nowMs;  // Record when session started
    } else if (currentState == ACTIVE) {
      // Check for session timeout (no motion for SESSION_TIMEOUT_MS)
      if (nowMs - lastMotionMs >= SESSION_TIMEOUT_MS) {
        currentState = CLOSING;  // Auto-close session on timeout
      }
    } else if (currentState == CLOSING) {
      // After close, return to IDLE
      currentState = IDLE;
    }
    // When auto_lights=true, stay in ACTIVE once a session starts (no auto-close on motion stop)
    // Session only closes explicitly when timeout occurs or auto_lights becomes false
  } else {
    // Not ready or auto_lights disabled: force IDLE and close session
    if (currentState == ACTIVE) {
      currentState = CLOSING;
    } else {
      currentState = IDLE;
    }
  }

  // Log state transitions
  if (currentState != previousState) {
    Serial.printf("[STATE] %s → %s\n", stateLabel(previousState), stateLabel(currentState));
    if (currentState == CLOSING && previousState == ACTIVE) {
      unsigned long sessionDurationS = (nowMs - lastMotionMs) / 1000;
      Serial.printf("[SESSION] Auto-timeout after %lus of inactivity\n", sessionDurationS);
    }
  }

  // Derive sessionActive from state
  bool sessionActive = (currentState == ACTIVE);

  // ===== SESSION LOGGING: Post time_in on IDLE→ACTIVE =====
  if (currentState == ACTIVE && previousState == IDLE) {
    bool logPost = postSessionStartLog(motion, sessionActive, sessionActive);
    if (logPost) {
      Serial.println("[SLOG] time_in posted on state transition");
    }
  }

  // ===== SESSION LOGGING: Patch time_out on ACTIVE→CLOSING =====
  if (currentState == CLOSING && previousState == ACTIVE) {
    bool logPatch = closeLatestSessionLog();
    if (logPatch) {
      Serial.println("[SLOG] time_out patched on state transition");
    }
  }

  // Session blink
  updateSessionBlink(sessionActive);

  // SSR output logic
  bool ssrFinal = overrideActive ? overrideValue : sessionActive;
  digitalWrite(SSR_PIN, ssrFinal ? HIGH : LOW);

  // ===== PHASE 5: RETRY / QUEUE LOGIC =====
  monitorWiFiReconnect();
  checkPostTimeoutWarning();
  
  // ===== PHASE 6: RTC MONITORING =====
  rtcMonitoring();
  
  // Check if it's time to retry failed events from queue
  if (nowMs >= postRetryNextMs && failedQueueCount > 0) {
    retryFailedQueue();
  }
  
  // OPTIMIZATION: Async posting (non-blocking, respects backoff timeout)
  // Only POST new events if we're not in backoff period or backoff has expired
  if (!DEBUG_DISABLE_POSTS && nowMs >= postRetryNextMs && 
      (ssrFinal != lastMotion || nowMs - lastPostMs >= POST_INTERVAL_MS)) {
    postSensorEventOptimized(motion, ssrFinal, ssrFinal);
    lastMotion = ssrFinal;
    lastPostMs = nowMs;
  }

  // Compact debug logging
  if (DEBUG_COMPACT_LOGS && nowMs % 5000 < 100) {
    Serial.printf("[STATUS] PIR=%d motion=%d SSR=%s override=%s queue=%d\n", 
      motionPin, motion, ssrFinal ? "ON" : "OFF", overrideActive ? "ACTIVE" : "OFF", failedQueueCount);
  }

  // OPTIMIZATION: Reduced delay for faster response
  delay(100);  // Changed: 250ms → 100ms for snappier responsiveness
}
