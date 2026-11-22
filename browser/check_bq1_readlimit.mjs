// RumiCar Simulator — 実ブラウザ 常設ゲート: RC_setReadLimit と RC_read を本番の画面で確かめる (Stage BQ・v12.0.0)
//
// v12.0.0 から、RC_read の値を信じる距離の上限はライブラリではなくプログラムが setup() の RC_setReadLimit で決める
// (正本 RumiCar-lib v0.7.0・RasPi RumiCar.py 0.7.0・Zero2Cam v0.7.0 と同じ)。値の照合 (正本の表) は wf_bo1_steer.mjs の G 章が見る。
// ここでは本番の画面 (各車の「⬆」でファイルを読み込み、「自動 ▶」で走らせ、シリアル出力とログを読む) で次を確かめる。
//
//  Y1 上限 (C++・Python・JavaScript): スタート位置で止まったまま、RC_setReadLimit(200) の後の RC_read(CENTER) と生の値を出力する。
//     前の壁は 200 mm より遠いので RC_read は -3、生の値 (C++・JavaScript) は距離のまま。
//  Y2 走行ごとに上限なしへ戻る: Y1 の直後に、RC_setReadLimit を呼ばない同じプログラムを走らせると、RC_read(CENTER) は距離を返す
//     (前の走行で決めた上限が残っていない)。その値は Y1 の生の値と同じ。
//  Y3 引数の数: RC_setReadLimit() (C++・Python) は行番号付きの実行時エラー。JavaScript は警告して続ける。
//  Y4 実機の見本を本文のまま: RumiCar-lib v0.7.0 の Exercise-4.2-Answer.ino、RumiCar master 061e42a の RasPi/Exercise-3.1・3.2 は
//     実行時エラーなしで走る。Zero2Cam v0.7.0 の見本 drive.py は setup() が通り、params.json が無いので loop() の p["stop_mm"] で止まる。
//  Y5 出荷の見本 (各言語の既定) は RC_setReadLimit を呼び、警告・実行時エラーなしで走る。
//  Y6 説明の表示 (日本語・英語): 使い方に RC_setReadLimit の項が出る (カタログの文と同じ)。使い方・仕様と制限・物理モデル・システム説明の
//     RC_read／RC_setReadLimit に触れる項に、一律の打ち切りの数値 (20 cm・200 mm・0〜200) が出ない。
//  Y7 操作中の console error / pageerror 0 (想定内の応答は件数を明示して除外)。
//
// 使い方: bash run.sh check_bq1_readlimit.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, appModule, setLang, report, APP_URL } from './lib.mjs';

// 正本の本文 (書き換えない)。
const EX = {
  'Exercise-4.2-Answer.ino': "#include <RumiCar.h>\n\n// Exercise-4.2-Answer はまったら切り返す車（解答例）\n//   Exercise-3.2 の走り方に、「はまったことに気づく」3 つの方法と、\n//   「ハンドルを切り返して脱出する」手順を足したものです。\n//   使えるのは前・左・右の距離センサーと、自分がモーターに何を命じたかだけです。\n//\n//   はまりの検知（どれか 1 つでも成立したら脱出に入る）\n//     (1) 前後の切り替えが短い時間に何回も起きた\n//     (2) 前進や後進を命じているのに、前の距離がほとんど変わらない\n//     (3) 前・左・右がすべて近い（角に鼻先が入っている）\n//   脱出（切り返し）\n//     近い壁の側にハンドルを切って少し後退 → 遠い側に切って少し前進 → 前が開いたか確かめる。\n//     後退するときは「近い壁の側」にハンドルを切るのがコツです（鼻先が壁から離れる向きに振れる）。\n//     決めた回数で抜けられなければ止まって待ち、前が開いたら走行を再開します。\n//   数値はすべて目安です。自分の車体とコースに合わせて変えてみましょう。\n\n// ---- 3.2 と同じ走り方のパラメータ ----\nconst int PWM_SLOW   = 150;\nconst int PWM_MID    = 200;\nconst int PWM_FAST   = 255;\n\n// ---- はまりの検知 ----\nconst unsigned long FLIP_WINDOW_MS = 3000;  // (1) この時間の中で\nconst int           FLIP_LIMIT     = 4;     // (1) 前後が何回入れ替わったら「はまり」か\nconst unsigned long STALL_CHECK_MS = 1000;  // (2) 前の距離を比べる間隔 [ms]\nconst int           STALL_DELTA_MM = 20;    // (2) これより変化が小さければ「進んでいない」（測距誤差 1〜2cm を考慮）\nconst int           STALL_NEAR_MM  = 200;   // (2) 前がこれより近いときだけ判定する（遠い壁は見ない。上限（RC_setReadLimit）以下にする）\nconst int           STALL_LIMIT    = 2;     // (2) 何回続いたら「はまり」か（最初の 1 回は比べる相手が無いので検知まで約 3 秒）\nconst int           CORNER_MM      = 120;   // (3) 前・左・右がすべてこれ未満なら角に入っている\n\n// ---- 脱出（切り返し） ----\nconst int           ESCAPE_PWM     = 200;   // 切り返しの速さ\nconst unsigned long BACK_MS        = 600;   // 後退する時間 [ms]\nconst unsigned long FWD_MS         = 400;   // 前進する時間 [ms]\nconst int           ESCAPE_TRIES   = 3;     // 切り返しの最大回数\nconst int           CLEAR_MM       = 200;   // 前がこれ以上開いたら脱出成功（上限（RC_setReadLimit）以下にする）\nconst int           REAR_STOP_MM   = 80;    // 後方センサーがある車体：後ろがこれより近ければ後退をやめる\nconst unsigned long COOLDOWN_MS    = 2000;  // 脱出のあと、再びはまりを判定しない時間 [ms]\n\n// ---- 状態を覚えておく変数 ----\nint           lastDirec   = FREE;   // 直前に命じた走行方向（FORWARD / REVERSE）\nunsigned long flipStart   = 0;      // (1) 数え始めた時刻\nint           flipCount   = 0;      // (1) 前後の切り替え回数\nunsigned long stallTime   = 0;      // (2) 前回比べた時刻\nint           stallPrev   = -1;     // (2) 前回の前の距離（-1 = まだ無い）\nint           stallCount  = 0;      // (2) 「進んでいない」が続いた回数\nunsigned long cooldownEnd = 0;      // 脱出のあと、この時刻までは判定しない\n\nvoid setup()\n{\n  RC_setup();\n  RC_setReadLimit(200);   // 信じる距離の上限 [mm]。これより先は -3（遠い）。上のしきい値はこの値以下にする\n}\n\n// 距離が測れなかったとき（-1 や -3）は「遠い」として扱う（3.2 の 8190 と同じ考え方）\n// RC_read は上限（setup() の RC_setReadLimit）より先を -3（範囲外）にするので、-3 は「上限より手前に何もない」\nint farIfInvalid(int d)\n{\n  return (d < 0) ? 9999 : d;\n}\n\n// 前が開いているか（遠い、または測れないほど遠い）\nbool isClear(int s1)\n{\n  return (s1 == -3) || (s1 >= CLEAR_MM);\n}\n\n// RC_drive の代わりに使う。前後の切り替え回数を数える（検知 (1) のため）\nvoid driveAndCount(int direc, int pwm)\n{\n  if ((direc == FORWARD && lastDirec == REVERSE) ||\n      (direc == REVERSE && lastDirec == FORWARD)) {\n    unsigned long now = millis();\n    if (flipCount == 0 || now - flipStart > FLIP_WINDOW_MS) {   // 数え直し\n      flipStart = now;\n      flipCount = 0;\n    }\n    flipCount++;\n  }\n  if (direc == FORWARD || direc == REVERSE) {\n    lastDirec = direc;\n  }\n  RC_drive(direc, pwm);\n}\n\n// (1) 前後の切り替えが短い時間に何回も起きたか\nbool stuckByFlip()\n{\n  return (flipCount >= FLIP_LIMIT) && (millis() - flipStart <= FLIP_WINDOW_MS);\n}\n\n// (2) 前進や後進を命じているのに、前の距離がほとんど変わらないか\nbool stuckByNoProgress(int s1)\n{\n  unsigned long now = millis();\n  if (now - stallTime < STALL_CHECK_MS) {\n    return false;                                    // まだ比べる時刻ではない\n  }\n  stallTime = now;\n  bool moving = (lastDirec == FORWARD || lastDirec == REVERSE);\n  bool near   = (s1 >= 0 && s1 < STALL_NEAR_MM);     // 測れていて、しかも近い\n  if (moving && near && stallPrev >= 0 && abs(s1 - stallPrev) < STALL_DELTA_MM) {\n    stallCount++;\n  } else {\n    stallCount = 0;\n  }\n  stallPrev = near ? s1 : -1;\n  return stallCount >= STALL_LIMIT;\n}\n\n// (3) 前・左・右がすべて近いか（角に鼻先が入っている）\nbool stuckByThreeSides(int s0, int s1, int s2)\n{\n  return (lastDirec == FORWARD) &&\n         (s0 >= 0 && s0 < CORNER_MM) &&\n         (s1 >= 0 && s1 < CORNER_MM) &&\n         (s2 >= 0 && s2 < CORNER_MM);\n}\n\nvoid resetDetectors()\n{\n  flipCount  = 0;\n  stallCount = 0;\n  stallPrev  = -1;\n  stallTime  = millis();\n  cooldownEnd = millis() + COOLDOWN_MS;\n}\n\n// 切り返して脱出する\nvoid escape(int s0, int s2)\n{\n  // 近い壁の側を決める（測れない側は「遠い」とみなす）\n  int nearSide = (farIfInvalid(s0) < farIfInvalid(s2)) ? LEFT : RIGHT;\n  int farSide  = (nearSide == LEFT) ? RIGHT : LEFT;\n\n  for (int i = 0; i < ESCAPE_TRIES; i++) {\n    // 後退：近い壁の側にハンドルを切る（鼻先が壁から離れる）\n    RC_steer(nearSide);\n    RC_drive(REVERSE, ESCAPE_PWM);\n    unsigned long t0 = millis();\n    while (millis() - t0 < BACK_MS) {\n      int rear = RC_read(REAR);                       // 後方センサーが無い車体は -1 が返る\n      if (rear >= 0 && rear < REAR_STOP_MM) {\n        break;                                        // 後ろが近い：後退をやめる\n      }\n    }\n    RC_drive(BRAKE, 0);\n    delay(100);\n\n    // 前進：遠い側にハンドルを切る\n    RC_steer(farSide);\n    RC_drive(FORWARD, ESCAPE_PWM);\n    delay(FWD_MS);\n    RC_drive(BRAKE, 0);\n    delay(100);\n\n    // 前が開いたか確かめる\n    if (isClear(RC_read(CENTER))) {\n      Serial.println(\"ESCAPED\");\n      lastDirec = FORWARD;\n      resetDetectors();\n      return;\n    }\n  }\n\n  // 抜けられなかった：止まって待ち、前が開いたら再開する（手で助けてもらう）\n  RC_drive(FREE, 0);\n  Serial.println(\"GIVE UP: waiting\");\n  while (!isClear(RC_read(CENTER))) {\n    delay(100);\n  }\n  lastDirec = FORWARD;\n  resetDetectors();\n}\n\n// Exercise-3.2 と同じ走り方\nvoid driveLikeExercise32(int s0, int s1, int s2)\n{\n  int d0 = farIfInvalid(s0);\n  int d1 = farIfInvalid(s1);\n  int d2 = farIfInvalid(s2);\n\n  if (d1 < 100) {\n    driveAndCount(REVERSE, PWM_SLOW);\n  } else if (d1 < 150) {\n    driveAndCount(FORWARD, PWM_SLOW);\n  } else if (d1 < 200) {\n    driveAndCount(FORWARD, PWM_MID);\n  } else {\n    driveAndCount(FORWARD, PWM_FAST);\n  }\n  if (d0 > d2) {\n    RC_steer(LEFT);\n  } else {\n    RC_steer(RIGHT);\n  }\n}\n\nvoid loop()\n{\n  int s0 = RC_read(LEFT);\n  int s1 = RC_read(CENTER);\n  int s2 = RC_read(RIGHT);\n\n  Serial.print(\"L:\");  Serial.print(s0);\n  Serial.print(\" C:\"); Serial.print(s1);\n  Serial.print(\" R:\"); Serial.print(s2);\n  Serial.print(\" flips:\"); Serial.print(flipCount);\n  Serial.print(\" stall:\"); Serial.println(stallCount);\n\n  bool canJudge = (millis() >= cooldownEnd);   // 脱出の直後は判定しない\n  if (canJudge && (stuckByFlip()\n                   || stuckByNoProgress(s1)\n                   || stuckByThreeSides(s0, s1, s2))) {\n    Serial.println(\"STUCK\");\n    escape(s0, s2);                           // 切り返し（最大 ESCAPE_TRIES 回）\n    return;\n  }\n\n  driveLikeExercise32(s0, s1, s2);            // 3.2 と同じ走り方\n}\n",
  'Exercise-3.1.py': "from RumiCar import *\n\n# 安全に止まる: 前方のセンサーの距離で走行を決める\n# 実行: python3 ../RumiCar.py Exercise-3.1.py\n\n\ndef setup():\n    RC_setup()\n\n\ndef loop():\n    d1 = RC_read(CENTER)\n    print(d1)\n    if d1 == -3:            # -3: 範囲外 = 遠い (-3 は数としては最小なので、比較の前にどの距離 (最大 2000) よりも大きい値に置き換える)\n        d1 = 9999\n    if d1 < 300:            # 30 cm より近くに何かある\n        if d1 > 120:\n            RC_drive(FORWARD, 255)\n        elif d1 < 80:\n            RC_drive(REVERSE, 255)\n        else:\n            RC_drive(BRAKE, 255)\n    else:\n        RC_drive(FREE, 0)\n",
  'Exercise-3.2.py': "from RumiCar import *\n\n# 道なりに走る: 3 つのセンサーで速さと向きを決める\n# 実行: python3 ../RumiCar.py Exercise-3.2.py\n\n\ndef setup():\n    RC_setup()\n\n\ndef loop():\n    s0 = RC_read(LEFT)\n    s1 = RC_read(CENTER)\n    s2 = RC_read(RIGHT)\n    print(\"Sensor0:\", s0, \" Sensor1:\", s1, \" Sensor2:\", s2)\n\n    if s0 == -3:            # -3: 範囲外 = 遠い (-3 は数としては最小なので、比較の前にどの距離 (最大 2000) よりも大きい値に置き換える)\n        s0 = 9999\n    if s1 == -3:\n        s1 = 9999\n    if s2 == -3:\n        s2 = 9999\n\n    if s1 < 100:\n        RC_drive(REVERSE, 150)\n    elif s1 < 150:\n        RC_drive(FORWARD, 150)\n    elif s1 < 250:\n        RC_drive(FORWARD, 200)\n    else:\n        RC_drive(FORWARD, 255)\n\n    if s0 > s2:\n        RC_steer(LEFT)\n    else:\n        RC_steer(RIGHT)\n",
  'drive.py': "# RumiCar の走行プログラム（見本）\n#\n# このファイルを書き換えることで、独自の走行方法で RumiCar を走行させることができます。\n# 走行管理アプリの「自分のプログラムを送る…」でこのファイルを含むフォルダを選択すると、\n# 車に送信され、そのまま有効化されます（README 11 章「自作の走行プログラム（Python）」）。\n#\n# 使うのは RumiCar ライブラリです。Raspberry Pi 版のライブラリ（RumiCar リポジトリの\n# RasPi/RumiCar.py 0.7.0）そのものを車の本体が使っており、Arduino のライブラリ\n# （RumiCar-lib v0.7.0）とも同じ名前・同じ値です。\n#\n#   setup()   プログラムの開始時に 1 回だけ呼び出されます（省略可）\n#   loop()    50 ミリ秒ごと（20 Hz）に呼び出されます。ここで操舵と駆動を決定します\n#\n#   RC_setReadLimit(上限)            RC_read の値を信頼する距離の上限（mm）を決めます。setup() で 1 回呼びます。\n#                                    上限は 1〜2000、0 は上限なし（既定。2000 mm まで返る）。\n#                                    RC_setReadLimit(方向, 上限) と書くと、その方向（LEFT / CENTER / RIGHT）だけに設定します\n#   RC_read(LEFT / CENTER / RIGHT)   左・前・右の距離センサーの値（mm）\n#                                    0〜上限 = 距離、-1 = 読み取りに失敗、\n#                                    -3 = 範囲外（RC_setReadLimit で決めた上限より先、または対象物なし）。走行では「遠い」として扱います\n#                                    -3 は数としては最も小さいので、比較の前に、RC_read が返すどの距離よりも大きい値に置き換えます\n#   RC_steer(LEFT / CENTER / RIGHT, 強さ)\n#                                    操舵（左・中央・右）。強さは 0〜255 の信号の割合で、省略すると 255（最大）。\n#                                    0 は CENTER と同じ（中立）、CENTER では強さは無視される。\n#                                    補正はしないため、同じ値でも車ごとに舵の効き方は異なる\n#   RC_drive(方向, 値)                駆動。方向は FREE（惰行）/ REVERSE（後退）/ FORWARD（前進）/ BRAKE（ブレーキ）、\n#                                    値は 0〜255 の PWM のデューティ（150 なら全開の 150/255 ≒ 59 % の信号）\n#   RC_params()                      params.json に記述した値（例 RC_params()[\"speed\"]）\n#   RC_state(\"名前\")                 現在の処理状態の名前（走行管理アプリの「判断状態」に表示されます）\n#   print(...)                       車のログに記録されます（ssh で sudo journalctl -u rumicar-core -f）\n#\n# 距離の上限について：センサーのレーザーはコーン状に広がるため、取り付け位置や車高によっては、\n# ある距離から先で床を捉えます。どこまでの値を信頼するかは、ライブラリではなくプログラムが\n# RC_setReadLimit で決めます。この見本は params.json の read_limit_mm を上限にしています\n# （値の決め方は README 5 章「ToF の値を信頼する距離の上限」）。距離のしきい値（stop_mm・turn_mm・\n# side_mm）は上限以下にします。上限より先は -3 になり、しきい値と比べても「遠い」としか分からないためです。\n#\n# RC_steer() と RC_drive() で設定した値は、次に変更するまで保持されます（Arduino と同じ）。\n# この見本の操舵は強さを省略した最大（255）です。強さを変えて走りを滑らかにする例は、\n# RumiCar リポジトリの RasPi/Exercise-3.3（なめらかに走る車）にあります。\n# 安全のため、本体が次の制御を必ず行います。\n#   ・自動モードへの切り替え時は、駆動の許容値を 0 から徐々に増加させる（急発進しない）\n#   ・走行管理アプリの「自動の最大出力」を超えて走行しない\n#   ・loop() の処理時間の上限は 30 ミリ秒。この時間内に処理が完了しなかったフレームはブレーキし、\n#     1 秒以上応答が無ければプログラムを停止する\n#   ・例外が発生したフレームはブレーキする（例外の内容はログに記録される）\n\nfrom RumiCar import *\n\n# -3（範囲外）を比較で「遠い」として扱うための値。RC_read が返すどの距離（最大 2000 mm）よりも\n# 大きいので、read_limit_mm をいくつにしても上限より大きい\nFAR = 9999\n\n\ndef setup():\n    RC_setup()\n    # RC_read の値を信頼する距離の上限（mm）。これより先は -3（遠い）になる。値は params.json の read_limit_mm\n    RC_setReadLimit(RC_params().get(\"read_limit_mm\", 200))\n    RC_state(\"START\")\n    print(\"見本のプログラムを始めます。設定:\", RC_params())\n\n\ndef loop():\n    p = RC_params()                      # params.json の値（車ごとに変更可能）\n    left = RC_read(LEFT)\n    center = RC_read(CENTER)\n    right = RC_read(RIGHT)\n\n    # センサーの読み取りに失敗した場合は停止する\n    if left == -1 or center == -1 or right == -1:\n        RC_drive(BRAKE, 0)\n        RC_state(\"NO_SENSOR\")\n        return\n\n    # 範囲外（-3：上限より先、または対象物なし）は「遠い」\n    if left == -3:\n        left = FAR\n    if center == -3:\n        center = FAR\n    if right == -3:\n        right = FAR\n\n    if center < p[\"stop_mm\"]:\n        # 前方が非常に近い：距離の大きい側と反対へ操舵して後退する（車体の前部が距離の大きい側を向く）\n        if left > right:\n            RC_steer(RIGHT)\n        else:\n            RC_steer(LEFT)\n        RC_drive(REVERSE, p[\"back_speed\"])\n        RC_state(\"BACK\")\n    elif center < p[\"turn_mm\"]:\n        # 前方が近い：距離の大きい側へ操舵し、低速で前進する\n        if left > right:\n            RC_steer(LEFT)\n        else:\n            RC_steer(RIGHT)\n        RC_drive(FORWARD, p[\"slow_speed\"])\n        RC_state(\"TURN\")\n    else:\n        # 前方に余裕がある：左右の壁が近ければ反対側へ操舵し、そうでなければ直進する\n        if left < p[\"side_mm\"]:\n            RC_steer(RIGHT)\n        elif right < p[\"side_mm\"]:\n            RC_steer(LEFT)\n        else:\n            RC_steer(CENTER)\n        RC_drive(FORWARD, p[\"speed\"])\n        RC_state(\"RUN\")\n",
};
// 上限を確かめるプログラム (車は動かさない)。LIMIT の行が空なら上限を決めない。
const PROBE = {
  c: (limit) => `void setup() {\n  RC_setup();\n  ${limit}\n}\nvoid loop() {\n  RC_drive(FREE, 0);\n  Serial.print("read=");\n  Serial.print(RC_read(CENTER));\n  Serial.print(" raw=");\n  Serial.println(sensor1.readRangeSingleMillimeters());\n}\n`,
  py: (limit) => `from RumiCar import *\n\ndef setup():\n    RC_setup()\n    ${limit || 'pass'}\n\ndef loop():\n    RC_drive(FREE, 0)\n    print("read=" + str(RC_read(CENTER)))\n`,
  js: (limit) => `function setup() {\n  RC_setup();\n  ${limit}\n}\nfunction loop() {\n  RC_drive(FREE, 0);\n  Serial.println("read=" + RC_read(CENTER) + " raw=" + sensor1.readRangeSingleMillimeters());\n}\n`,
};
const EXT = { c: 'ino', py: 'py', js: 'js' };

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const browser = await launch();
console.log(`\n== 実ブラウザ: RC_setReadLimit と RC_read (BQ) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, {
  width: 1440, height: 900,
  before: async (p) => { await p.addInitScript(() => { try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {} }); },
});
const ver = await appModule(page, 'js/config.js', (m) => m.APP_VERSION);
console.log(`APP_VERSION ${ver}`);

// コース: 卓上の「オーバル」(courses.json の先頭)。
const courseVal = await page.evaluate(() => {
  const o = [...document.querySelectorAll('#courseSel option')].find((x) => x.textContent.trim().replace(/^[^\p{L}]+/u, '').startsWith('オーバル'));
  return o ? o.value : null;
});
if (courseVal != null) { await page.selectOption('#courseSel', courseVal); await page.waitForTimeout(800); }
ok('Y0 コース「オーバル」を選べる', courseVal != null, `value=${courseVal}`);

const col = () => page.locator('#fleetCols .carcol').first();
// ファイルを「⬆」で読み込み、▶ で走らせ、シリアルが lines 行たまる (か ms ミリ秒たつ) まで待って ■。シリアル出力とログの増分を返す。
async function runFile(name, body, { lines = 6, ms = 15000 } = {}) {
  await col().locator('.cc-file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(body, 'utf8') });
  await page.waitForTimeout(500);
  const lang = await col().locator('.cc-lang').inputValue();
  const logBefore = (await page.locator('#log').innerText()).length;
  await page.click('#run');
  try {
    await page.waitForFunction((n) => { const s = document.querySelector('#fleetCols .carcol .cc-serial'); return s && s.innerText.split('\n').filter((x) => x.trim()).length >= n; }, lines, { timeout: ms, polling: 100 });
  } catch (e) { /* 出力が足りないまま時間切れ＝呼び出し側が行数で判定する */ }
  if (await page.isEnabled('#stop')) await page.click('#stop');   // 実行時エラーで止まった走行は ■ が無効になっている
  await page.waitForTimeout(300);
  const serial = (await col().locator('.cc-serial').innerText()).split('\n').map((x) => x.trim()).filter(Boolean);
  const log = (await page.locator('#log').innerText()).slice(logBefore);
  // 警告 (⚠) と実行時エラーは各車のシリアル出力に出る (fleet.js)。判定はログ欄の増分とシリアル出力の両方 (all) で行う。
  return { serial, log, lang, all: log + '\n' + serial.join('\n') };
}
// C++ の Serial.print を続けて書くと、シリアル出力は値の間に空白を入れて 1 行にする (「read= -3  raw= 408」)。
const nums = (serial, key) => serial.map((l) => { const m = new RegExp(key + '=\\s*(-?\\d+)').exec(l); return m ? Number(m[1]) : null; }).filter((v) => v !== null);

// ── Y1・Y2: 上限と、走行ごとの初期化 ──────────────────────────────────────────
for (const lang of ['c', 'py', 'js']) {
  const limit = lang === 'py' ? 'RC_setReadLimit(200)' : 'RC_setReadLimit(200);';
  const a = await runFile(`limit.${EXT[lang]}`, PROBE[lang](limit));
  const readA = nums(a.serial, 'read'), rawA = nums(a.serial, 'raw');
  ok(`Y1-0 ${lang}: ⬆ で読み込むと言語が ${lang} になる`, a.lang === lang, `lang=${a.lang}`);
  ok(`Y1-a ${lang}: RC_setReadLimit(200) の後、200 mm より遠い前の壁は RC_read(CENTER)＝-3`, readA.length >= 6 && readA.every((v) => v === -3), `read ${[...new Set(readA)].join(',')} (${readA.length} 行)`);
  if (lang !== 'py') ok(`Y1-b ${lang}: 生の値 sensor1.readRangeSingleMillimeters() は距離のまま (上限の影響を受けない)`, rawA.length >= 6 && rawA.every((v) => v > 200 && v <= 2000), `raw ${[...new Set(rawA)].join(',')}`);
  ok(`Y1-c ${lang}: 警告・実行時エラーなし`, !/実行時エラー|⚠/.test(a.all), (a.all.match(/.*(?:実行時エラー|⚠).*/g) || []).join(' ').slice(0, 100));
  const b = await runFile(`nolimit.${EXT[lang]}`, PROBE[lang](''));
  const readB = nums(b.serial, 'read'), rawB = nums(b.serial, 'raw');
  ok(`Y2-a ${lang}: 次の走行で上限を決めなければ RC_read(CENTER) は距離を返す (前の走行の上限は残らない)`, readB.length >= 6 && readB.every((v) => v > 200 && v <= 2000), `read ${[...new Set(readB)].join(',')} (${readB.length} 行)`);
  if (lang !== 'py') ok(`Y2-b ${lang}: その値は生の値と同じ・Y1 の生の値とも同じ`, readB.every((v, i) => v === rawB[i]) && readB[0] === rawA[0], `read ${readB[0]}・raw ${rawB[0]}・Y1 の raw ${rawA[0]}`);
}

// ── Y3: 引数の数 ──────────────────────────────────────────────────────────────
{
  const c = await runFile('argc.ino', 'void setup() {\n  RC_setup();\n  RC_setReadLimit();\n}\nvoid loop() {\n  Serial.println(RC_read(CENTER));\n}\n', { lines: 1, ms: 2500 });
  ok('Y3-a C++: RC_setReadLimit() は行番号付きのエラー (1〜2 個・行 3)', /RC_setReadLimit\(\) の引数は 1〜2 個です \(0 個渡されました\) \(行 3\)/.test(c.all), c.all.trim().slice(0, 120));
  const p = await runFile('argc.py', 'from RumiCar import *\n\ndef setup():\n    RC_setup()\n    RC_setReadLimit(LEFT, 200, 1)\n\ndef loop():\n    print(RC_read(CENTER))\n', { lines: 1, ms: 2500 });
  ok('Y3-b Python: RC_setReadLimit(LEFT, 200, 1) は行番号付きのエラー (3 個・行 5)', /RC_setReadLimit\(\) の引数は 1〜2 個です \(3 個渡されました\) \(行 5\)/.test(p.all), p.all.trim().slice(0, 120));
  const j = await runFile('argc.js', 'function setup() {\n  RC_setup();\n  RC_setReadLimit();\n}\nfunction loop() {\n  Serial.println("read=" + RC_read(CENTER));\n}\n', { lines: 3 });
  const rj = nums(j.serial, 'read');
  ok('Y3-c JavaScript: RC_setReadLimit() は上限なしとして警告 1 回・走り続ける', (j.all.match(/⚠ RC_setReadLimit/g) || []).length === 1 && !/実行時エラー/.test(j.all) && rj.length >= 3 && rj.every((v) => v > 200),
    `${(j.all.match(/.*⚠.*/g) || []).join(' ').slice(0, 110)} ／ read ${[...new Set(rj)].join(',')}`);
}

// ── Y4: 実機の見本を本文のまま ───────────────────────────────────────────────
for (const name of ['Exercise-4.2-Answer.ino', 'Exercise-3.1.py', 'Exercise-3.2.py']) {
  const r = await runFile(name, EX[name], { lines: 60, ms: 20000 });
  ok(`Y4-a ${name}: 実行時エラーなしで走り、出力がある`, !/実行時エラー/.test(r.all) && r.serial.length >= 60, `${r.serial.length} 行${/実行時エラー/.test(r.all) ? '・' + r.all.trim().slice(0, 100) : ''}`);
}
{
  const r = await runFile('drive.py', EX['drive.py'], { lines: 3, ms: 4000 });
  const line = EX['drive.py'].split('\n').findIndex((l) => /p\["stop_mm"\]/.test(l)) + 1;
  ok('Y4-b Zero2Cam drive.py: setup() が通る (state と「見本のプログラムを始めます」を出力・警告なし)', r.serial.some((l) => /state - -> START/.test(l)) && r.serial.some((l) => /見本のプログラムを始めます/.test(l)) && !/⚠/.test(r.all), r.serial.slice(0, 2).join(' ／ '));
  ok(`Y4-c Zero2Cam drive.py: loop() は p["stop_mm"] の行 (${line}) で止まる (params.json が無い)`, new RegExp(`'stop_mm' \\(行 ${line}\\)`).test(r.all), r.all.trim().slice(-120));
}

// ── Y5: 出荷の見本 (各言語の既定) ────────────────────────────────────────────
{
  const samples = await appModule(page, 'js/samples.js', (m) => m.SAMPLES);
  for (const lang of ['c', 'py', 'js']) {
    ok(`Y5-a ${lang}: 出荷の見本は RC_setReadLimit を呼ぶ`, /^\s*RC_setReadLimit\(\d+\)/m.test(samples[lang]), (/^.*RC_setReadLimit\(.*$/m.exec(samples[lang]) || [''])[0].trim().slice(0, 70));
    const r = await runFile(`sample.${EXT[lang]}`, samples[lang], { lines: 60, ms: 20000 });
    const far = r.serial.filter((l) => /\b9999\b/.test(l)).length, big = r.serial.filter((l) => l.split(/\s+/).some((x) => /^\d+$/.test(x) && Number(x) > 200 && Number(x) !== 9999)).length;
    ok(`Y5-b ${lang}: 警告・実行時エラーなしで走り、出力する距離は上限以下か「遠い」(9999) だけ`, !/実行時エラー|⚠/.test(r.all) && r.serial.length >= 60 && big === 0 && far > 0,
      `${r.serial.length} 行・「遠い」を含む ${far} 行・上限より大きい距離 ${big} 行${/実行時エラー|⚠/.test(r.all) ? '・' + r.all.trim().slice(0, 80) : ''}`);
  }
}

// ── Y6: 説明の表示 (日本語・英語) ────────────────────────────────────────────
for (const lang of ['ja', 'en']) {
  await setLang(page, lang);
  const want = await appModule(page, 'js/i18n/messages.js', (m) => ({ ja: m.MESSAGES['usage.s7.limit'].ja, en: m.MESSAGES['usage.s7.limit'].en }));
  const got = await page.evaluate(() => {
    const strip = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.replace(/\s+/g, ' ').trim(); };
    const el = document.querySelector('[data-i18n-html="usage.s7.limit"]');
    const texts = [];
    for (const id of ['dlgUsage', 'dlgSpec', 'dlgPhysics']) {
      const dlg = document.getElementById(id);
      if (dlg) for (const li of dlg.querySelectorAll('li, p')) texts.push({ id, t: li.textContent.replace(/\s+/g, ' ').trim() });
    }
    for (const li of document.querySelectorAll('[data-i18n-html="sys.prog.body"] li')) texts.push({ id: 'sys.prog.body', t: li.textContent.replace(/\s+/g, ' ').trim() });
    return { limit: el ? el.textContent.replace(/\s+/g, ' ').trim() : null, strip: strip.toString(), texts };
  });
  const plain = want[lang].replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
  ok(`Y6-a ${lang}: 使い方に RC_setReadLimit の項が出る (カタログの文と同じ)`, got.limit === plain && /RC_setReadLimit/.test(got.limit || ''), (got.limit || '(無い)').slice(0, 80));
  const api = got.texts.filter((x) => /RC_read|RC_setReadLimit/.test(x.t));
  const leak = api.filter((x) => x.t.split(/。|\. /).some((s) => /RC_read|RC_setReadLimit/.test(s) && /20 ?cm|200 ?mm|0〜200|0[–-]200/.test(s)));
  ok(`Y6-b ${lang}: RC_read／RC_setReadLimit に触れる項 ${api.length} 個に一律の打ち切りの数値が出ない`, api.length >= 6 && leak.length === 0, leak.length ? leak.slice(0, 2).map((x) => `${x.id}: ${x.t.slice(0, 60)}`).join(' ／ ') : `${[...new Set(api.map((x) => x.id))].join('・')}`);
  // 使い方のダイアログを実際に開いて、項が見えることを確かめる
  await page.click('#helpUsage');
  await page.waitForTimeout(300);
  const vis = await page.evaluate(() => { const el = document.querySelector('[data-i18n-html="usage.s7.limit"]'); if (!el) return null; el.scrollIntoView(); const r = el.getBoundingClientRect(); return { open: document.getElementById('dlgUsage').open, w: Math.round(r.width), h: Math.round(r.height) }; });
  ok(`Y6-c ${lang}: 使い方のダイアログを開くと RC_setReadLimit の項が表示される`, !!vis && vis.open && vis.w > 100 && vis.h > 10, vis ? `open=${vis.open} ${vis.w}x${vis.h}px` : '(無い)');
  await page.screenshot({ path: `shots/bq1_usage_${lang}.png` });
  await page.click('#dlgUsage .docdlg-x');
  await page.waitForTimeout(200);
}
await setLang(page, 'ja');

// ── Y7 ──
ok('Y7 操作中の console error / pageerror 0', errors.length === 0, `errors=${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''} (想定内として除外した応答 ${benign.length} 件)`);

await browser.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
