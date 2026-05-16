/*
  ESP32 LED On Test

  Purpose
  - Turns on the two indicator LEDs and keeps them on
  - Useful for checking wiring and resistor placement

  Pinout
  - LED 1 anode/+ -> GPIO 2
  - LED 1 cathode/- -> GND
  - LED 2 anode/+ -> GPIO 4
  - LED 2 cathode/- -> GND

  Note
  - Use a current-limiting resistor in series with each LED.
*/

#define LED_PIN 2
#define LED2_PIN 4

void setup() {
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED2_PIN, OUTPUT);

  digitalWrite(LED_PIN, HIGH);
  digitalWrite(LED2_PIN, HIGH);
}

void loop() {
  // Intentionally empty: LEDs stay on.
}
