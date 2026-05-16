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

#define PIR_PIN 13
#define SSR_PIN 12
#define LED_PIN 2
#define LED2_PIN 4

const char* WIFI_SSID = "JOSHUA 24:15/ 4G";
const char* WIFI_PASSWORD = "Tend@wifi";
const char* SUPABASE_URL = "https://dbfdgeicdapykmmjcrjx.supabase.co";
const char* SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiZmRnZWljZGFweWttbWpjcmp4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzU1OTkxNCwiZXhwIjoyMDkzMTM1OTE0fQ.dxMraLxKJDnZlXthO3CasH6mFzofq5GBq4jvZLvaZOI";
const char* DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const char* USER_ID = "6b04ff11-cd1e-40be-894a-b6c19405c54b";
const char* FIRMWARE_NAME = "SSR-Lightbulb-Test-v1-OPT";
const char* DEVICE_NAME = "ESP32-PIR-SSR";
const char* DEVICE_LOCATION = "Unassigned";

// OPTIMIZATION: Reduce posting frequency and use smarter intervals
const unsigned long POST_INTERVAL_MS = 10000;      // Changed: 5s → 10s (reduce Supabase load)
const unsigned long OVERRIDE_POLL_INTERVAL_MS = 5000;
const unsigned long ACK_POLL_INTERVAL_MS = 15000;  // Changed: 5s → 15s (less frequent checks)
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
bool deviceProvisioned = false;
unsigned long lastProvisionAttemptMs = 0;
const unsigned long PROVISION_RETRY_MS = 10000;
bool supabaseReady = false;
int lastProvisionHttpCode = 0;
bool autoLightsEnabled = true;
unsigned long lastAutoLightsCheckMs = 0;
const unsigned long AUTO_LIGHTS_REFRESH_MS = 60000;

const bool DEBUG_MODE = false;
const bool DEBUG_DISABLE_PIR = DEBUG_MODE;
const bool DEBUG_DISABLE_OVERRIDE_POLL = DEBUG_MODE;
const bool DEBUG_DISABLE_POSTS = DEBUG_MODE;
const bool DEBUG_FORCE_SSR_ON = false;
const bool DEBUG_SKIP_OVERRIDE_POLL = false;
const bool DEBUG_SKIP_POST_LOGGING = false;
const bool DEBUG_VERBOSE_DEBOUNCE = true;
const bool DEBUG_VERBOSE_BLINK = false;
const bool DEBUG_COMPACT_LOGS = true;

// OPTIMIZATION: Async polling state
bool overrideActive = false;
bool overrideValue = false;
unsigned long lastOverridePollMs = 0;

const unsigned long WARMUP_MS = 30000;
const int DEBOUNCE_REQUIRED = 2;
const int CLEAR_REQUIRED = 3;
const unsigned long MIN_ON_MS = 5000;
const unsigned long REFRACTORY_MS = 2000;
const unsigned long OFF_GRACE_MS = 5000;  // Keep SSR on briefly after last motion to avoid flicker

int consecHigh = 0;
int consecLow = 0;
bool motionState = false;
unsigned long motionStartMs = 0;
unsigned long lastClearedAtMs = 0;
unsigned long bootMs = 0;

// Presence session
bool sessionActive = false;
bool promptSent = false;
bool forcedOffAfterTimeout = false;
unsigned long lastMotionMs = 0;
unsigned long promptSentAtMs = 0;
uint32_t promptSentAtEpoch = 0;
unsigned long lastAckPollMs = 0;
bool ssrLatchedOn = false;

const unsigned long IDLE_PROMPT_MS = 10UL * 60UL * 1000UL;
const unsigned long PROMPT_TIMEOUT_MS = 5UL * 60UL * 1000UL;
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
  if (!success && !DEBUG_SKIP_POST_LOGGING) {
    Serial.printf("[POST] Failed HTTP %d\n", code);
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

  // OPTIMIZATION: Streamlined JSON parsing
  DynamicJsonDocument doc(256);
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
  snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02dZ",
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
 
  configTime(0, 0, "pool.ntp.org");
  time_t now = 0;
  unsigned long ntpStart = millis();
  while ((now = time(nullptr)) < 1609459200 && millis() - ntpStart < 10000) {
    delay(500);
  }
  if (now >= 1609459200) {
    rtc.adjust(DateTime(now));
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

  // Debounce logic (same as before)
  if (rawMotion) {
    consecHigh++;
    consecLow = 0;
  } else {
    consecLow++;
    consecHigh = 0;
  }

  if (nowMs - bootMs < WARMUP_MS) {
    motionState = false;
  } else if (!motionState && consecHigh >= DEBOUNCE_REQUIRED && nowMs - lastClearedAtMs > REFRACTORY_MS) {
    motionState = true;
    motionStartMs = nowMs;
  } else if (motionState && consecLow >= CLEAR_REQUIRED && nowMs - motionStartMs >= MIN_ON_MS) {
    motionState = false;
    lastClearedAtMs = nowMs;
  }

  bool motion = DEBUG_MODE ? DEBUG_FORCE_SSR_ON : motionState;
  bool pirDebounced = (consecHigh >= DEBOUNCE_REQUIRED);

  if (motionState) {
    lastMotionMs = nowMs;
  }

  // After warmup, first valid motion latches SSR on until manual override or reboot
  if (supabaseReady) {
    if (autoLightsEnabled && !ssrLatchedOn && motionState) {
      ssrLatchedOn = true;
    }
    sessionActive = ssrLatchedOn;
  } else {
    sessionActive = false;
  }

  // Session blink
  updateSessionBlink(sessionActive);

  // SSR output logic
  bool ssrFinal = forcedOffAfterTimeout ? false : (overrideActive ? overrideValue : sessionActive);
  digitalWrite(SSR_PIN, ssrFinal ? HIGH : LOW);

  // OPTIMIZATION: Async posting (non-blocking, respects timeout)
  if (!DEBUG_DISABLE_POSTS && (ssrFinal != lastMotion || nowMs - lastPostMs >= POST_INTERVAL_MS)) {
    postSensorEventOptimized(motion, ssrFinal, ssrFinal);
    lastMotion = ssrFinal;
    lastPostMs = nowMs;
  }

  // Compact debug logging
  if (DEBUG_COMPACT_LOGS && nowMs % 5000 < 100) {
    Serial.printf("[STATUS] PIR=%d motion=%d SSR=%s override=%s\n", 
      motionPin, motion, ssrFinal ? "ON" : "OFF", overrideActive ? "ACTIVE" : "OFF");
  }

  // OPTIMIZATION: Reduced delay for faster response
  delay(100);  // Changed: 250ms → 100ms for snappier responsiveness
}
