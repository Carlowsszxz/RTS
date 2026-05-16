/*
  ESP32 PIR Motion Sensor → SSR Lightbulb Control (SIMPLE)
  
  Features:
  ✓ PIR motion detection
  ✓ SSR relay control (turn lightbulb ON/OFF)
  ✓ LED status indicators
  ✓ Debouncing to filter noise
  ✓ Grace period to prevent flicker
  
  Hardware Pinout:
  GPIO13 ← PIR Motion Sensor (input)
  GPIO12 → SSR Relay Control (output)
  GPIO2  → LED Indicator 1 (output)
  GPIO4  → LED Indicator 2 (output)
*/

// ========== PIN DEFINITIONS ==========
#define PIR_PIN 13      // PIR sensor input
#define SSR_PIN 12      // SSR relay output (controls lightbulb)
#define LED_PIN 2       // LED indicator 1
#define LED2_PIN 4      // LED indicator 2

// ========== TIMING CONSTANTS (milliseconds) ==========
const unsigned long WARMUP_MS = 5000;          // PIR warmup time after boot
const unsigned long DEBOUNCE_MS = 100;         // Debounce motion signal
const unsigned long MIN_SESSION_MS = 1000;     // Minimum time to keep SSR on
const unsigned long OFF_GRACE_MS = 5000;       // Keep SSR on after last motion to prevent flicker
const unsigned long LED_BLINK_INTERVAL_MS = 300;  // How fast LEDs blink during active session

// ========== STATE VARIABLES ==========
bool motionDetected = false;        // Current debounced motion state
bool ssrActive = false;             // Current SSR state
unsigned long bootTimeMs = 0;       // When device started
unsigned long motionStartMs = 0;    // When motion was last detected
unsigned long lastMotionMs = 0;     // Timestamp of last motion
unsigned long lastLedBlinkMs = 0;   // Last time LEDs blinked
bool ledBlinkState = false;         // Which state are LEDs in

// Debounce variables
bool rawMotion = false;             // Raw PIR pin reading
unsigned long debounceStartMs = 0;  // When debounce window started

// ========== SETUP ==========
void setup() {
  Serial.begin(115200);
  delay(500);
  
  Serial.println("\n[BOOT] ESP32 Simple PIR → SSR Controller");
  
  // Configure pins
  pinMode(PIR_PIN, INPUT);
  pinMode(SSR_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);
  
  // Initialize outputs to OFF
  digitalWrite(SSR_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(LED2_PIN, LOW);
  
  bootTimeMs = millis();
  Serial.println("[BOOT] Setup complete - waiting 5 seconds for PIR warmup...");
  Serial.printf("[PINS] PIR=%d, SSR=%d, LED1=%d, LED2=%d\n", PIR_PIN, SSR_PIN, LED_PIN, LED2_PIN);
}

// ========== MAIN LOOP ==========
void loop() {
  unsigned long nowMs = millis();
  
  // Skip PIR reading during warmup period
  if (nowMs - bootTimeMs < WARMUP_MS) {
    return;
  }
  
  // ===== STEP 1: Read PIR sensor =====
  rawMotion = (digitalRead(PIR_PIN) == HIGH);
  
  // ===== STEP 2: Debounce motion signal =====
  // Motion is only true if pin stays HIGH for DEBOUNCE_MS
  if (rawMotion && !motionDetected) {
    // PIR went HIGH - start debounce timer
    if (debounceStartMs == 0) {
      debounceStartMs = nowMs;
    }
    // Check if debounce window has passed
    if (nowMs - debounceStartMs >= DEBOUNCE_MS) {
      motionDetected = true;
      motionStartMs = nowMs;
      lastMotionMs = nowMs;
      debounceStartMs = 0;
      Serial.println("[MOTION] Detected!");
    }
  } else if (!rawMotion && motionDetected) {
    // PIR went LOW - motion ending
    if (nowMs - motionStartMs >= MIN_SESSION_MS) {
      motionDetected = false;
      debounceStartMs = 0;
      Serial.println("[MOTION] Cleared");
    }
  } else if (!rawMotion) {
    // PIR is LOW and motion isn't active - reset debounce
    debounceStartMs = 0;
  }
  
  // ===== STEP 3: Calculate SSR state =====
  // SSR turns on when motion detected
  // SSR stays on for grace period even after motion stops (prevents flicker)
  bool motionActive = motionDetected;
  bool gracePeriodActive = (nowMs - lastMotionMs < OFF_GRACE_MS);
  ssrActive = motionActive || gracePeriodActive;
  
  // ===== STEP 4: Update SSR output =====
  digitalWrite(SSR_PIN, ssrActive ? HIGH : LOW);
  
  // ===== STEP 5: Update LED indicators =====
  // LEDs blink when session is active
  if (ssrActive) {
    if (nowMs - lastLedBlinkMs >= LED_BLINK_INTERVAL_MS) {
      ledBlinkState = !ledBlinkState;
      lastLedBlinkMs = nowMs;
    }
    // Complementary blink: LED1 is opposite of LED2
    digitalWrite(LED_PIN, ledBlinkState ? HIGH : LOW);
    digitalWrite(LED2_PIN, ledBlinkState ? LOW : HIGH);
  } else {
    // Session inactive - LEDs off
    digitalWrite(LED_PIN, LOW);
    digitalWrite(LED2_PIN, LOW);
    ledBlinkState = false;
  }
  
  // ===== STEP 6: Debug logging (every 2 seconds) =====
  if (nowMs % 2000 < 100) {
    Serial.printf("[STATUS] PIR=%s Motion=%s SSR=%s Grace=%s\n",
      rawMotion ? "HIGH" : "LOW",
      motionDetected ? "YES" : "NO",
      ssrActive ? "ON" : "OFF",
      gracePeriodActive ? "YES" : "NO"
    );
  }
  
  // Small delay for responsiveness
  delay(50);
}

/*
  LOGIC EXPLANATION:
  
  1. PIR DEBOUNCING
     - Raw PIR signal can be noisy
     - We only register motion if pin stays HIGH for 100ms
     - This prevents false triggers
  
  2. MOTION STATE
     - motionDetected: True while PIR is triggered
     - Becomes false once PIR stays LOW for MIN_SESSION_MS
  
  3. SSR CONTROL
     - SSR turns ON when motion is detected
     - SSR stays ON for OFF_GRACE_MS after motion stops
     - This prevents rapid on/off flicker (more comfortable lighting)
     - Example: Motion detected at 0ms, SSR on
            Motion stops at 2000ms, SSR stays on until 7000ms
  
  4. LED FEEDBACK
     - LEDs blink (300ms interval) when SSR is active = session running
     - LEDs off when SSR is off = no session
     - LED2 is inverse of LED1 for visual effect
  
  5. PIN STATES AT EACH EVENT
     
     Event: Motion Detected
     ├─ PIR_PIN: HIGH
     ├─ motionDetected: true
     ├─ ssrActive: true
     ├─ SSR_PIN: HIGH (relay energized)
     ├─ LED_PIN: blinking
     └─ Serial: "[MOTION] Detected!"
     
     Event: Grace Period (motion stopped, but within 5s)
     ├─ PIR_PIN: LOW
     ├─ motionDetected: false
     ├─ gracePeriodActive: true
     ├─ ssrActive: true (still on!)
     ├─ SSR_PIN: HIGH (relay still energized)
     ├─ LED_PIN: still blinking
     └─ Serial: (no message)
     
     Event: Grace Period Expires
     ├─ PIR_PIN: LOW
     ├─ motionDetected: false
     ├─ gracePeriodActive: false
     ├─ ssrActive: false
     ├─ SSR_PIN: LOW (relay de-energized)
     ├─ LED_PIN: LOW (off)
     └─ Serial: "[MOTION] Cleared"
  
  CUSTOMIZATION:
  - Change DEBOUNCE_MS to make PIR more/less sensitive
  - Change OFF_GRACE_MS to adjust flicker prevention
  - Change LED_BLINK_INTERVAL_MS to make LEDs blink faster/slower
  - Change MIN_SESSION_MS if motion needs minimum duration
*/
