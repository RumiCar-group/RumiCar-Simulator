// ボード/言語別の既定サンプル (RumiCar 壁回避アルゴリズム)。
// 前方が空いていれば直進、前方が詰まれば開いている方へ、側方が近ければ離れる。
export const SAMPLES = {
  c: `// Arduino C++ 風 (Arduino Nano / Raspberry Pi Pico)
void setup() {
  RC_setup();
}

// 信頼区間[mm]: >CONF/範囲外(-3) の測距は「遠い/開放」とみなす。実機 VL53L0X は地面拘束で ~250mm 超を
// 信頼しにくいが、本シム卓上は実機模型より広いので ~640mm を既定に。★実機は自機に合わせ下げ+減速。
int CONF = 640, OPEN = 9999;

void loop() {
  int s0 = sensor0.readRangeSingleMillimeters(); if (s0 < 0 || s0 > CONF) s0 = OPEN; // 左(信頼区間外=開放)
  int s1 = sensor1.readRangeSingleMillimeters(); if (s1 < 0 || s1 > CONF) s1 = OPEN; // 中央
  int s2 = sensor2.readRangeSingleMillimeters(); if (s2 < 0 || s2 > CONF) s2 = OPEN; // 右
  Serial.println(s1);

  // 前方の空き具合で速度を変える (十分開けていれば全開 240)。
  // ※ ドリフト FR/4WD: 旋回中に強くアクセル (目安 PWM220 以上) で滑り出す (FR=リアが流れる / 4WD=車体ごと流れる)
  // ※ ドリフト FF: 高速旋回中にアクセルを緩める (240→120) とリアだけ滑り出す
  if (s1 < 250)      RC_drive(FORWARD, 120);
  else if (s1 < 600) RC_drive(FORWARD, 230);
  else               RC_drive(FORWARD, 240);

  // 操舵
  if (s1 < 350) {                 // 前方に壁 → 開いている方へ
    if (s0 > s2) RC_steer(LEFT);
    else         RC_steer(RIGHT);
  } else if (s2 < 180) {          // 右が近い → 左へ
    RC_steer(LEFT);
  } else if (s0 < 180) {          // 左が近い → 右へ
    RC_steer(RIGHT);
  } else {                        // 前方も側方も空き → 直進
    RC_steer(CENTER);
  }
}
`,
  py: `# Python 風 (Raspberry Pi Zero)
# 信頼区間[mm]: >CONF/範囲外(-3) の測距は「遠い/開放」とみなす。実機 VL53L0X は地面拘束で ~250mm 超を
# 信頼しにくいが、本シム卓上は実機模型より広いので ~640mm を既定に。★実機は自機に合わせ下げ+減速。
CONF = 640
OPEN = 9999
while True:
    s0 = sensor0.get_distance()  # 左
    s1 = sensor1.get_distance()  # 中央
    s2 = sensor2.get_distance()  # 右
    if s0 < 0 or s0 > CONF:      # 信頼区間外/範囲外=開放
        s0 = OPEN
    if s1 < 0 or s1 > CONF:
        s1 = OPEN
    if s2 < 0 or s2 > CONF:
        s2 = OPEN
    print(s1)

    # 前方の空き具合で速度を変える (十分開けていれば全開 240)。
    # ※ ドリフト FR/4WD: 旋回中に強くアクセル (目安 PWM220 以上) で滑り出す (FR=リアが流れる / 4WD=車体ごと流れる)
    # ※ ドリフト FF: 高速旋回中にアクセルを緩める (240→120) とリアだけ滑り出す
    if s1 < 250:
        rc_drive(FORWARD, 120)
    elif s1 < 600:
        rc_drive(FORWARD, 230)
    else:
        rc_drive(FORWARD, 240)

    # 操舵
    if s1 < 350:                 # 前方に壁 → 開いている方へ
        if s0 > s2:
            rc_steer(LEFT)
        else:
            rc_steer(RIGHT)
    elif s2 < 180:               # 右が近い → 左へ
        rc_steer(LEFT)
    elif s0 < 180:               # 左が近い → 右へ
        rc_steer(RIGHT)
    else:                        # 前方も側方も空き → 直進
        rc_steer(CENTER)
`,
  js: `// JavaScript (シミュレータ専用)
function setup() {
  RC_setup();
}

// 信頼区間[mm]: >CONF/範囲外(-3) の測距は「遠い/開放」とみなす(実機 VL53L0X は地面拘束で ~250mm 超を
// 信頼しにくいが、本シム卓上は実機模型より広いので ~640mm を既定。★実機は自機に合わせ下げ+減速)。
const CONF = 640, OPEN = 9999;
function loop() {
  let s0 = sensor0.readRangeSingleMillimeters(); if (s0 < 0 || s0 > CONF) s0 = OPEN;
  let s1 = sensor1.readRangeSingleMillimeters(); if (s1 < 0 || s1 > CONF) s1 = OPEN;
  let s2 = sensor2.readRangeSingleMillimeters(); if (s2 < 0 || s2 > CONF) s2 = OPEN;
  // ドリフト FR/4WD は旋回中に強くアクセル (目安 PWM220 以上) で滑り出す。ドリフト FF はコーナー進入の
  // アクセルオフ (240→120) でリアが流れる。
  if (s1 < 250)      RC_drive(FORWARD, 120);
  else if (s1 < 600) RC_drive(FORWARD, 230);
  else               RC_drive(FORWARD, 240);
  if (s1 < 350) { if (s0 > s2) RC_steer(LEFT); else RC_steer(RIGHT); }
  else if (s2 < 180) RC_steer(LEFT);
  else if (s0 < 180) RC_steer(RIGHT);
  else RC_steer(CENTER);
}
`,
};
