#include <Wire.h>
#include <MPU6050_light.h>
#define DEVICE_NAME "SENS-INS-플루토늄"

/* 장비마다 고유한 이름을 붙입니다. 이름은 다음을 사용합니다. */
/*
- 수소
- 헬륨
- 리튬
- 베릴륨
- 붕소
- 탄소
- 질소
- 산소
- 플루오린
- 네온
- 나트륨
- 마그네슘

이 이름 앞에 "SENS-INS-" 을 붙여서 이름을 정합니다.
*/

// ── Pin Definitions ───────────────────────────────────
const uint8_t PIN_MPU_INT = 2;
const uint8_t PIN_LED     = 13;

// ── MPU6050 ───────────────────────────────────────────
MPU6050 mpu(Wire);

// ── Device State ──────────────────────────────────────
enum class State : uint8_t {
  WAITING,   // waiting for ALIGN command
  ALIGNING,  // collecting bias samples
  STANDBY,   // aligned, waiting for START command
  READY,     // measuring, stationary
  MOVING     // measuring, motion detected
};
State currentState = State::WAITING;

// ── Interrupt Flag ────────────────────────────────────
volatile bool dataReady = false;

void dataReady_ISR() {
  dataReady = true;
}

// ── LED Blink ─────────────────────────────────────────
unsigned long ledPrevTime     = 0;
bool          ledOn           = false;
const uint16_t BLINK_INTERVAL = 300;  // ms

// ── Alignment (non-blocking) ──────────────────────────
const uint16_t ALIGN_SAMPLES = 1000;
uint16_t alignCounter        = 0;
double   sumX = 0, sumY = 0, sumZ = 0;
double   sumRX = 0, sumRY = 0, sumRZ = 0;

float biasX = 0;           // m/s²
float biasY = 0;           // m/s²
float biasZ = 0;           // m/s²
float rotX = 0;
float rotY = 0;
float rotZ = 0;
float measuredGravity = 9.80665f;  // measured local gravity in m/s², updated on alignment

// ── Physical Constant ─────────────────────────────────
const float STANDARD_G = 9.80665f;  // m/s² per g

// ── Motion Detection Threshold ────────────────────────
const float MOTION_THRESHOLD = 0.3f;  // m/s²

// ── Serial Receive Buffer ─────────────────────────────
String serialBuffer = "";

// ── Transmission Timing ───────────────────────────────
unsigned long txPrevTime   = 0;
const uint16_t TX_INTERVAL = 20;  // ms → 50 Hz


// ════════════════════════════════════════════════════════
//  MPU6050 INT Register Configuration
// ════════════════════════════════════════════════════════
void configureMpuInterrupt() {
  // INT_PIN_CFG (0x37): active-high, push-pull, clear on read
  Wire.beginTransmission(0x68);
  Wire.write(0x37);
  Wire.write(0x00);
  Wire.endTransmission();

  // INT_ENABLE (0x38): DATA_RDY_EN bit ON
  Wire.beginTransmission(0x68);
  Wire.write(0x38);
  Wire.write(0x01);
  Wire.endTransmission();
}


// ════════════════════════════════════════════════════════
//  LED State Update (non-blocking)
// ════════════════════════════════════════════════════════
void updateLed() {
  switch (currentState) {

    case State::ALIGNING:
      if (millis() - ledPrevTime >= BLINK_INTERVAL) {
        ledOn = !ledOn;
        digitalWrite(PIN_LED, ledOn);
        ledPrevTime = millis();
      }
      break;

    case State::STANDBY:
      digitalWrite(PIN_LED, HIGH);  // steady on: aligned, awaiting START
      break;

    case State::READY:
      digitalWrite(PIN_LED, HIGH);
      break;

    case State::MOVING:
      digitalWrite(PIN_LED, LOW);
      break;

    default:  // WAITING
      digitalWrite(PIN_LED, LOW);
      break;
  }
}


// ════════════════════════════════════════════════════════
//  Alignment Handler (non-blocking, INT flag based)
// ════════════════════════════════════════════════════════
void handleAlignment() {
  if (!dataReady) return;
  dataReady = false;

  mpu.update();

  sumX += mpu.getAccX();
  sumY += mpu.getAccY();
  sumZ += mpu.getAccZ();
  sumRX += mpu.getAngleX();
  sumRY += mpu.getAngleY();
  sumRZ += mpu.getAngleZ();
  alignCounter++;

  if (alignCounter >= ALIGN_SAMPLES) {
    // convert g → m/s² using STANDARD_G; store all biases in m/s²
    biasX = (float)(sumX / ALIGN_SAMPLES) * STANDARD_G;
    biasY = (float)(sumY / ALIGN_SAMPLES) * STANDARD_G;
    measuredGravity = (float)(sumZ / ALIGN_SAMPLES) * STANDARD_G;  // actual local g in m/s²
    biasZ = measuredGravity;                                        // remove gravity from Z
    rotX = (float)(sumRX / ALIGN_SAMPLES);
    rotY = (float)(sumRY / ALIGN_SAMPLES);
    rotZ = (float)(sumRZ / ALIGN_SAMPLES);

    currentState = State::STANDBY;
    Serial.print("STATUS:STANDBY,G:");
    Serial.println(measuredGravity, 4);  // send measured g (m/s²) to web
  }
}


// ════════════════════════════════════════════════════════
//  Measurement Handler (INT flag based, 50 Hz TX)
// ════════════════════════════════════════════════════════
void handleMeasurement() {
  if (!dataReady) return;
  dataReady = false;

  mpu.update();

  // convert raw g readings to m/s², then subtract m/s² biases
  float aX = mpu.getAccX() * STANDARD_G - biasX;
  float aY = mpu.getAccY() * STANDARD_G - biasY;
  float aZ = mpu.getAccZ() * STANDARD_G - biasZ;
  float rX = mpu.getAngleX() - rotX;
  float rY = mpu.getAngleY() - rotY;
  float rZ = mpu.getAngleZ() - rotZ;

  // detect motion via vector magnitude → update LED state
  float magnitude = sqrtf(aX * aX + aY * aY + aZ * aZ);
  if(magnitude > MOTION_THRESHOLD && currentState == State::READY) {
    currentState = State::MOVING;
    Serial.println("STATUS:MOVING");
  }

  // transmit at 50 Hz
  if (millis() - txPrevTime >= TX_INTERVAL) {
    Serial.print("ACC:");
    Serial.print(aX, 4); Serial.print(',');
    Serial.print(aY, 4); Serial.print(',');
    Serial.print(aZ, 4);
    Serial.println("/ROT:0,0,0");
    //Serial.print(rX, 4); Serial.print(',');
    //Serial.print(rY, 4); Serial.print(',');
    //Serial.println(rZ, 4);
    txPrevTime = millis();
  }
}


// ════════════════════════════════════════════════════════
//  Serial Command Handler
// ════════════════════════════════════════════════════════
void handleSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      serialBuffer.trim();

      if (serialBuffer == "PING") {
        Serial.println("PONG");
      } else if (serialBuffer == "ALIGN") {
        alignCounter = 0;
        sumX = sumY = sumZ = sumRX = sumRY = sumRZ = 0.0;
        currentState = State::ALIGNING;
        Serial.println("STATUS:ALIGNING");
      } else if (serialBuffer == "STOP") {
        currentState = State::WAITING;
      } else if (serialBuffer == "START") {
        if (currentState == State::STANDBY) {
          currentState = State::READY;
          Serial.println("STATUS:READY");
        }
      }
      serialBuffer = "";
    } else {
      serialBuffer += c;
    }
  }
}


// ════════════════════════════════════════════════════════
//  setup / loop
// ════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);

  pinMode(PIN_LED,     OUTPUT);
  pinMode(PIN_MPU_INT, INPUT);
  digitalWrite(PIN_LED, LOW);

  Wire.begin();
  Wire.setClock(400000);  // Fast I2C (400 kHz)

  byte errCode = mpu.begin();
  if (errCode != 0) {
    Serial.print("ERR:MPU6050:");
    Serial.println(errCode);
    while (1);  // halt on connection failure
  }

  configureMpuInterrupt();
  attachInterrupt(digitalPinToInterrupt(PIN_MPU_INT),
                  dataReady_ISR, RISING);

  Serial.print("META:VERSION:sensINS_1.0.0/BAUD:115200/DEV:");
  Serial.println(DEVICE_NAME);
  Serial.println("STATUS:WAITING");
}

void loop() {
  handleSerial();
  updateLed();

  switch (currentState) {
    case State::ALIGNING:
      handleAlignment();
      break;

    case State::READY:
    case State::MOVING:
      handleMeasurement();
      break;

    case State::STANDBY:
    case State::WAITING:
    default:
      break;
  }
}
