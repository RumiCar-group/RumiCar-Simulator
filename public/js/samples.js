// ボード/言語別の既定サンプル (RumiCar 壁沿い走行アルゴリズム "Wall Hugger")。3 言語とも同じロジック・同じ定数
// (本番フロー runRace で卓上 56 コースの verifyHash が 3 言語で全件一致することを確認済み・2026-11)。
// RumiCar の ToF は 20 cm より先を見ない (RC_read は -3) ので、右の壁に寄って沿い、前に壁が見えたら開いている方へ、
// 右の壁を見失ったら右へ切って探し、詰まったら後退して切り返す。c は Arduino RumiCar-lib、py は RasPi RumiCar.py の形 (最上位の
// while True:。Zero2Cam は def setup()/def loop() の形が要るので py_normal_fr を見る)、js はシミュレータ専用。回数で数える定数
// (BACKT・SEEK) は loop の周期 (シムは 20 Hz) に依存するので、周期の違う実機では見直す。-1 (読めない) は置き換えず「近い」扱い (安全側)。
export const SAMPLES = {
  c: `// Arduino C++ (Arduino Nano / Raspberry Pi Pico)。RumiCar-lib の API。
// RC_read(LEFT/CENTER/RIGHT) は 0〜200 = 距離[mm]・-1 = 読めない・-3 = 20 cm 以内に何もない (開けている)。
// 通路は 20 cm より広いので、真ん中では左右とも -3 になる。∴ 右の壁に寄って沿う (両側が見えれば左右の差で真ん中へ)。
// -3 は数としては最も小さいので、比較の前に FAR (999) へ置き換える。-1 (読めない) はそのまま＝「近い」扱い (安全側)。
int TOP = 240;      // 速度: 壁に沿って安定しているとき (255 = 全開)
int CRUISE = 180;   // 速度: 壁を探す・寄せるとき
int TURNV = 110;    // 速度: 前に壁が見えて曲げるとき (抜くほど小さく回れる)
int BACKV = 150;    // 速度: 後退
int NEAR = 100;     // 右の壁がこれより近ければ左へ [mm]
int FARB = 170;     // 右の壁がこれより遠ければ右へ [mm]
int ESC = 80;       // 前方がこれより近ければ後退して切り返す [mm]
int BACKT = 8;      // 後退を続ける回数 (20 Hz なら 0.4 秒)
int SEEK = 4;       // 壁を見失ってから全舵で切り続ける回数 (その後は半分の時間だけ切って大回り)
int FAR = 999;

int back = 0;       // 後退の残り回数
int bdir = CENTER;  // 後退中の舵
int lost = 0;       // 右の壁を見失ってからの回数

void setup() {
  RC_setup();
}

void loop() {
  int L = RC_read(LEFT);
  int C = RC_read(CENTER);
  int R = RC_read(RIGHT);
  if (L == -3) L = FAR;
  if (C == -3) C = FAR;
  if (R == -3) R = FAR;
  Serial.print(L); Serial.print(" "); Serial.print(C); Serial.print(" "); Serial.println(R);

  if (back > 0) {                 // 後退中: 舵を固定して下がる
    back = back - 1;
    RC_steer(bdir);
    RC_drive(REVERSE, BACKV);
    return;
  }
  if (C < ESC) {                  // 詰まった: 開いている側へ鼻先が向くよう逆ハンで後退
    back = BACKT;
    if (L < 120 || R < 120) bdir = CENTER;
    else if (L > R) bdir = RIGHT;
    else bdir = LEFT;
    RC_steer(bdir);
    RC_drive(REVERSE, BACKV);
    return;
  }
  if (C < 200) {                  // 前に壁 (20 cm 以内): 開いている方へ
    if (R > L) RC_steer(RIGHT); else RC_steer(LEFT);
    RC_drive(FORWARD, TURNV);
    return;
  }
  if (L < FAR && R < FAR) {       // 両側に壁 (狭い通路): 左右の差で真ん中へ
    lost = 0;
    if (L + 20 < R) RC_steer(RIGHT);
    else if (R + 20 < L) RC_steer(LEFT);
    else RC_steer(CENTER);
    RC_drive(FORWARD, CRUISE);
    return;
  }
  if (R == FAR) {                 // 右の壁が見えない: 右へ切って探す
    lost = lost + 1;
    if (lost <= SEEK || lost % 2 == 0) RC_steer(RIGHT); else RC_steer(CENTER);
    RC_drive(FORWARD, CRUISE);
    return;
  }
  lost = 0;                       // 右の壁に沿う
  if (R < NEAR)      { RC_steer(LEFT);   RC_drive(FORWARD, CRUISE); }
  else if (R > FARB) { RC_steer(RIGHT);  RC_drive(FORWARD, CRUISE); }
  else               { RC_steer(CENTER); RC_drive(FORWARD, TOP); }
}
`,
  py: `# Python (Raspberry Pi Zero / Zero 2 W)。RumiCar ライブラリの API は Arduino 版と同じ名前・同じ値。
# RC_read(LEFT/CENTER/RIGHT) は 0〜200 = 距離[mm]・-1 = 読めない・-3 = 20 cm 以内に何もない (開けている)。
# 通路は 20 cm より広いので、真ん中では左右とも -3 になる。∴ 右の壁に寄って沿う (両側が見えれば左右の差で真ん中へ)。
# -3 は数としては最も小さいので、比較の前に FAR (999) へ置き換える。-1 (読めない) はそのまま＝「近い」扱い (安全側)。
from RumiCar import *

TOP = 240       # 速度: 壁に沿って安定しているとき (255 = 全開)
CRUISE = 180    # 速度: 壁を探す・寄せるとき
TURNV = 110     # 速度: 前に壁が見えて曲げるとき (抜くほど小さく回れる)
BACKV = 150     # 速度: 後退
NEAR = 100      # 右の壁がこれより近ければ左へ [mm]
FARB = 170      # 右の壁がこれより遠ければ右へ [mm]
ESC = 80        # 前方がこれより近ければ後退して切り返す [mm]
BACKT = 8       # 後退を続ける回数 (20 Hz なら 0.4 秒)
SEEK = 4        # 壁を見失ってから全舵で切り続ける回数 (その後は半分の時間だけ切って大回り)
FAR = 999

back = 0        # 後退の残り回数
bdir = CENTER   # 後退中の舵
lost = 0        # 右の壁を見失ってからの回数

RC_setup()
while True:
    L = RC_read(LEFT)
    C = RC_read(CENTER)
    R = RC_read(RIGHT)
    if L == -3:
        L = FAR
    if C == -3:
        C = FAR
    if R == -3:
        R = FAR
    print(L, C, R)

    if back > 0:                    # 後退中: 舵を固定して下がる
        back = back - 1
        RC_steer(bdir)
        RC_drive(REVERSE, BACKV)
        continue
    if C < ESC:                     # 詰まった: 開いている側へ鼻先が向くよう逆ハンで後退
        back = BACKT
        if L < 120 or R < 120:
            bdir = CENTER
        elif L > R:
            bdir = RIGHT
        else:
            bdir = LEFT
        RC_steer(bdir)
        RC_drive(REVERSE, BACKV)
        continue
    if C < 200:                     # 前に壁 (20 cm 以内): 開いている方へ
        if R > L:
            RC_steer(RIGHT)
        else:
            RC_steer(LEFT)
        RC_drive(FORWARD, TURNV)
        continue
    if L < FAR and R < FAR:         # 両側に壁 (狭い通路): 左右の差で真ん中へ
        lost = 0
        if L + 20 < R:
            RC_steer(RIGHT)
        elif R + 20 < L:
            RC_steer(LEFT)
        else:
            RC_steer(CENTER)
        RC_drive(FORWARD, CRUISE)
        continue
    if R == FAR:                    # 右の壁が見えない: 右へ切って探す
        lost = lost + 1
        if lost <= SEEK or lost % 2 == 0:
            RC_steer(RIGHT)
        else:
            RC_steer(CENTER)
        RC_drive(FORWARD, CRUISE)
        continue
    lost = 0                        # 右の壁に沿う
    if R < NEAR:
        RC_steer(LEFT)
        RC_drive(FORWARD, CRUISE)
    elif R > FARB:
        RC_steer(RIGHT)
        RC_drive(FORWARD, CRUISE)
    else:
        RC_steer(CENTER)
        RC_drive(FORWARD, TOP)
`,
  js: `// JavaScript (シミュレータ専用)。API は Arduino 版と同じ名前・同じ値 (setup/loop を定義する)。
// RC_read(LEFT/CENTER/RIGHT) は 0〜200 = 距離[mm]・-1 = 読めない・-3 = 20 cm 以内に何もない (開けている)。
// 通路は 20 cm より広いので、真ん中では左右とも -3 になる。∴ 右の壁に寄って沿う (両側が見えれば左右の差で真ん中へ)。
// -3 は数としては最も小さいので、比較の前に FAR (999) へ置き換える。-1 (読めない) はそのまま＝「近い」扱い (安全側)。
const TOP = 240;      // 速度: 壁に沿って安定しているとき (255 = 全開)
const CRUISE = 180;   // 速度: 壁を探す・寄せるとき
const TURNV = 110;    // 速度: 前に壁が見えて曲げるとき (抜くほど小さく回れる)
const BACKV = 150;    // 速度: 後退
const NEAR = 100;     // 右の壁がこれより近ければ左へ [mm]
const FARB = 170;     // 右の壁がこれより遠ければ右へ [mm]
const ESC = 80;       // 前方がこれより近ければ後退して切り返す [mm]
const BACKT = 8;      // 後退を続ける回数 (20 Hz なら 0.4 秒)
const SEEK = 4;       // 壁を見失ってから全舵で切り続ける回数 (その後は半分の時間だけ切って大回り)
const FAR = 999;

let back = 0;         // 後退の残り回数
let bdir = CENTER;    // 後退中の舵
let lost = 0;         // 右の壁を見失ってからの回数

function setup() {
  RC_setup();
}

function loop() {
  let L = RC_read(LEFT), C = RC_read(CENTER), R = RC_read(RIGHT);
  if (L === -3) L = FAR;
  if (C === -3) C = FAR;
  if (R === -3) R = FAR;
  Serial.println(L + " " + C + " " + R);

  if (back > 0) {                 // 後退中: 舵を固定して下がる
    back--;
    RC_steer(bdir);
    RC_drive(REVERSE, BACKV);
    return;
  }
  if (C < ESC) {                  // 詰まった: 開いている側へ鼻先が向くよう逆ハンで後退
    back = BACKT;
    bdir = (L < 120 || R < 120) ? CENTER : (L > R ? RIGHT : LEFT);
    RC_steer(bdir);
    RC_drive(REVERSE, BACKV);
    return;
  }
  if (C < 200) {                  // 前に壁 (20 cm 以内): 開いている方へ
    RC_steer(R > L ? RIGHT : LEFT);
    RC_drive(FORWARD, TURNV);
    return;
  }
  if (L < FAR && R < FAR) {       // 両側に壁 (狭い通路): 左右の差で真ん中へ
    lost = 0;
    if (L + 20 < R) RC_steer(RIGHT);
    else if (R + 20 < L) RC_steer(LEFT);
    else RC_steer(CENTER);
    RC_drive(FORWARD, CRUISE);
    return;
  }
  if (R === FAR) {                // 右の壁が見えない: 右へ切って探す
    lost++;
    RC_steer(lost <= SEEK || lost % 2 === 0 ? RIGHT : CENTER);
    RC_drive(FORWARD, CRUISE);
    return;
  }
  lost = 0;                       // 右の壁に沿う
  if (R < NEAR)      { RC_steer(LEFT);   RC_drive(FORWARD, CRUISE); }
  else if (R > FARB) { RC_steer(RIGHT);  RC_drive(FORWARD, CRUISE); }
  else               { RC_steer(CENTER); RC_drive(FORWARD, TOP); }
}
`,
};
