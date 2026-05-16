/*
  ESP32 + PIR + SSR + LED -> Supabase sensor_events

  What it does:
  - Reads PIR motion on GPIO 13
  - Drives SSR on GPIO 12 and LED on GPIO 2
  - Posts each state change / loop sample to Supabase sensor_events

  ===== PIN CONFIGURATION =====
  
  PIR Motion Sensor
  OUT → GPIO 13
  VCC → 3.3V
  GND → GND
  
  SSR (Solid State Relay) - Controls Lightbulb
  IN → GPIO 12
  GND → GND
  
  LED (Status Indicator)
  + → GPIO 2
  - → GND
  
  RTC DS3231 (Real-Time Clock, I2C)
  SDA → GPIO 21
  SCL → GPIO 22
  VCC → 3.3V
  GND → GND
  
  ================================
  
  Libraries needed:
  - WiFi (built-in on ESP32)
  - HTTPClient (built-in on ESP32)
  - WiFiClientSecure (built-in on ESP32)
  - RTClib (install via Library Manager)
  - ArduinoJson (install via Library Manager)
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

// Supabase project URL (NO /rest/v1 at the end)
const char* SUPABASE_URL = "https://dbfdgeicdapykmmjcrjx.supabase.co";
// Firmware uses a service role key to satisfy RLS for inserts and override reads.
// Do not commit a real service role key to version control.
const char* SUPABASE_SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiZmRnZWljZGFweWttbWpjcmp4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzU1OTkxNCwiZXhwIjoyMDkzMTM1OTE0fQ.dxMraLxKJDnZlXthO3CasH6mFzofq5GBq4jvZLvaZOI";

// Must be a UUID that exists in your devices table
const char* DEVICE_ID = "550e8400-e29b-41d4-a716-446655440000";
const char* FIRMWARE_NAME = "SSR-Lightbulb-Test-v1";
const char* DEVICE_NAME = "ESP32-PIR-SSR";
const char* DEVICE_LOCATION = "Unassigned";
const unsigned long PROVISION_RETRY_MS = 10000;
unsigned long lastProvisionAttemptMs = 0;
bool deviceProvisioned = false;

unsigned long lastPostMs = 0;
const unsigned long POST_INTERVAL_MS = 5000;
bool lastMotion = false;
unsigned long lastLoopLogMs = 0;
const unsigned long LOOP_LOG_INTERVAL_MS = 5000;

// Master debug switch:
// - true  = disable PIR, override polling, and POSTs for safe local testing
// - false = normal behavior
const bool DEBUG_MODE = false;
const bool DEBUG_DISABLE_PIR = DEBUG_MODE;
const bool DEBUG_DISABLE_OVERRIDE_POLL = DEBUG_MODE;
const bool DEBUG_DISABLE_POSTS = DEBUG_MODE;
const bool DEBUG_FORCE_SSR_ON = false;

// Standalone debug flags (independent of DEBUG_MODE)
const bool DEBUG_SKIP_OVERRIDE_POLL = false; // set to true to disable polling and focus on PIR debugging
const bool DEBUG_SKIP_POST_LOGGING = true; // set to true to disable verbose POST logging during debug
const bool DEBUG_VERBOSE_DEBOUNCE = true; // set to true to see raw PIR debounce counter values
const bool DEBUG_VERBOSE_BLINK = false; // set to true to see blink sequence logs
const bool DEBUG_COMPACT_LOGS = true; // set to true for one-line loop status logs

// Override polling
unsigned long lastOverridePollMs = 0;
const unsigned long OVERRIDE_POLL_INTERVAL_MS = 1000; // poll every 1 second for near real-time feel
bool overrideActive = false; // true = force SSR to overrideValue
bool overrideValue = false; // true = force ON, false = force OFF

// Firmware debounce and timing
const unsigned long WARMUP_MS = 30000; // ignore triggers during first 30s
const int DEBOUNCE_REQUIRED = 2;      // consecutive HIGHs to confirm motion
const int CLEAR_REQUIRED = 3;         // consecutive LOWs to clear
const unsigned long MIN_ON_MS = 5000; // keep SSR ON at least 5s
const unsigned long REFRACTORY_MS = 2000; // ignore new triggers after clearing

// Presence session timing
const unsigned long IDLE_PROMPT_MS = 10UL * 60UL * 1000UL; // 10 minutes idle before prompt
const unsigned long PROMPT_TIMEOUT_MS = 5UL * 60UL * 1000UL; // 5 minutes to acknowledge
const unsigned long ACK_POLL_INTERVAL_MS = 5000;

int consecHigh = 0;
int consecLow = 0;
bool motionState = false; // debounced motion state
unsigned long motionStartMs = 0;
unsigned long lastClearedAtMs = 0;
unsigned long bootMs = 0;

// Presence session state
bool sessionActive = false;
bool promptSent = false;
bool forcedOffAfterTimeout = false;
unsigned long lastMotionMs = 0;
unsigned long promptSentAtMs = 0;
uint32_t promptSentAtEpoch = 0;
unsigned long lastAckPollMs = 0;

// Session indicator blink
const unsigned long SESSION_BLINK_INTERVAL_MS = 300;
bool sessionBlinkState = false;
unsigned long lastSessionBlinkMs = 0;

void debugSection(const String& label) {
  Serial.println();
  Serial.println(String("========== ") + label + String(" =========="));
}

void debugKeyValue(const String& key, const String& value) {
  Serial.print("[DEBUG][");
  Serial.print(millis());
  Serial.print("ms] ");
  Serial.print(key);
  Serial.print(": ");
  Serial.println(value);
}

void debugStatusLine(const DateTime& now, bool motion, bool pirDebounced, int motionPin, bool ssrFinal) {
  Serial.print("[STATUS] ");
  Serial.print(now.hour());
  Serial.print(":");
  Serial.print(now.minute());
  Serial.print(":");
  Serial.print(now.second());
  Serial.print(" | PIR=");
  Serial.print(motionPin);
  Serial.print(" deb=");
  Serial.print(pirDebounced ? "1" : "0");
  Serial.print(" motion=");
  Serial.print(motion ? "1" : "0");
  Serial.print(" override=");
  Serial.print(overrideActive ? (overrideValue ? "ON" : "OFF") : "NONE");
  Serial.print(" ssr=");
  Serial.println(ssrFinal ? "ON" : "OFF");
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

String isoTimestamp(const DateTime& dt) {
  char buffer[25];
  snprintf(
    buffer,
    sizeof(buffer),
    "%04d-%02d-%02dT%02d:%02d:%02dZ",
    dt.year(), dt.month(), dt.day(), dt.hour(), dt.minute(), dt.second()
  );
  return String(buffer);
}

bool parseIsoToEpoch(const String& iso, uint32_t* outEpoch) {
  if (iso.length() < 19 || outEpoch == nullptr) return false;
  int year = iso.substring(0, 4).toInt();
  int month = iso.substring(5, 7).toInt();
  int day = iso.substring(8, 10).toInt();
  int hour = iso.substring(11, 13).toInt();
  int minute = iso.substring(14, 16).toInt();
  int second = iso.substring(17, 19).toInt();
  if (year < 2022 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  DateTime dt(year, month, day, hour, minute, second);
  *outEpoch = dt.unixtime();
  return true;
}

void connectWiFi() {
  debugSection("WIFI CONNECT");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  debugKeyValue("SSID", WIFI_SSID);
  Serial.print("[WIFI] Connecting");
  unsigned long startMs = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startMs < 15000) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    debugKeyValue("Status", "Connected");
    debugKeyValue("Local IP", WiFi.localIP().toString());
    debugKeyValue("Signal (RSSI)", String(WiFi.RSSI()) + " dBm");
  } else {
    debugKeyValue("Status", "Connect timeout");
  }
}

bool ensureDeviceRow(bool forceUpdate) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String lookupUrl = String(SUPABASE_URL)
    + "/rest/v1/devices?select=id&id=eq."
    + String(DEVICE_ID)
    + "&limit=1";

  if (!http.begin(client, lookupUrl)) return false;

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Content-Type", "application/json");

  int code = http.GET();
  String response = http.getString();
  http.end();

  if (code == 200 && response.length() > 2) {
    if (!forceUpdate) {
      return true; // row exists
    }

    HTTPClient updateHttp;
    String updateUrl = String(SUPABASE_URL) + "/rest/v1/devices?id=eq." + String(DEVICE_ID);
    if (!updateHttp.begin(client, updateUrl)) return true;

    updateHttp.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
    updateHttp.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
    updateHttp.addHeader("Content-Type", "application/json");
    updateHttp.addHeader("Prefer", "return=minimal");

    StaticJsonDocument<256> updatePayload;
    updatePayload["name"] = DEVICE_NAME;
    updatePayload["location"] = DEVICE_LOCATION;
    updatePayload["last_seen"] = isoTimestamp(rtc.now());
    JsonObject metadata = updatePayload.createNestedObject("metadata");
    metadata["firmware"] = FIRMWARE_NAME;

    String updateBody;
    serializeJson(updatePayload, updateBody);

    int updateCode = updateHttp.sendRequest("PATCH", updateBody);
    updateHttp.end();

    debugKeyValue("Provision Update", String("HTTP ") + String(updateCode));
    return true;
  }

  HTTPClient insertHttp;
  String insertUrl = String(SUPABASE_URL) + "/rest/v1/devices";
  if (!insertHttp.begin(client, insertUrl)) return false;

  insertHttp.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  insertHttp.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  insertHttp.addHeader("Content-Type", "application/json");
  insertHttp.addHeader("Prefer", "return=minimal");

  StaticJsonDocument<256> payload;
  payload["id"] = DEVICE_ID;
  payload["name"] = DEVICE_NAME;
  payload["location"] = DEVICE_LOCATION;
  JsonObject metadata = payload.createNestedObject("metadata");
  metadata["provisioned_by"] = "firmware";
  metadata["firmware"] = FIRMWARE_NAME;
  metadata["created_at"] = isoTimestamp(rtc.now());

  String body;
  serializeJson(payload, body);

  int insertCode = insertHttp.POST(body);
  insertHttp.end();

  debugKeyValue("Provision Insert", String("HTTP ") + String(insertCode));
  return (insertCode >= 200 && insertCode < 300);
}

bool postSensorEvent(bool motion, bool ssr, bool led) {
  if (DEBUG_SKIP_POST_LOGGING) {
    // Silent mode - don't log POST details
  } else {
    debugSection("SUPABASE POST");
  }
  
  if (WiFi.status() != WL_CONNECTED) {
    if (!DEBUG_SKIP_POST_LOGGING) debugKeyValue("WiFi", "Disconnected, skipping POST");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Prototype only. Use proper CA cert for production.
  if (!DEBUG_SKIP_POST_LOGGING) debugKeyValue("TLS", "Insecure mode enabled for testing");

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/sensor_events";
  if (!DEBUG_SKIP_POST_LOGGING) debugKeyValue("POST URL", url);

  if (!http.begin(client, url)) {
    if (!DEBUG_SKIP_POST_LOGGING) debugKeyValue("HTTP", "Begin failed");
    return false;
  }

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  DateTime now = rtc.now();
  // Validate RTC time before posting
  if (now.year() < 2022) {
    if (!DEBUG_SKIP_POST_LOGGING) debugKeyValue("POST", "Skipped - RTC time invalid");
    http.end();
    return false;
  }

  // Build JSON payload using ArduinoJson to avoid String concatenation issues
  StaticJsonDocument<256> payload;
  payload["device_id"] = DEVICE_ID;
  payload["timestamp"] = isoTimestamp(now);
  payload["motion"] = motion;
  payload["ssr"] = ssr;
  payload["led"] = led;
  payload["firmware"] = FIRMWARE_NAME;

  String body;
  serializeJson(payload, body);
  if (!DEBUG_SKIP_POST_LOGGING) debugKeyValue("Payload", body);

  // Retry loop with exponential backoff for transient failures
  const int MAX_RETRIES = 4;
  int attempt = 0;
  int code = -99;
  String response = "";
  while (attempt < MAX_RETRIES) {
    code = http.POST(body);
    response = http.getString();
    if (!DEBUG_SKIP_POST_LOGGING) {
      debugKeyValue("HTTP Code (attempt)", String(code) + " (" + String(attempt+1) + ")");
      if (response.length() > 0) {
        debugKeyValue("Response", response);
      } else {
        debugKeyValue("Response", "<empty>");
      }
    }

    if (code >= 200 && code < 300) break; // success

    // exponential backoff (bounded)
    unsigned long backoff = 250UL * (1UL << attempt);
    if (backoff > 5000) backoff = 5000;
    delay(backoff);
    attempt++;
  }

  http.end();
  return (code >= 200 && code < 300);
}

bool postSessionStartLog(bool motion, bool ssr, bool led) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/session_logs";
  if (!http.begin(client, url)) return false;

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  DateTime now = rtc.now();
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
  return (code >= 200 && code < 300);
}

bool closeLatestSessionLog() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String lookupUrl = String(SUPABASE_URL)
    + "/rest/v1/session_logs?select=id&device_id=eq."
    + String(DEVICE_ID)
    + "&time_out=is.null&order=time_in.desc&limit=1";

  if (!http.begin(client, lookupUrl)) return false;

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Content-Type", "application/json");

  int code = http.GET();
  String response = http.getString();
  http.end();

  if (code != 200 || response.length() < 3) return false;

  DynamicJsonDocument doc(256);
  DeserializationError err = deserializeJson(doc, response);
  if (err || !doc.is<JsonArray>() || doc.size() == 0) return false;

  JsonObject row = doc[0].as<JsonObject>();
  if (!row.containsKey("id")) return false;

  String rowId = row["id"].as<String>();
  DateTime now = rtc.now();
  if (now.year() < 2022) return false;

  HTTPClient updateHttp;
  String updateUrl = String(SUPABASE_URL) + "/rest/v1/session_logs?id=eq." + rowId;
  if (!updateHttp.begin(client, updateUrl)) return false;

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
  return (updateCode >= 200 && updateCode < 300);
}

bool pollPresenceAck() {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = String(SUPABASE_URL)
    + "/rest/v1/presence_acks?select=ack_at&device_id=eq."
    + String(DEVICE_ID)
    + "&order=ack_at.desc&limit=1";

  if (!http.begin(client, url)) return false;

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Content-Type", "application/json");

  int code = http.GET();
  String response = http.getString();
  http.end();

  if (code != 200 || response.length() < 3) return false;

  DynamicJsonDocument doc(256);
  DeserializationError err = deserializeJson(doc, response);
  if (err || !doc.is<JsonArray>() || doc.size() == 0) return false;

  JsonObject row = doc[0].as<JsonObject>();
  if (!row.containsKey("ack_at")) return false;

  String ackAt = row["ack_at"].as<String>();
  uint32_t ackEpoch = 0;
  if (!parseIsoToEpoch(ackAt, &ackEpoch)) return false;
  return (promptSentAtEpoch > 0 && ackEpoch > promptSentAtEpoch);
}

bool postPresenceEvent(const char* eventType, const char* message) {
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/presence_events";
  if (!http.begin(client, url)) return false;

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Prefer", "return=minimal");

  DateTime now = rtc.now();
  if (now.year() < 2022) {
    http.end();
    return false;
  }

  StaticJsonDocument<256> payload;
  payload["device_id"] = DEVICE_ID;
  payload["timestamp"] = isoTimestamp(now);
  payload["event"] = eventType;
  payload["note"] = message;
  payload["firmware"] = FIRMWARE_NAME;

  String body;
  serializeJson(payload, body);

  int code = http.POST(body);
  http.end();
  return (code >= 200 && code < 300);
}

void pollOverrides() {
  debugSection("OVERRIDE POLL");
  if (WiFi.status() != WL_CONNECTED) {
    debugKeyValue("WiFi", "Disconnected, skipping poll");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  String url = String(SUPABASE_URL) + "/rest/v1/devices?select=overrides&id=eq." + String(DEVICE_ID);
  debugKeyValue("Poll URL", url);

  if (!http.begin(client, url)) {
    debugKeyValue("HTTP", "Begin failed");
    return;
  }

  http.addHeader("apikey", SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_SERVICE_ROLE_KEY);
  http.addHeader("Content-Type", "application/json");

  int code = http.GET();
  String response = http.getString();

  debugKeyValue("HTTP Code", String(code));
  debugKeyValue("Response Length", String(response.length()));
  debugKeyValue("Response Body", response.length() > 0 ? response : "<empty>");

  if (code == 200 && response.length() > 2) {
    // Parse JSON properly using ArduinoJson.
    // Supports either:
    // 1) [{"overrides":{"lights": true, ...}}]
    // 2) [{"overrides":"{\"lights\": true, ...}"}]
    DynamicJsonDocument doc(512);
    DeserializationError err = deserializeJson(doc, response);
    if (err) {
      debugKeyValue("JSON", String("Parse error: ") + err.c_str());
    } else {
      if (doc.is<JsonArray>() && doc.size() > 0) {
        JsonObject root = doc[0].as<JsonObject>();
        if (!root.containsKey("overrides")) {
          debugKeyValue("Override", "no overrides field in response");
        } else if (root["overrides"].is<JsonObject>()) {
          JsonObject ov = root["overrides"].as<JsonObject>();
          if (ov.containsKey("lights")) {
            if (ov["lights"].isNull()) {
              overrideActive = false;
              debugKeyValue("Override", "lights override cleared");
            } else {
              overrideActive = true;
              overrideValue = ov["lights"].as<bool>();
              debugKeyValue("Override", overrideValue ? "Lightbulb forced ON" : "Lightbulb forced OFF");
            }
          } else if (ov.containsKey("pc")) {
            // Backward compatibility with older rows
            if (ov["pc"].isNull()) {
              overrideActive = false;
              debugKeyValue("Override", "pc override cleared");
            } else {
              overrideActive = true;
              overrideValue = ov["pc"].as<bool>();
              debugKeyValue("Override", overrideValue ? "SSR forced ON" : "SSR forced OFF");
            }
          } else {
            overrideActive = false;
            debugKeyValue("Override", "overrides object present but no lights/pc field");
          }
        } else if (root["overrides"].is<const char*>()) {
          const char* rawOverrides = root["overrides"].as<const char*>();
          DynamicJsonDocument overridesDoc(256);
          DeserializationError innerErr = deserializeJson(overridesDoc, rawOverrides);
          if (innerErr) {
            debugKeyValue("Override", String("stringified overrides parse error: ") + innerErr.c_str());
          } else if (overridesDoc.is<JsonObject>() && overridesDoc.as<JsonObject>().containsKey("lights")) {
            if (overridesDoc["lights"].isNull()) {
              overrideActive = false;
              debugKeyValue("Override", "lights override cleared");
            } else {
              overrideActive = true;
              overrideValue = overridesDoc["lights"].as<bool>();
              debugKeyValue("Override", overrideValue ? "Lightbulb forced ON" : "Lightbulb forced OFF");
            }
          } else if (overridesDoc.is<JsonObject>() && overridesDoc.as<JsonObject>().containsKey("pc")) {
            if (overridesDoc["pc"].isNull()) {
              overrideActive = false;
              debugKeyValue("Override", "pc override cleared");
            } else {
              overrideActive = true;
              overrideValue = overridesDoc["pc"].as<bool>();
              debugKeyValue("Override", overrideValue ? "SSR forced ON" : "SSR forced OFF");
            }
          } else {
            overrideActive = false;
            debugKeyValue("Override", "stringified overrides present but no lights/pc field");
          }
        } else {
          overrideActive = false;
          debugKeyValue("Override", "overrides field has unexpected type");
        }
      } else {
        overrideActive = false;
        debugKeyValue("Override", "unexpected response format");
      }
    }
  } else {
    overrideActive = false;
    debugKeyValue("Poll Status", String(code) + " - No valid response");
  }

  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  debugSection("SYSTEM BOOT");
  debugKeyValue("Firmware", FIRMWARE_NAME);
  debugKeyValue("Device ID", DEVICE_ID);
  debugKeyValue("Debug Mode", DEBUG_MODE ? "ON" : "OFF");

  pinMode(PIR_PIN, INPUT);
  pinMode(SSR_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);

  debugKeyValue("PIR PIN", String(PIR_PIN));
  debugKeyValue("SSR PIN", String(SSR_PIN));
  debugKeyValue("LED PIN", String(LED_PIN));

  digitalWrite(SSR_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(LED2_PIN, LOW);
  debugKeyValue("SSR State", "LOW (startup)");
  debugKeyValue("LED State", "LOW (startup)");

  Wire.begin(21, 22);
  debugKeyValue("I2C SDA", "21");
  debugKeyValue("I2C SCL", "22");

  debugSection("RTC CHECK");
  if (!rtc.begin()) {
    debugKeyValue("RTC", "Not found");
    while (1) {
      delay(1000);
    }
  }

  debugKeyValue("RTC", "Found");
  DateTime rtcNow = rtc.now();
  debugKeyValue("RTC Time", isoTimestamp(rtcNow));

  if (rtcNow.year() < 2022) {
    debugKeyValue("RTC", "Time looks invalid; set RTC manually or via NTP");
  }

  connectWiFi();
  deviceProvisioned = ensureDeviceRow(true);
  // Sync system time from NTP and update RTC
  configTime(0, 0, "pool.ntp.org");  // Sync system time from internet
  debugKeyValue("NTP", "Waiting for time sync (up to 10s)");
  time_t now = 0;
  unsigned long ntpStart = millis();
  // Wait up to 10s for NTP to provide a valid time (year > 2020)
  while ((now = time(nullptr)) < 1609459200 && millis() - ntpStart < 10000) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (now >= 1609459200) {
    debugKeyValue("NTP", "Time acquired");
    debugKeyValue("System Time (epoch)", String(now));
    rtc.adjust(DateTime(now));  // Set RTC from system time
    debugKeyValue("RTC", "Updated from NTP");
  } else {
    debugKeyValue("NTP", "Failed to acquire time; leaving RTC unchanged");
  }

  bootMs = millis();
  debugSection("START COMPLETE");
  Serial.println("SSR Lightbulb Test Started...");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastLoopLogMs >= LOOP_LOG_INTERVAL_MS) {
      debugKeyValue("WiFi", "Disconnected, reconnecting...");
    }
    connectWiFi();
  }

  if (!deviceProvisioned && (millis() - lastProvisionAttemptMs >= PROVISION_RETRY_MS)) {
    debugSection("PROVISION RETRY");
    deviceProvisioned = ensureDeviceRow(false);
    lastProvisionAttemptMs = millis();
  }

  unsigned long nowMs = millis();

  // Poll overrides every OVERRIDE_POLL_INTERVAL_MS
  if (nowMs - lastOverridePollMs >= OVERRIDE_POLL_INTERVAL_MS) {
    if (!DEBUG_DISABLE_OVERRIDE_POLL && !DEBUG_SKIP_OVERRIDE_POLL) {
      pollOverrides();
    } else if (millis() - lastLoopLogMs >= LOOP_LOG_INTERVAL_MS) {
      debugKeyValue("Override Poll", "Skipped (debug mode)");
    }
    lastOverridePollMs = nowMs;
  }

  if (millis() - lastLoopLogMs >= LOOP_LOG_INTERVAL_MS) {
    debugSection("LOOP CHECK");
  }
  DateTime now = rtc.now();
  int motionPin = DEBUG_DISABLE_PIR ? LOW : digitalRead(PIR_PIN);
  bool rawMotion = DEBUG_DISABLE_PIR ? false : (motionPin == HIGH);

  // Update debounce counters
  if (rawMotion) {
    consecHigh++;
    consecLow = 0;
  } else {
    consecLow++;
    consecHigh = 0;
  }

  // Warm-up: ignore triggers during initial boot period
  if (DEBUG_MODE) {
    motionState = DEBUG_FORCE_SSR_ON;
  } else if (nowMs - bootMs < WARMUP_MS) {
    motionState = false;
  } else {
    // Confirm motion when enough consecutive highs and outside refractory
    if (!motionState && consecHigh >= DEBOUNCE_REQUIRED) {
      if (nowMs - lastClearedAtMs > REFRACTORY_MS) {
        motionState = true;
        motionStartMs = nowMs;
      }
    }

    // Clear motion when enough consecutive lows and min-on satisfied
    if (motionState && consecLow >= CLEAR_REQUIRED) {
      if (nowMs - motionStartMs >= MIN_ON_MS) {
        motionState = false;
        lastClearedAtMs = nowMs;
      }
    }
  }

  bool motion = motionState;
  if (DEBUG_MODE) {
    motion = DEBUG_FORCE_SSR_ON;
  }

  if (motion) {
    lastMotionMs = nowMs;
    forcedOffAfterTimeout = false;
  }

  // Debounced PIR flag
  bool pirDebounced = (consecHigh >= DEBOUNCE_REQUIRED);
  if (pirDebounced) {
    lastMotionMs = nowMs;
  }

  if (millis() - lastLoopLogMs >= LOOP_LOG_INTERVAL_MS && !DEBUG_COMPACT_LOGS) {
    debugKeyValue("RTC Read", isoTimestamp(now));
    debugKeyValue("PIR Raw", String(motionPin));
    if (DEBUG_VERBOSE_DEBOUNCE) {
      debugKeyValue("Debounce Counters", String("HIGH=") + String(consecHigh) + String(" LOW=") + String(consecLow));
      debugKeyValue("PIR Debounced State", pirDebounced ? "TRUE (motion detected)" : "FALSE (no motion)");
    }
    debugKeyValue("Motion", motion ? "HIGH / detected" : "LOW / clear");
    if (overrideActive) {
      debugKeyValue("Override SSR", overrideValue ? "FORCED ON" : "FORCED OFF");
    } else {
      debugKeyValue("Override SSR", "motion logic");
    }
  }

  if (millis() - lastLoopLogMs >= LOOP_LOG_INTERVAL_MS && !DEBUG_COMPACT_LOGS) {
    Serial.print("Time: ");
    Serial.print(now.hour());
    Serial.print(":");
    Serial.print(now.minute());
    Serial.print(":");
    Serial.println(now.second());
  }

  // Session blink runs independently of SSR.

  // Presence session flow
  if (!sessionActive && pirDebounced) {
    sessionActive = true;
    promptSent = false;
    promptSentAtEpoch = 0;
    bool sessionLights = overrideActive ? overrideValue : true;
    bool sessionLed = true;
    if (!postSessionStartLog(true, sessionLights, sessionLed) && !DEBUG_SKIP_POST_LOGGING) {
      debugKeyValue("Session Log", "time_in insert failed");
    }
  }

  if (sessionActive && !promptSent && (nowMs - lastMotionMs >= IDLE_PROMPT_MS)) {
    promptSent = true;
    promptSentAtMs = nowMs;
    promptSentAtEpoch = rtc.now().unixtime();
    postPresenceEvent("still_there_prompt", "idle 10 minutes");
  }

  if (promptSent && (nowMs - lastAckPollMs >= ACK_POLL_INTERVAL_MS)) {
    bool acked = pollPresenceAck();
    lastAckPollMs = nowMs;
    if (acked) {
      promptSent = false;
      lastMotionMs = nowMs;
      postPresenceEvent("still_there_ack", "user confirmed");
    }
  }

  if (promptSent && (nowMs - promptSentAtMs >= PROMPT_TIMEOUT_MS)) {
    promptSent = false;
    sessionActive = false;
    forcedOffAfterTimeout = true;
    promptSentAtEpoch = 0;
    if (!closeLatestSessionLog() && !DEBUG_SKIP_POST_LOGGING) {
      debugKeyValue("Session Log", "time_out update failed");
    }
  }

  updateSessionBlink(sessionActive);

  // Apply session latch: keep SSR ON after time_in until time_out
  bool ssrFinal = forcedOffAfterTimeout ? false : (overrideActive ? overrideValue : sessionActive);

  if (millis() - lastLoopLogMs >= LOOP_LOG_INTERVAL_MS && !DEBUG_COMPACT_LOGS) {
    if (overrideActive) {
      debugKeyValue("Decision", overrideValue ? "Override: SSR/LED ON" : "Override: SSR/LED OFF");
    } else if (motion) {
      debugKeyValue("Decision", "Motion detected -> SSR/LED ON");
    } else {
      debugKeyValue("Decision", "No motion -> SSR/LED OFF");
    }
  }
  digitalWrite(SSR_PIN, ssrFinal ? HIGH : LOW);

  if (millis() - lastLoopLogMs >= LOOP_LOG_INTERVAL_MS) {
    if (DEBUG_COMPACT_LOGS) {
      debugStatusLine(now, motion, pirDebounced, motionPin, ssrFinal);
    } else {
      debugKeyValue("SSR State", digitalRead(SSR_PIN) == HIGH ? "HIGH" : "LOW");
      debugKeyValue("LED State", digitalRead(LED_PIN) == HIGH ? "HIGH" : "LOW");
    }
  }

  // Send when state changes or every POST_INTERVAL_MS
  if (!DEBUG_DISABLE_POSTS && (ssrFinal != lastMotion || nowMs - lastPostMs >= POST_INTERVAL_MS)) {
    if (!DEBUG_SKIP_POST_LOGGING) {
      debugKeyValue("POST Trigger", ssrFinal != lastMotion ? "Motion change" : "Interval elapsed");
    }
    bool ok = postSensorEvent(ssrFinal, ssrFinal, ssrFinal);
    if (!ok && !DEBUG_SKIP_POST_LOGGING) {
      debugKeyValue("POST", "Failed after retries");
    }
    lastMotion = ssrFinal;
    lastPostMs = nowMs;
  } else {
    if (DEBUG_DISABLE_POSTS && !DEBUG_SKIP_POST_LOGGING) {
      if (millis() - lastLoopLogMs >= LOOP_LOG_INTERVAL_MS) {
        debugKeyValue("POST Trigger", "Skipped (debug mode)");
      }
    }
  }

  if (millis() - lastLoopLogMs >= LOOP_LOG_INTERVAL_MS) {
    lastLoopLogMs = millis();
  }

  delay(250);
}
