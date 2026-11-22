// RumiCar Simulator — 実ブラウザ 常設ゲート: Exercise-2.5／3.3 を実際のファイルとして読み込んで走らせる (Stage BO・v11.0.0)
//
// 本番の画面で、各車の「⬆」(ファイル入力 .cc-file) から Exercise のファイルを読み込み、「自動 ▶」で走らせ、走っている車の
// 舵の指令・強さ・実舵角を測る。プログラムの本文は正本そのまま (書き換えない):
//   Exercise-2.5.ino・Exercise-3.3.ino … Arduino RumiCar-lib v0.7.1 の examples (タグ v0.7.1・main 594e1b0)
//   Exercise-2.5.py・Exercise-3.3.py   … RumiCar リポジトリ RasPi/Exercise-2.5・3.3 (master 7b57478)
//   Stage BQ (v12.0.0): Exercise-3.3 は v0.7.0 の本文 (setup() に RC_setReadLimit(200)。v0.6.0 までは無く、ライブラリが 200 mm で打ち切っていた)
//   に替えた。Exercise-2.5 は v0.6.0 から変わっていない。上限そのものの確認は check_bq1_readlimit.mjs。
//   Stage BR (v12.1.0): Exercise-3.3 を v0.7.1 と RasPi master 7b57478 の本文に替えた (値を距離とステータスに分け、状況に分けて切る形に
//   作り直した版。先頭の LIMIT_MM と setup() の RC_setReadLimit(LIMIT_MM)。.ino は bool・const int・abs・constrain を使う)。
// 観測の仕方: ページが読み込んでいる physics.js／physics_dyn.js／physics_v2.js を import し (アプリと同じモジュール)、車クラスの
//   step(dt) を包んで「車ごとの dt の合計＝sim 時間・steer・steerAmt・steerAngle・x・y」を毎物理ステップ記録する (検査のためにページの
//   中だけで包む＝製品コードは変えない。check_bl6_loop の rAF の記録と同じ作法)。▶ の直前にアプリが行う実走での収容の確認 (capacity.js の
//   試走・既定の見本で走る) の車も同じクラスなので、車ごとに番号を付け、■ を押す直前まで走っていた車 (＝走行中の車) の記録だけを使う。
//
//  X1 2.5 (C・Python): 指令が RIGHT255 → LEFT255 → RIGHT128 → LEFT128 の順に、約 0.5 s ごとに変わる (loop() の直下の delay で区切る)。
//     1 周は 2.05 s (最後の delay は周期 0.05 s＋待ち)。各区間の終わりの実舵角は全舵 (24°) と その 128/255 (約 12°)。
//  X2 3.3 (C・Python): 実行時エラーなしで走り、Power をシリアルに出し、強さ (steerAmt) が 40〜255 の整数で 2 通り以上に変わり、車が動く。
//  X3 操作中の console error / pageerror 0 (想定内の応答は件数を明示して除外)。
//
// 使い方: bash run.sh check_bo1_exercise.mjs   終了コード: 0=全 PASS / 1=いずれか FAIL
import { launch, newPage, report, APP_URL } from './lib.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => (report(label, cond, detail) ? pass++ : fail++);

const EX = {
  'Exercise-2.5.ino': "#include <RumiCar.h>\n\nvoid setup()\n{\n  RC_setup();\n}\n\nvoid loop()\n{\n  RC_steer(RIGHT,255);\n  delay(500);\n  RC_steer(LEFT,255);\n  delay(500);\n  RC_steer(RIGHT,128);\n  delay(500);\n  RC_steer(LEFT,128);\n  delay(500);\n}\n",
  'Exercise-3.3.ino': "#include <RumiCar.h>\n\n// Tentative values. When you change them on your car, change one at a time.\nconst int LIMIT_MM = 200;   // the distance RC_read trusts [mm]. Beyond it RC_read returns -3 (out of range).\n                            // The RumiCar model 32 picks up the floor at about 30 cm; 200 mm leaves a margin.\nconst int BAND_MM  = 30;    // with walls on both sides, go straight if left and right differ by this much or less [mm]\n                            // (larger than the sensor error of 1-2 cm)\n\nint ipower = 128;           // steering strength 0-255 (start at half; it changes by itself while driving,\n                            // 1.3 times or half at a time - rough guides)\nint lastSide = CENTER;      // the side we steered to last time\nint lastErr = 0;            // the error last time [mm]\nint lastCase = -1;          // the situation last time (see below)\n\nvoid setup()\n{\n  RC_setup();\n  RC_setReadLimit(LIMIT_MM);  // beyond LIMIT_MM, RC_read returns -3\n}\n\nvoid loop()\n{\n  int s0 = RC_read(LEFT);\n  int s1 = RC_read(CENTER);\n  int s2 = RC_read(RIGHT);\n\n  Serial.print(\"Sensor0:\");   // print the values as RC_read returned them (-3 is out of range, not a distance)\n  Serial.print(s0);\n  Serial.print(\"  Sensor1:\");\n  Serial.print(s1);\n  Serial.print(\"  Sensor2:\");\n  Serial.print(s2);\n  Serial.print(\"  Power:\");\n  Serial.println(ipower);\n\n  if (s0 < 0 || s1 < 0 || s2 < 0) {          // status: a negative value is not a distance\n    if (s0 == -1 || s1 == -1 || s2 == -1) {  // -1: a sensor did not answer, so stop\n      RC_drive(BRAKE, 0);\n      return;\n    }\n    // -3 (out of range): nothing was measured before LIMIT_MM in that direction.\n    // Below, it means \"no wall is seen on that side\".\n  }\n\n  // Speed: decided by the front (center) sensor\n  if (s1 == -3) {             // nothing before LIMIT_MM\n    RC_drive(FORWARD, 255);\n  } else if (s1 < 100) {      // keep these thresholds at or below LIMIT_MM\n    RC_drive(REVERSE, 150);\n  } else if (s1 < 150) {\n    RC_drive(FORWARD, 150);\n  } else if (s1 < 200) {\n    RC_drive(FORWARD, 200);\n  } else {\n    RC_drive(FORWARD, 255);\n  }\n\n  // Direction: for each situation, decide the side to steer to and the error\n  bool seeLeft = (s0 >= 0);   // a wall is seen on the left (RC_read returned a distance)\n  bool seeRight = (s2 >= 0);\n  int theCase;                // the situation\n  int side;                   // the side to steer to (CENTER = go straight)\n  int err;                    // the error [mm]: how far we are from what we want\n  if (seeLeft && seeRight) {         // walls on both sides: drive in the middle\n    theCase = 0;\n    err = abs(s0 - s2);\n    if (err <= BAND_MM) {\n      side = CENTER;\n    } else if (s0 > s2) {\n      side = LEFT;\n    } else {\n      side = RIGHT;\n    }\n  } else if (seeRight) {             // only the right wall: move away from it\n    theCase = 1;\n    err = LIMIT_MM - s2;      // the closer the wall, the larger the error\n    side = LEFT;\n  } else if (seeLeft) {              // only the left wall: move away from it\n    theCase = 2;\n    err = LIMIT_MM - s0;\n    side = RIGHT;\n  } else {                           // no wall on either side: go straight\n    theCase = 3;\n    err = 0;\n    side = CENTER;\n  }\n  // We do not know how far an unseen wall is (-3), so we do not guess a distance for it:\n  // with one wall, we only move away from the wall we can see.\n\n  if (theCase != lastCase) {\n    // The situation changed (a wall or a pole appeared or disappeared). That change was not\n    // caused by our steering, so do not judge the strength by comparing with last time.\n    lastSide = CENTER;\n  }\n\n  if (side == CENTER) {\n    RC_steer(CENTER);\n  } else {\n    if (lastSide != CENTER && side != lastSide) {\n      ipower = ipower / 2;          // went past the target: too strong, use half\n    } else if (side == lastSide && err >= lastErr) {\n      ipower = ipower * 13 / 10;    // the error is not getting smaller: too weak, use 1.3 times\n    }\n    ipower = constrain(ipower, 40, 255);  // keep at least 40 so that 1.3 times can grow again\n    RC_steer(side, ipower);\n    lastSide = side;\n  }\n  lastErr = err;\n  lastCase = theCase;\n}\n",
  'Exercise-2.5.py': "from RumiCar import *\nimport time\n\n# ハンドルの強さを変えてみよう: 強さ 255 (いちばん強い) と 128 (半分) で右・左に切る\n# 実行: python3 ../RumiCar.py Exercise-2.5.py\n\n\ndef setup():\n    RC_setup()\n\n\ndef loop():\n    RC_steer(RIGHT, 255)\n    time.sleep(0.5)\n    RC_steer(LEFT, 255)\n    time.sleep(0.5)\n    RC_steer(RIGHT, 128)\n    time.sleep(0.5)\n    RC_steer(LEFT, 128)\n    time.sleep(0.5)\n",
  'Exercise-3.3.py': "from RumiCar import *\n\n# なめらかに走る車: 状況に分けて、「ずれ」の大きさでハンドルを切る\n#   両側に壁 → 真ん中を走る / 右の壁だけ → 左へ切って離れる / 左の壁だけ → 右へ切って離れる\n#   どちらにも壁が見えない → まっすぐ / センサーが応答しない (-1) → 止まる\n# ハンドルの強さは走りながら自分で調整する (ずれが縮まらなければ 1.3 倍、目標を越えたら半分)\n# Arduino 版 (RumiCar-lib v0.7.1 の Exercise-3.3) と同じ動き\n# 実行: python3 ../RumiCar.py Exercise-3.3.py\n\n# 仮の値。自分の車で変えるときは、1 つずつ変える\nLIMIT_MM = 200          # RC_read が信じる距離の上限 [mm]。これより先は RC_read が -3 (範囲外) を返す\n                        # RumiCar モデル 32 型は約 30 cm で床を捉えるので、200 mm は余裕を見た値\nBAND_MM = 30            # 両側に壁があるとき、左右の差がこれ以下ならまっすぐ [mm]\n                        # (センサーの誤差 1〜2 cm より大きくする)\n\nipower = 128            # ハンドルの強さ 0〜255 (半分から始める。走りながら自分で変わる。\n                        # 1.3 倍・半分ずつ。どちらも目安)\nlast_side = CENTER      # 前回切った側\nlast_err = 0            # 前回のずれ [mm]\nlast_case = -1          # 前回の状況 (下を参照)\n\n\ndef setup():\n    RC_setup()\n    RC_setReadLimit(LIMIT_MM)   # LIMIT_MM より先は RC_read が -3 を返す\n\n\ndef loop():\n    global ipower, last_side, last_err, last_case\n\n    s0 = RC_read(LEFT)\n    s1 = RC_read(CENTER)\n    s2 = RC_read(RIGHT)\n\n    # RC_read が返した値のまま表示する (-3 は範囲外で、距離ではない)\n    print(\"Sensor0:\", s0, \" Sensor1:\", s1, \" Sensor2:\", s2, \" Power:\", ipower)\n\n    if s0 < 0 or s1 < 0 or s2 < 0:              # ステータス: 負の数は距離ではない\n        if s0 == -1 or s1 == -1 or s2 == -1:    # -1: センサーが応答しない → 止まる\n            RC_drive(BRAKE, 0)\n            return\n        # -3 (範囲外): その方向の LIMIT_MM より手前に測れた物が無い。\n        # 以下では「その側に壁が見えない」という意味で使う\n\n    # 速さ: 前 (中央) のセンサーで決める\n    if s1 == -3:                # LIMIT_MM より手前に何も無い\n        RC_drive(FORWARD, 255)\n    elif s1 < 100:              # これらのしきい値は LIMIT_MM 以下にする\n        RC_drive(REVERSE, 150)\n    elif s1 < 150:\n        RC_drive(FORWARD, 150)\n    elif s1 < 200:\n        RC_drive(FORWARD, 200)\n    else:\n        RC_drive(FORWARD, 255)\n\n    # 向き: 状況ごとに、切る側とずれを決める\n    see_left = (s0 >= 0)        # 左に壁が見える (RC_read が距離を返した)\n    see_right = (s2 >= 0)\n    # the_case: 状況、side: 切る側 (CENTER = まっすぐ)、err: ずれ [mm] (目標からどれだけ離れているか)\n    if see_left and see_right:          # 両側に壁: 真ん中を走る\n        the_case = 0\n        err = abs(s0 - s2)\n        if err <= BAND_MM:\n            side = CENTER\n        elif s0 > s2:\n            side = LEFT\n        else:\n            side = RIGHT\n    elif see_right:                     # 右の壁だけ: その壁から離れる\n        the_case = 1\n        err = LIMIT_MM - s2     # 壁が近いほど、ずれが大きい\n        side = LEFT\n    elif see_left:                      # 左の壁だけ: その壁から離れる\n        the_case = 2\n        err = LIMIT_MM - s0\n        side = RIGHT\n    else:                               # どちらにも壁が無い: まっすぐ\n        the_case = 3\n        err = 0\n        side = CENTER\n    # 見えない壁 (-3) がどれだけ遠いかは分からないので、その距離を推測しない:\n    # 壁が片側だけのときは、見えている壁から離れるだけにする\n\n    if the_case != last_case:\n        # 状況が変わった (壁や柱が現れた・消えた)。この変化は自分の切り方の結果ではないので、\n        # 前回と比べて強さを判断しない\n        last_side = CENTER\n\n    if side == CENTER:\n        RC_steer(CENTER)\n    else:\n        if last_side != CENTER and side != last_side:\n            ipower = ipower // 2            # 目標を越えた: 強すぎるので半分にする\n        elif side == last_side and err >= last_err:\n            ipower = ipower * 13 // 10      # ずれが縮まらない: 弱いので 1.3 倍にする\n        ipower = max(40, min(ipower, 255))  # 1.3 倍でまた増やせるよう 40 以上に保つ\n        RC_steer(side, ipower)\n        last_side = side\n    last_err = err\n    last_case = the_case\n",
};

const browser = await launch();
console.log(`\n== 実ブラウザ: Exercise-2.5／3.3 を読み込んで走らせる (BO) ==\n対象: ${APP_URL}\n`);
const { page, errors, benign } = await newPage(browser, {
  width: 1440, height: 900,
  before: async (p) => { await p.addInitScript(() => { try { localStorage.setItem('rumicar.lang', 'ja'); } catch (e) {} }); },
});

// コース: 卓上の「オーバル」(courses.json の先頭)。
const courseVal = await page.evaluate(() => {
  const o = [...document.querySelectorAll('#courseSel option')].find((x) => x.textContent.trim().replace(/^[^\p{L}]+/u, '').startsWith('オーバル'));
  return o ? o.value : null;
});
if (courseVal != null) { await page.selectOption('#courseSel', courseVal); await page.waitForTimeout(800); }
ok('X0 コース「オーバル」を選べる', courseVal != null, `value=${courseVal}`);

// 車クラスの step を包んで記録する (ページの中だけ)。
await page.evaluate(async () => {
  const [p, d, v] = await Promise.all([import('./js/physics.js'), import('./js/physics_dyn.js'), import('./js/physics_v2.js')]);
  const L = window.__bo1 = { on: false, rec: [], id: new WeakMap(), t: new Map(), n: 0, maxT: 0 };
  for (const C of [p.Car, d.DynCar, v.CarV2]) {
    if (!Object.prototype.hasOwnProperty.call(C.prototype, 'step') || C.prototype.step.__bo1) continue;
    const orig = C.prototype.step;
    const w = function (dt) {
      const r = orig.call(this, dt);
      if (L.on) {
        let id = L.id.get(this); if (id == null) { id = ++L.n; L.id.set(this, id); }
        const t = (L.t.get(id) || 0) + dt; L.t.set(id, t); if (t > L.maxT) L.maxT = t;
        L.rec.push([t, this.steer, this.steerAmt == null ? null : this.steerAmt, this.steerAngle, this.x, this.y, id]);
      }
      return r;
    };
    w.__bo1 = true; C.prototype.step = w;
  }
});
const maxSteer = await page.evaluate(async () => (await import('./js/config.js')).CAR.maxSteer);

async function runFile(name, simSec) {
  const input = page.locator('#fleetCols .carcol .cc-file').first();
  await input.setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(EX[name], 'utf8') });
  await page.waitForTimeout(500);
  const lang = await page.locator('#fleetCols .carcol .cc-lang').first().inputValue();
  const logBefore = (await page.locator('#log').innerText()).length;
  await page.evaluate(() => { const L = window.__bo1; L.on = true; L.rec = []; L.id = new WeakMap(); L.t = new Map(); L.maxT = 0; });
  await page.click('#run');
  // 走行中の車＝最後に記録された車。その車の sim 時間が simSec に届くまで待つ。
  await page.waitForFunction((s) => { const L = window.__bo1; const last = L.rec[L.rec.length - 1]; return last && (L.t.get(last[6]) || 0) >= s; }, simSec, { timeout: 180000, polling: 100 });
  await page.click('#stop');
  await page.waitForTimeout(300);
  const all = await page.evaluate(() => { const L = window.__bo1; L.on = false; return L.rec; });
  const liveId = all[all.length - 1][6];
  const rec = all.filter((r) => r[6] === liveId);
  const serial = await page.locator('#fleetCols .carcol .cc-serial').first().innerText();
  const log = (await page.locator('#log').innerText()).slice(logBefore);
  return { rec, serial, log, lang };
}

// ── X1: Exercise-2.5 ─────────────────────────────────────────────────────────
for (const name of ['Exercise-2.5.ino', 'Exercise-2.5.py']) {
  const { rec, log, serial, lang } = await runFile(name, 4.4);
  ok(`X1-0 ${name}: ⬆ で読み込むと言語が ${name.endsWith('.py') ? 'py' : 'c'} になる`, lang === (name.endsWith('.py') ? 'py' : 'c'), `lang=${lang}`);
  const ch = []; let prev = null;
  rec.forEach((r, i) => { const k = `${r[1]}/${r[2]}`; if (k !== prev) { ch.push({ t: r[0], k, i }); prev = k; } });
  if (ch.length && ch[0].k === `${1}/null`) ch.shift();   // ▶ から最初の loop() までの物理ステップ (CENTER のまま)
  const keys = ch.map((c) => c.k);
  const wantKeys = ['2/null', '0/null', '2/128', '0/128', '2/null', '0/null', '2/128', '0/128'];
  ok(`X1-a ${name}: 指令の順序 RIGHT255→LEFT255→RIGHT128→LEFT128 を繰り返す`, JSON.stringify(keys.slice(0, 8)) === JSON.stringify(wantKeys), keys.slice(0, 8).join(' '));
  const want = [0, 0.5, 1.0, 1.5, 2.05, 2.55, 3.05, 3.55];
  const t0 = ch[0] ? ch[0].t : 0;   // 最初の loop() までの時間 (▶ から最初の指令まで) を引いて相対時刻で比べる
  const dts = ch.slice(0, 8).map((c, j) => (c.t - t0) - want[j]);
  const worst = Math.max(...dts.map(Math.abs));
  ok(`X1-b ${name}: 最初の指令から 0.5・1.0・1.5・2.05・2.55 … s で指令が変わる (±0.07 s・live は区間の始まりで呼ぶため最大 0.05 s 早まりうる)`, worst <= 0.07,
    ch.slice(0, 8).map((c) => (c.t - t0).toFixed(3)).join(' ') + ` (最初の指令 ${t0.toFixed(3)} s)`);
  // 各区間の終わり (次の指令の直前の step) の実舵角
  const endAng = ch.slice(1, 8).map((c) => rec[c.i - 1][3]);
  const r255 = Math.abs(endAng[0]) / maxSteer, l255 = Math.abs(endAng[1]) / maxSteer, r128 = Math.abs(endAng[2]) / maxSteer, l128 = Math.abs(endAng[3]) / maxSteer;
  ok(`X1-c ${name}: 区間の終わりの実舵角 RIGHT255/LEFT255 は全舵・RIGHT128/LEFT128 は全舵の 128/255`,
    Math.abs(r255 - 1) < 1e-9 && Math.abs(l255 - 1) < 1e-9 && Math.abs(r128 - 128 / 255) < 1e-9 && Math.abs(l128 - 128 / 255) < 1e-9 && endAng[0] < 0 && endAng[1] > 0 && endAng[2] < 0 && endAng[3] > 0,
    `比 ${r255.toFixed(4)} / ${l255.toFixed(4)} / ${r128.toFixed(4)} / ${l128.toFixed(4)} (128/255=${(128 / 255).toFixed(4)})`);
  ok(`X1-d ${name}: 実行時エラー・警告なし`, !/実行時エラー|⚠/.test(log + serial), log.trim().slice(0, 80));   // 警告と実行時エラーは各車のシリアル出力に出る
}

// ── X2: Exercise-3.3 ─────────────────────────────────────────────────────────
for (const name of ['Exercise-3.3.ino', 'Exercise-3.3.py']) {
  const { rec, serial, log } = await runFile(name, 20);
  ok(`X2-a ${name}: 実行時エラーなし`, !/実行時エラー/.test(log + serial), log.trim().slice(0, 80));
  const pw = [...serial.matchAll(/Power:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  ok(`X2-b ${name}: シリアルに Power を出す (40〜255)`, pw.length > 20 && pw.every((x) => x >= 40 && x <= 255), `${pw.length} 行・値 ${[...new Set(pw)].slice(0, 8).join(',')}`);
  const amts = [...new Set(rec.map((r) => r[2]).filter((a) => a != null))].sort((a, b) => a - b);
  ok(`X2-c ${name}: 強さが 40〜255 の整数で 2 通り以上に変わる`, amts.length >= 2 && amts.every((a) => Number.isInteger(a) && a >= 40 && a <= 255), amts.join(','));
  const path = rec.reduce((s, r, i) => (i ? s + Math.hypot(r[4] - rec[i - 1][4], r[5] - rec[i - 1][5]) : 0), 0);
  ok(`X2-d ${name}: 車が走る (20 sim 秒の走行距離)`, path > 2, `${path.toFixed(2)} m`);
}

// ── X3 ──
ok('X3 操作中の console error / pageerror 0', errors.length === 0, `errors=${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''} (想定内として除外した応答 ${benign.length} 件)`);

await browser.close();
console.log(`\n結果: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
