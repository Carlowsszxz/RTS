/*
  PIR Raw Test Sketch

  Purpose
  - Reads the PIR sensor directly
  - Prints the raw HIGH / LOW value to Serial Monitor
  - Helps determine if the sensor hardware is unstable or if the main logic is the issue

  Wiring
  - PIR OUT -> GPIO 13
  - PIR VCC -> 3.3V
  - PIR GND -> GND

  Serial Monitor
  - Baud rate: 115200
*/

#define PIR_PIN 13

int lastPirValue = -1; // Track last state to detect changes

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIR_PIN, INPUT);

  Serial.println("PIR Raw Test Started");
  Serial.println("Printing ONLY on state change (real-time)...");
}

void loop() {
  int pirValue = digitalRead(PIR_PIN);

  // Print only when state changes
  if (pirValue != lastPirValue) {
    Serial.print(millis());
    Serial.print("ms -> PIR: ");
    Serial.println(pirValue == HIGH ? "HIGH" : "LOW");
    lastPirValue = pirValue;
  }
}
