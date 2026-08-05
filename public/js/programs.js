// 車種別 走行プログラム集 "Fable Racing Line" (by Fable 5)
// ★学習用に「段階的」に並べてある★ 各車の物理特性 (config.js の DRIVE) を引き出すロジックを、
// 単純な基準(ノーマルFR)から順に足していく構成。Arduino C++ 形式で実機 RumiCar でも動作する。
//
// 学びの順序:
//   Lv1 ノーマルFR  「基準」      … 素直な車。小細工なしのギャップフォロワーがそのまま速い。
//   Lv2 ノーマル4WD 「強みを使う」  … トラクションを活かし“コーナー出口で誰より早く全開”。
//   Lv3 ノーマルFF  「弱点を補う」  … 前輪が駆動+操舵 → 曲げる時はアクセルを抜く(核ロジック)。
//   Lv4 ドリフトFR  「状況で技を切替」… 基本グリップ+切り返し/レイトアペックス/ブレーキドリフト/防御。
//   Lv5 ドリフト4WD 「技を切替+定数」… 回頭ドリフトは外し(滑っても回頭しない)、重量級向け定数で攻める。
//   Lv6 ドリフトFF  「特殊を管理+」  … “急にアクセルを抜くと”滑る → レート制限を維持しつつ技を追加。
//
// つまり: 定数だけで足りる車(FR基準)と、個別ロジックが要る車(4WDの立ち上がり全開, FFの操舵中リフト)、
//   そして「滑りが合理的な局面だけドリフトを使う」状況切替(Lv4-6)がある——という学びになる。
// 車種を選ぶとその車のプログラムが自動で入り、別車種のを入れて挙動差を比べることもできる。

const FR_CODE = `// Apex Hunter — ノーマル FR 用  [Fable Racing Line / Lv1 基準]  by Fable 5
// 実測 (v6.0.0・完走が定義される全41コース中39コース・既定3台・laps=3・rejoin=OFF): 37/39 完走。
// 素直なFRはこの単純ロジックで6種中トップ級。
// ★学習の出発点★ FRは駆動(後輪)と操舵(前輪)が分かれるので最も素直に曲がる(us=0.10)。
// だから小細工なしの「素直なギャップフォロワー」がそのまま良く走る。まずこれで基本を掴もう。
//
// 全車に共通する土台ロジック(4つ):
//   (1) 前方センサー C の空き具合で速度を3段に変える(直線=速い / 中速 / コーナー=遅い)
//   (2) 前が詰まったら左右で「広い方」へ全力で曲げる
//   (3) 側方の壁が近ければ離れる方向へ補正する
//   (4) 前が塞がったまま開いてこなければ、いったん下がって切り返す(行き止まり脱出)
// 他の車種は「この土台に何を足すか/引くか」で特性を引き出す。FRは足す必要が少ない=基準。
// ※FRはアクセルONで少しリアが出る(powerOs=0.40)ので、旋回中だけ上限PWM(TCAP)で軽く抑える。

int TOP=250, CRUISE=215, SLOW=130, TCAP=195;       // 速度: 直線/中速/コーナー/旋回中の上限
int D_OPEN=620, D_MID=405, D_TURN=375, D_SIDE=180; // 判定距離[mm]
int CONF=640, OPEN=9999;   // 信頼区間[mm]: これを超える/範囲外(-3)の測距は「遠い/開放」とみなす。
// 実機 VL53L0X は地面拘束・低信号で ~250mm 超を信頼しにくい。本シム卓上コースは実機模型の約2.5倍
// 広い(廊下~550mm)ため実スケール換算 ~640mm(=250×2.56) を既定にする。★実機へ移すときは自機の
// 車体/搭載高に合わせて下げ(目安250mm)、併せて速度も落とすこと。fullscale は 250×領域スケール。

int ESC=120, STUCK=1, BACK=7, SETTLE=4;   // (4) [脱出] 前方が ESC[mm] 未満で「詰まり続け」が STUCK 回
int prevC; int seen; int stuckT; int escBack; int escRec; int escDir;  // 続いたら行き止まり → BACK 回後退 → SETTLE 回落ち着き
// 3値操舵は最小旋回半径が決まっているので、それより小さいコーナーは「下がって角度を作り直す」しか
// 通れない(実機でも同じ)。要点は2つ:
//   ★掠めただけでは発火させない★ 速いコースでは壁を数十mmでかすめるのが普通(実測: 全3台完走できる
//     コースでも前方最小 25mm まで詰まる)。距離だけで判定すると正常な走行を壊す。だから「近い」に
//     加えて「前方が開いてこない(dC<=0)」を必須にする — かすめて抜ける場面は前方が開くので発火しない。
//   ★後退中は舵を固定する★ 毎回 L/R を見比べて舵を選び直すと左右にぶれて同じ場所を往復し(極限周回)、
//     ヘアピンから出られなくなる。抜ける向きは入った瞬間に決めて、後退の間ずっと保つ。

void setup() { RC_setup(); prevC = 0; seen = 0; stuckT = 0; escBack = 0; escRec = 0; escDir = CENTER; }

void loop() {
  int L = sensor0.readRangeSingleMillimeters(); if (L < 0 || L > CONF) L = OPEN;  // 信頼区間外/範囲外=開放
  int C = sensor1.readRangeSingleMillimeters(); if (C < 0 || C > CONF) C = OPEN;
  int R = sensor2.readRangeSingleMillimeters(); if (R < 0 || R > CONF) R = OPEN;

  // (4) ★行き止まりからの脱出★ 詰まり続けたら、開いている側へ鼻先が向くよう“逆ハンで後退”する。
  int dC = 0; if (seen == 1) dC = C - prevC; prevC = C; seen = 1;   // dC<=0 = 前方が開いてこない
  if (C < ESC && dC <= 0) stuckT = stuckT + 1;   // 「近い」かつ「開かない」が続いた回数
  if (C >= ESC) stuckT = 0;                      // 前が開いたら解除
  if (escBack > 0) { escBack = escBack - 1; RC_steer(escDir); RC_drive(REVERSE, 170); return; }   // 舵を固定して後退
  if (escRec > 0) { escRec = escRec - 1; RC_steer(CENTER); RC_drive(FORWARD, 90); return; }       // 直後は落ち着かせる
  if (stuckT >= STUCK) {
    if (L > R) escDir = RIGHT; else escDir = LEFT;   // 開いている側へ鼻先が向く舵を“入口で決めて”固定
    escBack = BACK; escRec = SETTLE; stuckT = 0;
    RC_steer(escDir); RC_drive(REVERSE, 170); return;
  }

  // (2)(3) 操舵: 前が詰まれば広い方へ、側方が近ければ「近い方の壁から」離れる
  int turning = 1;
  if (C < D_TURN) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); }
  else if (L < D_SIDE || R < D_SIDE) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); }
  else { RC_steer(CENTER); turning = 0; }

  // (1) 速度: 前方が開けているほど速く
  int pwm = SLOW;
  if (C > D_OPEN) pwm = TOP;
  else if (C > D_MID) pwm = CRUISE;
  if (turning == 1 && pwm > TCAP) pwm = TCAP;  // 旋回中は軽く抑え巻き込みを防ぐ
  RC_drive(FORWARD, pwm);
}
`;

const AWD_CODE = `// Traction Blitz — ノーマル 4WD 用  [Fable Racing Line / Lv2 強みを使う]  by Fable 5
// 実測 (v6.0.0・同条件): 35/39 完走。最高速級。
// 4WDは四輪で路面を掴み発進空転がほぼ無く(spin=0)、加速が最強(accel=1.25)・最高速も上。
// 弱点はやや重くアンダー寄り(massが大)。
// ★引き出すロジック★ 他車にはできない「コーナー出口で“誰より早く”フル加速」。
//   前方距離 C の前回との差 dC を取り、前が開き出した瞬間(dC>0=立ち上がり)に全開へ。
//   FR/FFが同じことをすると空転やオーバー/アンダーで膨らむが、4WDはトラクションで決まる。
// 基準(FR)との違い: 速度3段は同じ。そこに「立ち上がり検知 → 即全開」を足しただけ。

int TOP=235, CRUISE=215, SLOW=140, TCAP=208;  // 動力学モデル較正: 255/226/150 は制動が
                                              // 間に合わず刺さる (kin でも 235/215/140 の方が完走+1)
int D_OPEN=645, D_MID=410, D_TURN=386, D_SIDE=178;
int CONF=640, OPEN=9999;   // 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」。実機 VL53L0X は地面拘束で
// ~250mm 超を信頼しにくい。本シム卓上は実機模型の約2.5倍広いので実スケール換算 ~640mm を既定にする。
// ★実機へ移すときは自機の車体/搭載高に合わせて下げ(目安250mm)速度も落とす。fullscale は 250×領域スケール。
int EXIT=18;            // 前方が1ループでこの[mm]以上開いたら=コーナー脱出 → 立ち上がり全開
int ESC=100, STUCK=1, BACK=7, SETTLE=6;   // [脱出] 基準FRと同じ土台。詰まり続けたら BACK 回後退→SETTLE 回落ち着き。
int stuckT; int escBack; int escRec; int escDir;   //   掠めただけでは発火させず、後退中は舵を固定する。
int prevC; int started; // 前回の前方距離 (差分=接近/開きの検知に使う)

void setup() { RC_setup(); prevC = 0; started = 0; stuckT = 0; escBack = 0; escRec = 0; escDir = CENTER; }

void loop() {
  int L = sensor0.readRangeSingleMillimeters(); if (L < 0 || L > CONF) L = OPEN;  // 信頼区間外/範囲外=開放
  int C = sensor1.readRangeSingleMillimeters(); if (C < 0 || C > CONF) C = OPEN;
  int R = sensor2.readRangeSingleMillimeters(); if (R < 0 || R > CONF) R = OPEN;
  int dC = 0;
  if (started == 1) dC = C - prevC;   // dC>0 = 前方が開いてくる = コーナーの立ち上がり
  prevC = C; started = 1;
  // ★行き止まりからの脱出★ 詰まり続けたら開いている側へ鼻先を向けて後退 (立ち上がり検知は持ち越さない)
  if (C < ESC && dC <= 0) stuckT = stuckT + 1;   // 「近い」かつ「開かない」が続いた回数
  if (C >= ESC) stuckT = 0;                      // 前が開いたら解除
  if (escBack > 0) { escBack = escBack - 1; RC_steer(escDir); RC_drive(REVERSE, 170); started = 0; return; }
  if (escRec > 0) { escRec = escRec - 1; RC_steer(CENTER); RC_drive(FORWARD, 90); started = 0; return; }
  if (stuckT >= STUCK) {
    if (L > R) escDir = RIGHT; else escDir = LEFT;
    escBack = BACK; escRec = SETTLE; stuckT = 0; started = 0;
    RC_steer(escDir); RC_drive(REVERSE, 170); return;
  }

  int turning = 1;
  if (C < D_TURN) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); }
  else if (L < D_SIDE || R < D_SIDE) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); }   // 近い方の壁から離れる
  else { RC_steer(CENTER); turning = 0; }

  int pwm = SLOW;
  if (C > D_OPEN) pwm = TOP;
  else if (C > D_MID) pwm = CRUISE;
  if (turning == 1 && pwm > TCAP) pwm = TCAP;
  // ★立ち上がり全開★ コーナーを抜け前方が開き出したら、トラクションを信じて即フルパワー
  if (dC > EXIT && C > D_MID) pwm = TOP;
  RC_drive(FORWARD, pwm);
}
`;

const FF_CODE = `// Steady Nose — ノーマル FF 用  [Fable Racing Line / Lv3 弱点を補う]  by Fable 5
// 実測 (v6.0.0・同条件): 31/39 完走。乾いた路面ではFFは構造上やや遅いが安定。
//   ※FFの真価は雨(低グリップ)。攻めるとテールの出る車は自滅するが、アンダーのFFは生き残る。
// FFは前輪が「駆動」と「操舵」を兼ねる。曲げながらアクセルを踏むと前輪が駆動に取られて
// 曲がる力を失い、外へ膨らむ(パワーアンダー, powerUs=0.50)。発進空転も大きい(spin=0.45)。
// 一方エンジンが前にあり制動は安定(brake=1.08)。
// ★引き出すロジック(基準と“決定的に違う”点)★
//   「操舵している間はアクセルを抜く」。前輪に“曲げる仕事”を専念させ、まっすぐで踏む。
//   速度を前方距離だけでなく『今ハンドルを切っているか』で決めるのが核。これがFFの肝。

int TOP=250, CRUISE=205, SLOW=120, TURN_PWM=120;   // TURN_PWM=操舵中に抜く先の低PWM
int D_OPEN=600, D_MID=440, D_TURN=400, D_SIDE=190;
int CONF=640, OPEN=9999;   // 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」。実機 VL53L0X は地面拘束で
// ~250mm 超を信頼しにくい。本シム卓上は実機模型の約2.5倍広いので実スケール換算 ~640mm を既定にする。
// ★実機へ移すときは自機の車体/搭載高に合わせて下げ(目安250mm)速度も落とす。fullscale は 250×領域スケール。

int ESC=110, STUCK=1, BACK=5, SETTLE=4;   // [脱出] 基準FRと同じ土台。詰まり続けたら BACK 回後退→SETTLE 回落ち着き。
int prevC; int seen; int stuckT; int escBack; int escRec; int escDir;
// FF は前輪が駆動と操舵を兼ねるぶん曲がりきれず詰まりやすいので切り返しの効きが大きい。
// ★掠めただけでは発火させない★ =「近い」かつ「開かない」が続いたときだけ行き止まりとみなす。
// ★後退中は舵を固定する★ =左右にぶれて同じ場所を往復するのを防ぐ。

void setup() { RC_setup(); prevC = 0; seen = 0; stuckT = 0; escBack = 0; escRec = 0; escDir = CENTER; }

void loop() {
  int L = sensor0.readRangeSingleMillimeters(); if (L < 0 || L > CONF) L = OPEN;  // 信頼区間外/範囲外=開放
  int C = sensor1.readRangeSingleMillimeters(); if (C < 0 || C > CONF) C = OPEN;
  int R = sensor2.readRangeSingleMillimeters(); if (R < 0 || R > CONF) R = OPEN;

  // ★行き止まりからの脱出★ 詰まり続けたら、開いている側へ鼻先が向くよう“逆ハンで後退”する。
  int dC = 0; if (seen == 1) dC = C - prevC; prevC = C; seen = 1;   // dC<=0 = 前方が開いてこない
  if (C < ESC && dC <= 0) stuckT = stuckT + 1;   // 「近い」かつ「開かない」が続いた回数
  if (C >= ESC) stuckT = 0;                      // 前が開いたら解除
  if (escBack > 0) { escBack = escBack - 1; RC_steer(escDir); RC_drive(REVERSE, 170); return; }
  if (escRec > 0) { escRec = escRec - 1; RC_steer(CENTER); RC_drive(FORWARD, 90); return; }  // 脱出直後は落ち着かせる
  if (stuckT >= STUCK) {
    if (L > R) escDir = RIGHT; else escDir = LEFT;
    escBack = BACK; escRec = SETTLE; stuckT = 0;
    RC_steer(escDir); RC_drive(REVERSE, 170); return;
  }

  int steering = 1;   // 1=今ハンドルを切っている, 0=まっすぐ
  if (C < D_TURN) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); }
  else if (L < D_SIDE || R < D_SIDE) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); }   // 近い方の壁から離れる
  else { RC_steer(CENTER); steering = 0; }

  // ★FFの肝★ 操舵中はアクセルを抜き(前輪を操舵に専念)、まっすぐなら前方の空きで加速する。
  int pwm;
  if (steering == 1) pwm = TURN_PWM;
  else if (C > D_OPEN) pwm = TOP;
  else if (C > D_MID) pwm = CRUISE;
  else pwm = SLOW;
  RC_drive(FORWARD, pwm);
}
`;

const DFR_CODE = `// Drift Maestro — ドリフト FR 用  [Fable Racing Line / Lv4 状況で技を切替]  by Fable 5
// 試走(ドライ31コース×60秒): standard 31/31 完走 / 動力学モデル 30/31 (旧Grip Reaper: 28/31)。
// ウェット2コース (grip0.5/0.55) も両モード完走 ([TC] トラクション管理による)。
// ドリフトは「滑らせるほど速い」のではない。平坦ドライでは滑り=外への横流れ=ロスで、
// 基本はグリップが速い (滑る手前 TCAP の自制は旧版と同じ)。速さの源は“技の使い分け”:
//   [脱出] 前方が壁ぴったり → 開いた側へ鼻先を振る逆ハン後退 (ドリフトの切り返し/180°ターンの応用)
//   [出口] 出口で前が開いても内側壁が近い間は加速を我慢+外へ当て舵 (レイトアペックス)。
//          出口の壁刺さり(ストリート等のクラッシュ原因)はほぼこれで消える。
//   [回頭] 深いコーナーで進入速度過多 (前方が閉じ続ける=下り等) の時だけブレーキドリフト:
//          BRAKE で前荷重→リアが流れ、“減速しながら回頭”する。滑りが合理的なのはここ。
//   [TC]   アクセルは踏み足し上限つき (トラクション管理)。一気に踏むと駆動が摩擦を食い尽くし
//          “直進中なのに横が消える”——ウェット路面 (grip0.5) では発進加速だけで独楽スピンになる
//          (実測)。踏み足しを絞ればウェットでも横グリップが残り、ドライの最高速は変わらない。
//          雨をセンサーで当てにいく案 (舵と逆側レイの低下検知) はドライのコーナーでも同じ
//          見え方が頻発して判別不能だった——“雨でも死なない踏み方を常にする”が正解。
//   [防御] 後方センサー(任意装備・OFFなら無効)が追走車を検知 → ライン占有 or ドリフトウォール
//          (テールを左右に流して車幅で塞ぐ。広い直線では追走車を 100%→4% に完封する唯一の技)。

int TOP=225, CRUISE=205, SLOW=120, TCAP=150;        // 速度3段 + 旋回中の上限 (滑る手前)
                     // TOP は 225 に抑える: 動力学モデルはモーターブレーキが後輪のみ
                     // (減速 ≈1.4-1.9 m/s²) で、248 だとコーナー出現に減速が間に合わない
int D_OPEN=620, D_MID=420, D_TURN=385, D_SIDE=190;  // 判定距離[mm]
int CONF=640, OPEN=9999;   // 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」。実機 VL53L0X は地面拘束で
// ~250mm 超を信頼しにくい。本シム卓上は実機模型の約2.5倍広いので実スケール換算 ~640mm を既定にする。
// ★実機へ移すときは自機の車体/搭載高に合わせて下げ(目安250mm)速度も落とす。fullscale は 250×領域スケール。
int ESC=90;          // [脱出] 前方がこれ未満=行き止まり
int GUARD=250;       // [出口] 内側壁がこれ未満なら加速を我慢
int TRIG_T=6;        // [回頭] 旋回がこの tick 数続く=深いコーナー
int DCF=24;          // [回頭] 1tick にこれ[mm]以上閉じ続ける=進入速度過多
int BURST=2, GAP=8;  // [回頭] ブレーキドリフトのデューティ (BRAKE 2 / 前進 8)
int RAMP=5;          // [TC] 1tick の踏み足し上限 (PWM)。+5/tick ≈ 0.29m/s² の加速要求で、
                     //      ウェット(grip0.5)の駆動上限 ≈0.86m/s² の1/3=横グリップを残して加速。
                     //      掃引実測 (5/6/8/10/12/15/20/∞): 5 だけが ドライ/ウェット/峠 全勝
                     //      (緩すぎても単コースは軌道カオスで悪化しうる。総合で判断)
int DEF_STYLE=2;     // [防御] 0=なし 1=ライン占有(狭路向き) 2=ドリフトウォール(広い直線向き)
int turnT; int prevTurn; int pC; int started; int fastT; int defT; int defOn;
int spdT; int escRec; int cur;

void setup() { RC_setup(); turnT=0; prevTurn=0; pC=0; started=0; fastT=0; defT=0; defOn=0; spdT=0; escRec=0; cur=0; }

void loop() {
  int L = sensor0.readRangeSingleMillimeters(); if (L < 0 || L > CONF) L = OPEN;  // 信頼区間外/範囲外=開放
  int C = sensor1.readRangeSingleMillimeters(); if (C < 0 || C > CONF) C = OPEN;
  int R = sensor2.readRangeSingleMillimeters(); if (R < 0 || R > CONF) R = OPEN;
  int dC = 0; if (started == 1) dC = C - pC; pC = C; started = 1;
  // 速度の目安: 前が開いていた直後だけ「速い」(低速の定常旋回ではレイ掃引で dC が
  // 急減して [回頭] が誤発火する — kin では無害だが dyn ではパワーオーバーで刺さる)
  if (C > D_MID) spdT = 10; else if (spdT > 0) spdT = spdT - 1;

  // [脱出] 行き止まり: 開いている側へ鼻先が向くよう逆ハンで後退 (壁前38mmでも生還)
  if (C < ESC) { if (L > R) RC_steer(RIGHT); else RC_steer(LEFT); RC_drive(REVERSE, 170); turnT = 0; escRec = 4; cur = 0; return; }
  // [脱出] 直後はタイヤを落ち着かせてから通常制御へ (dyn での前後往復スピンを断つ)
  if (escRec > 0) { escRec = escRec - 1; RC_steer(CENTER); RC_drive(FORWARD, 90); cur = 90; return; }

  // [防御] 後方に追走車 → 約3秒防御を維持 (横に並ばれ後方レイが見失っても解かない)
  int B = RC_read(BACK);
  if (B >= 0 && B < 650) defOn = 60; else if (defOn > 0) defOn = defOn - 1;
  defT = defT + 1;
  if (DEF_STYLE > 0 && defOn > 0) {
    if (C < 380) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); RC_drive(FORWARD, 150); cur = 150; return; }
    if (R < 175) { RC_steer(LEFT); RC_drive(FORWARD, 120); cur = 120; return; }
    if (L < 175) { RC_steer(RIGHT); RC_drive(FORWARD, 120); cur = 120; return; }
    if (DEF_STYLE == 2) {  // ドリフトウォール: 振り出し→逆ハンの繰り返しでテールを流し車幅を塞ぐ
      int ph = defT % 24;
      if (ph < 6) { RC_steer(LEFT); RC_drive(FORWARD, 210); cur = 210; }
      else if (ph < 12) { RC_steer(RIGHT); RC_drive(FORWARD, 120); cur = 120; }
      else if (ph < 18) { RC_steer(RIGHT); RC_drive(FORWARD, 210); cur = 210; }
      else { RC_steer(LEFT); RC_drive(FORWARD, 120); cur = 120; }
      return;
    }
    RC_steer(CENTER); RC_drive(FORWARD, 150); cur = 150; return;   // ライン占有 (低速で前を塞ぐ)
  }

  // [通常] グリップ走行: 3段速度 + 旋回中は滑る手前で頭打ち + 出口で急に踏まない (旧版と同じ)
  int t = 1;
  if (C < D_TURN) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); }
  else if (R < D_SIDE) RC_steer(LEFT);
  else if (L < D_SIDE) RC_steer(RIGHT);
  else { RC_steer(CENTER); t = 0; }
  int pwm = SLOW;
  if (C > D_OPEN) pwm = TOP;
  else if (C > D_MID) pwm = CRUISE;
  if (t == 1 && pwm > TCAP) pwm = TCAP;
  if (prevTurn == 1 && t == 0 && pwm > CRUISE) pwm = CRUISE;
  prevTurn = t;

  // [回頭] 深いコーナー & 速度過多が続く → ブレーキドリフト (減速しつつリアを流して回頭)
  if (t == 1 && C < D_TURN) turnT = turnT + 1; else turnT = 0;
  if (t == 1 && dC < 0 - DCF) fastT = fastT + 1; else fastT = 0;
  if (turnT >= TRIG_T && fastT >= 2 && spdT > 0) {
    int ph2 = (turnT - TRIG_T) % (BURST + GAP);
    if (ph2 < BURST) { RC_drive(BRAKE, 255); cur = cur - 40; if (cur < 60) cur = 60; return; }
    int rp = 205;
    if (rp > cur + RAMP) rp = cur + RAMP;
    cur = rp; RC_drive(FORWARD, rp); return;
  }

  // [出口] レイトアペックス: 前が開いても内側壁が近い間は CRUISE 止め + 外へ当て舵
  if (pwm > CRUISE) {
    if (R < GUARD && R < L) { RC_steer(LEFT); pwm = CRUISE; }
    else if (L < GUARD && L < R) { RC_steer(RIGHT); pwm = CRUISE; }
  }
  // [TC] 踏み足しはスルーレート制限 (アクセルを戻す側は即時)
  if (pwm > cur + RAMP) pwm = cur + RAMP;
  cur = pwm;
  RC_drive(FORWARD, pwm);
}
`;

const DAWD_CODE = `// Rally Maestro — ドリフト 4WD 用  [Fable Racing Line / Lv5 技を切替+定数攻め]  by Fable 5
// 試走(ドライ31コース×60秒): standard 30/31 完走 / 動力学モデル 31/31 (旧Rally Tamer: 26/31)。
// 4WDはドリフトFRと違い slipYaw が小さく (0.25)、滑らせても回頭がほぼ増えない=
// “滑らせるドリフト”は4WDでは速さに直結しない (実測でブレーキドリフトは逆効果)。
// そこで Drift Maestro から [回頭] を外し、[脱出]/[出口]/[防御] と
// 「重い4WD向けの定数」(早めに曲げ始める D_TURN=470・低めの TCAP=135・広い GUARD=340) で攻める。
// 学び: 同じ技セットでも“どの技を有効にするか”と“定数”は車の物理で決まる。

int TOP=248, CRUISE=205, SLOW=100, TCAP=135;        // 重い4WD: 旋回はやや抑えめが速い
                     // SLOW は 100: 動力学モデルは旋回中 β≈10° 外へ流れて対地ラインが
                     // 膨らむため、旋回速度を落として締める (kin は 120 と完走数同じ)
int D_OPEN=620, D_MID=420, D_TURN=470, D_SIDE=190;  // 慣性が大きい分、早めに曲げ始める
int CONF=640, OPEN=9999;   // 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」。実機 VL53L0X は地面拘束で
// ~250mm 超を信頼しにくい。本シム卓上は実機模型の約2.5倍広いので実スケール換算 ~640mm を既定にする。
// ★実機へ移すときは自機の車体/搭載高に合わせて下げ(目安250mm)速度も落とす。fullscale は 250×領域スケール。
int ESC=90;          // [脱出] 前方がこれ未満=行き止まり
int GUARD=340;       // [出口] 重さで膨らむ分、ガードを広めに
int DEF_STYLE=2;     // [防御] 0=なし 1=ライン占有 2=ドリフトウォール
int prevTurn; int defT; int defOn;

void setup() { RC_setup(); prevTurn=0; defT=0; defOn=0; }

void loop() {
  int L = sensor0.readRangeSingleMillimeters(); if (L < 0 || L > CONF) L = OPEN;  // 信頼区間外/範囲外=開放
  int C = sensor1.readRangeSingleMillimeters(); if (C < 0 || C > CONF) C = OPEN;
  int R = sensor2.readRangeSingleMillimeters(); if (R < 0 || R > CONF) R = OPEN;

  // [脱出] 行き止まり: 開いている側へ鼻先が向くよう逆ハンで後退
  if (C < ESC) { if (L > R) RC_steer(RIGHT); else RC_steer(LEFT); RC_drive(REVERSE, 170); return; }

  // [防御] 後方に追走車 → 約3秒防御を維持
  int B = RC_read(BACK);
  if (B >= 0 && B < 650) defOn = 60; else if (defOn > 0) defOn = defOn - 1;
  defT = defT + 1;
  if (DEF_STYLE > 0 && defOn > 0) {
    if (C < 380) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); RC_drive(FORWARD, 150); return; }
    if (R < 175) { RC_steer(LEFT); RC_drive(FORWARD, 120); return; }
    if (L < 175) { RC_steer(RIGHT); RC_drive(FORWARD, 120); return; }
    if (DEF_STYLE == 2) {
      int ph = defT % 24;
      if (ph < 6) { RC_steer(LEFT); RC_drive(FORWARD, 210); }
      else if (ph < 12) { RC_steer(RIGHT); RC_drive(FORWARD, 120); }
      else if (ph < 18) { RC_steer(RIGHT); RC_drive(FORWARD, 210); }
      else { RC_steer(LEFT); RC_drive(FORWARD, 120); }
      return;
    }
    RC_steer(CENTER); RC_drive(FORWARD, 150); return;
  }

  // [通常] グリップ走行
  int t = 1;
  if (C < D_TURN) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); }
  else if (R < D_SIDE) RC_steer(LEFT);
  else if (L < D_SIDE) RC_steer(RIGHT);
  else { RC_steer(CENTER); t = 0; }
  int pwm = SLOW;
  if (C > D_OPEN) pwm = TOP;
  else if (C > D_MID) pwm = CRUISE;
  if (t == 1 && pwm > TCAP) pwm = TCAP;
  if (prevTurn == 1 && t == 0 && pwm > CRUISE) pwm = CRUISE;
  prevTurn = t;

  // [出口] レイトアペックス: 前が開いても内側壁が近い間は CRUISE 止め + 外へ当て舵
  if (pwm > CRUISE) {
    if (R < GUARD && R < L) { RC_steer(LEFT); pwm = CRUISE; }
    else if (L < GUARD && L < R) { RC_steer(RIGHT); pwm = CRUISE; }
  }
  RC_drive(FORWARD, pwm);
}
`;

const DFF_CODE = `// Lift Maestro — ドリフト FF 用  [Fable Racing Line / Lv6 特殊を管理+技を切替]  by Fable 5
// 試走(ドライ31コース×60秒): 25/31 完走・タイト4/8・総距離 698m (旧Lift Whisper: 23/31・655m)。
// ドリフトFFは特殊。パワーでは滑らず「高速旋回中にアクセルを“急に”抜くと」リアが流れる
// (リフトオフ・オーバーステア)。だから旧版の肝 = スロットルのレート制限 (RAMP) は維持し、
// そこへ Drift Maestro の [脱出]/[出口]/[防御] を足した。
// ※ [防御] のドリフトウォールは FF でも有効: 振り出し→戻しの減速がリフトオフを誘発し
//   テールが流れて車幅を塞ぐ (FF はこの“抜いて滑らせる”が唯一のドリフト)。

int TOP=234, CRUISE=184, SLOW=114, TCAP=158;        // リフトオフでの過剰な滑り出しを誘発しない上限
int D_OPEN=605, D_MID=458, D_TURN=410, D_SIDE=196;
int CONF=640, OPEN=9999;   // 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」。実機 VL53L0X は地面拘束で
// ~250mm 超を信頼しにくい。本シム卓上は実機模型の約2.5倍広いので実スケール換算 ~640mm を既定にする。
// ★実機へ移すときは自機の車体/搭載高に合わせて下げ(目安250mm)速度も落とす。fullscale は 250×領域スケール。
int RAMP=10;         // 1ループで下げてよいPWM上限 (急リフト禁止 = リフトオフドリフト防止)
int ESC=90;          // [脱出] 前方がこれ未満=行き止まり
int GUARD=250;       // [出口] 内側壁がこれ未満なら加速を我慢
int DEF_STYLE=2;     // [防御] 0=なし 1=ライン占有 2=ドリフトウォール
int prevPwm; int defT; int defOn; int prevTurn;

void setup() { RC_setup(); prevPwm=0; defT=0; defOn=0; prevTurn=0; }

void loop() {
  int L = sensor0.readRangeSingleMillimeters(); if (L < 0 || L > CONF) L = OPEN;  // 信頼区間外/範囲外=開放
  int C = sensor1.readRangeSingleMillimeters(); if (C < 0 || C > CONF) C = OPEN;
  int R = sensor2.readRangeSingleMillimeters(); if (R < 0 || R > CONF) R = OPEN;

  // [脱出] 行き止まり: 開いている側へ鼻先が向くよう逆ハンで後退
  if (C < ESC) { if (L > R) RC_steer(RIGHT); else RC_steer(LEFT); RC_drive(REVERSE, 170); prevPwm = 0; return; }

  // [防御] 後方に追走車 → 約3秒防御を維持
  int B = RC_read(BACK);
  if (B >= 0 && B < 650) defOn = 60; else if (defOn > 0) defOn = defOn - 1;
  defT = defT + 1;
  if (DEF_STYLE > 0 && defOn > 0) {
    if (C < 380) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); RC_drive(FORWARD, 150); return; }
    if (R < 175) { RC_steer(LEFT); RC_drive(FORWARD, 120); return; }
    if (L < 175) { RC_steer(RIGHT); RC_drive(FORWARD, 120); return; }
    if (DEF_STYLE == 2) {
      int ph = defT % 24;
      if (ph < 6) { RC_steer(LEFT); RC_drive(FORWARD, 210); }
      else if (ph < 12) { RC_steer(RIGHT); RC_drive(FORWARD, 120); }
      else if (ph < 18) { RC_steer(RIGHT); RC_drive(FORWARD, 210); }
      else { RC_steer(LEFT); RC_drive(FORWARD, 120); }
      return;
    }
    RC_steer(CENTER); RC_drive(FORWARD, 150); return;
  }

  // [通常] グリップ走行 + リフトオフ回避 (旧版の肝)
  int turning = 1;
  if (C < D_TURN) { if (L > R) RC_steer(LEFT); else RC_steer(RIGHT); }
  else if (R < D_SIDE) RC_steer(LEFT);
  else if (L < D_SIDE) RC_steer(RIGHT);
  else { RC_steer(CENTER); turning = 0; }

  int pwm = SLOW;
  if (C > D_OPEN) pwm = TOP;
  else if (C > D_MID) pwm = CRUISE;
  if (turning == 1 && pwm > TCAP) pwm = TCAP;
  if (prevTurn == 1 && turning == 0 && pwm > CRUISE) pwm = CRUISE;  // 出口で急に踏まない
  prevTurn = turning;

  // [出口] レイトアペックス: 前が開いても内側壁が近い間は CRUISE 止め + 外へ当て舵
  if (pwm > CRUISE) {
    if (R < GUARD && R < L) { RC_steer(LEFT); pwm = CRUISE; }
    else if (L < GUARD && L < R) { RC_steer(RIGHT); pwm = CRUISE; }
  }

  // ★リフトオフ回避★ アクセルを“急に”抜かない。減らす時は1ループ RAMP までに制限。
  if (pwm < prevPwm - RAMP) pwm = prevPwm - RAMP;
  prevPwm = pwm;
  RC_drive(FORWARD, pwm);
}
`;

const SHOW_CODE = `// Drift Showtime — ドリフト FR + 動力学モデル 用ショー演目  by Fable 5
// 「ドリフト広場 (ショー会場)」で踊る非レース・プログラム。実測: 600秒 無事故
// (dyn/standard 両物理)、dyn では全時間の53%が slip>0.4、β最大159° (バックエントリー成立)。
// 演目はループする:
//   [Act1 ドーナツ] 全舵+全開255 → 後輪空転で横力が抜け β≈52°・半径0.25m の安定回転
//   [Act2 8の字]   ドーナツを切り、直線バーストで移動して逆回りのドーナツへ (左右交互)
//   [Act3 バックエントリー] 助走全開 → フェイント → BRAKE+舵で振り出し (u<0.45 へ減速が
//        物理的に必須) → 255+舵で深化 β>90° (テールから進入) → BRAKE+CENTER で停止回収
// 操作列は test_dyn.mjs (donut / backentry シナリオ) の実証値を 20Hz tick に換算した
// オープンループ + 距離センサーの壁ガード。standard 物理でも走るが、β が 45° で
// 頭打ちになるため本領は動力学モデル (車両設定でトグル ON)。
// 信頼区間: この演目は開ループ(タイミング制御)で踊り、ToF は「壁に寄り過ぎたら止める」近距離ガード
// (~数百mm=信頼区間内)だけに使う=測距航法しない。ゆえに遠方読みへの CONF カットオフは設けない。
int at;        // 現在のフェーズ内の経過 tick (20Hz)
int act;       // 0=ドーナツ 1=8の字 2=バックエントリー
int ph;        // 演目内フェーズ
int laps;      // 8の字の回転数 (偶数=右回り、奇数=左回り)
int guardT;    // 壁ガードで退避中の残り tick

void setup() { RC_setup(); at = 0; act = 0; ph = 0; laps = 0; guardT = 0; }

void loop() {
  int L = sensor0.readRangeSingleMillimeters();
  int C = sensor1.readRangeSingleMillimeters();
  int R = sensor2.readRangeSingleMillimeters();

  // [壁ガード] 壁へ寄り過ぎたら「BRAKE で停止 (滑り状態の万能リセット) → 開いた側へ
  // グリップ離脱」。横滑りは前方センサーに映らないので早め (450mm) に拾い、
  // 滑走中に FORWARD で逃げようとしない (エネルギーを足して悪化する — 実測)。
  // バックエントリーの技の最中 (act2 ph>=2) は介入しない。
  if (act != 2 || ph < 2) {
    if (C < 600 || L < 260 || R < 260) { if (guardT == 0) guardT = 36; }
  }
  if (guardT > 0) {
    guardT = guardT - 1;
    if (guardT > 24) { RC_steer(CENTER); RC_drive(BRAKE, 255); return; }   // まず停める
    // 解除は全レイがクリアしてから (C だけで解除すると、横レイが壁を見たまま即再アーム
    // → BRAKE 連打のデッドロックで壁際に居座る — 実測)。
    // ドーナツ相の中断は「その周回は終了」扱いで進める (頭からやり直すと、壁際の周回が
    // 5 秒間ノーガードで完走することは稀で、ショーがその場で進まなくなる — 実測)
    if ((C > 900 && L > 300 && R > 300) || guardT == 0) {
      guardT = 0;
      if (act < 2 && ph == 2) at = 99; else at = 0;
    }
    else {
      if (L > R) RC_steer(LEFT); else RC_steer(RIGHT);
      if (C < 220) { RC_drive(REVERSE, 170); } else { RC_drive(FORWARD, 160); }
      return;
    }
  }

  at = at + 1;

  // ドーナツの作法 (動力学モデル): 255 を入れ続けると u が車輪速上限に達して空転代が消え、
  // 再グリップ→過回転スピン→フィッシュテールの暴れに入る (実測で漂流1.7m/40s)。
  // フレア (255×0.5s) を 170 のグリップ円で挟んでも漂流は溜まるため、約5秒ごとに
  // 「照準→中央へ復帰」を必ず挟む封じ込め構造にする (照準=回転しながら C が開くのを待つ)。
  if (act == 0 || act == 1) {           // [Act1] ドーナツ / [Act2] 8の字 (構造は同じ)
    int lt = 1;                         // この周回の回転方向 (Act1=左固定, Act2=交互)
    if (act == 1 && laps % 2 == 1) lt = 0;
    if (ph == 0) {                      // 照準: グリップ回転で前が大きく開くのを待つ
      if (lt == 1) RC_steer(LEFT); else RC_steer(RIGHT);
      RC_drive(FORWARD, 170);
      if (C > 1700 || at > 70) { ph = 1; at = 0; }
      return;
    }
    if (ph == 1) {                      // 復帰: 開けた方 (≈中央方向) へグリップで戻る
      RC_steer(CENTER); RC_drive(FORWARD, 190);
      if (at >= 14) { ph = 2; at = 0; }
      return;
    }
    if (lt == 1) RC_steer(LEFT); else RC_steer(RIGHT);          // ドーナツ:
    if (at % 34 < 24) RC_drive(FORWARD, 170);                   //   グリップ円で捕まえ
    else RC_drive(FORWARD, 255);                                //   フレアで流す
    if (at >= 100) {
      laps = laps + 1; ph = 0; at = 0;
      if (act == 0 && laps >= 2) { act = 1; at = 0; laps = 0; }
      else if (act == 1 && laps >= 4) { act = 2; at = 0; }
    }
    return;
  }

  // [Act3] バックエントリー
  if (ph == 0) {                        // 仕切り直し (停止=滑り状態のリセット) → 照準
    if (at < 14) { RC_steer(CENTER); RC_drive(BRAKE, 255); return; }   // 決めの間
    RC_steer(LEFT); RC_drive(FORWARD, 170);   // グリップ回転で前と左前方が開くのを待つ
    // L/R レイは前方±22° — 真横の空きは測れないため、左前方回廊 (L) の開きを代理にする
    if ((C > 1600 && L > 1400) || at > 90) { ph = 1; at = 0; }
    return;
  }
  if (ph == 1) {                        // 助走: 全開直進。技のフットプリントは実測で
    RC_steer(CENTER); RC_drive(FORWARD, 255);   // 前+0.82m/左+1.06m/後0.65m
    if (C > 1100 && C < 1500 && at >= 16 && L > 1200) { ph = 2; at = 0; }
    if (at > 120) { act = 0; at = 0; ph = 0; }   // 条件が揃わない回は見送って開幕へ
    return;
  }
  if (ph == 2) {                        // フェイント (逆へ 0.1s)
    RC_steer(RIGHT); RC_drive(FORWARD, 255);
    if (at >= 2) { ph = 3; at = 0; }
    return;
  }
  if (ph == 3) {                        // 振り出し: BRAKE+舵で u≈0.15・β≈25° へ
    RC_steer(LEFT); RC_drive(BRAKE, 255); //  (SC.backentry 実測 20step=7tick)
    if (at >= 7) { ph = 4; at = 0; }
    return;
  }
  if (ph == 4) {                        // 深化: 255+舵 1.9s で β>90° (テールから滑走。
    RC_steer(LEFT); RC_drive(FORWARD, 255);     //  実測 114step=38tick)
    if (at >= 38 || C < 650 || L < 550 || R < 550) { ph = 5; at = 0; }   // 壁が迫ったら即回収
    return;
  }
  if (ph == 5) {                        // 回収: 駆動を抜いてリア再グリップ → 停止
    RC_steer(CENTER); RC_drive(BRAKE, 255);     //  (実測 87step=29tick)
    if (at >= 30) { ph = 6; at = 0; }
    return;
  }
  RC_steer(CENTER); RC_drive(FREE, 0);  // 決めポーズ 1 秒 → 開幕へ
  if (at >= 20) { act = 0; at = 0; ph = 0; }
}
`;

const ZEROCOUNTER_CODE = `// Zero-Counter Drift — カウンターを当てないドリフト保持  by Opus 4.8
// 「ドリフト広場 (ショー会場)」で踊る非レース・プログラム。実測 (動力学モデル):
// 中央スタートから 300秒 無事故・全時間の99%が横向き>25°・βavg 87° を保持し続ける。
//
// 普通のドリフトは「カウンター(逆ハン)」で姿勢を作る。この演目はその逆 —
// 舵をコーナー内側(LEFT)に入れたまま一度も戻さず、スロットルだけでスライドを保持する。
//   核: スロットルを「グリップ円 170 / フレア 255」のデューティで打つ。255 を入れ続けると
//       u が車輪速上限に達して空転代(車速<車輪速の余裕)が消え、再グリップ→過回転スピンで
//       壁へ刺さる (実測)。グリップ円 170 を挟むと空転代が回復し、定位置ドーナツが安定する。
//   呼吸: 4秒周期でグリップ寄り(締まる)↔フレア寄り(膨らむ)を行き来し、ドーナツを脈動させる。
// なぜ一方向だけ? 逆回りにするには回転中に逆ハン(=カウンター)を当てる遷移が要る。
// 「カウンターを当てない」縛りでは反転できない — ゼロカウンターのスライドは一方向限定、
// というのがこの演目の物理レッスン。
//
// プログラム API は ToF 距離しか読めず β(横すべり角)は観測できない。そこで姿勢制御ではなく
// 「壁に寄ったら止めて(BRAKE)仕切り直す」割り切りガードで安全を担保する (姿勢は開ループで保持)。
// 信頼区間: 開ループのドーナツ保持+近距離の壁ガードだけに ToF を使う(測距航法しない)ので CONF カットオフは設けない。
int at;        // ドーナツ内の経過 tick (20Hz)
int guardT;    // 壁ガードで停止中の残り tick

void setup() { RC_setup(); at = 0; guardT = 0; }

void loop() {
  int L = sensor0.readRangeSingleMillimeters();
  int C = sensor1.readRangeSingleMillimeters();
  int R = sensor2.readRangeSingleMillimeters();

  // [壁ガード] 壁へ寄り過ぎたら BRAKE+CENTER で止める (滑り状態の万能リセット。
  // カウンターは当てない=CENTER のまま)。前レイ全クリアで仕切り直し。中央スタートでは
  // ドーナツが (1.0,2.2) 付近に自己整定して発火しない — これは万一の保険。
  if (C < 500 || L < 230 || R < 230) { if (guardT == 0) guardT = 30; }
  if (guardT > 0) {
    guardT = guardT - 1;
    RC_steer(CENTER); RC_drive(BRAKE, 255);
    if ((C > 1300 && L > 360 && R > 360) || guardT == 0) { guardT = 0; at = 0; }
    return;
  }

  at = at + 1;

  // [ゼロカウンター・ドーナツ] 舵は内側(LEFT)へ入れたまま — 逆ハンは絶対に当てない。
  RC_steer(LEFT);
  // 呼吸: 前半(at%80<40)はグリップ多めで締め、後半はフレア多めで膨らませる。
  int grip;
  if (at % 80 < 40) grip = 28; else grip = 18;
  if (at % 34 < grip) RC_drive(FORWARD, 170);   // グリップ円で捕まえ (空転代を回復)
  else               RC_drive(FORWARD, 255);    //   フレアで流す
}
`;

// ============================================================================
//  競技 (フルスケール・レース) サンプル — Phase F6
//  領域セレクタを「フルスケール・レース」に、コースを「競技グラウンド」にして走らせる。
//  卓上(実機相当)では滑らない物理が、フルスケールでは「速度=グリップ」「ローンチ空転」
//  「ブレーキロック」として現れる。これらを“制御”するのが競技プログラミングの題材。
//  ★Launch Lab / Brake Lab は「車輪エンコーダ(任意)」を ON にすると本領を発揮する★
//    (前輪=非駆動=接地速度 / 後輪=駆動。両者の差でスリップ率が分かる=実車の TC/ABS と同じ)。
// ============================================================================

// 競技 Lv1 — トラクション制御ローンチ (要 車輪エンコーダ)。
const COMP_LAUNCH_CODE = `// Launch Lab — トラクション制御ローンチ  [競技 / フルスケール]  by Fable 5
// ★領域=フルスケール・レース / コース=競技グラウンド / 「車輪エンコーダ(任意)」を ON★
//
// フルスケールでは発進トルクがタイヤのグリップを上回るので、全開ベタ踏みすると
// 駆動輪(後)が空転して前に進まない (ホイールスピン)。これを“車輪速”で検知して抑えるのが
// トラクション制御 (TC)。FR は前輪が非駆動なので「前輪速 ≒ 本当の接地速度」。
//   スリップ率 = (後輪速 - 前輪速) / 前輪速。空転すると後輪速だけ跳ね上がる。
// TC の肝: アクセル開度ではなく「接地速度より少しだけ速い目標」を狙い続けると、
//   駆動力が摩擦ピーク内に収まりスリップが暴れない → 同じ時間でずっと遠くまで加速する。
//
// このプログラムは A/B 比較デモ: ①全開ベタ踏み → ②TC、各2.5秒の到達距離を Serial に出す。
//   実測: 全開 ≈16m に対し TC ≈40m (+24m)。フルスケールでこそ意味を持つ。
// 信頼区間: TC ローンチは車輪エンコーダ(前=接地速度/後=駆動速度の差)で走り、前方 ToF 測距は読まない=信頼区間パラメータは無い。
int phase = 0, t = 0;
float odo = 0, fullDist = 0;   // odo = 走行距離[m] (前輪速の積分 = 車輪オドメトリ)

void setup() { RC_setup(); }

void loop() {
  float gs = RC_wheel_speed(FRONT);   // 接地速度[m/s] (非駆動の前輪)
  float rear = RC_wheel_speed(REAR);  // 駆動輪(後)の速度[m/s]
  RC_steer(CENTER);
  t = t + 1;

  if (phase == 0) {                   // ① 全開ベタ踏み (空転して進まない)
    RC_drive(FORWARD, 255);
    odo = odo + gs / 20;              // 20Hz ループなので 1 回 = gs * (1/20) m
    if (t > 50) { fullDist = odo; phase = 1; t = 0; }   // 2.5 秒
    return;
  }
  if (phase == 1) {                   // ブレーキで停止 → 記録してスタートへ戻す
    if (rear < gs * 0.8) RC_drive(FREE, 0);   // 後輪ロック気味なら緩める (簡易ABS)
    else                 RC_drive(BRAKE, 255);
    if (gs < 0.5) { Serial.println(fullDist); RC_setup(); odo = 0; t = 0; phase = 2; }
    return;
  }
  if (phase == 2) {                   // ② トラクション制御ローンチ
    int pwm = (gs + 5) / 110 * 255;   // 「接地速度+5m/s」を狙う (110=フルスケール最高速)
    RC_drive(FORWARD, pwm);           //   → 駆動力が摩擦ピーク内に収まりスリップしない
    odo = odo + gs / 20;
    if (t > 50) { Serial.println(odo); RC_setup(); odo = 0; t = 0; phase = 3; }
    return;
  }
  RC_drive(FREE, 0);                  // ひと呼吸おいて最初へ
  if (t > 20) { phase = 0; t = 0; }
}
`;

// 競技 Lv2 — ABS ブレーキング (要 車輪エンコーダ)。
const COMP_BRAKE_CODE = `// Brake Lab — ABS ブレーキング  [競技 / フルスケール]  by Fable 5
// ★領域=フルスケール・レース / コース=競技グラウンド / 「車輪エンコーダ(任意)」を ON★
//
// 全力でブレーキを踏むと駆動輪がロックする (スリップ率 -1 = 路面に対し車輪が止まる)。
// ロックしたタイヤは「縦も横もグリップを失う」ので、①制動力がむしろ落ちて止まれない、
// ②横力が消えて舵が効かない (=曲がれない/スピン)。
// ABS = 車輪速でロックを検知し、ロックしたら一瞬ブレーキを緩めて車輪を転がし直す。
//   FR は前輪(非駆動)が接地速度の基準。後輪速が前輪速より大きく落ちたら「ロック」。
//
// A/B 比較デモ: ①ベタ踏みロック → ②ABS、各々の停止距離を Serial に出す。
//   実測: ロック ≈50m に対し ABS ≈32m (約 1/3 短い)。ロックは止まれないのが分かる。
// 信頼区間: ABS は車輪エンコーダでロックを検知して走り、前方 ToF 測距は読まない=信頼区間パラメータは無い。
int phase = 0;
float odo = 0, lockDist = 0;

void setup() { RC_setup(); }

void loop() {
  float gs = RC_wheel_speed(FRONT);
  float rear = RC_wheel_speed(REAR);
  RC_steer(CENTER);

  if (phase == 0) {                   // 助走 (TC で 18m/s まで)
    int pwm = (gs + 5) / 110 * 255;
    RC_drive(FORWARD, pwm);
    if (gs > 18) { phase = 1; odo = 0; }
    return;
  }
  if (phase == 1) {                   // ① ベタ踏みロック (止まりきれない)
    RC_drive(BRAKE, 255);
    odo = odo + gs / 20;
    if (gs < 0.5) { lockDist = odo; Serial.println(lockDist); RC_setup(); phase = 2; }
    return;
  }
  if (phase == 2) {                   // 助走 (再び)
    int pwm = (gs + 5) / 110 * 255;
    RC_drive(FORWARD, pwm);
    if (gs > 18) { phase = 3; odo = 0; }
    return;
  }
  if (rear < gs * 0.8) RC_drive(FREE, 0);   // ② ABS: ロック検知で緩める
  else                 RC_drive(BRAKE, 255);
  odo = odo + gs / 20;
  if (gs < 0.5) { Serial.println(odo); RC_setup(); phase = 0; }
}
`;

// 競技 Lv0 — 現象デモ (エンコーダ不要)。装備なしでも空転/ロックを“見る”。
const COMP_DEMO_CODE = `// Spin & Lock Demo — 空転とロックを見る  [競技 / フルスケール]  by Fable 5
// ★領域=フルスケール・レース / コース=競技グラウンド (車輪エンコーダは不要)★
//
// 特別な装備なしで、フルスケールの2大現象をただ“見る”デモ:
//   ① 全開発進 → 駆動輪が空転 (タイヤスモークが出て、なかなか前に進まない)。
//   ② 舵を当てたままベタ踏みブレーキ → 駆動輪ロックで横力が消え、スピンする。
// 「なぜこうなるか/どう抑えるか」は Launch Lab / Brake Lab (車輪エンコーダ ON) で学ぶ。
// 信頼区間: このデモは固定シーケンス(時間制御)で空転/ロックを見せ、ToF 測距を読まない=信頼区間パラメータは無い。
int t = 0, phase = 0;

void setup() { RC_setup(); }

void loop() {
  t = t + 1;
  if (phase == 0) {                   // ① 全開ローンチ (空転)
    RC_steer(CENTER); RC_drive(FORWARD, 255);
    if (t > 60) { phase = 1; t = 0; }
    return;
  }
  if (phase == 1) {                   // ② 舵+ベタ踏みブレーキ (ロック→スピン)
    RC_steer(LEFT); RC_drive(BRAKE, 255);
    if (t > 40) { phase = 2; t = 0; }
    return;
  }
  RC_steer(CENTER); RC_drive(FREE, 0); // 停止して仕切り直し
  if (t > 40) { RC_setup(); phase = 0; t = 0; }
}
`;

// 競技 Lv3 — フルスケール実寸サーキットの『3センサー先読みレース』(ノーマル FF)。
const COMP_CIRCUIT_CODE = `// Circuit Racer — フルスケール実寸サーキット周回  [競技 / フルスケール]  by Fable 5
// ★領域=フルスケール・レース / コース=競技サーキット (フルスケール)★ (車輪エンコーダは不要)
//
// 実車スケール(2.6m・~350km/h)の実寸サーキット(1周~1.9km・道幅28m)を、前方3センサー
// だけで周回するレースプログラム。卓上と同じ「広い方へ操舵+前方の空きで加速」の土台に、
// フルスケール特有の2点を足すのが肝:
//   (1) 先読みブレーキ: フルスケールは速度が高くブレーキが相対的に弱い(~96m/s から停止に~115m)。
//       前方距離 C が「速く縮む」=高速でコーナーに接近、と見たら BRAKE で荷重を移して減速する。
//       (この見通しのため ToF レンジは実車レーダ相当の 150m に拡張されている=領域メタ)
//   (2) 速度を実寸に合わせて抑える: フルスケールでは pwm が実速度に効く。卓上の 255 連発は
//       コーナーで破綻するので、直線 TOP=140・コーナー TCAP=110 と低めに置く(出力律速+空力で
//       到達速度は pwm 比そのままにはならない)。
//   (3) ★視野コーン(25°)対応で再チューン★ 距離センサーは「太さゼロの直線レイ」でなく VL53L0X 相当の
//       25°視野コーンの「扇内最近」を返す(#27・Stage AM)。この実寸コースでは中央 C の読みが直線レイ
//       時代の約半分になる(扇が近いコーナー内側を先に捉えるため。実測 cone/thin≈48%)。そこで判定距離を
//       約半分へ下げた(D_OPEN 66→33m・D_MID 44→22m・D_TURN 32→16m・BIAS 4→2m)。旧値のままだと
//       「常に壁が近い」と誤認して早すぎるブレーキ/操舵でラインを失い巻き込む(実測: 61→160秒・スピン)。
//       教訓: 理想化(直線レイ)に合わせた較正は、センサーを実機(コーン)に近づけた瞬間にズレる——
//       現実に忠実にするほど、プログラム側も実機の見え方へ合わせ直す(=実機に載せ替える時と同じ作業)。
//   (4) ★精密動力学 v2 対応=全舵デューティ変調★ 走行エンジンが v2(4輪 two-track・忠実な荷重移動)に
//       変わると、3値ステアの「全舵」は この大R コーナー(直線×4+大きな角丸)には切りすぎになる。全舵を
//       当てっぱなしにすると 後輪の横グリップを破ってオーバーステア→スピン(β→180°)する。旧エンジンは
//       荷重移動が穏やかで見えなかったが、v2 は実車どおり顕在化する。対策=舵を「脈打たせる」:SPER ループ
//       のうち SDUTY 回だけ実際に舵を当て、残りは CENTER に戻す(=実効的に舵角を半分に薄める=大R に
//       ちょうど合った旋回)。あわせて旋回中の上限 TCAP を 110→78 に下げる(v2 のコーナー限界速度は低い)。
//       教訓: 操舵の"強さ"は連続量。3値しか無くても「当てる割合(デューティ)」で実効舵角を作れる——
//       センサーだけでなくエンジン(物理)が変わっても、プログラムは新しい挙動へ合わせ直す(AN と同じ作業)。
//
// ★車種の物理レッスン★ このコードは「ノーマル FF」で安定して周回する。同じコードを
//   ノーマル FR / 4WD で走らせると、最初のコーナーで巻き込んでスピンする(オーバーステア)。
//   実車スケールでは弱アンダーの FF が一番素直=「曲がる車ほど限界で危ない」を体感できる。
//
// 距離は RC_read() を使う(範囲外で -3 を返す=「遠く開けている」が符号で明確に分かる。
//   sensorN.readRangeSingleMillimeters() の範囲外値 8190 は『8.19m の壁』と区別できないため避ける)。
int TOP=140, MID=110, SLOW=82, TCAP=78;             // 速度(pwm): 直線/中速/コーナー/旋回中の上限(TCAP は v2 で 110→78)
int D_OPEN=33000, D_MID=22000, D_TURN=16000;        // 判定距離[mm](実寸 m×1000。33000=33m。視野コーン対応で直線レイ時代の半分)
int CLOSE=1600, BRK=240, BIAS=2000;                 // 接近検知[mm/loop] / ブレーキpwm / センタリング閾[mm](コーン対応で半分)
int SDUTY=1, SPER=2;    // 全舵デューティ: SPER ループのうち SDUTY だけ実際に舵を当てる(残りは CENTER)=実効舵角を薄める(v2)
int CONF=150000;     // 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」。本フルスケールは実車レーダ相当の
// 150m レンジで設計しているので信頼区間もレーダ地平(150m)とする。実短距離 ToF の地面拘束は ~5m
// (=250mm×領域スケール20)ゆえ、実機/自機ではここを下げて要調整(下げるほど遠くの壁を見ず反応が遅れる)。
int prevC; int started; int sc;

void setup() { RC_setup(); prevC = 0; started = 0; sc = 0; }

void loop() {
  int L = RC_read(LEFT);
  int C = RC_read(CENTER);
  int R = RC_read(RIGHT);
  if (L < 0 || L > CONF) L = 99000;   // 範囲外(-3)=遠く開けている → 大きな値に正規化
  if (C < 0 || C > CONF) C = 99000;
  if (R < 0 || R > CONF) R = 99000;
  int dC = 0;
  if (started == 1) dC = prevC - C;   // dC>0 = 前方が縮む = コーナー/壁へ接近
  prevC = C; started = 1;

  // 操舵の向きを決める: 前が詰まれば広い方へ、緩い区間は近い壁から離れてセンタリング
  int turning = 1; int dir = CENTER;
  if (C < D_TURN) { if (L > R) dir = LEFT; else dir = RIGHT; }
  else if (L - R > BIAS) dir = LEFT;
  else if (R - L > BIAS) dir = RIGHT;
  else { dir = CENTER; turning = 0; }
  // ★v2 の全舵デューティ変調★ 舵を脈打たせて実効舵角を薄める(=大R に合った旋回。詳細は上のねらい(4))。
  int phase = sc % SPER; sc = sc + 1;
  if (turning == 1 && phase < SDUTY) RC_steer(dir); else RC_steer(CENTER);

  // 速度: 前方が開けているほど速く。旋回中は上限を抑え巻き込みを防ぐ
  int pwm = SLOW;
  if (C > D_OPEN) pwm = TOP;
  else if (C > D_MID) pwm = MID;
  if (turning == 1 && pwm > TCAP) pwm = TCAP;

  // ★先読みブレーキ★ 前方が速く縮んでいるなら(高速でコーナー接近)、突っ込む前に減速する
  if (dC > CLOSE && C < D_OPEN) RC_drive(BRAKE, BRK);
  else RC_drive(FORWARD, pwm);
}
`;

const DRIFT_CIRCUIT_CODE = `// Sustained Drift — フルスケール・サーキットで持続ドリフト  [競技 / フルスケール]  by Opus 4.8
// ★領域=フルスケール・レース / コース=競技サーキット (フルスケール) / 車=ドリフトFR★
//
// J1 で判明: ドリフト車はフルスケール・サーキットで即スピン(<11秒)し「持続ドリフト」が存在しなかった。
// Phase J2 でドリフト車専用の縦μ(muXDrift)を下げて空転パワーオーバーを復活させ、保持できるスライドが
// 生まれた。このプログラムはそれを ToF×3 だけで保持する(J-1: 姿勢=ヨー/βは直接読まない。壁の距離
// L/C/R の差と前方の詰まり方だけで操る。逆ハン=カウンターは姿勢推定を要するが J1 でそれは不成立なので
// 当てない=スロットルだけでスライドを維持する ZeroCounter の作法)。
//
// 円角四角(直線×4+コーナー×4・全コーナーが同じ向き)を:
//   直線  : グリップで踏んで前進(平行移動)。前が速く詰まれば(高速でコーナー接近)先読みブレーキ。
//   コーナー: 広い側へ全舵を当てたまま、スロットルを「フレア210 / グリップ円150」で脈打たせて後輪を
//            流し続ける(空転代=車速<車輪速上限 を保ちスライドを維持)。
// 注: 横滑りは前方センサーに映らないので壁ガードは早め(GUARD)に拾い、滑走中に前進で逃げない(悪化する)。
//
// 条件を変えて確かめよう(J4): この走りが成り立つのは「壁で囲まれたフルスケール・サーキット」。
//   プログラムはそのままで、領域やコースを変えて走らせると結果はどう変わる? 先回りの答えは書かない。
//   どんな条件なら成り立ち、どんな条件だと成り立たないかは、走った結果から自分で気づこう。
// ★Stage AO 注記(走行エンジン v2)★ v2(4輪 two-track・muXDrift ハック廃止・忠実な荷重移動)では、この実寸
//   フルスケール・コーナーは速度が高すぎて、最初のコーナーで即スピン→スタックする(前進は最初の直線ぶんのみ)。
//   ToF×3+3値ステアでは姿勢(ヨー/β)を読めず逆ハンを当てられない=持続ドリフト不成立、という J1 の限界は
//   v2 でも不変で、むしろ荷重移動が忠実なぶん一層はっきり出る(=最速レースにはドリフトは不利)。この
//   「ドリフトの意味/利点」を安全に学ぶ環境は 卓上スリップタイヤ(Stage AO6・低速で滑りを保てる)を参照。
int TOP, CORNER, BIAS, GUARD, GUARDS, DUTY, DUTYHI, FLARE, GRIP, CLOSE;
int CONF=150000;     // 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」。本フルスケールは実車レーダ相当の
// 150m レンジで設計しているので信頼区間もレーダ地平(150m)とする。実短距離 ToF の地面拘束は ~5m
// (=250mm×領域スケール20)ゆえ、実機/自機ではここを下げて要調整(下げるほど遠くの壁を見ず反応が遅れる)。
int prevC; int started; int t;

void setup() {
  RC_setup();
  TOP = 170; CORNER = 50000; BIAS = 6000; GUARD = 9000; GUARDS = 4500;
  DUTY = 24; DUTYHI = 9; FLARE = 210; GRIP = 150; CLOSE = 2200;
  prevC = 0; started = 0; t = 0;
}

void loop() {
  int L = RC_read(LEFT);
  int C = RC_read(CENTER);
  int R = RC_read(RIGHT);
  if (L < 0 || L > CONF) L = 99000;   // 範囲外(-3)=遠く開けている → 大きな値へ正規化
  if (C < 0 || C > CONF) C = 99000;
  if (R < 0 || R > CONF) R = 99000;
  int dC = 0;
  if (started == 1) dC = prevC - C;   // dC>0 = 前方が縮む = コーナー/壁へ接近
  prevC = C; started = 1;
  t = t + 1;

  // 壁ガード: 近すぎたら広い側へ舵を残して BRAKE (滑り状態の万能リセット)。前進で逃げない。
  if (C < GUARD || L < GUARDS || R < GUARDS) {
    if (L > R) RC_steer(LEFT); else RC_steer(RIGHT);
    RC_drive(BRAKE, 240);
    return;
  }

  // コーナー: 前方が詰まっている = 進入/旋回中。広い側(=コーナー内側・全周同じ向き)へ全舵を保持し
  //   スロットルを脈打たせて後輪を流し続ける。
  if (C < CORNER) {
    if (L >= R) RC_steer(LEFT); else RC_steer(RIGHT);
    if ((t % DUTY) < DUTYHI) RC_drive(FORWARD, FLARE);
    else RC_drive(FORWARD, GRIP);
    return;
  }

  // 直線: 近い壁から離れてセンタリングしつつグリップで前進。前が速く詰まれば先読みブレーキ。
  if (L - R > BIAS) RC_steer(LEFT);
  else if (R - L > BIAS) RC_steer(RIGHT);
  else RC_steer(CENTER);
  if (dC > CLOSE) RC_drive(BRAKE, 210);
  else RC_drive(FORWARD, TOP);
}
`;

const SLIP_ATTACK_CODE = `// Slip Attack — フルスケール・サーキットで「最速グリップ⇄リア流し」を切り替えて攻める  [競技 / フルスケール]  by Opus 4.8
// ★領域=フルスケール・レース / コース=競技サーキット (フルスケール) / 車=ドリフトFR★
//
// J3 の正直な前提(実測で確定):
//   ・このシムでは「ドリフト角を一定に保つ(保持ドリフト)」は前方ToFだけでは作れない。リアが流れ始めると
//     姿勢(ヨー/β)を読んで逆ハン(カウンター)を当てない限りスピン(β→180°)まで回り切ってしまう。
//   ・逆ハンには姿勢推定が要るが、ToF の時間変化からの姿勢推定は本シムでは不成立(Phase J1 = NO-GO)。
//   ・つまり「全周をドリフトのまま回る」「逆ハンでスピンを止める」は ToF×3 だけでは成立しない(走れば分かる)。
// だから本プログラムは "保持" を狙わず、実車の走法どおり【直線=最速グリップ / コーナー=リアを振って回頭】を
//   リズムで切り替える。コーナーではリアが流れて深く回頭し(=スピン側まで行く)、前が開けたらグリップで次へ進む。
//   姿勢は一切読まず、前方の詰まり(C)と左右差(L-R)だけで直線/コーナーを判断する。
//
// 補足(正直な実測): このスライドは開ループ(姿勢を読まない)では本質的に不安定で、コーナーごとに
//   β→180° まで回り切る「スピン→復帰」のリズムになる。サーキット半周ぶんは前進できるが、その先は
//   滑りが溜まってスタックしがち=全周ドリフトは成立しない。値を攻めるほど結果がブレる(決定論的カオス)
//   ので、ここは堅牢に半周前進できる素直な構成にしてある。
//
// 条件を変えて確かめよう(J4): この走りが成り立つのは「壁で囲まれたフルスケール・サーキット」。
//   プログラムはそのままで、領域やコースを変えて走らせると結果はどう変わる? 先回りの答えは書かない。
//   どんな条件なら成り立ち、どんな条件だと成り立たないかは、走った結果から自分で気づこう。
// ★Stage AO 注記(走行エンジン v2)★ v2(4輪 two-track・muXDrift ハック廃止・忠実な荷重移動)では、この実寸
//   フルスケール・コーナーは速度が高すぎて、コーナー進入で即スピンする(補足どおり「保持は不成立」が一層
//   はっきり出て、前進は最初の直線ぶんが主)。ToF×3+3値ステアでは姿勢を読めず逆ハンできない=スピンを
//   止められない限界(J1=NO-GO)は v2 でも不変。「最速安全」にはグリップ(弱アンダーFF)が有利で、ドリフトは
//   不利という物理が創発する。ドリフトの意味/利点を安全に学ぶには 卓上スリップタイヤ(Stage AO6)を参照。
int TOP, CORNER, BIAS, GUARD, GUARDS, DUTY, DUTYHI, FLARE, GRIP, CLOSE, BRK;
int CONF=150000;     // 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」。本フルスケールは実車レーダ相当の
// 150m レンジで設計しているので信頼区間もレーダ地平(150m)とする。実短距離 ToF の地面拘束は ~5m
// (=250mm×領域スケール20)ゆえ、実機/自機ではここを下げて要調整(下げるほど遠くの壁を見ず反応が遅れる)。
int prevC; int started; int t;

void setup() {
  RC_setup();
  TOP = 180; CORNER = 50000; BIAS = 6000; GUARD = 9000; GUARDS = 4500;
  DUTY = 24; DUTYHI = 9; FLARE = 210; GRIP = 150; CLOSE = 2200; BRK = 210;
  prevC = 0; started = 0; t = 0;
}

void loop() {
  int L = RC_read(LEFT);
  int C = RC_read(CENTER);
  int R = RC_read(RIGHT);
  if (L < 0 || L > CONF) L = 99000;   // 範囲外(-3) = 遠く開けている → 大きな値へ
  if (C < 0 || C > CONF) C = 99000;
  if (R < 0 || R > CONF) R = 99000;
  int dC = 0;
  if (started == 1) dC = prevC - C;   // dC>0 = 前方が縮む = 壁/コーナーへ接近
  prevC = C; started = 1; t = t + 1;

  // 壁ガード: 近すぎたら広い側へ舵を残してブレーキ(滑りの万能リセット)。前進で逃げない。
  if (C < GUARD || L < GUARDS || R < GUARDS) {
    if (L > R) RC_steer(LEFT); else RC_steer(RIGHT);
    RC_drive(BRAKE, 240);
    return;
  }

  // コーナー: 前方が詰まっている(C<CORNER)= 進入/旋回中。広い側(=内側・全周同じ向き)へ全舵を当て、
  //   スロットルを脈打たせて後輪を流す。逆ハンは当てない(姿勢が読めない=J1)のでリアは流れ切って回頭する。
  if (C < CORNER) {
    if (L >= R) RC_steer(LEFT); else RC_steer(RIGHT);
    if ((t % DUTY) < DUTYHI) RC_drive(FORWARD, FLARE);
    else RC_drive(FORWARD, GRIP);
    return;
  }

  // 直線: 中央寄せして最速グリップで踏む。前が速く詰まれば先読みブレーキでコーナーに備える。
  if (L - R > BIAS) RC_steer(LEFT);
  else if (R - L > BIAS) RC_steer(RIGHT);
  else RC_steer(CENTER);
  if (dC > CLOSE) RC_drive(BRAKE, BRK);
  else RC_drive(FORWARD, TOP);
}
`;

const ESTIMATOR_CODE = `// Range-Flow Estimator — 前方ToF×3(+任意の後方/エンコーダ)の時間変化から姿勢(横滑り角β)を推定する研究サンプル  [競技 / フルスケール]  by Opus 4.8
// ★領域=フルスケール・レース / コース=競技サーキット (フルスケール) / 車=ノーマルFF★
//
// ねらい(研究): 「姿勢(ヨー/横滑り角β)を直接読むセンサーは足さない」(J-1)。代わりに、各ToFが
//   1ループで何mm縮んだか/伸びたか(レンジレート)から、車体の速度(前後vx・横vy)と回頭ω を逆算し、
//   β=atan2(vy,vx) を推定してみる。原理=レンジフロー(測距オドメトリ):
//     各ビーム i は機体に固定で 向きn_i・取付p_i が既知。壁を「ビームに正対する平面」と素朴に仮定すると、
//     距離変化 Δd_i ≈ -(n_i·vx + n_i·vy + ω·k_i) の線形式になる(k_i=(n_i×p_i)_z)。ビーム3本(+後方/
//     エンコーダ)→ 連立を最小二乗(正規方程式+Cramer)で解く。±65°の広い左右ビームが横滑りvyを左右差に
//     出すので観測しやすい…はず、というのが研究テーマ。
//
// ★正直な限界(Phase J1 で本番実測=NO-GO。CI-7: 緩めない)★
//   ToF からの姿勢推定は本シムでは本番基準(平均誤差MAE≤15° かつ 符号一致≥80%)を満たさない=不成立。
//   J1(精密版)でも MAE 10〜12° / 符号一致 70〜72%(<80%)で、「βは常に0」と決め打ちする自明推定に勝てなかった。
//   この素朴版を走らせると更にはっきり分かる:
//     ・エンコーダON(推奨)→ 推定βは真βと同じくらい小さく出る(MAE 数°)が、それは安定周回の真βが
//       元々数°と小さいからで「β=0と決め打ち」と同程度。肝心の【どちらに滑っているか=符号】が当たらない。
//     ・エンコーダOFF → 前後速度の符号すら定まらず、推定が大きく外れる(だから下の事前情報/エンコーダが要る)。
//   理由(構造的・直せない): ①壁の法線は1スキャンからは分からない(法線↔自己運動の循環)。素朴な
//     「壁はビームに正対」仮定が、斜め壁では横滑りの符号を取り違える。②フルスケールは壁が遠く、回頭
//     ω×(数十m)が vx/vy(~1)を圧倒する悪条件。③安定周回の真βは数°と小さく、符号≥80%は"ほぼ完璧"を要求。
//   → だから"成り立たない研究課題"として提供する。素朴な壁法線仮定をどう直すか——それが君の研究テーマ。
//
// 使い方: 走らせて、ここが出力する「推定β」と、画面 DEPTH パネルの「β …°」(真値)を並べて見比べよう。
//   後方センサー(任意)・車輪エンコーダ(任意)を ON にすると観測式が1〜2本増える(が、それでも基準には届かない)。
//   推定をどう直せば真βに近づくか——それがこの研究環境の問いです。
//   (走りは Circuit Racer と同じ素直なFF周回。壁が視野に入るので推定の素材になる。)
double PL, PC, PR, PB; int prevC; int started; int t; int sc;
int CONF=150000;     // 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」。本フルスケールは実車レーダ相当の
// 150m レンジ設計ゆえ信頼区間もレーダ地平(150m)。実短距離 ToF の地面拘束は ~5m(=250mm×領域スケール20)。
// 実機/自機では下げて要調整。※姿勢推定部は別途 L<140000 で有効域を絞る(遠方壁ほどレンジフローが弱い)。

double k_of(double nx, double ny, double px, double py) { return ny*px - nx*py; }   // ω係数 (n×p)_z

double det3(double a, double b, double c, double d, double e, double f, double g, double h, double i) {
  return a*(e*i - f*h) - b*(d*i - f*g) + c*(d*h - e*g);   // 3x3 行列式 (Cramer 法用)
}

void setup() { RC_setup(); started = 0; t = 0; prevC = 0; PL = 0; PC = 0; PR = 0; PB = 0; sc = 0; }

void loop() {
  int L = RC_read(LEFT);
  int C = RC_read(CENTER);
  int R = RC_read(RIGHT);
  // ---- 周回ドライバ (Circuit Racer と同じ。FFは安定周回・壁が視野に入る) ----
  int Lg = L; int Cg = C; int Rg = R;
  if (Lg < 0 || Lg > CONF) Lg = 99000;   // 範囲外(-3)/信頼区間外=遠く開けている
  if (Cg < 0 || Cg > CONF) Cg = 99000;
  if (Rg < 0 || Rg > CONF) Rg = 99000;
  int dCb = 0;
  if (started == 1) dCb = prevC - Cg;
  prevC = Cg;
  // 判定距離は視野コーン(25°)対応で直線レイ時代の約半分(Circuit Racer と同じ再チューン・#27/Stage AM)。
  int turning = 1; int dir = CENTER;
  if (Cg < 16000) { if (Lg > Rg) dir = LEFT; else dir = RIGHT; }
  else if (Lg - Rg > 2000) dir = LEFT;
  else if (Rg - Lg > 2000) dir = RIGHT;
  else { dir = CENTER; turning = 0; }
  // ★v2(精密動力学)対応=全舵デューティ変調★ 2ループに1回だけ実際に舵を当て残りは CENTER に戻す
  //   =実効舵角を半分に薄める(大R コーナーで全舵は切りすぎ→後輪破りスピン。Circuit Racer と同じ v2 対策)。
  int phase = sc % 2; sc = sc + 1;
  if (turning == 1 && phase < 1) RC_steer(dir); else RC_steer(CENTER);
  int pwm = 82;
  if (Cg > 33000) pwm = 140;
  else if (Cg > 22000) pwm = 110;
  if (turning == 1 && pwm > 78) pwm = 78;   // 旋回中の上限は v2 で 110→78
  if (dCb > 1600 && Cg < 33000) RC_drive(BRAKE, 240);
  else RC_drive(FORWARD, pwm);

  // ---- 姿勢推定(研究): レンジフロー ----  距離は m に直す。範囲外/未装備は無効。
  int B = RC_read(BACK);                 // 後方(任意装備)。未装備は -2
  double enc = RC_wheel_speed(REAR);     // 車輪面速度[m/s](任意装備)。未装備は -1
  double dL = L / 1000.0; double dC = C / 1000.0; double dR = R / 1000.0; double dB = B / 1000.0;
  t = t + 1;

  // 各ビーム: 行[nx, ny, k]·(vx,vy,ω) = -Δd_i (素朴な「壁はビームに正対」仮定)。正規方程式 ATA·x = ATb を組む。
  double a00=0.0; double a01=0.0; double a02=0.0; double a11=0.0; double a12=0.0; double a22=0.0;
  double b0=0.0; double b1=0.0; double b2=0.0; int rows=0;
  // L (取付 p=[0.130,0.018], n=[cos65,sin65])
  if (L > 0 && L < 140000 && started == 1 && PL > 0) {
    double nx=0.4226; double ny=0.9063; double k=k_of(nx,ny,0.130,0.018); double rhs=-(dL - PL);
    a00=a00+nx*nx; a01=a01+nx*ny; a02=a02+nx*k; a11=a11+ny*ny; a12=a12+ny*k; a22=a22+k*k;
    b0=b0+nx*rhs; b1=b1+ny*rhs; b2=b2+k*rhs; rows=rows+1;
  }
  // C (p=[0.135,0], n=[1,0])
  if (C > 0 && C < 140000 && started == 1 && PC > 0) {
    double nx=1.0; double ny=0.0; double k=k_of(nx,ny,0.135,0.0); double rhs=-(dC - PC);
    a00=a00+nx*nx; a01=a01+nx*ny; a02=a02+nx*k; a11=a11+ny*ny; a12=a12+ny*k; a22=a22+k*k;
    b0=b0+nx*rhs; b1=b1+ny*rhs; b2=b2+k*rhs; rows=rows+1;
  }
  // R (p=[0.130,-0.018], n=[cos65,-sin65])
  if (R > 0 && R < 140000 && started == 1 && PR > 0) {
    double nx=0.4226; double ny=-0.9063; double k=k_of(nx,ny,0.130,-0.018); double rhs=-(dR - PR);
    a00=a00+nx*nx; a01=a01+nx*ny; a02=a02+nx*k; a11=a11+ny*ny; a12=a12+ny*k; a22=a22+k*k;
    b0=b0+nx*rhs; b1=b1+ny*rhs; b2=b2+k*rhs; rows=rows+1;
  }
  // B (後方・任意: p=[-0.045,0], n=[-1,0])
  if (B > 0 && B < 140000 && started == 1 && PB > 0) {
    double nx=-1.0; double ny=0.0; double k=k_of(nx,ny,-0.045,0.0); double rhs=-(dB - PB);
    a00=a00+nx*nx; a01=a01+nx*ny; a02=a02+nx*k; a11=a11+ny*ny; a12=a12+ny*k; a22=a22+k*k;
    b0=b0+nx*rhs; b1=b1+ny*rhs; b2=b2+k*rhs; rows=rows+1;
  }
  // エンコーダ(任意): vx を直接拘束 (1·vx = enc·Δt, Δt≈0.05s)。重み50。
  if (enc >= 0) { double w=50.0; double rhs=enc*0.05; a00=a00+w; b0=b0+w*rhs; rows=rows+1; }
  // 前進は既知(FORWARD指令)なので vx>0 の弱い事前情報を入れる。これが無いと前後速度の符号が
  //   定まらず推定が±180°へ飛ぶ。エンコーダがあればそちらが正確に vx を与える(この事前は弱い)。
  double pw=3.0; a00=a00+pw; b0=b0+pw*0.6; rows=rows+1;

  // 前回値を保存
  if (L > 0 && L < 140000) PL = dL; else PL = 0;
  if (C > 0 && C < 140000) PC = dC; else PC = 0;
  if (R > 0 && R < 140000) PR = dR; else PR = 0;
  if (B > 0 && B < 140000) PB = dB; else PB = 0;
  started = 1;

  if (rows < 3) return;
  // 正則化して 3x3 を Cramer で解く
  a00=a00+0.0001; a11=a11+0.0001; a22=a22+0.000001;
  double det = det3(a00,a01,a02, a01,a11,a12, a02,a12,a22);
  if (det < 0.000000001 && det > -0.000000001) return;
  double vx = det3(b0,a01,a02, b1,a11,a12, b2,a12,a22) / det;
  double vy = det3(a00,b0,a02, a01,b1,a12, a02,b2,a22) / det;
  double beta = atan2(vy, vx) * 57.29578;

  // 約2回/秒で出力。画面 DEPTH の「β …°」(真値)と見比べよう。
  if ((t % 10) == 0) Serial.println("推定β=" + round(beta) + "° / 画面DEPTHの真βと比べよう (J1=NO-GO: 届かない)");
}
`;

// 各プログラムのメタ情報 (UI 表示・GitHub README・教育的説明に使う)
const RECON_RACER_CODE = `# Recon Racer — コースを試走で覚えてレーシングライン＋本番は他車を見て最善手  [競技 / フルスケール・Python・要エンコーダ]  by Opus 4.8
# ★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★
# 実車のレースは本番前に試走(recon)してコースを研究し、本番は他車を見ながら抜きどころを計算する。
#   1周目(試走): 前方3センサーで安全に周回しつつ、エンコーダで測った「スタートからの距離」を
#                インデックスに各地点の 前方の詰まり(=コーナーのきつさ sev) と 左右の壁の余地(mapL/mapR) を
#                地図に記録する。前方の最も近い壁の距離 wmin も覚える(壁にしては近すぎる読み=他車は除く)。
#   2周目以降(本番): 覚えた地図で「この先のきついコーナー」を先読みして手前で減速する。さらに
#                「覚えた壁の距離」と「今のセンサー値」の差から前/横の他車を見つけ、前が詰まったら
#                余地の広い側(=多くはアウト側)から抜き、抜けないなら追従して自滅しない。
# 反応のみの Circuit Racer は速度が乗るコーナーで止まりきれずスピンするが、Recon Racer は地図の
# 先読みでそこを事前に殺し、他車は地図差分で見分けて避ける/抜く=試走で覚える価値(本番フロー実証)。
# ★視野コーン(25°)対応(#27・Stage AM)★ 距離センサーは扇内最近を返すため中央 C の読みが直線レイ時代の
#   約半分になる(実測 cone/thin≈48%)。前方/側方の距離しきい値(TIGHT/D_OPEN/CARMIN/SIDE_OPEN 等)は
#   すべて約半分へ下げた。地図値(sev/mapL/mapR)も現センサーで測るので他車検知の差分も自動的に整合する。
#   一方 距離(エンコーダ)・方位(操舵履歴)・速度(pwm)はコーン非依存なので不変。旧しきい値のままだと
#   「常にコーナー」と誤認して踏めずスピンした(実測 111→89秒・β180°→8°)。
# ★精密動力学 v2 対応(Stage AO)★ 走行エンジンが v2(4輪 two-track・忠実な荷重移動)に変わると、3値ステアの
#   全舵は大R コーナーには切りすぎ=後輪を破ってオーバーステア→スピンする。対策は Circuit Racer と同じ「舵の
#   デューティ変調」(2ループに1回だけ実際に舵を当て残りは CENTER=実効舵角を半分に薄める)。あわせて旋回中の
#   上限 TCAP を 72→58 に下げた(v2 のコーナー限界速度は低い。Recon は先読みブレーキが多く後輪を抜きやすい)。
# ★D-1: 学習側は ToF×3 + 任意エンコーダのみ。絶対位置・方位(ヨー)は与えられない★ → 自己位置は
#   「エンコーダ速度の積み上げ=距離」と「操舵履歴=方位の目安」のデッドレコニング。1周の区切りは
#   方位が一周ぶん回ったことで検出する。他車検知に新しいセンサーは要らない: ToF は壁と他車を区別せず
#   最も近い距離を返すので、「試走で覚えた壁の距離」より今が有意に近ければ そこに他車が居る。
#   エンコーダ未装備だと距離が測れず地図は無効化され、反応のみ(Circuit Racer 相当)で走る=正直なフォールバック。
N=72
BL=700
AHEAD=3
TIGHT=20000
VTIGHT=15000
VFAST=26
RTCAP=53
LAP_MIN_S=18000
LAP_HDG=6000
TOP=91
MID=72
SLOW=53
TCAP=58
D_OPEN=33000
D_MID=22000
D_TURN=16000
CONF=150000  # 信頼区間[mm]: >CONF/範囲外(-3)=遠い/開放。実車レーダ相当150mレンジ設計ゆえ信頼区間もレーダ地平。
#            実短距離ToFの地面拘束は~5m(=250mm×領域スケール20)。実機/自機では下げて要調整(下げるほど遠くの壁を見ず反応遅れ)。
CLOSE=1600
BRK=240
BIAS=2000
CARMIN=20000
CARGAP=3000
CAR_SEE=19000
OVT_NEAR=12000
SIDE_OPEN=15000
SIDE_DIFF=6000
FOLLOW=44
FOLLOW_NEAR=9000
sev=${'[' + Array(72).fill(99000).join(', ') + ']'}
mapL=${'[' + Array(72).fill(99000).join(', ') + ']'}
mapR=${'[' + Array(72).fill(99000).join(', ') + ']'}
LAPLEN=0
LAPB=0
phase=0
s=0
hdg=0
prevC=0
started=0
wmin=99000
told=0
sc=0

def setup():
    global LAPLEN, LAPB, phase, s, hdg, prevC, started, wmin, told, sc
    RC_setup()
    LAPLEN=0
    LAPB=0
    phase=0
    s=0
    hdg=0
    prevC=0
    started=0
    wmin=99000
    told=0
    sc=0
    for i in range(N):
        sev[i]=99000
        mapL[i]=99000
        mapR[i]=99000

def loop():
    global LAPLEN, LAPB, phase, s, hdg, prevC, started, wmin, told, sc
    # --- 自己位置(距離)をエンコーダで積分。未装備(-1)なら距離を測れず地図は無効=反応のみで走る ---
    v=RC_wheel_speed(REAR)
    if v<0:
        v=0
    s=s+v
    # --- 前方3センサー(範囲外 -3 は「遠く開けている」に正規化) ---
    L=RC_read(LEFT)
    C=RC_read(CENTER)
    R=RC_read(RIGHT)
    if L<0 or L>CONF:
        L=99000
    if C<0 or C>CONF:
        C=99000
    if R<0 or R>CONF:
        R=99000
    dC=0
    if started==1:
        dC=prevC-C
    prevC=C
    started=1
    # --- 距離→バケツ(本番は1周ぶんで折り返す) ---
    b=s//BL
    if phase==1:
        b=b%LAPB
    if b<0:
        b=0
    if b>=N:
        b=N-1
    # --- 地図づくり: 前方の詰まり(コーナーのきつさ sev)・左右の余地(mapL/mapR)を記録(最小=最も近い壁)。
    #     前方の最近壁距離 wmin は「壁にしては近すぎる(=他車)」読み(CARMIN 未満)を除いて学習する ---
    if C<sev[b]:
        sev[b]=C
    if L<mapL[b]:
        mapL[b]=L
    if R<mapR[b]:
        mapR[b]=R
    if phase==0 and C>CARMIN and C<wmin:
        wmin=C
    # --- 前方の他車検知(地図差分): 今の前方が「覚えた最も近い壁 wmin」よりさらに近ければ他車。壁は決して
    #     CAR_SEE より近くないと学んでいるので、試走中(地図形成前)でも上限 CAR_SEE で前方の他車を見分けられる ---
    cthr=wmin-CARGAP
    if cthr>CAR_SEE:
        cthr=CAR_SEE
    carF=0
    if C<cthr:
        carF=1
    # --- 側方の他車検知(本番のみ・地図差分): 覚えた左右の壁 mapL/mapR より live が有意に近ければ そこに他車 ---
    carL=0
    carR=0
    if phase==1:
        if mapL[b]-L>SIDE_DIFF:
            carL=1
        if mapR[b]-R>SIDE_DIFF:
            carR=1
    # --- 先読み: この先 AHEAD バケツのうち最もきついコーナーを見る(本番のみ) ---
    coming=99000
    if phase==1:
        j=1
        while j<=AHEAD:
            bb=(b+j)%LAPB
            if sev[bb]<coming:
                coming=sev[bb]
            j=j+1
    # --- 抜きどころ判断: 前が他車で近く(<OVT_NEAR)・直線(coming>TIGHT)なら、今ほんとうに広く開いている側
    #     (live>SIDE_OPEN かつ その側に他車なし)へ寄せて抜く。両側が広いなら 地図が覚えた余地の大きい側=アウト
    #     を選ぶ。広い側が無ければ抜かず控える(=FOLLOW で追従して自滅しない)。live を使うので壁へは寄らない ---
    ovt=0
    if carF==1 and C<OVT_NEAR and coming>TIGHT:
        okL=0
        okR=0
        if L>SIDE_OPEN and carL==0:
            okL=1
        if R>SIDE_OPEN and carR==0:
            okR=1
        if okL==1 and okR==1:
            if mapL[b]>mapR[b]:
                ovt=1
            elif mapR[b]>mapL[b]:
                ovt=0-1
            elif L>R:
                ovt=1
            else:
                ovt=0-1
        elif okL==1:
            ovt=1
        elif okR==1:
            ovt=0-1
        if told==0 and ovt!=0:
            Serial.println("traffic ahead: passing on the open side")
            told=1
    # --- 操舵の向き(壁回避 → 抜き → センタリング)を決める。st=方位デッドレコニング用の意図方向 ---
    turning=1
    st=0
    dir=CENTER
    if C<D_TURN:
        if L>R:
            dir=LEFT
            st=1
        else:
            dir=RIGHT
            st=0-1
    elif ovt==1:
        dir=LEFT
        st=1
    elif ovt==0-1:
        dir=RIGHT
        st=0-1
    elif L-R>BIAS:
        dir=LEFT
        st=1
    elif R-L>BIAS:
        dir=RIGHT
        st=0-1
    else:
        dir=CENTER
        turning=0
    # ★v2(精密動力学)対応=全舵デューティ変調★ 2ループに1回だけ実際に舵を当て残りは CENTER に戻す=実効舵角を
    #   半分に薄める(大R で全舵は切りすぎ→後輪破りスピン。Circuit Racer と同じ v2 対策)。方位デッドレコニング
    #   (hdg)は意図方向 st で積む=デューティに関係なく周回検出は安定。
    sc=sc+1
    if turning==1 and (sc%2)<1:
        RC_steer(dir)
    else:
        RC_steer(CENTER)
    hdg=hdg+st*v
    # --- 速度(反応): 前が開けているほど速く・旋回中は抑える ---
    pwm=SLOW
    if C>D_OPEN:
        pwm=TOP
    elif C>D_MID:
        pwm=MID
    if turning==1 and pwm>TCAP:
        pwm=TCAP
    # --- 先読み減速: 覚えたコーナーが近いなら手前で速度を落とす(本番のみ) ---
    if phase==1 and coming<TIGHT and pwm>RTCAP:
        pwm=RTCAP
    # --- 抜けない時(前が他車・両側塞がり)で 接近しすぎ(<FOLLOW_NEAR)なら追従速度まで落として自滅を避ける
    #     (遠い検知では速度を保つ=団子で全体が鈍らない) ---
    if carF==1 and ovt==0 and C<FOLLOW_NEAR and pwm>FOLLOW:
        pwm=FOLLOW
    # --- ブレーキ判断: 反応(前方が速く縮む) + 先読み(きついコーナーへ高速接近) ---
    brake=0
    if dC>CLOSE and C<D_OPEN:
        brake=1
    if phase==1 and coming<VTIGHT and v>VFAST:
        brake=1
    if brake==1:
        RC_drive(BRAKE,BRK)
    else:
        RC_drive(FORWARD,pwm)
    # --- 1周ぶん回ったら「試走→本番」へ。以後この地図で先読み＋他車を見て最善手 ---
    if phase==0 and s>LAP_MIN_S and (hdg>LAP_HDG or hdg<0-LAP_HDG):
        LAPLEN=s
        LAPB=s//BL
        if LAPB<1:
            LAPB=1
        phase=1
        Serial.println("course learned: " + LAPB + " zones")
`;

const COMP_LOCALIZE_CODE = `# Self-Locator — ToF×3 + 車輪エンコーダで「今コースのどこにいるか」を1次元ヒストグラムフィルタで推定する  [競技 / フルスケール・Python・要エンコーダ]  by Opus 4.8
# ★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★
# 実車の自己位置推定を ToF×3+エンコーダだけで再現する研究/競技サンプル。絶対位置・方位は与えられない(D-1)。
#   1周目(試走): 反応走行しながら「スタートからの距離」を目盛りに、各地点の前方/左右の壁距離を
#                「指紋(fingerprint)」として記録する。スタート地点の壁パターンも覚える。
#   周回検出=loop closure: 十分走って方位が一周ぶん回り、かつ「今の壁パターンが覚えたスタートの
#                パターンに戻った」ら1周完了とみなす(実車のループ閉じ込み)。1周の距離 LAPLEN が確定。
#   2周目以降(本番): 前方3センサーの今の値を各目盛りの指紋と照合し、どの目盛り(=弧長)に居るかを
#                確率分布(ヒストグラム)で追跡する。予測=エンコーダで分布を前へ、観測=指紋残差
#                k=1/(1+(err/σ)^2) で重み付け→正規化。推定 ŝ=分布のピーク近傍の加重平均・信頼度=ピーク比。
#   他車分離(残差ゲーティング): 「壁測定は位置に・地図差分は他車に」。前方/側方が覚えた壁より有意に
#                近ければ そこに他車(その channel は位置更新から外す=他車が居ても位置は発散しない)。
# ★毎周おなじ反応ラインで走る(先読みで線を変えない)=指紋が周回間で再現し照合が効く。速さより
#   「自分がどこに居るか正確に知る」ことを見せるサンプル(先読み最速化は Apex Strategist へ)。★
# ★D-1: 学習側は ToF×3 + 任意エンコーダのみ。位置は自前計測の学習物(コースデータは渡されない)。★
# 走行(反応)定数
CONF=150000
D_TURN=16000
D_MID=22000
D_OPEN=33000
BIAS=2000
TOP=91
MID=72
SLOW=53
TCAP=58
CLOSE=1600
BRK=240
# 自己位置(loop closure)定数
BLF=380
NF=160
LAP_MIN_S=30000
LAP_HDG=6300
CLOSURE=4000
MINWAIT=6
# 観測カーネルσ² (残差の効き。σ大=甘い・小=多峰へ発散)
SC2=64000000
SS2=100000000
CARGAP2=9000
DT=0.05
WIN=7
GAIN=0.05
# 指紋(fine バケツ)・ヒストグラム
fpC=${'[' + Array(160).fill(99000).join(', ') + ']'}
fpL=${'[' + Array(160).fill(99000).join(', ') + ']'}
fpR=${'[' + Array(160).fill(99000).join(', ') + ']'}
fpN=${'[' + Array(160).fill(0).join(', ') + ']'}
w=${'[' + Array(160).fill(0).join(', ') + ']'}
wt=${'[' + Array(160).fill(0).join(', ') + ']'}
LAPLEN=0
LAPBF=0
lp=0
s=0
sl=0
hdg=0
prevC=0
started=0
sc=0
fs0C=0
fs0L=0
fs0R=0
lstart=0
armed=0
mmin=999999
mminSl=0
sinceMin=0
mdbg=0
estb=0
ests=0
conf=0
carF=0
carL=0
carR=0
pe=0
betaEst=0
betaN=0

def setup():
    global LAPLEN, LAPBF, lp, s, sl, hdg, prevC, started, sc, fs0C, fs0L, fs0R, lstart, armed, mmin, mminSl, sinceMin, mdbg, estb, ests, conf, carF, carL, carR, pe, betaEst, betaN
    RC_setup()
    LAPLEN=0
    LAPBF=0
    lp=0
    s=0
    sl=0
    hdg=0
    prevC=0
    started=0
    sc=0
    fs0C=0
    fs0L=0
    fs0R=0
    lstart=0
    armed=0
    mmin=999999
    mminSl=0
    sinceMin=0
    mdbg=0
    estb=0
    ests=0
    conf=0
    carF=0
    carL=0
    carR=0
    pe=0
    betaEst=0
    betaN=0
    for i in range(NF):
        fpC[i]=99000
        fpL[i]=99000
        fpR[i]=99000
        fpN[i]=0
        w[i]=0
        wt[i]=0

def loop():
    global LAPLEN, LAPBF, lp, s, sl, hdg, prevC, started, sc, fs0C, fs0L, fs0R, lstart, armed, mmin, mminSl, sinceMin, mdbg, estb, ests, conf, carF, carL, carR, pe, betaEst, betaN
    v=RC_wheel_speed(REAR)
    if v<0:
        v=0
    s=s+v
    sl=sl+v
    L=RC_read(LEFT)
    C=RC_read(CENTER)
    R=RC_read(RIGHT)
    if L<0 or L>CONF:
        L=99000
    if C<0 or C>CONF:
        C=99000
    if R<0 or R>CONF:
        R=99000
    dC=0
    if started==1:
        dC=prevC-C
    prevC=C
    started=1
    # ── 反応走行 (毎周同一ライン=指紋再現性の源) ──
    turning=1
    st=0
    dir=CENTER
    if C<D_TURN:
        if L>R:
            dir=LEFT
            st=1
        else:
            dir=RIGHT
            st=0-1
    elif L-R>BIAS:
        dir=LEFT
        st=1
    elif R-L>BIAS:
        dir=RIGHT
        st=0-1
    else:
        dir=CENTER
        turning=0
    sc=sc+1
    if turning==1 and (sc%2)<1:
        RC_steer(dir)
    else:
        RC_steer(CENTER)
    hdg=hdg+st*v
    pwm=SLOW
    if C>D_OPEN:
        pwm=TOP
    elif C>D_MID:
        pwm=MID
    if turning==1 and pwm>TCAP:
        pwm=TCAP
    if dC>CLOSE and C<D_OPEN:
        RC_drive(BRAKE,BRK)
    else:
        RC_drive(FORWARD,pwm)
    # ── 指紋づくり (fine バケツ・lap-local 弧長 sl 目盛り・初回入場時に1回) ──
    bf=sl//BLF
    if bf<0:
        bf=0
    if bf>=NF:
        bf=NF-1
    if lstart==0:
        fs0C=C
        fs0L=L
        fs0R=R
        lstart=1
    if lp==0:
        if fpN[bf]==0:
            fpC[bf]=C
            fpL[bf]=L
            fpR[bf]=R
            fpN[bf]=1
    # ── loop closure (局所最小): 方位が一周ぶん回ったら武装し、スタート指紋との差 match が「最小」に
    #    なった点=真のスタート(=φ1.0)で1周確定。単なる閾値割れは対称ゴーストで早発火するので最小追跡。──
    match=abs(C-fs0C)+abs(L-fs0L)+abs(R-fs0R)
    mdbg=match
    # 武装 = 方位が一周ぶん回った。以後 スタート壁パターンとの差 match が「局所最小」になった点=スタート
    #   復帰 で1周を確定 (単なる閾値割れは対称ゴーストで早発火するので最小追跡)。実測: 周回内の相対位置は
    #   in-sample 0.30bin と高精度。絶対原点は閉じ込み点の ToF ノイズで周ごとに ~2.5bin ブレる (held-out
    #   2.59bin) =この差が loop closure の原点精度限界 (docs/stage_ao/localize_result.md)。
    if sl>LAP_MIN_S and (hdg>LAP_HDG or hdg<0-LAP_HDG):
        armed=1
    if armed==1:
        if match<mmin:
            mmin=match
            mminSl=sl
            sinceMin=0
        else:
            sinceMin=sinceMin+1
        # 最小を過ぎ (match が再上昇) かつ最小が十分小さいなら発火。LAPLEN=mminSl (真の1周長)。
        if sinceMin>MINWAIT and mmin<CLOSURE:
            if lp==0:
                LAPLEN=mminSl
                LAPBF=mminSl//BLF
                if LAPBF<1:
                    LAPBF=1
                if LAPBF>=NF:
                    LAPBF=NF-1
                i=0
                while i<LAPBF:
                    if fpN[i]==0:
                        pj=i-1
                        if pj<0:
                            pj=LAPBF-1
                        fpC[i]=fpC[pj]
                        fpL[i]=fpL[pj]
                        fpR[i]=fpR[pj]
                    w[i]=0.0
                    i=i+1
                lp=1
                Serial.println("localizer ready: " + LAPBF + " bins (loop closed)")
            # 再アンカー: sl を「最小からの走行ぶん」へ (=真スタートから今までの距離)。信念もそこへ。
            sl=sl-mminSl
            bb=sl//BLF
            if bb<0:
                bb=0
            if bb>=LAPBF:
                bb=LAPBF-1
            estb=bb
            i=0
            while i<LAPBF:
                if i==bb:
                    w[i]=1.0
                else:
                    w[i]=0.0
                i=i+1
            armed=0
            mmin=999999
            sinceMin=0
    # ============ 自己位置推定 (lp==1・ヒストグラムフィルタ) ============
    if lp==1:
        # 予測: エンコーダで前進 dsb ビン (小数)。前方移流 + 小拡散。
        dsb=v/BLF
        if dsb<0:
            dsb=0
        if dsb>0.9:
            dsb=0.9
        i=0
        while i<LAPBF:
            wt[i]=w[i]
            i=i+1
        i=0
        while i<LAPBF:
            jm=i-1
            if jm<0:
                jm=LAPBF-1
            jp=i+1
            if jp>=LAPBF:
                jp=0
            w[i]=(1-dsb)*wt[i]+dsb*wt[jm]
            w[i]=0.96*w[i]+0.02*wt[jm]+0.02*wt[jp]
            i=i+1
        # 他車ゲーティング (現ベスト bin の指紋より有意に近ければ その channel は位置更新から除外)
        cb=floor(estb)
        if cb<0:
            cb=0
        if cb>=LAPBF:
            cb=LAPBF-1
        useC=1
        useL=1
        useR=1
        if C<fpC[cb]-CARGAP2:
            useC=0
        if L<fpL[cb]-CARGAP2:
            useL=0
        if R<fpR[cb]-CARGAP2:
            useR=0
        # 観測: 指紋残差 → 有理カーネル k=1/(1+err)。ソフト適用 w*=(SOFTA+SOFTB*k) で1tick の
        #   誤マッチ(知覚エイリアシング=別地点が似て見える)では信念が飛ばず、持続証拠で徐々に収束させる。
        i=0
        while i<LAPBF:
            err=0
            if useC==1:
                d0=C-fpC[i]
                err=err+d0*d0/SC2
            if useL==1:
                d1=L-fpL[i]
                err=err+d1*d1/SS2
            if useR==1:
                d2=R-fpR[i]
                err=err+d2*d2/SS2
            kk=1/(1+err)
            w[i]=w[i]*(0.6+0.4*kk)
            i=i+1
        # 正規化 (総和ガード)
        sm=0
        i=0
        while i<LAPBF:
            sm=sm+w[i]
            i=i+1
        if sm<0.000000001:
            i=0
            while i<LAPBF:
                w[i]=1.0/LAPBF
                i=i+1
            sm=1.0
        i=0
        while i<LAPBF:
            w[i]=w[i]/sm
            i=i+1
        # 推定 ŝ = オドメトリ位置 (=lap-local 弧長 sl の bin・毎周 loop closure で再アンカー=高精度な骨格)
        #   を中心に、その ±WIN 窓内の地図照合ピークへ GAIN だけ寄せる (=有界な地図補正)。実測で ToF 照合
        #   はこの清潔コースでエンコーダに勝てない (観測は追従ノイズを足す) ため、骨格をオドメトリに固定し
        #   観測は「軽い補正＋信頼度・他車ゲーティングの源」に留める (docs/stage_ao/localize_result.md・CI-14)。
        center=sl/BLF
        if center<0:
            center=0
        if center>=LAPBF:
            center=center%LAPBF
        c0=floor(center)
        if c0<0:
            c0=0
        if c0>=LAPBF:
            c0=LAPBF-1
        pk=0
        pi=c0
        jw=0-WIN
        while jw<=WIN:
            kw=(c0+jw)%LAPBF
            if kw<0:
                kw=kw+LAPBF
            if w[kw]>pk:
                pk=w[kw]
                pi=kw
            jw=jw+1
        csum=0
        wsum=0
        jj=0-3
        while jj<=3:
            kk=(pi+jj)%LAPBF
            if kk<0:
                kk=kk+LAPBF
            csum=csum+w[kk]*jj
            wsum=wsum+w[kk]
            jj=jj+1
        off=0
        if wsum>0:
            off=csum/wsum
        estRaw=pi+off
        # 相補フィルタ: 出力=オドメトリ予測 + GAIN×(観測ピーク−予測) の円環ブレンド。オドメトリ(=予測)は
        #   滑らかで既に高精度なので主体にし、観測は「遅いドリフト補正」として少しだけ効かせる(観測ノイズを
        #   出力へ持ち込まない=正しいベイズ融合は予測のみより悪化しない)。
        diff=estRaw-center
        if diff>LAPBF/2:
            diff=diff-LAPBF
        if diff<0-LAPBF/2:
            diff=diff+LAPBF
        estb=center+GAIN*diff
        if estb<0:
            estb=estb+LAPBF
        if estb>=LAPBF:
            estb=estb-LAPBF
        ests=estb*BLF
        conf=pk
        # 他車フラグ (recall 用・driver は他車回避しないがフラグは出す)
        carF=0
        carL=0
        carR=0
        if useC==0:
            carF=1
        if useL==0:
            carL=1
        if useR==0:
            carR=1
        # (毎周の再アンカーは上の loop closure 局所最小で sl をリセット=信念もスタートへ再同期済)
        # ── β 再挑戦 (地図事前分布つき・実験): レコンライン からの横ずれ e とそのレート ──
        cbf=floor(estb)
        if cbf<0:
            cbf=0
        if cbf>=LAPBF:
            cbf=LAPBF-1
        if useL==1 and useR==1 and v>3:
            e=((fpL[cbf]-L)+(R-fpR[cbf]))/2
            de=e-pe
            pe=e
            braw=atan2(de/1000/DT,v)*57.29578
            betaEst=0.7*betaEst+0.3*braw
            betaN=betaN+1
        if (sc%10)==0:
            Serial.println("pos=bin " + round(estb) + "/" + LAPBF + " conf=" + round(conf*100) + "%")
`;

// AS4: 上の 2 本 (Recon Racer / Self-Locator) の Arduino C++ 移植。地図・指紋・ヒストグラムを
//   「配列」で持つ学習モデルが Python でしか書けなかった状態を解消する。ロジックと定数は py 版と
//   同一で、同じコース・同じ車種で走らせた結果 (順位・タイム・verifyHash) が py 版と一致すること
//   を常設ゲート wf_as4_carray.mjs が実測で機械確認する (＝移植の忠実性を主張でなく測定で示す)。
const RECON_RACER_C_CODE = `// Recon Racer (C) — コースを試走で覚えてレーシングライン＋本番は他車を見て最善手  [競技 / フルスケール・Arduino C++・要エンコーダ]  by Opus 5
// ★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★
// Python 版 Recon Racer の忠実な C 移植。走りの考え方は py 版と同一:
//   1周目(試走): 前方3センサーで安全に周回しつつ、エンコーダで測った「スタートからの距離」を
//                インデックスに各地点の 前方の詰まり(コーナーのきつさ sev) と 左右の壁の余地(mapL/mapR)
//                を配列の地図に記録する。前方の最近壁距離 wmin も覚える(近すぎる読み=他車は除く)。
//   2周目以降(本番): 覚えた地図で「この先のきついコーナー」を先読みして手前で減速し、「覚えた壁の
//                距離」と「今のセンサー値」の差から前/横の他車を見つけ、前が詰まったら余地の広い側
//                (=多くはアウト側)から抜き、抜けないなら追従して自滅しない。
// ★C 移植のポイント(ここが配列対応の学びどころ)★
//   ・地図は配列 int sev[N]; / mapL[N]; / mapR[N]; で持つ。長さは const int N=72; の定数で決める。
//   ・要素数は sizeof(sev)/sizeof(sev[0]) でも取れる(Arduino の定石。本シムは要素数を返す)。
//   ・Python の切り捨て除算 a//b は C に無い。本シムの C の / は真の除算なので floor(a/b) と書く
//     (実機 Arduino C は int どうしなら / が切り捨て=同じ結果になる)。
//   ・配列は関数へ渡すと参照が渡る(C のポインタ減衰と同じ)。int f(int a[], int n) と書ける。
// ★D-1: 学習側は ToF×3 + 任意エンコーダのみ。絶対位置・方位(ヨー)は与えられない★
//   エンコーダ未装備だと距離が測れず地図は無効化され、反応のみ(Circuit Racer 相当)で走る。
const int N=72;
const int BL=700;
const int AHEAD=3;
const int TIGHT=20000;
const int VTIGHT=15000;
const int VFAST=26;
const int RTCAP=53;
const int LAP_MIN_S=18000;
const int LAP_HDG=6000;
const int TOP=91;
const int MID=72;
const int SLOW=53;
const int TCAP=58;
const int D_OPEN=33000;
const int D_MID=22000;
const int D_TURN=16000;
const int CONF=150000;   // 信頼区間[mm]: >CONF/範囲外(-3)=遠い/開放
const int CLOSE=1600;
const int BRK=240;
const int BIAS=2000;
const int CARMIN=20000;
const int CARGAP=3000;
const int CAR_SEE=19000;
const int OVT_NEAR=12000;
const int SIDE_OPEN=15000;
const int SIDE_DIFF=6000;
const int FOLLOW=44;
const int FOLLOW_NEAR=9000;
// 地図(配列)。バケツ番号 = スタートからの距離 / BL。
int sev[N];
int mapL[N];
int mapR[N];
float LAPLEN=0;
int LAPB=0;
int phase=0;
float s=0;
float hdg=0;
float prevC=0;
int started=0;
float wmin=99000;
int told=0;
long sc=0;

void setup(){
  RC_setup();
  LAPLEN=0;
  LAPB=0;
  phase=0;
  s=0;
  hdg=0;
  prevC=0;
  started=0;
  wmin=99000;
  told=0;
  sc=0;
  // 配列の初期化。要素数は sizeof で取れる(= N と同じ)。
  for(int i=0;i<sizeof(sev)/sizeof(sev[0]);i++){
    sev[i]=99000;
    mapL[i]=99000;
    mapR[i]=99000;
  }
}

void loop(){
  // --- 自己位置(距離)をエンコーダで積分。未装備(-1)なら距離を測れず地図は無効=反応のみで走る ---
  float v=RC_wheel_speed(REAR);
  if(v<0){ v=0; }
  s=s+v;
  // --- 前方3センサー(範囲外 -3 は「遠く開けている」に正規化) ---
  float L=RC_read(LEFT);
  float C=RC_read(CENTER);
  float R=RC_read(RIGHT);
  if(L<0 || L>CONF){ L=99000; }
  if(C<0 || C>CONF){ C=99000; }
  if(R<0 || R>CONF){ R=99000; }
  float dC=0;
  if(started==1){ dC=prevC-C; }
  prevC=C;
  started=1;
  // --- 距離→バケツ(本番は1周ぶんで折り返す)。py の s//BL は C では floor(s/BL) ---
  int b=floor(s/BL);
  if(phase==1){ b=b%LAPB; }
  if(b<0){ b=0; }
  if(b>=N){ b=N-1; }
  // --- 地図づくり: 前方の詰まり・左右の余地を配列へ記録(最小=最も近い壁) ---
  if(C<sev[b]){ sev[b]=C; }
  if(L<mapL[b]){ mapL[b]=L; }
  if(R<mapR[b]){ mapR[b]=R; }
  if(phase==0 && C>CARMIN && C<wmin){ wmin=C; }
  // --- 前方の他車検知(地図差分) ---
  float cthr=wmin-CARGAP;
  if(cthr>CAR_SEE){ cthr=CAR_SEE; }
  int carF=0;
  if(C<cthr){ carF=1; }
  // --- 側方の他車検知(本番のみ・地図差分) ---
  int carL=0;
  int carR=0;
  if(phase==1){
    if(mapL[b]-L>SIDE_DIFF){ carL=1; }
    if(mapR[b]-R>SIDE_DIFF){ carR=1; }
  }
  // --- 先読み: この先 AHEAD バケツのうち最もきついコーナーを見る(本番のみ) ---
  float coming=99000;
  if(phase==1){
    int j=1;
    while(j<=AHEAD){
      int bb=(b+j)%LAPB;
      if(sev[bb]<coming){ coming=sev[bb]; }
      j=j+1;
    }
  }
  // --- 抜きどころ判断: 前が他車で近く・直線なら、今ほんとうに広く開いている側へ寄せて抜く ---
  int ovt=0;
  if(carF==1 && C<OVT_NEAR && coming>TIGHT){
    int okL=0;
    int okR=0;
    if(L>SIDE_OPEN && carL==0){ okL=1; }
    if(R>SIDE_OPEN && carR==0){ okR=1; }
    if(okL==1 && okR==1){
      if(mapL[b]>mapR[b]){ ovt=1; }
      else if(mapR[b]>mapL[b]){ ovt=-1; }
      else if(L>R){ ovt=1; }
      else { ovt=-1; }
    }
    else if(okL==1){ ovt=1; }
    else if(okR==1){ ovt=-1; }
    if(told==0 && ovt!=0){
      Serial.println("traffic ahead: passing on the open side");
      told=1;
    }
  }
  // --- 操舵の向き(壁回避 → 抜き → センタリング)。st=方位デッドレコニング用の意図方向 ---
  int turning=1;
  int st=0;
  int dir=CENTER;
  if(C<D_TURN){
    if(L>R){ dir=LEFT; st=1; }
    else { dir=RIGHT; st=-1; }
  }
  else if(ovt==1){ dir=LEFT; st=1; }
  else if(ovt==-1){ dir=RIGHT; st=-1; }
  else if(L-R>BIAS){ dir=LEFT; st=1; }
  else if(R-L>BIAS){ dir=RIGHT; st=-1; }
  else { dir=CENTER; turning=0; }
  // ★v2(精密動力学)対応=全舵デューティ変調★ 2ループに1回だけ実際に舵を当て残りは CENTER に戻す。
  sc=sc+1;
  if(turning==1 && (sc%2)<1){ RC_steer(dir); }
  else { RC_steer(CENTER); }
  hdg=hdg+st*v;
  // --- 速度(反応): 前が開けているほど速く・旋回中は抑える ---
  int pwm=SLOW;
  if(C>D_OPEN){ pwm=TOP; }
  else if(C>D_MID){ pwm=MID; }
  if(turning==1 && pwm>TCAP){ pwm=TCAP; }
  // --- 先読み減速(本番のみ) ---
  if(phase==1 && coming<TIGHT && pwm>RTCAP){ pwm=RTCAP; }
  // --- 抜けない時の追従(自滅回避) ---
  if(carF==1 && ovt==0 && C<FOLLOW_NEAR && pwm>FOLLOW){ pwm=FOLLOW; }
  // --- ブレーキ判断: 反応(前方が速く縮む) + 先読み(きついコーナーへ高速接近) ---
  int brake=0;
  if(dC>CLOSE && C<D_OPEN){ brake=1; }
  if(phase==1 && coming<VTIGHT && v>VFAST){ brake=1; }
  if(brake==1){ RC_drive(BRAKE,BRK); }
  else { RC_drive(FORWARD,pwm); }
  // --- 1周ぶん回ったら「試走→本番」へ ---
  if(phase==0 && s>LAP_MIN_S && (hdg>LAP_HDG || hdg<-LAP_HDG)){
    LAPLEN=s;
    LAPB=floor(s/BL);
    if(LAPB<1){ LAPB=1; }
    phase=1;
    Serial.println("course learned: " + LAPB + " zones");
  }
}
`;

const COMP_LOCALIZE_C_CODE = `// Self-Locator (C) — ToF×3 + 車輪エンコーダで「今コースのどこにいるか」を1次元ヒストグラムフィルタで推定する  [競技 / フルスケール・Arduino C++・要エンコーダ]  by Opus 5
// ★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★
// Python 版 Self-Locator の忠実な C 移植。考え方は py 版と同一:
//   1周目(試走): 反応走行しながら「スタートからの距離」を目盛りに、各地点の前方/左右の壁距離を
//                「指紋(fingerprint)」の配列 fpC/fpL/fpR に記録する。スタート地点の壁も覚える。
//   周回検出=loop closure: 方位が一周ぶん回り、スタートの壁パターンとの差 match が「局所最小」に
//                なった点で1周確定(単なる閾値割れは対称ゴーストで早発火するので最小追跡)。
//   2周目以降(本番): 予測(エンコーダで確率分布 w[] を前へ移流)＋観測(指紋残差の有理カーネル)で
//                ヒストグラムフィルタを回し、オドメトリ中心の ±WIN 窓のピークへ GAIN だけ寄せる。
//   他車分離(残差ゲーティング): 覚えた壁より有意に近い channel は位置更新から外す(他車が居ても発散しない)。
// ★C 移植のポイント(配列の学びどころ)★
//   ・指紋と信念(確率分布)を配列で持つ: int fpC[NF]; / float w[NF]; / float wt[NF];(予測用の作業配列)
//   ・py の a//b は floor(a/b)。剰余 % と floor(), atan2(), round(), abs() はそのまま使える。
//   ・配列の要素数は sizeof(fpC)/sizeof(fpC[0]) で取れる(Arduino の定石)。
// ★毎周おなじ反応ラインで走る(先読みで線を変えない)=指紋が周回間で再現し照合が効く。速さより
//   「自分がどこに居るか正確に知る」ことを見せるサンプル(先読み最速化は Apex Strategist へ)。★
// ★D-1: 学習側は ToF×3 + 任意エンコーダのみ。位置は自前計測の学習物(コースデータは渡されない)。★
// 走行(反応)定数
const int CONF=150000;
const int D_TURN=16000;
const int D_MID=22000;
const int D_OPEN=33000;
const int BIAS=2000;
const int TOP=91;
const int MID=72;
const int SLOW=53;
const int TCAP=58;
const int CLOSE=1600;
const int BRK=240;
// 自己位置(loop closure)定数
const int BLF=380;
const int NF=160;
const int LAP_MIN_S=30000;
const int LAP_HDG=6300;
const int CLOSURE=4000;
const int MINWAIT=6;
// 観測カーネルσ² (残差の効き。σ大=甘い・小=多峰へ発散)
const float SC2=64000000;
const float SS2=100000000;
const int CARGAP2=9000;
const float DT=0.05;
const int WIN=7;
const float GAIN=0.05;
// 指紋(fine バケツ)・ヒストグラム
int fpC[NF];
int fpL[NF];
int fpR[NF];
int fpN[NF];
float w[NF];
float wt[NF];
float LAPLEN=0;
int LAPBF=0;
int lp=0;
float s=0;
float sl=0;
float hdg=0;
float prevC=0;
int started=0;
long sc=0;
float fs0C=0;
float fs0L=0;
float fs0R=0;
int lstart=0;
int armed=0;
float mmin=999999;
float mminSl=0;
int sinceMin=0;
float mdbg=0;
float estb=0;
float ests=0;
float conf=0;
int carF=0;
int carL=0;
int carR=0;
float pe=0;
float betaEst=0;
long betaN=0;

void setup(){
  RC_setup();
  LAPLEN=0;
  LAPBF=0;
  lp=0;
  s=0;
  sl=0;
  hdg=0;
  prevC=0;
  started=0;
  sc=0;
  fs0C=0;
  fs0L=0;
  fs0R=0;
  lstart=0;
  armed=0;
  mmin=999999;
  mminSl=0;
  sinceMin=0;
  mdbg=0;
  estb=0;
  ests=0;
  conf=0;
  carF=0;
  carL=0;
  carR=0;
  pe=0;
  betaEst=0;
  betaN=0;
  for(int i=0;i<NF;i++){
    fpC[i]=99000;
    fpL[i]=99000;
    fpR[i]=99000;
    fpN[i]=0;
    w[i]=0;
    wt[i]=0;
  }
}

void loop(){
  float v=RC_wheel_speed(REAR);
  if(v<0){ v=0; }
  s=s+v;
  sl=sl+v;
  float L=RC_read(LEFT);
  float C=RC_read(CENTER);
  float R=RC_read(RIGHT);
  if(L<0 || L>CONF){ L=99000; }
  if(C<0 || C>CONF){ C=99000; }
  if(R<0 || R>CONF){ R=99000; }
  float dC=0;
  if(started==1){ dC=prevC-C; }
  prevC=C;
  started=1;
  // ── 反応走行 (毎周同一ライン=指紋再現性の源) ──
  int turning=1;
  int st=0;
  int dir=CENTER;
  if(C<D_TURN){
    if(L>R){ dir=LEFT; st=1; }
    else { dir=RIGHT; st=-1; }
  }
  else if(L-R>BIAS){ dir=LEFT; st=1; }
  else if(R-L>BIAS){ dir=RIGHT; st=-1; }
  else { dir=CENTER; turning=0; }
  sc=sc+1;
  if(turning==1 && (sc%2)<1){ RC_steer(dir); }
  else { RC_steer(CENTER); }
  hdg=hdg+st*v;
  int pwm=SLOW;
  if(C>D_OPEN){ pwm=TOP; }
  else if(C>D_MID){ pwm=MID; }
  if(turning==1 && pwm>TCAP){ pwm=TCAP; }
  if(dC>CLOSE && C<D_OPEN){ RC_drive(BRAKE,BRK); }
  else { RC_drive(FORWARD,pwm); }
  // ── 指紋づくり (fine バケツ・lap-local 弧長 sl 目盛り・初回入場時に1回) ──
  int bf=floor(sl/BLF);
  if(bf<0){ bf=0; }
  if(bf>=NF){ bf=NF-1; }
  if(lstart==0){
    fs0C=C;
    fs0L=L;
    fs0R=R;
    lstart=1;
  }
  if(lp==0){
    if(fpN[bf]==0){
      fpC[bf]=C;
      fpL[bf]=L;
      fpR[bf]=R;
      fpN[bf]=1;
    }
  }
  // ── loop closure (局所最小): 方位が一周ぶん回ったら武装し、スタート指紋との差 match が「最小」に
  //    なった点=真のスタートで1周確定。単なる閾値割れは対称ゴーストで早発火するので最小追跡。──
  float match=abs(C-fs0C)+abs(L-fs0L)+abs(R-fs0R);
  mdbg=match;
  if(sl>LAP_MIN_S && (hdg>LAP_HDG || hdg<-LAP_HDG)){ armed=1; }
  if(armed==1){
    if(match<mmin){
      mmin=match;
      mminSl=sl;
      sinceMin=0;
    }
    else { sinceMin=sinceMin+1; }
    // 最小を過ぎ (match が再上昇) かつ最小が十分小さいなら発火。LAPLEN=mminSl (真の1周長)。
    if(sinceMin>MINWAIT && mmin<CLOSURE){
      if(lp==0){
        LAPLEN=mminSl;
        LAPBF=floor(mminSl/BLF);
        if(LAPBF<1){ LAPBF=1; }
        if(LAPBF>=NF){ LAPBF=NF-1; }
        int i=0;
        while(i<LAPBF){
          if(fpN[i]==0){
            int pj=i-1;
            if(pj<0){ pj=LAPBF-1; }
            fpC[i]=fpC[pj];
            fpL[i]=fpL[pj];
            fpR[i]=fpR[pj];
          }
          w[i]=0.0;
          i=i+1;
        }
        lp=1;
        Serial.println("localizer ready: " + LAPBF + " bins (loop closed)");
      }
      // 再アンカー: sl を「最小からの走行ぶん」へ。信念もそこへ。
      sl=sl-mminSl;
      int bb=floor(sl/BLF);
      if(bb<0){ bb=0; }
      if(bb>=LAPBF){ bb=LAPBF-1; }
      estb=bb;
      int i2=0;
      while(i2<LAPBF){
        if(i2==bb){ w[i2]=1.0; }
        else { w[i2]=0.0; }
        i2=i2+1;
      }
      armed=0;
      mmin=999999;
      sinceMin=0;
    }
  }
  // ============ 自己位置推定 (lp==1・ヒストグラムフィルタ) ============
  if(lp==1){
    // 予測: エンコーダで前進 dsb ビン (小数)。前方移流 + 小拡散。
    float dsb=v/BLF;
    if(dsb<0){ dsb=0; }
    if(dsb>0.9){ dsb=0.9; }
    int i=0;
    while(i<LAPBF){
      wt[i]=w[i];
      i=i+1;
    }
    i=0;
    while(i<LAPBF){
      int jm=i-1;
      if(jm<0){ jm=LAPBF-1; }
      int jp=i+1;
      if(jp>=LAPBF){ jp=0; }
      w[i]=(1-dsb)*wt[i]+dsb*wt[jm];
      w[i]=0.96*w[i]+0.02*wt[jm]+0.02*wt[jp];
      i=i+1;
    }
    // 他車ゲーティング (現ベスト bin の指紋より有意に近ければ その channel は位置更新から除外)
    int cb=floor(estb);
    if(cb<0){ cb=0; }
    if(cb>=LAPBF){ cb=LAPBF-1; }
    int useC=1;
    int useL=1;
    int useR=1;
    if(C<fpC[cb]-CARGAP2){ useC=0; }
    if(L<fpL[cb]-CARGAP2){ useL=0; }
    if(R<fpR[cb]-CARGAP2){ useR=0; }
    // 観測: 指紋残差 → 有理カーネル k=1/(1+err)。ソフト適用で1tick の誤マッチでは信念が飛ばない。
    i=0;
    while(i<LAPBF){
      float err=0;
      if(useC==1){
        float d0=C-fpC[i];
        err=err+d0*d0/SC2;
      }
      if(useL==1){
        float d1=L-fpL[i];
        err=err+d1*d1/SS2;
      }
      if(useR==1){
        float d2=R-fpR[i];
        err=err+d2*d2/SS2;
      }
      float kk=1/(1+err);
      w[i]=w[i]*(0.6+0.4*kk);
      i=i+1;
    }
    // 正規化 (総和ガード)
    float sm=0;
    i=0;
    while(i<LAPBF){
      sm=sm+w[i];
      i=i+1;
    }
    if(sm<0.000000001){
      i=0;
      while(i<LAPBF){
        w[i]=1.0/LAPBF;
        i=i+1;
      }
      sm=1.0;
    }
    i=0;
    while(i<LAPBF){
      w[i]=w[i]/sm;
      i=i+1;
    }
    // 推定 ŝ = オドメトリ位置を中心に ±WIN 窓内の地図照合ピークへ GAIN だけ寄せる (有界な地図補正)。
    float center=sl/BLF;
    if(center<0){ center=0; }
    if(center>=LAPBF){ center=center%LAPBF; }
    int c0=floor(center);
    if(c0<0){ c0=0; }
    if(c0>=LAPBF){ c0=LAPBF-1; }
    float pk=0;
    int pi=c0;
    int jw=-WIN;
    while(jw<=WIN){
      int kw=(c0+jw)%LAPBF;
      if(kw<0){ kw=kw+LAPBF; }
      if(w[kw]>pk){
        pk=w[kw];
        pi=kw;
      }
      jw=jw+1;
    }
    float csum=0;
    float wsum=0;
    int jj=-3;
    while(jj<=3){
      int kk2=(pi+jj)%LAPBF;
      if(kk2<0){ kk2=kk2+LAPBF; }
      csum=csum+w[kk2]*jj;
      wsum=wsum+w[kk2];
      jj=jj+1;
    }
    float off=0;
    if(wsum>0){ off=csum/wsum; }
    float estRaw=pi+off;
    // 相補フィルタ: 出力=オドメトリ予測 + GAIN×(観測ピーク−予測) の円環ブレンド。
    float diff=estRaw-center;
    if(diff>LAPBF/2){ diff=diff-LAPBF; }
    if(diff<-LAPBF/2){ diff=diff+LAPBF; }
    estb=center+GAIN*diff;
    if(estb<0){ estb=estb+LAPBF; }
    if(estb>=LAPBF){ estb=estb-LAPBF; }
    ests=estb*BLF;
    conf=pk;
    // 他車フラグ (recall 用・driver は他車回避しないがフラグは出す)
    carF=0;
    carL=0;
    carR=0;
    if(useC==0){ carF=1; }
    if(useL==0){ carL=1; }
    if(useR==0){ carR=1; }
    // ── β 再挑戦 (地図事前分布つき・実験): レコンライン からの横ずれ e とそのレート ──
    int cbf=floor(estb);
    if(cbf<0){ cbf=0; }
    if(cbf>=LAPBF){ cbf=LAPBF-1; }
    if(useL==1 && useR==1 && v>3){
      float e=((fpL[cbf]-L)+(R-fpR[cbf]))/2;
      float de=e-pe;
      pe=e;
      float braw=atan2(de/1000/DT,v)*57.29578;
      betaEst=0.7*betaEst+0.3*braw;
      betaN=betaN+1;
    }
    if((sc%10)==0){
      Serial.println("pos=bin " + round(estb) + "/" + LAPBF + " conf=" + round(conf*100) + "%");
    }
  }
}
`;

const STRATEGIST_CODE = `# Apex Strategist — 試走で覚えた地図から速度プロファイルを計画して先読み最速で周回する  [競技 / フルスケール・Python・要エンコーダ]  by Opus 4.8
# ★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★
# 標準の Circuit Racer は v2 で全舵=切りすぎスピンを避けるため保守的(TCAP 低め)に組み、実測 ~210s/3周(~31m/s
# 巡航)で流す。Apex Strategist は本番前に試走(recon)でコースを地図化し、その地図で自信を持って攻める:
#   A) 走りの土台=recon で「踏める」と分かったコースを反応型で"攻めチューン"する(直線=踏み切り TOP2=255・
#      操舵中だけ TCAP=120 で前輪空転→巻き込みを抑える=v2 の FF レッスン)。実測 ~163–187s/3周=Circuit Racer 比
#      11–22% 速い(crash0)。★この差の大半はこの"攻めチューン"が生む★=地図が「攻めても大丈夫」を保証する。
#   B) 速度プロファイル計画: recon で曲率代理 cr[b]=各バケツで実際に舵を当てていた割合(速度重み)を作り、
#      vmax[b]=VMAX−KMAP×cr[b](直線ほど速い)→前進/後退パス(O(N))で実現可能な計画へ。本番は自己位置
#      (エンコーダ距離+loop closure)で今のバケツを知り、地図のきつい区間の手前でスロットルを絞る(加速ガバナ)。
# ★正直な実測(CI-14・AO8/AO10 と同型の限界)★ このコースは4コーナー全部 R≈116m と均一で"どのコーナーを速く"の
#   差が無く、かつ ToF 自己位置は幅28m・2回対称の超楕円では loop closure が粗い(~数バケツ=AO10 の絶対位置限界と
#   同根)。ゆえに「地図で更に踏み込む精密な後追い制動」は安全に成立せず、速度プロファイルの純利得は概ね中立
#   (加速ガバナは安全側の保険)。=速いのは"recon が保証する攻めチューン"で、精密プロファイルはこの清潔コースでは
#   出番が小さい、という正直な結果(勝てない所は勝てない=AO8 のドリフト NO-GO・AO10 の ToF<オドメトリ と同じ教訓)。
# ★戦略ドリフト(教材)★ コーナー毎に grip/drift を選ぶ状態機械を持つ: cr[b] が幾何限界級(=フル舵を当て
#   続けないと曲がれない≈R<1.1×R_min。car の最小回転半径 R_min=5.84m)のバケツだけ drift 発動。だが AO8 の
#   go/no-go 実測どおり乾燥の中高速コーナーでは3値ステアの持続ドリフトは grip に勝てず出口再グリップも作れず
#   NO-GO。この競技サーキットは最小 R≈116m ≫ 6.4m ゆえ drift-GO のバケツは存在せず状態機械は常に grip・非発動
#   =「速いのは正確な grip、drift は限界を超えた時だけ・ここでは出番なし」を正直に見せる(勝てない所は勝てない)。
# ★D-1: 学習側は ToF×3 + 任意エンコーダのみ。地図・自己位置・速度計画は全て自前計測の学習物。★
#   エンコーダ未装備なら距離を測れず計画不能 → 反応型(Circuit Racer 相当)へ正直にフォールバックする。
N=72
BL=700
CONF=150000
# 反応ドライブ (試走ラップ + エンコーダ無しフォールバック) = Recon/Circuit 系の清潔チューン
D_TURN=16000
D_MID=22000
D_OPEN=33000
BIAS=2000
TOP=91
MID=72
SLOW=53
TCAP0=58
CLOSE=1600
BRK=240
RSTEER=2
# 本番(phase1)の反応速度=前方開放度ベースで直線は踏み切り(TOP2)・操舵中は TCAP 頭打ち(清潔高速の土台)
TOP2=255
MID2=200
SLOW2=120
# loop closure (方位一周 + スタート指紋の局所最小)。odo/m≈20・1周≈41960odo(BL=700→~60バケツ)・hdg≈7100/周。
# 定数は comp_localize(AO10)の実証値=0.54bin(スタートを 13% 早取りしない)。
LAP_MIN_S=30000
LAP_HDG=6300
CLOSURE=4000
MINWAIT=6
SFS0=2500
# 速度プロファイル計画 (BL=700odo≈35m/バケツ・FWD/BWD=2a·Δs の v² 予算)
VMAX=58
VMIN=34
KMAP=54
FWD=350
BWD=1400
LOOK=3
PWMAX=255
PWB=100
KP=12
OVER=2
BRKG=220
TCAP=120
CORNTH=46
# 他車 / TTC (追突誘発ゼロ)
CARGAP=3000
CAR_SEE=19000
CARMIN=20000
SIDE_DIFF=6000
TTCB=255
TTC_MIN=0.8
DT=0.05
FOLLOW=44
FOLLOW_NEAR=9000
# 戦略ドリフト状態機械 (教材=このコースでは非発動)
DRIFT_ON=1
KGO=0.85
DBRK=255
# 地図・計画・状態
sev=${'[' + Array(72).fill(99000).join(', ') + ']'}
mapL=${'[' + Array(72).fill(99000).join(', ') + ']'}
mapR=${'[' + Array(72).fill(99000).join(', ') + ']'}
cS=${'[' + Array(72).fill(0).join(', ') + ']'}
cV=${'[' + Array(72).fill(0).join(', ') + ']'}
vprof=${'[' + Array(72).fill(0).join(', ') + ']'}
dgo=${'[' + Array(72).fill(0).join(', ') + ']'}
phase=0
s=0
sl=0
hdg=0
prevC=0
started=0
wmin=99000
sc=0
LAPLEN=0
LAPB=0
fs0C=0
fs0L=0
fs0R=0
lstart=0
armed=0
mmin=999999
mminSl=0
sinceMin=0
estb=0
dstate=0
driftFired=0
maxcr=0

def setup():
    global phase, s, sl, hdg, prevC, started, wmin, sc, LAPLEN, LAPB, fs0C, fs0L, fs0R, lstart, armed, mmin, mminSl, sinceMin, estb, dstate, driftFired, maxcr
    RC_setup()
    phase=0
    s=0
    sl=0
    hdg=0
    prevC=0
    started=0
    wmin=99000
    sc=0
    LAPLEN=0
    LAPB=0
    fs0C=0
    fs0L=0
    fs0R=0
    lstart=0
    armed=0
    mmin=999999
    mminSl=0
    sinceMin=0
    estb=0
    dstate=0
    driftFired=0
    maxcr=0
    for i in range(N):
        sev[i]=99000
        mapL[i]=99000
        mapR[i]=99000
        cS[i]=0
        cV[i]=0
        vprof[i]=0
        dgo[i]=0

def loop():
    global phase, s, sl, hdg, prevC, started, wmin, sc, LAPLEN, LAPB, fs0C, fs0L, fs0R, lstart, armed, mmin, mminSl, sinceMin, estb, dstate, driftFired, maxcr
    v=RC_wheel_speed(REAR)
    enc=1
    if v<0:
        enc=0
        v=0
    s=s+v
    sl=sl+v
    L=RC_read(LEFT)
    C=RC_read(CENTER)
    R=RC_read(RIGHT)
    if L<0 or L>CONF:
        L=99000
    if C<0 or C>CONF:
        C=99000
    if R<0 or R>CONF:
        R=99000
    dC=0
    if started==1:
        dC=prevC-C
    prevC=C
    started=1
    b=sl//BL
    if phase==1:
        b=b%LAPB
    if b<0:
        b=0
    if b>=N:
        b=N-1
    # ── 操舵の向き (広い方へ) + 方位デッドレコニング intent st ──
    turning=1
    st=0
    dir=CENTER
    if C<D_TURN:
        if L>R:
            dir=LEFT
            st=1
        else:
            dir=RIGHT
            st=0-1
    elif L-R>BIAS:
        dir=LEFT
        st=1
    elif R-L>BIAS:
        dir=RIGHT
        st=0-1
    else:
        dir=CENTER
        turning=0
    # ── 戦略ドリフト状態機械: このバケツが drift-GO なら drift 制御、そうでなければ grip ──
    dstate=0
    drifting=0
    if phase==1 and DRIFT_ON==1 and dgo[b]==1:
        drifting=1
        dstate=3
        driftFired=driftFired+1
    # ── 操舵の適用 (デューティ変調で実効舵角を薄める=v2 の大R で全舵切りすぎ→後輪破り を回避) ──
    sc=sc+1
    applSign=0
    if drifting==1:
        RC_steer(dir)
        applSign=st
    elif turning==1 and (sc%RSTEER)<1:
        RC_steer(dir)
        applSign=st
    else:
        RC_steer(CENTER)
    hdg=hdg+st*v
    # ── 試走(phase0): 地図づくり (最近壁・曲率代理=当て舵の割合・スタート指紋) ──
    if phase==0:
        if C<sev[b]:
            sev[b]=C
        if L<mapL[b]:
            mapL[b]=L
        if R<mapR[b]:
            mapR[b]=R
        cS[b]=cS[b]+applSign*v
        cV[b]=cV[b]+v
        if C>CARMIN and C<wmin:
            wmin=C
        if lstart==0 and sl>SFS0:
            fs0C=C
            fs0L=L
            fs0R=R
            lstart=1
    # ── loop closure(1回だけ): 方位一周後、スタート指紋との差 match の局所最小=1周確定→LAPLEN 確定+
    #    原点をスタートへ整合。以後は純オドメトリで毎周 sl-=LAPLEN 再アンカー(AO10=オドメトリ骨格が
    #    最良・周回内0.30bin。指紋照合は対称コースで多峰=毎周は不安定ゆえ最初の1回のみ使う)。──
    match=abs(C-fs0C)+abs(L-fs0L)+abs(R-fs0R)
    if phase==0 and sl>LAP_MIN_S and (hdg>LAP_HDG or hdg<0-LAP_HDG):
        armed=1
    if phase==0 and armed==1:
        if match<mmin:
            mmin=match
            mminSl=sl
            sinceMin=0
        else:
            sinceMin=sinceMin+1
        if sinceMin>MINWAIT and mmin<CLOSURE:
            if phase==0:
                LAPLEN=mminSl
                LAPB=mminSl//BL
                if LAPB<1:
                    LAPB=1
                if LAPB>=N:
                    LAPB=N-1
                # 曲率代理 cr=|Σ当て舵×v|/Σv → 3バケツ平滑 → vmax 線形写像 → 前進/後退パス
                i=0
                while i<LAPB:
                    im=i-1
                    if im<0:
                        im=LAPB-1
                    ip=i+1
                    if ip>=LAPB:
                        ip=0
                    d0=cV[i]
                    if d0<1:
                        d0=1
                    dm=cV[im]
                    if dm<1:
                        dm=1
                    dp=cV[ip]
                    if dp<1:
                        dp=1
                    cr=(abs(cS[i])/d0*2+abs(cS[im])/dm+abs(cS[ip])/dp)/4
                    if cr>maxcr:
                        maxcr=cr
                    vm=VMAX-KMAP*cr
                    if vm>VMAX:
                        vm=VMAX
                    if vm<VMIN:
                        vm=VMIN
                    vprof[i]=vm
                    dgo[i]=0
                    if cr>=KGO:
                        dgo[i]=1
                    i=i+1
                p=0
                while p<2:
                    i=0
                    while i<LAPB:
                        j=i+1
                        if j>=LAPB:
                            j=0
                        lim=sqrt(vprof[i]*vprof[i]+FWD)
                        if vprof[j]>lim:
                            vprof[j]=lim
                        i=i+1
                    p=p+1
                p=0
                while p<2:
                    i=LAPB-1
                    while i>=0:
                        j=i-1
                        if j<0:
                            j=LAPB-1
                        lim=sqrt(vprof[i]*vprof[i]+BWD)
                        if vprof[j]>lim:
                            vprof[j]=lim
                        i=i-1
                    p=p+1
                phase=1
                armed=0
                Serial.println("plan ready: " + LAPB + " zones (max curvature " + round(maxcr*100) + "%)")
    # ── 本番: 純オドメトリで毎周 sl-=LAPLEN 再アンカー。原点はスタート(tick0)のまま=地図と同一原点で
    #    整合(地図は phase0 の sl-from-start で構築・照会も同じ sl→整合。指紋シフトはしない)。骨格=
    #    エンコーダ距離で周回内高精度(AO10・0.30bin)、周回境界だけ LAPLEN で畳む(ドリフト有界)。──
    if phase==1 and sl>=LAPLEN:
        sl=sl-LAPLEN
    # ── b を再アンカー後で取り直す ──
    b=sl//BL
    if phase==1:
        b=b%LAPB
    if b<0:
        b=0
    if b>=N:
        b=N-1
    if phase==1:
        estb=b
    # ── 速度: 試走/フォールバックは反応、本番は速度プロファイル ──
    if phase==0 or enc==0:
        # 試走(phase0)もエンコーダ無しフォールバックも「反応型 高速」(TOP2/操舵中 TCAP)で走る=無駄な遅い
        #   周回を作らない(試走ラップも本番同等に速い・地図はその間に作る)。反応制動(dC)で安全。
        pwm=SLOW2
        if C>D_OPEN:
            pwm=TOP2
        elif C>D_MID:
            pwm=MID2
        if turning==1 and pwm>TCAP:
            pwm=TCAP
        if dC>CLOSE and C<D_OPEN:
            RC_drive(BRAKE,BRK)
        else:
            RC_drive(FORWARD,pwm)
    elif drifting==1:
        # drift 制御 (TURN_IN/DRIFT: フル舵 + ブレーキ脈動で後軸を流す。EXIT は grip 復帰=非 drift 側)
        if (sc%2)<1:
            RC_drive(BRAKE,DBRK)
        else:
            RC_drive(FORWARD,PWMAX)
    else:
        # 他車検知 (地図差分)
        carF=0
        cthr=wmin-CARGAP
        if cthr>CAR_SEE:
            cthr=CAR_SEE
        if C<cthr:
            carF=1
        # 計画目標速度: この先 LOOK バケツの最小 vprof(=手前から減速)。地図が視程(コーン~25m)の地平を
        #   延ばし、反応型が「見えてから」制動する頭打ちを破る。min-over-窓 なので自己位置が数バケツ
        #   ズレても頑健(コーナーを取り逃さない)。
        tgt=vprof[b]
        j=1
        while j<=LOOK:
            bb=(b+j)%LAPB
            if vprof[bb]<tgt:
                tgt=vprof[bb]
            j=j+1
        # 反応の速さ=前方開放度ベース+操舵中 TCAP 頭打ち(Circuit Racer で実証した清潔高速の土台=直線は
        #   踏み切って高速へ・操舵中は前輪空転→巻き込みを TCAP で防ぐ=v2 の FF レッスン)。
        pwm=SLOW2
        if C>D_OPEN:
            pwm=TOP2
        elif C>D_MID:
            pwm=MID2
        if turning==1 and pwm>TCAP:
            pwm=TCAP
        # ★地図の速度プロファイルを「加速ガバナ」として使う★ この先(LOOK バケツ内)に計画速度の低い=きつい
        #   区間があれば、そこへ突っ込む手前でスロットルを計画速度ぶんに絞る(ハードブレーキでなく throttle-lift)。
        #   地図は加速を「抑える」だけ=位置が数バケツずれても踏み込み過ぎで刺さらない(常に安全側)。これが
        #   コーン視程(~25m)の地平を地図で延ばす本質=反応型が「見えてから」しか緩められないのを先に緩める。
        if tgt<CORNTH and (turning==1 or dC>0):
            pcap=PWB+KP*(tgt-v)
            if pcap<0:
                pcap=0
            if pcap<pwm:
                pwm=pcap
        # TTC ガード: 前車へ接近しすぎたら制動オーバーライド(追突誘発ゼロ)
        ttcB=0
        if carF==1 and dC>0 and v>1:
            clos=dC/1000/DT
            if clos>0:
                ttc=C/1000/clos
                if ttc<TTC_MIN:
                    ttcB=1
        if carF==1 and C<FOLLOW_NEAR and v>FOLLOW:
            ttcB=1
        # 制動: 反応(前方が速く縮む=安全網) OR TTC。ハードブレーキは反応/TTC のみ(地図は加速ガバナで
        #   throttle-lift のみ=位置ズレでも刺さらない)。Circuit Racer と同じく制動は操舵中でも可(実証済清潔)。
        brake=0
        if dC>CLOSE and C<D_OPEN:
            brake=1
        if ttcB==1:
            brake=1
        if brake==1:
            RC_drive(BRAKE,BRK)
        else:
            RC_drive(FORWARD,pwm)
`;

// ── 卓上 Lv1〜3 の Python 版 (C 版 FR/AWD/FF の忠実移植・走りは同一) ──────────────
// C の Apex Hunter / Traction Blitz / Steady Nose をロジック・定数そのままに Python の書き方
// (def setup/loop・global・RC_read) へ置き換えた入門サンプル。「C で読んだ土台を Python でも
// 書けるようにする」ための空白帯補完 (卓上 Lv1〜3 に Python 版が無かった)。走行挙動は C 版と同一。
const PY_FR_CODE = `# Apex Hunter (Python) — ノーマル FR 用  [卓上 Lv1 基準・Python 版]  by Opus 4.8
# C 版「Apex Hunter」の Python 移植。ロジックと定数は完全に同一 (=まったく同じ走り) で、
# 書き方だけ Python (def setup/loop・global・RC_read) に置き換えた入門サンプル。
# ★学習の出発点★ FR は駆動(後輪)と操舵(前輪)が分かれるので最も素直に曲がる。
# 全車に共通する土台ロジック(3つ):
#   (1) 前方センサー C の空き具合で速度を3段に変える(直線=速い / 中速 / コーナー=遅い)
#   (2) 前が詰まったら左右で「広い方」へ全力で曲げる
#   (3) 側方の壁が近ければ離れる方向へ補正する
# ※Python では RC_read(LEFT/CENTER/RIGHT) で前方3センサーを読む(C の sensor0/1/2 と同じ値)。

TOP=250        # 速度: 直線
CRUISE=215     # 速度: 中速
SLOW=130       # 速度: コーナー
TCAP=195       # 旋回中の上限
D_OPEN=620     # 判定距離[mm]: これより前が開けば TOP
D_MID=405      # 判定距離[mm]: これより前が開けば CRUISE
D_TURN=375     # 判定距離[mm]: これより前が詰まれば曲げる
D_SIDE=180     # 判定距離[mm]: 側方がこれより近ければ離れる
CONF=640       # 信頼区間[mm]: これを超える/範囲外(-3)の測距は「遠い/開放」とみなす
OPEN=9999      # 開放を表す大きな値

def setup():
    RC_setup()

def loop():
    L=RC_read(LEFT)    # 前方3センサー (C の sensor0/1/2 に対応)
    C=RC_read(CENTER)
    R=RC_read(RIGHT)
    if L<0 or L>CONF:  # 信頼区間外/範囲外(-3) = 開放
        L=OPEN
    if C<0 or C>CONF:
        C=OPEN
    if R<0 or R>CONF:
        R=OPEN
    # (2)(3) 操舵: 前が詰まれば広い方へ、側方が近ければ離れる
    turning=1
    if C<D_TURN:
        if L>R:
            RC_steer(LEFT)
        else:
            RC_steer(RIGHT)
    elif R<D_SIDE:
        RC_steer(LEFT)
    elif L<D_SIDE:
        RC_steer(RIGHT)
    else:
        RC_steer(CENTER)
        turning=0
    # (1) 速度: 前方が開けているほど速く
    pwm=SLOW
    if C>D_OPEN:
        pwm=TOP
    elif C>D_MID:
        pwm=CRUISE
    if turning==1 and pwm>TCAP:   # 旋回中は軽く抑え巻き込みを防ぐ
        pwm=TCAP
    RC_drive(FORWARD,pwm)
`;

const PY_AWD_CODE = `# Traction Blitz (Python) — ノーマル 4WD 用  [卓上 Lv2 強みを使う・Python 版]  by Opus 4.8
# C 版「Traction Blitz」の Python 移植。ロジックと定数は完全に同一 (=同じ走り)。
# ★引き出すロジック★ 4WD だけができる「コーナー出口で“誰より早く”フル加速」。
#   前方距離 C の前回との差 dC を取り、前が開き出した瞬間(dC>0=立ち上がり)に全開へ。
# 基準(FR)との違い: 速度3段は同じ。そこに「立ち上がり検知 → 即全開」を足しただけ。
# ※Python で前回値を覚えるには module 変数 (prevC/started) を global で書き換える。

TOP=235
CRUISE=215
SLOW=140
TCAP=208
D_OPEN=645
D_MID=410
D_TURN=386
D_SIDE=178
CONF=640       # 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」
OPEN=9999
EXIT=18        # 前方が1ループでこの[mm]以上開いたら=コーナー脱出 → 立ち上がり全開
prevC=0        # 前回の前方距離 (差分=接近/開きの検知に使う)
started=0

def setup():
    global prevC, started
    RC_setup()
    prevC=0
    started=0

def loop():
    global prevC, started
    L=RC_read(LEFT)
    C=RC_read(CENTER)
    R=RC_read(RIGHT)
    if L<0 or L>CONF:
        L=OPEN
    if C<0 or C>CONF:
        C=OPEN
    if R<0 or R>CONF:
        R=OPEN
    dC=0
    if started==1:
        dC=C-prevC     # dC>0 = 前方が開いてくる = コーナーの立ち上がり
    prevC=C
    started=1
    turning=1
    if C<D_TURN:
        if L>R:
            RC_steer(LEFT)
        else:
            RC_steer(RIGHT)
    elif R<D_SIDE:
        RC_steer(LEFT)
    elif L<D_SIDE:
        RC_steer(RIGHT)
    else:
        RC_steer(CENTER)
        turning=0
    pwm=SLOW
    if C>D_OPEN:
        pwm=TOP
    elif C>D_MID:
        pwm=CRUISE
    if turning==1 and pwm>TCAP:
        pwm=TCAP
    # ★立ち上がり全開★ コーナーを抜け前方が開き出したら、トラクションを信じて即フルパワー
    if dC>EXIT and C>D_MID:
        pwm=TOP
    RC_drive(FORWARD,pwm)
`;

const PY_FF_CODE = `# Steady Nose (Python) — ノーマル FF 用  [卓上 Lv3 弱点を補う・Python 版]  by Opus 4.8
# C 版「Steady Nose」の Python 移植。ロジックと定数は完全に同一 (=同じ走り)。
# FF は前輪が「駆動」と「操舵」を兼ねる。曲げながら踏むと前輪が駆動に取られて曲がる力を失い
# 外へ膨らむ(パワーアンダー)。
# ★引き出すロジック(基準と“決定的に違う”点)★
#   「操舵している間はアクセルを抜く」。前輪に“曲げる仕事”を専念させ、まっすぐで踏む。
#   速度を前方距離だけでなく『今ハンドルを切っているか』で決めるのが核。これが FF の肝。

TOP=250
CRUISE=205
SLOW=120
TURN_PWM=120   # 操舵中に抜く先の低PWM
D_OPEN=600
D_MID=440
D_TURN=400
D_SIDE=190
CONF=640       # 信頼区間[mm]: >CONF/範囲外(-3)=「遠い/開放」
OPEN=9999

def setup():
    RC_setup()

def loop():
    L=RC_read(LEFT)
    C=RC_read(CENTER)
    R=RC_read(RIGHT)
    if L<0 or L>CONF:
        L=OPEN
    if C<0 or C>CONF:
        C=OPEN
    if R<0 or R>CONF:
        R=OPEN
    steering=1     # 1=今ハンドルを切っている, 0=まっすぐ
    if C<D_TURN:
        if L>R:
            RC_steer(LEFT)
        else:
            RC_steer(RIGHT)
    elif R<D_SIDE:
        RC_steer(LEFT)
    elif L<D_SIDE:
        RC_steer(RIGHT)
    else:
        RC_steer(CENTER)
        steering=0
    # ★FF の肝★ 操舵中はアクセルを抜き(前輪を操舵に専念)、まっすぐなら前方の空きで加速する。
    if steering==1:
        pwm=TURN_PWM
    elif C>D_OPEN:
        pwm=TOP
    elif C>D_MID:
        pwm=CRUISE
    else:
        pwm=SLOW
    RC_drive(FORWARD,pwm)
`;

const SPEC = [
  {
    key: 'normal_fr', name: 'Apex Hunter', label: 'ノーマル FR', level: 'Lv1 基準', code: FR_CODE,
    strategy: '最も素直なFRの基準プログラム。小細工なしのギャップフォロワー。学習の出発点。',
    learns: 'まず読むべき土台。3段速度+広い方へ操舵+側方補正という全車共通のロジック。',
  },
  {
    key: 'normal_awd', name: 'Traction Blitz', label: 'ノーマル 4WD', level: 'Lv2 強みを使う', code: AWD_CODE,
    strategy: 'トラクションを活かし、コーナー出口で前方が開いた瞬間に誰より早く全開にする。',
    learns: '強みを引き出すロジック。センサーの“差分(dC)”で立ち上がりを検知し早期加速。',
  },
  {
    key: 'normal_ff', name: 'Steady Nose', label: 'ノーマル FF', level: 'Lv3 弱点を補う', code: FF_CODE,
    strategy: '前輪が駆動+操舵を兼ねるFF。曲げる時はアクセルを抜き、まっすぐで踏む。',
    learns: '弱点(パワーアンダー)を避ける個別ロジック。速度を“操舵中か”で決めるのが核。',
  },
  {
    key: 'drift_fr', name: 'Drift Maestro', label: 'ドリフト FR', level: 'Lv4 状況で技を切替', code: DFR_CODE,
    strategy: '基本はグリップで自制し、行き止まり=切り返し/出口=レイトアペックス/速度過多の深いコーナー=ブレーキドリフト/追走車=ドリフトウォール、と状況で技を切り替える。',
    learns: 'ドリフトは“滑らせるほど速い”のではなく、滑りが合理的な局面(回頭・防御・切り返し)だけで使う、という実車セオリーの再現。全31コース完走。',
  },
  {
    key: 'drift_awd', name: 'Rally Maestro', label: 'ドリフト 4WD', level: 'Lv5 技を切替+定数攻め', code: DAWD_CODE,
    strategy: '4WDは滑らせても回頭が増えない(slipYaw小)ので回頭ドリフトは外し、切り返し/レイトアペックス/防御と重量級向け定数(早め進入・広めガード)で攻める。',
    learns: '同じ技セットでも“どの技を有効にするか”と定数は車の物理で決まる、という学び。',
  },
  {
    key: 'drift_ff', name: 'Lift Maestro', label: 'ドリフト FF', level: 'Lv6 特殊を管理+技を切替', code: DFF_CODE,
    strategy: '肝のスロットルレート制限(急リフト禁止)は維持しつつ、切り返し/レイトアペックス/防御を追加。FFのドリフトウォールはリフトオフで滑らせる。',
    learns: '特殊トリガー(リフトオフ)の管理と技の切替の両立。',
  },
  {
    key: 'py_normal_fr', name: 'Apex Hunter (Python)', label: 'ノーマル FR (Python)', level: 'Lv1 基準 (Python)',
    carType: 'normal_fr', lang: 'py', code: PY_FR_CODE,
    strategy: 'C版 Apex Hunter と同じロジックを Python で書いた入門サンプル。走りは C版と同一。',
    learns: 'C で読んだ土台(3段速度+広い方へ操舵+側方補正)を Python の書き方(def/global/RC_read)で書く練習。',
  },
  {
    key: 'py_normal_awd', name: 'Traction Blitz (Python)', label: 'ノーマル 4WD (Python)', level: 'Lv2 強みを使う (Python)',
    carType: 'normal_awd', lang: 'py', code: PY_AWD_CODE,
    strategy: 'C版 Traction Blitz と同じロジックを Python で書いた入門サンプル。走りは C版と同一。',
    learns: 'センサーの“差分(dC)”で立ち上がりを検知し早期加速。前回値を module 変数(global)で覚える Python の書き方。',
  },
  {
    key: 'py_normal_ff', name: 'Steady Nose (Python)', label: 'ノーマル FF (Python)', level: 'Lv3 弱点を補う (Python)',
    carType: 'normal_ff', lang: 'py', code: PY_FF_CODE,
    strategy: 'C版 Steady Nose と同じロジックを Python で書いた入門サンプル。走りは C版と同一。',
    learns: '弱点(パワーアンダー)を避け、速度を“操舵中か”で決める個別ロジックを Python で書く練習。',
  },
  {
    key: 'showtime', name: 'Drift Showtime', label: 'ドリフト FR', carType: 'drift_fr', kind: 'show', code: SHOW_CODE,
    level: 'EX ショー演目',
    strategy: 'レースではなくショー。ドーナツ→8の字→バックエントリーを「ドリフト広場」で踊り続ける。動力学モデルでこそ本領 (β>90°のテール進入)。',
    learns: '限界の向こう側の制御。滑りの維持には空転代 (車速<車輪速上限) が要る、深い滑りからの回収は駆動を抜く、という動力学の作法。',
  },
  {
    key: 'zerocounter', name: 'Zero-Counter Drift', label: 'ドリフト FR', carType: 'drift_fr', kind: 'show', code: ZEROCOUNTER_CODE,
    level: 'EX ショー演目',
    strategy: 'カウンター(逆ハン)を一度も当てずにドリフトを保持するショー。舵をコーナー内側に入れたまま、スロットルのデューティ(グリップ円170/フレア255)だけで定位置ドーナツを脈動させ続ける。動力学モデル専用。',
    learns: 'カウンターに頼らない姿勢の作り方=スライドの維持はスロットルの空転代で決まること。逆ハンを使わない縛りでは回転方向を反転できない(ゼロカウンターは一方向限定)、という限界も体感する。',
  },
  {
    key: 'comp_demo', name: 'Spin & Lock Demo', label: '競技 FR', carType: 'normal_fr', kind: 'comp', code: COMP_DEMO_CODE,
    level: '競技 Lv0 現象を見る', regime: 'fullscale', course: '競技グラウンド (フルスケール)',
    strategy: 'フルスケール領域+競技グラウンドで、全開発進の「ホイールスピン」と舵を当てたブレーキの「ロック→スピン」をただ見るデモ。車輪エンコーダ不要。',
    learns: '卓上では滑らない物理が、実車スケール(速度・空力・実μ)では空転/ロックとして現れること。なぜ起きるかは Launch/Brake Lab へ。',
  },
  {
    key: 'comp_launch', name: 'Launch Lab', label: '競技 FR', carType: 'normal_fr', kind: 'comp', code: COMP_LAUNCH_CODE,
    level: '競技 Lv1 トラクション制御', regime: 'fullscale', course: '競技グラウンド (フルスケール)', encoder: true,
    strategy: '★車輪エンコーダ(任意)ON★ 前輪(非駆動)=接地速度を基準に「接地速度+5m/s」を狙い続けるトラクション制御で、全開ベタ踏み(空転)より +24m 遠くまで加速する A/B デモ。',
    learns: '車輪速センサーでスリップ率を測り、駆動力を摩擦ピーク内に保つ=実車の TC。アクセル全開が最速ではないこと。車輪オドメトリ(前輪速の積分=距離)も学べる。',
  },
  {
    key: 'comp_brake', name: 'Brake Lab', label: '競技 FR', carType: 'normal_fr', kind: 'comp', code: COMP_BRAKE_CODE,
    level: '競技 Lv2 ABS', regime: 'fullscale', course: '競技グラウンド (フルスケール)', encoder: true,
    strategy: '★車輪エンコーダ(任意)ON★ 後輪(駆動)が前輪(接地)より大きく落ちたら「ロック」と判定し一瞬緩める ABS で、ベタ踏みロック(≈50m)より短い停止距離(≈32m)を出す A/B デモ。',
    learns: 'ロックしたタイヤは縦も横もグリップを失う(止まれない・曲がれない)。車輪速でロックを検知し緩める=実車の ABS。',
  },
  {
    key: 'comp_circuit', name: 'Circuit Racer', label: '競技 FF', carType: 'normal_ff', kind: 'comp', code: COMP_CIRCUIT_CODE,
    level: '競技 Lv3 サーキット周回', regime: 'fullscale', course: '競技サーキット (フルスケール)',
    strategy: '★領域=フルスケール / コース=競技サーキット★ 前方3センサーだけで実寸サーキット(1周~1.9km)を周回。直線も pwm を抑えめにし、コーナー手前で先読みブレーキ→旋回。弱アンダーのノーマルFFは安定周回するが、同じコードのFR/4WDはコーナーでスピンする。',
    learns: '実車スケールの3センサー先読みレース。フルスケールはブレーキが相対的に弱い→『見えてから止まれない』ので先読み制動が要る。速度=グリップ(ダウンフォース)。安定性は車種の物理(US/OS)で決まる=曲がる車ほど限界で危ない。',
  },
  {
    key: 'comp_drift', name: 'Sustained Drift', label: '競技 ドリフトFR', carType: 'drift_fr', kind: 'comp', code: DRIFT_CIRCUIT_CODE,
    level: '競技 Lv4 持続ドリフト', regime: 'fullscale', course: '競技サーキット (フルスケール)',
    strategy: '★領域=フルスケール / コース=競技サーキット / 車=ドリフトFR★ ドリフト車専用に縦μを下げ持続スライドを成立させたフルスケール領域で、コーナーは全舵を当てたままスロットルの脈動(フレア/グリップ円)で後輪を流し続け、直線はグリップで前進する。姿勢(ヨー/β)は読まず ToF×3 の壁距離だけで保持する(カウンターは当てない)。',
    learns: '持続ドリフトは「滑らせ続ける」のではなく空転代(車速<車輪速上限)の維持で決まること。姿勢推定なしでも壁距離だけでスライドを保持できるが、全周をドリフトのまま回るのは難しい(=J3 の課題)。逆ハンには姿勢推定が要り、それは ToF だけでは成立しない(J1)。',
  },
  {
    key: 'comp_slip', name: 'Slip Attack', label: '競技 ドリフトFR', carType: 'drift_fr', kind: 'comp', code: SLIP_ATTACK_CODE,
    level: '競技 Lv5 最速⇄流し', regime: 'fullscale', course: '競技サーキット (フルスケール)',
    strategy: '★領域=フルスケール / コース=競技サーキット / 車=ドリフトFR★ 実車の走法どおり【直線=最速グリップ / コーナー=リアを振って回頭】をリズムで切り替えて攻める。姿勢(ヨー/β)は読まず ToF×3 の壁距離だけで状況(直線/進入/立て直し)を判断。コーナーはリアが流れ切ってスピン側まで深く回頭し、前が開けたら立て直して次へ進む。',
    learns: '保持ドリフト(角度を一定に保つ)や逆ハン(カウンター)は姿勢推定が要り、前方ToFだけでは作れない(リアが流れるとスピンまで回り切る/J1 NO-GO)。だから狙うのは"保持"でなく【最速⇄リア流し】の切替リズム=実車で「最速で走りつつ条件が合えばドリフト」と同じ。全周をドリフトのまま回ること・スピンを逆ハンで止めることは ToF だけでは成立しない——走れば分かる(J3 の正直な結論)。',
  },
  {
    key: 'comp_estimate', name: 'Range-Flow Estimator', label: '競技 FF', carType: 'normal_ff', kind: 'comp', code: ESTIMATOR_CODE,
    level: '競技 Lv6 姿勢推定(研究)', regime: 'fullscale', course: '競技サーキット (フルスケール)', rear: true, encoder: true,
    strategy: '★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF★ ヨー/βを直接読むセンサーは足さず(J-1)、前方ToF×3(+任意の後方/エンコーダ)の時間変化=レンジレートから車体速度(vx,vy)と回頭ωを最小二乗で逆算し β=atan2(vy,vx) を推定して出力する研究サンプル。走りは Circuit Racer と同じ素直なFF周回(壁が視野に入る=推定の素材)。',
    learns: '測距オドメトリ(レンジフロー)の原理と、それが本シムでは成立しない理由(J1=NO-GO)。推定βを画面の真βと並べると、本番基準(MAE≤15°かつ符号≥80%)に届かないことを自分で確かめられる。エンコーダONでも推定βは小さいだけで横滑りの符号が当たらず「β=0と決め打ち」と同程度、OFFだと前後速度の符号すら外れる。根本=壁法線の観測不能(法線↔自己運動の循環)・遠壁の悪条件・安定周回の真βが微小。素朴な壁法線仮定をどう直すかが研究テーマ。',
  },
  {
    key: 'recon_racer', name: 'Recon Racer', label: '競技 FF', carType: 'normal_ff', kind: 'comp', code: RECON_RACER_CODE, lang: 'py',
    level: '競技 Lv7 コース試走学習', regime: 'fullscale', course: '競技サーキット (フルスケール)', encoder: true,
    strategy: '★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★ 実車のレースのように本番前にコースを試走(recon)して覚え、本番は他車を見て最善手を選ぶ学習モデル。1周目はエンコーダ距離をインデックスに各地点のコーナーのきつさと左右の余地、前方の最近壁距離を地図に記録し、2周目以降はその地図で先読み減速する。さらに「覚えた壁の距離」と「今のセンサー値」の差から前/横の他車を見つけ、前が詰まれば余地の広い側(=多くはアウト)から抜き、抜けないなら追従して自滅しない。',
    learns: '「見てから反応」と「覚えて先読み＋他車を見て最善手」の差。ToF×3+任意エンコーダだけで(絶対位置は与えられない)デッドレコニングの距離インデックス地図を作り、反応のみより速く確実に走る考え方。他車検知に新センサーは要らない=ToF は壁と他車を区別せず最近距離を返すので「覚えた壁距離より今が近い＝そこに他車」で見分けられる(地図差分)。抜きどころは地図のコース余地＋現センサーで計算する(アウト・イン・アウトと整合)。正直な限界=デッドレコニング誤差・固定長バケツ・発走の団子では試走自体が難しいこと(Python 限定だった制約は Recon Racer (C) の追加で解消)。エンコーダOFFだと距離が測れず反応のみに退化する。',
  },
  {
    key: 'comp_localize', name: 'Self-Locator', label: '競技 FF', carType: 'normal_ff', kind: 'comp', code: COMP_LOCALIZE_CODE, lang: 'py',
    level: '競技 Lv8 自己位置推定', regime: 'fullscale', course: '競技サーキット (フルスケール)', encoder: true,
    strategy: '★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★ ToF×3+エンコーダだけで「今コースのどこにいるか(周回弧長)」を1次元ヒストグラムフィルタで推定する研究サンプル。1周目に各地点の前方/左右の壁距離を距離目盛りの指紋として覚え、方位が一周ぶん回りスタートの壁パターンに戻ったら1周と判定(loop closure=1周の長さが確定)。2周目以降はエンコーダで進めた確率分布を前方3センサーの指紋照合で補正し、分布のピークで自己位置と信頼度を出す。前方/側方が覚えた壁より有意に近ければ他車と見なし位置更新から外す(残差ゲーティング=壁は位置に・地図差分は他車に)。',
    learns: 'ToF×3+エンコーダだけの自己位置推定(絶対位置は与えられない=D-1)。実測=周回内の相対位置(=次コーナーまでの距離＝先読みに効く量)は約0.5bin(9m/1周2057m)と高精度、他車5台混走でも約0.8bin・前方検知recall96%・発散なし。正直な限界(J1と同型に隠さない): この清潔なコースではToF照合はエンコーダ単独に勝てず観測はむしろ追従ノイズを足す→位置推定の骨格はエンコーダのデッドレコニングで、ヒストグラムは軽い補正＋信頼度＋他車分離の役。周回原点(絶対位置)はloop closureのToFノイズで周ごとに約2.6bin(46m)ブレる=これがToF閉じ込みの原点精度限界(対称コースでは絶対≤1binには届かない)。方位/横滑り角βは地図事前分布つきでも推定できない(J-1と同じ=符号が当たらない)。地図を前提に最速化するのはApex Strategist(AO11)へ。',
  },
  {
    key: 'recon_racer_c', name: 'Recon Racer (C)', label: '競技 FF', carType: 'normal_ff', kind: 'comp', code: RECON_RACER_C_CODE, lang: 'c',
    level: '競技 Lv7 コース試走学習 (C)', regime: 'fullscale', course: '競技サーキット (フルスケール)', encoder: true,
    strategy: '★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★ Recon Racer の Arduino C++ 版。ロジックと定数は Python 版と同一で、地図(コーナーのきつさ sev・左右の余地 mapL/mapR)を配列 int sev[N]; で持つ。同じコース・同じ車種で走らせた結果(順位・タイム・verifyHash)が Python 版と一致することを常設ゲートで機械確認している＝「同じ考え方は C でも書ける」ことの実物。',
    learns: '配列を使う学習モデルを Arduino C++ で書く方法。①配列の宣言と長さの持ち方(const int N=72; int sev[N];)②要素数の定石 sizeof(sev)/sizeof(sev[0])(本シムは要素数を返す。実機のバイト数とは異なる＝仕様欄に明記)③Python の切り捨て除算 a//b は C に無いので floor(a/b) と書く(実機 Arduino C は int どうしなら / が切り捨てで同じ結果)④配列を関数へ渡すと参照が渡る(C のポインタ減衰・int f(int a[], int n))。Python 版と読み比べると、同じアルゴリズムが言語でどう変わる/変わらないかが分かる。',
  },
  {
    key: 'comp_localize_c', name: 'Self-Locator (C)', label: '競技 FF', carType: 'normal_ff', kind: 'comp', code: COMP_LOCALIZE_C_CODE, lang: 'c',
    level: '競技 Lv8 自己位置推定 (C)', regime: 'fullscale', course: '競技サーキット (フルスケール)', encoder: true,
    strategy: '★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★ Self-Locator の Arduino C++ 版。ロジックと定数は Python 版と同一で、指紋 fpC/fpL/fpR と確率分布 w[]/wt[] を配列で持つ1次元ヒストグラムフィルタ。同じ条件での走行結果が Python 版と一致することを常設ゲートで機械確認している。',
    learns: '確率分布(信念)を配列で回すフィルタを Arduino C++ で書く方法。予測(移流+拡散)には更新前の値が要るので作業配列 wt[] へ退避してから w[] を書き換える(=その場更新で壊さない)、正規化は総和ガードつき、円環インデックスは (i+j)%LAPBF と負の巻き戻し、という配列プログラミングの定石が一通り出てくる。実測の限界は Python 版と同一(この清潔なコースでは ToF 照合はエンコーダ単独に勝てず、骨格はデッドレコニング)。',
  },
  {
    key: 'strategist', name: 'Apex Strategist', label: '競技 FF', carType: 'normal_ff', kind: 'comp', code: STRATEGIST_CODE, lang: 'py',
    level: '競技 Lv9 戦略レーサー', regime: 'fullscale', course: '競技サーキット (フルスケール)', encoder: true,
    strategy: '★領域=フルスケール / コース=競技サーキット / 車=ノーマルFF / 車輪エンコーダ(任意)ON★ 本番前に試走(recon)でコースを地図化し、その地図で自信を持って攻める戦略レーサー。走りの土台は「recon で踏めると分かったコースを反応型で攻めチューン」(直線=踏み切り・操舵中だけ出力を抑えて前輪空転→巻き込みを防ぐ v2 の FF レッスン)で、標準の Circuit Racer 比 約11〜22% 速い(crash0)。加えて曲率代理から速度プロファイル(vmax=前進/後退パス)を計画し、きつい区間の手前でスロットルを絞る加速ガバナに使う。戦略ドリフト状態機械・他車の残差ゲーティング検知・TTC 制動ガードも持つ。',
    learns: '「見てから反応」を超えて「試走で覚えた地図で自信を持って攻める」考え方。速度プロファイル計画(曲率代理→vmax→前進/後退パスで実現可能な計画へ)・自己位置(エンコーダ距離+loop closure)・戦略ドリフト状態機械・他車予測+TTC ガードの組み立て。正直な実測の限界(AO8/AO10 と同型に隠さない): このコースは4コーナー全部 R≈116m と均一で"どのコーナーを速く"の差が無く、ToF 自己位置も幅28m・2回対称の超楕円では loop closure が粗い(数バケツ=AO10 の絶対位置限界と同根)ため、地図で更に踏み込む精密な後追い制動は安全に成立しない。ゆえに速さの大半は"recon が保証する攻めチューン"で生まれ、精密な速度プロファイルの純利得はこの清潔コースでは概ね中立(加速ガバナは安全側の保険)。戦略ドリフトは AO8 の go/no-go どおり最小 R≈116m ≫ 6.4m ゆえ発動区間が無く常に grip(=速いのは正確な grip、drift は限界を超えた時だけ)。エンコーダ未装備だと地図を作れず反応型(攻めチューン)へフォールバックする。',
  },
];

// 公開: 各プログラム {key, carType, name, label, lang, code, desc, strategy, level, learns, kind}
// kind==='show' はレース用ベンチマーク (test_programs) と車種既定の対象外。
export const PROGRAMS = SPEC.map(p => ({
  key: p.key, carType: p.carType || p.key, name: p.name, label: p.label, lang: p.lang || 'c',
  desc: `${p.name} (${p.label})`,
  strategy: p.strategy, level: p.level, learns: p.learns, kind: p.kind || null,
  // 領域(regime)/推奨コース/任意装備(後方センサー・車輪エンコーダ)要否 (競技サンプル用。未指定は卓上の通常走行)
  regime: p.regime || null, course: p.course || null, encoder: p.encoder || false, rear: p.rear || false,
  // 旧 README 互換 (aim は strategy で代用)
  aim: p.strategy,
  code: p.code,
}));

// 車種→既定プログラム (ショー演目は既定にしない)
export const PROGRAM_BY_CARTYPE = Object.fromEntries(PROGRAMS.filter(p => !p.kind).map(p => [p.carType, p]));
export const PROGRAM_BY_KEY = Object.fromEntries(PROGRAMS.map(p => [p.key, p]));

// src 文字列がどの既定プログラムか判定 (一致すれば key、なければ null)。
// 車種変更時に「利用者の手編集を壊さない」ためのガードに使う。
export function programKeyForCode(src) {
  const t = (src || '').trim();
  for (const p of PROGRAMS) if (p.code.trim() === t) return p.key;
  return null;
}
