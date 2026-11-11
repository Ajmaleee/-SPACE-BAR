// EVA-SUIT-REV4  ESP32 -> dashboard over Bluetooth Low Energy (real sensor data only)
// Libraries: "DHT sensor library" (Adafruit) + "Adafruit Unified Sensor". BLE + Wire are built in.
//
// Wiring
//   DHT11 data  -> GPIO18        MPU6050 SDA -> GPIO21, SCL -> GPIO22, VCC 3V3
//   Pulse sensor analog out -> GPIO34 (ADC1)
//   Muscle pads (bare wire / foil pad, touch with skin):
//     left arm  -> GPIO4  (T0)   right arm -> GPIO27 (T7)
//     left leg  -> GPIO33 (T8)   right leg -> GPIO32 (T9)
//   Keep hands off the pads while the board boots (it calibrates the untouched baseline).
//
// One line every 200 ms (comma separated, "nan" = no valid reading):
//   hr,p1;...;p10,temp,hum,ax,ay,az,gx,gy,gz,m0,m1,m2,m3
#include <Wire.h>
#include <DHT.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define TX_UUID      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
#define DHT_PIN 18
#define PULSE_PIN 34
#define MPU_ADDR 0x68

const int TOUCH_PIN[4] = {4, 27, 33, 32};
float touchBase[4];
DHT dht(DHT_PIN, DHT11);
BLECharacteristic *tx;
bool connected = false;
unsigned long connectedAt = 0;

float lastTemp = NAN, lastHum = NAN;
unsigned long lastDht = 0, lastSample = 0, lastBeat = 0;
int batch[10], nb = 0;
float bpm = NAN, sMax = 0, sMin = 4095, prevV = 0;

class ServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer *s)    { connected = true; connectedAt = millis(); }
  void onDisconnect(BLEServer *s) { connected = false; BLEDevice::startAdvertising(); }
};

void sendLine(const char *s) {
  size_t n = strlen(s);
  for (size_t i = 0; i < n; i += 20) {            // 20-byte chunks work with any MTU
    tx->setValue((uint8_t *)(s + i), min((size_t)20, n - i));
    tx->notify();
    delay(12);
  }
}

bool readMPU(float *o) {                           // ax ay az (g)  gx gy gz (deg/s)
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(MPU_ADDR, 14) != 14) return false;
  int16_t v[7];
  for (int i = 0; i < 7; i++) { v[i] = Wire.read() << 8; v[i] |= Wire.read(); }
  o[0] = v[0] / 16384.0; o[1] = v[1] / 16384.0; o[2] = v[2] / 16384.0;
  o[3] = v[4] / 131.0;   o[4] = v[5] / 131.0;   o[5] = v[6] / 131.0;
  return true;
}

float touchPct(int i) {                            // 0..100, classic ESP32: value DROPS when touched
  float v = touchRead(TOUCH_PIN[i]);
  float d = (touchBase[i] - v) / touchBase[i];
  return constrain(d * 200.0, 0, 100);             // 50% drop = 100%
}

void samplePulse() {                               // 50 Hz adaptive-threshold beat detector
  int v = analogRead(PULSE_PIN);
  batch[nb++] = v;
  sMax = v > sMax ? v : sMax - (sMax - v) * 0.01;
  sMin = v < sMin ? v : sMin + (v - sMin) * 0.01;
  float thr = (sMax + sMin) / 2;
  unsigned long now = millis();
  if ((sMax - sMin) > 150 && prevV < thr && v >= thr && now - lastBeat > 300) {
    if (lastBeat) {
      float ibi = now - lastBeat;
      if (ibi < 1500) { float b = 60000.0 / ibi; bpm = isnan(bpm) ? b : bpm * 0.7 + b * 0.3; }
    }
    lastBeat = now;
  }
  prevV = v;
  if (now - lastBeat > 3000) bpm = NAN;
}

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);
  Wire.beginTransmission(MPU_ADDR); Wire.write(0x6B); Wire.write(0); Wire.endTransmission();
  dht.begin();
  analogReadResolution(12);
  delay(500);
  for (int i = 0; i < 4; i++) {                    // untouched baseline
    float s = 0; for (int k = 0; k < 20; k++) { s += touchRead(TOUCH_PIN[i]); delay(10); }
    touchBase[i] = s / 20.0;
  }
  BLEDevice::init("EVA-SUIT");
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new ServerCB());
  BLEService *svc = server->createService(SERVICE_UUID);
  tx = svc->createCharacteristic(TX_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  tx->addDescriptor(new BLE2902());
  svc->start();
  BLEAdvertising *adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->start();
}

void loop() {
  unsigned long now = millis();
  if (now - lastSample >= 20) { lastSample = now; samplePulse(); }
  if (now - lastDht >= 2000) {                     // DHT11 is slow: 1 reading / 2 s
    lastDht = now;
    float t = dht.readTemperature(), h = dht.readHumidity();
    if (!isnan(t)) lastTemp = t;
    if (!isnan(h)) lastHum = h;
  }
  if (nb >= 10) {
    nb = 0;
    if (connected && millis() - connectedAt > 2500) {   // wait until the browser finished service discovery
      float m[6]; bool ok = readMPU(m);
      char pb[64]; pb[0] = 0;
      for (int i = 0; i < 10; i++) { char t[8]; snprintf(t, sizeof(t), i ? ";%d" : "%d", batch[i]); strcat(pb, t); }
      char line[220];
      snprintf(line, sizeof(line),
        "%.0f,%s,%.1f,%.0f,%.3f,%.3f,%.3f,%.1f,%.1f,%.1f,%.0f,%.0f,%.0f,%.0f\n",
        bpm, pb, lastTemp, lastHum,
        ok ? m[0] : NAN, ok ? m[1] : NAN, ok ? m[2] : NAN,
        ok ? m[3] : NAN, ok ? m[4] : NAN, ok ? m[5] : NAN,
        touchPct(0), touchPct(1), touchPct(2), touchPct(3));
      sendLine(line);
    }
  }
}