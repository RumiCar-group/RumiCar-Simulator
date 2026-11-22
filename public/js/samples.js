// ボード/言語別の既定サンプル (RumiCar 壁沿い走行アルゴリズム "Wall Hugger")。3 言語とも同じロジック・同じ定数
// (本番フロー runRace で卓上 56 コースの verifyHash が 3 言語で全件一致することを確認済み・2026-11)。
// RC_read の値の扱いは、実機の見本 (正本 RumiCar-lib v0.7.1 の Exercise-3.3・4.2-Answer／RasPi の Exercise-3.1〜3.3) と同じ決まり (v12.1.0):
//   ・値はまず 0 以上 (距離) か負の数 (ステータス) かで分け、ステータスの処理は loop() の最初の 1 つのブロックにまとめる。
//   ・-1 (センサーが応答しない) は止まる (RC_drive(BRAKE, 0) を出して、その回は判断しない)。
//   ・-3 (範囲外＝その方向の上限より手前に測れた物が無い) は、比べる前に先頭の定数 FAR_MM へ置き換える。「遠い」とみなすのはプログラムの決めごと。
//     FAR_MM は大小の比較にだけ使い、左右の差は両側とも距離のときだけ計算する (差の計算に仮の距離を入れない)。
//   ・RC_read の値を信じる距離の上限は、先頭の定数 LIMIT_MM に書き、プログラムが最初に RC_setReadLimit(LIMIT_MM) で決める (正本 RumiCar-lib v0.7.0／
//     RasPi RumiCar.py 0.7.0 からの API。上限の数値を書くのはその定数だけ・上限より先は RC_read が -3 を返す。値の決め方は docs/physics_model.md §12「上限の決め方」)。
//   ・出力は RC_read が返した値のまま (-3 がそのまま見える)。
// シミュレータの前・左・右のセンサーは -1 を返さない (センサーノイズ ON の欠測も -3＝sensors.js。-1 は後方センサー未装備の RC_read(REAR) だけ)。
// -1 で止まるブロックは、同じプログラムを実機で動かしたときのタイムアウトのためのもので、シミュレータでの走りは v12.0.0 の見本と同じ。
// 通路は上限より広いので、右の壁に寄って沿い、前に壁が見えたら開いている方へ、
// 右の壁を見失ったら右へ切って探し、詰まったら後退して切り返す。c は Arduino RumiCar-lib、py は RasPi RumiCar.py の形 (最上位の
// while True:。Zero2Cam は def setup()/def loop() の形が要るので py_normal_fr を見る)、js はシミュレータ専用。回数で数える定数
// (BACKT・SEEK) は loop の周期 (シムは 20 Hz) に依存するので、周期の違う実機では見直す。
// v11.x までの見本は RC_setReadLimit の行が無く、ライブラリが卓上では 200 mm で一律に打ち切っていた。上限をその値にしたこの見本は、
// 卓上では RC_read から v11.x と同じ値を受け取り、同じ走りをする (wf_bh6_docs.mjs の D 章が 56 コースの verifyHash を v11.1.0 の値と照合する)。
export const SAMPLES = {
  c: `// Arduino C++ (Arduino Nano / Raspberry Pi Pico)。RumiCar-lib の API。
// RC_read(LEFT/CENTER/RIGHT) の値は、まず 0 以上かで分ける: 0〜上限 = 距離[mm]。負の数はステータスで、距離ではない
//   (-1 = センサーが応答しない・-3 = 範囲外＝その方向の上限より手前に測れた物が無い)。ステータスの処理は loop() の最初のブロックにまとめる。
// 上限 = RC_read の値を信じる距離の上限。先頭の LIMIT_MM に書き、setup() の RC_setReadLimit で決める (値の決め方は物理モデル解説 docs/physics_model.md §12「上限の決め方」)。
// 通路は上限より広いので、真ん中では左右とも -3 になる。∴ 右の壁に寄って沿う (両側が見えれば左右の差で真ん中へ)。
// -1 は止まる (シミュレータの前・左・右は -1 を返さない。実機ではセンサーのタイムアウトで返る)。-3 は数としては最も小さいので、
//   比べる前に FAR_MM へ置き換える (「遠い」とみなすのはこのプログラムの決めごと。FAR_MM は大小の比較にだけ使う)。
int LIMIT_MM = 200; // RC_read の値を信じる距離の上限 [mm]。これより先は RC_read が -3 (範囲外) を返す。上限を変えるときはこの 1 行を直す
int FAR_MM = 9999;  // 範囲外 (-3) を「遠い」として比べるための値。RC_read が返すどの距離 (卓上は最大 2000 mm) よりも大きい＝上限を変えても直さなくてよい
int TOP = 240;      // 速度: 壁に沿って安定しているとき (255 = 全開)
int CRUISE = 180;   // 速度: 壁を探す・寄せるとき
int TURNV = 110;    // 速度: 前に壁が見えて曲げるとき (抜くほど小さく回れる)
int BACKV = 150;    // 速度: 後退
int NEAR = 100;     // 右の壁がこれより近ければ左へ [mm]
int FARB = 170;     // 右の壁がこれより遠ければ右へ [mm]
int ESC = 80;       // 前方がこれより近ければ後退して切り返す [mm]
int BACKT = 8;      // 後退を続ける回数 (20 Hz なら 0.4 秒)
int SEEK = 4;       // 壁を見失ってから全舵で切り続ける回数 (その後は半分の時間だけ切って大回り)

int back = 0;       // 後退の残り回数
int bdir = CENTER;  // 後退中の舵
int lost = 0;       // 右の壁を見失ってからの回数

void setup() {
  RC_setup();
  RC_setReadLimit(LIMIT_MM);      // LIMIT_MM より先は RC_read が -3 (範囲外) を返す
}

void loop() {
  int L = RC_read(LEFT);
  int C = RC_read(CENTER);
  int R = RC_read(RIGHT);
  Serial.print(L); Serial.print(" "); Serial.print(C); Serial.print(" "); Serial.println(R);   // RC_read が返した値のまま出す (-3 は範囲外で、距離ではない)

  if (L < 0 || C < 0 || R < 0) {  // ステータス (負の数は距離ではない)。ステータスの処理はこのブロックにまとめる
    if (L == -1 || C == -1 || R == -1) {   // -1: センサーが応答しない → 止まる (この回は判断しない)
      RC_drive(BRAKE, 0);
      return;
    }
    if (L == -3) L = FAR_MM;      // -3: 範囲外 (上限より手前に測れた物が無い) を「遠い」として比べる
    if (C == -3) C = FAR_MM;
    if (R == -3) R = FAR_MM;
  }
  // ここから先の L・C・R は距離 [mm] (範囲外は FAR_MM)

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
  if (C < 200) {                  // 前に壁: 開いている方へ (距離のしきい値は LIMIT_MM 以下にする。ESC・NEAR・FARB も同じ)
    if (R > L) RC_steer(RIGHT); else RC_steer(LEFT);
    RC_drive(FORWARD, TURNV);
    return;
  }
  if (L < FAR_MM && R < FAR_MM) { // 両側に壁 (狭い通路): 左右の差で真ん中へ (差を使うのは、両側とも距離のときだけ)
    lost = 0;
    if (L + 20 < R) RC_steer(RIGHT);
    else if (R + 20 < L) RC_steer(LEFT);
    else RC_steer(CENTER);
    RC_drive(FORWARD, CRUISE);
    return;
  }
  if (R == FAR_MM) {              // 右の壁が見えない: 右へ切って探す
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
# RC_read(LEFT/CENTER/RIGHT) の値は、まず 0 以上かで分ける: 0〜上限 = 距離[mm]。負の数はステータスで、距離ではない
#   (-1 = センサーが応答しない・-3 = 範囲外＝その方向の上限より手前に測れた物が無い)。ステータスの処理はループの最初のブロックにまとめる。
# 上限 = RC_read の値を信じる距離の上限。先頭の LIMIT_MM に書き、最初に RC_setReadLimit で決める (値の決め方は物理モデル解説 docs/physics_model.md §12「上限の決め方」)。
# 通路は上限より広いので、真ん中では左右とも -3 になる。∴ 右の壁に寄って沿う (両側が見えれば左右の差で真ん中へ)。
# -1 は止まる (シミュレータの前・左・右は -1 を返さない。実機ではセンサーのタイムアウトで返る)。-3 は数としては最も小さいので、
#   比べる前に FAR_MM へ置き換える (「遠い」とみなすのはこのプログラムの決めごと。FAR_MM は大小の比較にだけ使う)。
from RumiCar import *

LIMIT_MM = 200  # RC_read の値を信じる距離の上限 [mm]。これより先は RC_read が -3 (範囲外) を返す。上限を変えるときはこの 1 行を直す
FAR_MM = 9999   # 範囲外 (-3) を「遠い」として比べるための値。RC_read が返すどの距離 (卓上は最大 2000 mm) よりも大きい＝上限を変えても直さなくてよい
TOP = 240       # 速度: 壁に沿って安定しているとき (255 = 全開)
CRUISE = 180    # 速度: 壁を探す・寄せるとき
TURNV = 110     # 速度: 前に壁が見えて曲げるとき (抜くほど小さく回れる)
BACKV = 150     # 速度: 後退
NEAR = 100      # 右の壁がこれより近ければ左へ [mm]
FARB = 170      # 右の壁がこれより遠ければ右へ [mm]
ESC = 80        # 前方がこれより近ければ後退して切り返す [mm]
BACKT = 8       # 後退を続ける回数 (20 Hz なら 0.4 秒)
SEEK = 4        # 壁を見失ってから全舵で切り続ける回数 (その後は半分の時間だけ切って大回り)

back = 0        # 後退の残り回数
bdir = CENTER   # 後退中の舵
lost = 0        # 右の壁を見失ってからの回数

RC_setup()
RC_setReadLimit(LIMIT_MM)           # LIMIT_MM より先は RC_read が -3 (範囲外) を返す
while True:
    L = RC_read(LEFT)
    C = RC_read(CENTER)
    R = RC_read(RIGHT)
    print(L, C, R)                  # RC_read が返した値のまま出す (-3 は範囲外で、距離ではない)

    if L < 0 or C < 0 or R < 0:     # ステータス (負の数は距離ではない)。ステータスの処理はこのブロックにまとめる
        if L == -1 or C == -1 or R == -1:   # -1: センサーが応答しない → 止まる (この回は判断しない)
            RC_drive(BRAKE, 0)
            continue
        if L == -3:                 # -3: 範囲外 (上限より手前に測れた物が無い) を「遠い」として比べる
            L = FAR_MM
        if C == -3:
            C = FAR_MM
        if R == -3:
            R = FAR_MM
    # ここから先の L・C・R は距離 [mm] (範囲外は FAR_MM)

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
    if C < 200:                     # 前に壁: 開いている方へ (距離のしきい値は LIMIT_MM 以下にする。ESC・NEAR・FARB も同じ)
        if R > L:
            RC_steer(RIGHT)
        else:
            RC_steer(LEFT)
        RC_drive(FORWARD, TURNV)
        continue
    if L < FAR_MM and R < FAR_MM:   # 両側に壁 (狭い通路): 左右の差で真ん中へ (差を使うのは、両側とも距離のときだけ)
        lost = 0
        if L + 20 < R:
            RC_steer(RIGHT)
        elif R + 20 < L:
            RC_steer(LEFT)
        else:
            RC_steer(CENTER)
        RC_drive(FORWARD, CRUISE)
        continue
    if R == FAR_MM:                 # 右の壁が見えない: 右へ切って探す
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
// RC_read(LEFT/CENTER/RIGHT) の値は、まず 0 以上かで分ける: 0〜上限 = 距離[mm]。負の数はステータスで、距離ではない
//   (-1 = センサーが応答しない・-3 = 範囲外＝その方向の上限より手前に測れた物が無い)。ステータスの処理は loop() の最初のブロックにまとめる。
// 上限 = RC_read の値を信じる距離の上限。先頭の LIMIT_MM に書き、setup() の RC_setReadLimit で決める (値の決め方は物理モデル解説 docs/physics_model.md §12「上限の決め方」)。
// 通路は上限より広いので、真ん中では左右とも -3 になる。∴ 右の壁に寄って沿う (両側が見えれば左右の差で真ん中へ)。
// -1 は止まる (シミュレータの前・左・右は -1 を返さない。実機ではセンサーのタイムアウトで返る)。-3 は数としては最も小さいので、
//   比べる前に FAR_MM へ置き換える (「遠い」とみなすのはこのプログラムの決めごと。FAR_MM は大小の比較にだけ使う)。
const LIMIT_MM = 200; // RC_read の値を信じる距離の上限 [mm]。これより先は RC_read が -3 (範囲外) を返す。上限を変えるときはこの 1 行を直す
const FAR_MM = 9999;  // 範囲外 (-3) を「遠い」として比べるための値。RC_read が返すどの距離 (卓上は最大 2000 mm) よりも大きい＝上限を変えても直さなくてよい
const TOP = 240;      // 速度: 壁に沿って安定しているとき (255 = 全開)
const CRUISE = 180;   // 速度: 壁を探す・寄せるとき
const TURNV = 110;    // 速度: 前に壁が見えて曲げるとき (抜くほど小さく回れる)
const BACKV = 150;    // 速度: 後退
const NEAR = 100;     // 右の壁がこれより近ければ左へ [mm]
const FARB = 170;     // 右の壁がこれより遠ければ右へ [mm]
const ESC = 80;       // 前方がこれより近ければ後退して切り返す [mm]
const BACKT = 8;      // 後退を続ける回数 (20 Hz なら 0.4 秒)
const SEEK = 4;       // 壁を見失ってから全舵で切り続ける回数 (その後は半分の時間だけ切って大回り)

let back = 0;         // 後退の残り回数
let bdir = CENTER;    // 後退中の舵
let lost = 0;         // 右の壁を見失ってからの回数

function setup() {
  RC_setup();
  RC_setReadLimit(LIMIT_MM);      // LIMIT_MM より先は RC_read が -3 (範囲外) を返す
}

function loop() {
  let L = RC_read(LEFT), C = RC_read(CENTER), R = RC_read(RIGHT);
  Serial.println(L + " " + C + " " + R);   // RC_read が返した値のまま出す (-3 は範囲外で、距離ではない)

  if (L < 0 || C < 0 || R < 0) {  // ステータス (負の数は距離ではない)。ステータスの処理はこのブロックにまとめる
    if (L === -1 || C === -1 || R === -1) {   // -1: センサーが応答しない → 止まる (この回は判断しない)
      RC_drive(BRAKE, 0);
      return;
    }
    if (L === -3) L = FAR_MM;     // -3: 範囲外 (上限より手前に測れた物が無い) を「遠い」として比べる
    if (C === -3) C = FAR_MM;
    if (R === -3) R = FAR_MM;
  }
  // ここから先の L・C・R は距離 [mm] (範囲外は FAR_MM)

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
  if (C < 200) {                  // 前に壁: 開いている方へ (距離のしきい値は LIMIT_MM 以下にする。ESC・NEAR・FARB も同じ)
    RC_steer(R > L ? RIGHT : LEFT);
    RC_drive(FORWARD, TURNV);
    return;
  }
  if (L < FAR_MM && R < FAR_MM) { // 両側に壁 (狭い通路): 左右の差で真ん中へ (差を使うのは、両側とも距離のときだけ)
    lost = 0;
    if (L + 20 < R) RC_steer(RIGHT);
    else if (R + 20 < L) RC_steer(LEFT);
    else RC_steer(CENTER);
    RC_drive(FORWARD, CRUISE);
    return;
  }
  if (R === FAR_MM) {             // 右の壁が見えない: 右へ切って探す
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
