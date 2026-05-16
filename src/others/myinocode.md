/*
  SSR Lightbulb Test

  Module / Pin Connections:

  1) PIR Motion Sensor
     - VCC  -> 3.3V or 5V
     - GND  -> GND
     - OUT  -> GPIO 13

  2) SSR Module
     - IN   -> GPIO 12
     - VCC  -> (as required by your SSR module)
     - GND  -> GND

  3) RTC DS3231 Module
     - SDA  -> GPIO 21
     - SCL  -> GPIO 22
     - VCC  -> 3.3V or 5V
     - GND  -> GND

  4) LED
     - Anode (+) -> GPIO 2
     - Cathode (-) -> GND
     - Use a current-limiting resistor (e.g. 220Ω to 330Ω) in series with the LED anode.
*/

#include <Wire.h>
#include <RTClib.h>

RTC_DS3231 rtc;

#define PIR_PIN 13
#define SSR_PIN 12
#define LED_PIN 2

void setup() {
  Serial.begin(115200);

  pinMode(PIR_PIN, INPUT);
  pinMode(SSR_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  digitalWrite(SSR_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  Wire.begin(21, 22);

  if (!rtc.begin()) {
    Serial.println("RTC not found!");
    while (1);
  }

  Serial.println("SSR Lightbulb Test Started...");
}

void loop() {
  DateTime now = rtc.now();

  Serial.print("Time: ");
  Serial.print(now.hour());
  Serial.print(":");
  Serial.print(now.minute());
  Serial.print(":");
  Serial.println(now.second());

  int motion = digitalRead(PIR_PIN);

  if (motion == HIGH) {
    Serial.println("Motion detected - Light ON");
    digitalWrite(SSR_PIN, HIGH);
    digitalWrite(LED_PIN, HIGH);
  } else {
    Serial.println("No motion - Light OFF");
    digitalWrite(SSR_PIN, LOW);
    digitalWrite(LED_PIN, LOW);
  }

  delay(1000);
}