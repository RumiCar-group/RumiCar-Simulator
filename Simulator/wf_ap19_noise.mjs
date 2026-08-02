// AP19 常設アサートゲート: センサー実機化 opt-in ② 外れ値/距離依存欠測 + 他車反射率。
// 本番フロー (readAll / buildController+tickSlot+integrateSlot・runner・fleet) を実データで駆動し、
// 受け入れ基準①②③④を連続量マージンで検証する (知覚→測定・CI-14)。1 つでも外れたら exit(1)。
//   ① 既定 (追加フィールド0): 全読み値 byte 一致 (決定論)・乱数非消費 (追加乱数0=outlier 短絡)・f0〜f3 不変 (wf_ab8_bench が別途担保)。
//   ② ON: (a) spurious 率 ±20% (N=50000)  (b) dropout 距離傾き = 設定式 ×(1.0±0.2)  (c) 車エッジ標的 sd 比 = carSigmaMul ±10%。
//   ③ CONF 付きサンプル (samples.c) が outlier ON で棄却>0 (spurious 起因の増分>0) かつ完走。
//   ④ 残差ゲーティング driver 6 台混走で carTarget が発火 (sd 倍率が軌跡を変える) しつつ全車が機能 (前進・非ハング)。
import { SENSOR_NOISE, SENSOR_RANGE, SIM, CONST, FLEET } from './public/js/config.js';
import { Car, carEdges } from './public/js/physics.js';
import { readAll } from './public/js/sensors.js';
import { buildFromSpec } from './public/js/course.js';
import { makeSlot, rebuildSpawns, tickSlot, integrateSlot, othersFor } from './public/js/fleet.js';
import { buildController } from './public/js/runner.js';
import { SAMPLES } from './public/js/samples.js';

// ── テスト環境: Node に localStorage が無い (LapTracker.reset が loadBestRec→getItem を呼ぶ) ため
//    最小のインメモリ polyfill を敷く。本番 UI では実 localStorage。ここは環境整備であって本番経路の分岐ではない。
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map();
  globalThis.localStorage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() };
}

let fail = 0;
const chk = (cond, msg) => { console.log(`  ${cond ? '✓' : '✗'} ${msg}`); if (!cond) fail++; };
const sd = (a) => { const m = a.reduce((s, x) => s + x, 0) / a.length; return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length); };

// 決定論のためのシード付き PRNG (mulberry32)。本番 readSensor は Math.random をそのまま使う。ゲートは
// nondeterminism を固定して確率的受け入れを再現可能にするだけ (production コードは無改変=CI-8 のバイパスでない)。
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const realRand = Math.random;
const seedRand = (s) => { Math.random = mulberry32(s); };
const spyRand = () => { let n = 0; const base = Math.random; Math.random = () => { n++; return base(); }; return () => n; };
const restoreRand = () => { Math.random = realRand; };

// 退避 (本番 live globals を汚さない)。
const SAV = { on: SENSOR_NOISE.on, sb: SENSOR_NOISE.sigmaBaseMm, sf: SENSOR_NOISE.sigmaFrac, dr: SENSOR_NOISE.dropout,
  ol: SENSOR_NOISE.outlier, om: SENSOR_NOISE.outlierMinMm, df: SENSOR_NOISE.dropoutFar, cm: SENSOR_NOISE.carSigmaMul };
const resetNoise = () => { SENSOR_NOISE.on = false; SENSOR_NOISE.sigmaBaseMm = 8; SENSOR_NOISE.sigmaFrac = 0.02;
  SENSOR_NOISE.dropout = 0.03; SENSOR_NOISE.outlier = 0; SENSOR_NOISE.outlierMinMm = 20; SENSOR_NOISE.dropoutFar = 0; SENSOR_NOISE.carSigmaMul = 1; };

// 実データ: 卓上オーバル (=f0 と同一 spec)。
const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
const walls = oval.walls;

// 中央センサーが中距離を読む姿勢を実測で選ぶ (AP18 gate と同型)。
function pickPose() {
  for (let x = -1.0; x <= 1.0; x += 0.1) for (let y = -0.6; y <= 0.6; y += 0.1)
    for (const th of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      const c = new Car({ x, y, theta: th });
      const mm = readAll(c, walls, [])[1].mm;
      if (mm >= 300 && mm <= 1400) return { x, y, theta: th, mm };
    }
  return null;
}
const pose = pickPose();
if (!pose) { console.error('FAIL: 適切な測距姿勢が見つからない'); process.exit(1); }
console.log(`基準姿勢: x=${pose.x.toFixed(1)} y=${pose.y.toFixed(1)} θ=${pose.theta.toFixed(2)} 中央mm=${pose.mm}`);

// ─────────────────────────────────────────────────────────────────────
console.log('\n[① 既定 (追加フィールド0): 全読み値 byte 一致・追加乱数0 (outlier 短絡)]');
{
  resetNoise();
  SENSOR_NOISE.on = true;   // ノイズ ON かつ AP19 追加フィールド 0 = 従来 (M1) 経路へ縮退するはず。
  const car = new Car({ x: pose.x, y: pose.y, theta: pose.theta });
  // (i) 決定論: 同一シードで 2 回 → 全読み値 byte 一致。
  seedRand(12345);
  const runA = []; for (let k = 0; k < 400; k++) runA.push(...readAll(car, walls, []).map(s => s.mm));
  seedRand(12345);
  const runB = []; for (let k = 0; k < 400; k++) runB.push(...readAll(car, walls, []).map(s => s.mm));
  const identical = runA.length === runB.length && runA.every((v, i) => v === runB[i]);
  chk(identical, `同一シード 2 回で全 ${runA.length} 読み値 byte 一致 (決定論)`);
  // (ii) 乱数消費が「classic (M1) パターン」と厳密一致 = outlier が乱数を1つも消費していない証拠。
  //      ノイズ block に入るのは pre-noise mm>=0 のセンサーだけ (範囲外 -3 は block をスキップ=0 乱数)。
  //      block 内 1 読み: 出力 -3 (欠測)→1 乱数 / 出力>=0 (gauss)→3 乱数 (dropout check 1 + gauss 2)。outlier=0 は短絡で 0。
  SENSOR_NOISE.on = false;
  const mask = readAll(car, walls, []).map(s => s.mm >= 0);   // 各センサーが block に入るか (pre-noise 有効)
  const nValid = mask.filter(Boolean).length;
  SENSOR_NOISE.on = true;
  seedRand(99999);
  const cnt = spyRand();
  const perCall = []; for (let k = 0; k < 400; k++) perCall.push(readAll(car, walls, []).map(s => s.mm));
  const used = cnt(); restoreRand();
  let expected = 0;
  for (const call of perCall) for (let i = 0; i < call.length; i++) {
    if (!mask[i]) continue;                 // pre-noise 無効 = block 非通過 = 0 乱数
    expected += (call[i] === -3) ? 1 : 3;   // 欠測=1 / gauss=3
  }
  chk(used === expected && nValid > 0, `追加乱数0: 実消費 ${used} = classic 期待 ${expected} (block 通過 ${nValid}/3 センサー・欠測×1/gauss×3) ⇒ outlier 分岐は Math.random 非消費`);
  // (iii) 追加フィールド0 では spurious (真距離無相関の一様値) が一度も生成されない → block 通過読みは -3 か真値近傍のみ。
  SENSOR_NOISE.on = false;
  const trueMm = readAll(car, walls, []).map(s => s.mm);
  SENSOR_NOISE.on = true;
  let anySpurious = false;
  for (const call of perCall) for (let i = 0; i < call.length; i++)
    if (mask[i] && call[i] !== -3 && Math.abs(call[i] - trueMm[i]) > 500) anySpurious = true;  // gauss では届かない大外れ=spurious の痕跡
  chk(!anySpurious, `追加フィールド0 で spurious 値の生成なし (block 通過読みが全て -3 か真値±500mm 内)`);
  restoreRand();
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n[②-a spurious 率 ±20% (N=50000)]');
{
  resetNoise();
  SENSOR_NOISE.on = true; SENSOR_NOISE.sigmaBaseMm = 0; SENSOR_NOISE.sigmaFrac = 0; SENSOR_NOISE.dropout = 0;
  const P = 0.05; SENSOR_NOISE.outlier = P;   // σ=0・dropout=0 → 各読みは真値 (round) か spurious 一様値のいずれか。
  const car = new Car({ x: pose.x, y: pose.y, theta: pose.theta });
  const trueMm = readAll.call(null, car, walls, [])[1].mm;  // outlier は下で発火するが、真値は σ=0 のとき outlier 非発火読み=trueMm
  seedRand(20240719);
  const N = 50000; let spur = 0;
  for (let k = 0; k < N; k++) { const mm = readAll(car, walls, [])[1].mm; if (mm !== trueMm) spur++; }
  restoreRand();
  const rate = spur / N;
  const rel = Math.abs(rate - P) / P;
  chk(rel <= 0.20, `spurious 率 実測 ${(rate * 100).toFixed(2)}% vs 設定 ${(P * 100).toFixed(1)}% (相対誤差 ${(rel * 100).toFixed(1)}% ≤ 20%)`);
}

console.log('\n[②-b dropout 距離傾き = 設定式 ×(1.0±0.2)]');
{
  // 2 距離で欠測率を測り、傾きが dropoutFar に一致するか。σ=0/outlier=0 で dropout 分岐のみを分離。
  resetNoise();
  SENSOR_NOISE.on = true; SENSOR_NOISE.sigmaBaseMm = 0; SENSOR_NOISE.sigmaFrac = 0; SENSOR_NOISE.outlier = 0;
  const base = 0.02, slope = 0.06; SENSOR_NOISE.dropout = base; SENSOR_NOISE.dropoutFar = slope;   // 欠測率 = base + slope×距離[m]
  // 近/遠の 2 姿勢を実測で選ぶ (中央 mm が有効な短距離と長距離)。
  const pickAt = (lo, hi) => {
    for (let x = -1.0; x <= 1.0; x += 0.05) for (let y = -0.6; y <= 0.6; y += 0.05)
      for (const th of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
        const c = new Car({ x, y, theta: th }); const mm = readAll(c, walls, [])[1].mm;
        if (mm >= lo && mm <= hi) return { car: c, d: mm / 1000 };
      }
    return null;
  };
  const near = pickAt(280, 420), far = pickAt(1000, 1500);
  if (!near || !far) { chk(false, 'dropout 傾き: 近/遠の測距姿勢が見つからない'); }
  else {
    const rateAt = (car, seed) => {
      seedRand(seed); const N = 50000; let d3 = 0;
      for (let k = 0; k < N; k++) if (readAll(car, walls, [])[1].mm === -3) d3++;
      restoreRand(); return d3 / N;
    };
    const rN = rateAt(near.car, 555), rF = rateAt(far.car, 777);
    const measSlope = (rF - rN) / (far.d - near.d);
    const ratio = measSlope / slope;
    chk(Math.abs(ratio - 1) <= 0.20, `dropout 傾き 実測 ${measSlope.toFixed(4)}/m vs 設定 ${slope}/m (比 ${ratio.toFixed(3)} ∈ 1.0±0.2)  [近 d=${near.d.toFixed(2)}m率${(rN * 100).toFixed(1)}% / 遠 d=${far.d.toFixed(2)}m率${(rF * 100).toFixed(1)}%]`);
  }
}

console.log('\n[②-c 車エッジ標的 sd 比 = carSigmaMul ±10%]');
{
  resetNoise();
  SENSOR_NOISE.on = true; SENSOR_NOISE.sigmaBaseMm = 25; SENSOR_NOISE.sigmaFrac = 0.05; SENSOR_NOISE.dropout = 0; SENSOR_NOISE.outlier = 0;
  const MUL = 2.0; SENSOR_NOISE.carSigmaMul = MUL;
  // 中央センサー正面 (θ=0) の距離 D に、壁 or 他車エッジ を置く。car のセンサー原点は前方オフセットを持つので
  // 十分手前から先に伸びる縦セグメントにして扇内で確実に当てる。
  const car = new Car({ x: 0, y: 0, theta: 0 });
  const D = 0.9;
  const wall = { x1: D, y1: -0.6, x2: D, y2: 0.6 };            // 壁標的 (hitCar=false)
  const carEdge = { x1: D, y1: -0.35, x2: D, y2: 0.35 };       // 他車エッジ標的 (extra=hitCar=true)
  // 真距離が両者でほぼ一致することを確認 (σ を同一距離で比較=倍率だけを見る)。
  resetNoise(); SENSOR_NOISE.on = false;
  const mmWallTrue = readAll(car, [wall], [])[1].mm;
  const mmCarTrue = readAll(car, [], [carEdge])[1].mm;
  SENSOR_NOISE.on = true; SENSOR_NOISE.sigmaBaseMm = 25; SENSOR_NOISE.sigmaFrac = 0.05; SENSOR_NOISE.dropout = 0; SENSOR_NOISE.outlier = 0; SENSOR_NOISE.carSigmaMul = MUL;
  chk(mmWallTrue > 0 && mmCarTrue > 0 && Math.abs(mmWallTrue - mmCarTrue) <= 5, `壁/車エッジ 真距離ほぼ一致 (壁${mmWallTrue}mm / 車${mmCarTrue}mm)`);
  const N = 40000;
  seedRand(31415); const wv = []; for (let k = 0; k < N; k++) wv.push(readAll(car, [wall], [])[1].mm);
  seedRand(31415); const cv = []; for (let k = 0; k < N; k++) cv.push(readAll(car, [], [carEdge])[1].mm);
  restoreRand();
  const sdW = sd(wv), sdC = sd(cv), ratio = sdC / sdW;
  chk(Math.abs(ratio - MUL) / MUL <= 0.10, `sd 比 実測 ${ratio.toFixed(3)} vs carSigmaMul ${MUL} (相対誤差 ${(Math.abs(ratio - MUL) / MUL * 100).toFixed(1)}% ≤ 10%)  [壁sd ${sdW.toFixed(1)} / 車sd ${sdC.toFixed(1)}]`);
}

// ─────────────────────────────────────────────────────────────────────
// 本番フロー: 1 台/6 台を fleet で駆動するヘルパ (main.js の paused-step 経路と同型: tickSlot→integrateSlot)。
function makeFleet(srcs, lang, course) {
  const slots = srcs.map((src, i) => makeSlot({ i, lang, src, course, slotCount: srcs.length, logFor: () => (() => {}) }));
  rebuildSpawns(slots, course);
  for (const s of slots) { s.controller = buildController(s.src, s.lang, s.hostEnv); s.controller.setup(); s.running = true; s.loopTimer = 0; }
  return slots;
}
// 1 loop tick = tickSlot (全車) → integrateSlot (全車, dt=1/loopHz)。progress[]=各車の累積走行距離[m]。
function stepFleet(slots, walls, interact, recover, progress) {
  const edges = slots.map(s => carEdges(s.car));
  slots.forEach((s, i) => tickSlot(s, othersFor(edges, i, interact)));
  slots.forEach((s, i) => {
    const px = s.car.x, py = s.car.y;
    integrateSlot(s, 1 / SIM.loopHz, othersFor(edges, i, interact), walls, recover);
    if (progress) progress[i] += Math.hypot(s.car.x - px, s.car.y - py);
  });
}

console.log('\n[③ CONF 付きサンプル (samples.c) が outlier ON で棄却>0 (spurious 増分>0) かつ完走]');
{
  // outlier ON と OFF を同条件で走らせ、CONF ゲート棄却 (プログラムが受けた読値で mm<0||mm>640) の件数を比較。
  //   ON の棄却が OFF より多い = spurious が CONF 教材を実際に演習した証拠。ON で完走 (laps≥1)。
  const runConf = (outlier, seed, budgetSec) => {
    resetNoise(); SENSOR_NOISE.on = true; SENSOR_NOISE.outlier = outlier;   // 実機相当の他ノイズは既定 (σ8/2%, dropout3%) のまま。
    seedRand(seed);
    const course = buildFromSpec({ name: 'オーバルC', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
    const slots = makeFleet([SAMPLES.c], 'c', course);
    let reject = 0; const steps = Math.round(budgetSec * SIM.loopHz);
    for (let k = 0; k < steps; k++) {
      stepFleet(slots, course.walls, false, true, null);
      // プログラムが RC 経由で受ける値 = rawRead(mm<0→8190)。CONF ゲート棄却述語 = (mm<0 || mm>640)。
      for (const s of slots[0].world._sensors) if (s.mm < 0 || s.mm > 640) reject++;
      if (slots[0].lap.laps >= 1) { /* 完走後も走り続けて棄却を集計 */ }
    }
    restoreRand();
    return { reject, laps: slots[0].lap.laps };
  };
  const on = runConf(0.06, 424242, 120);
  const off = runConf(0.0, 424242, 120);
  chk(on.reject > 0, `outlier ON で CONF 棄却 ${on.reject} 件 (>0)`);
  chk(on.reject > off.reject, `spurious 起因の棄却増分 = ON ${on.reject} − OFF ${off.reject} = +${on.reject - off.reject} (>0)`);
  chk(on.laps >= 1, `outlier ON で完走 (laps=${on.laps} ≥ 1)`);
}

console.log('\n[④ 残差ゲーティング 6 台混走で carTarget 発火 + 全車機能]');
{
  // 残差ゲーティング driver (C): 各センサーに EMA 予測 e0/e1/e2 を持ち、|読値-予測|>400mm を外れ値として棄却
  //   (予測維持)、無効/範囲外(8190)は予測維持、それ以外で EMA 更新。外れ値/欠測に頑健な学習系の代表。
  const RESID = `
int e0, e1, e2;
void setup() { RC_setup(); e0 = -1; e1 = -1; e2 = -1; }
void loop() {
  int s0 = sensor0.readRangeSingleMillimeters();
  int s1 = sensor1.readRangeSingleMillimeters();
  int s2 = sensor2.readRangeSingleMillimeters();
  if (s0 >= 0 && s0 <= 2000) { if (e0 < 0) { e0 = s0; } else { int d0 = s0 - e0; if (d0 < 0) d0 = -d0; if (d0 <= 400) e0 = (e0 * 6 + s0 * 4) / 10; } }
  if (s1 >= 0 && s1 <= 2000) { if (e1 < 0) { e1 = s1; } else { int d1 = s1 - e1; if (d1 < 0) d1 = -d1; if (d1 <= 400) e1 = (e1 * 6 + s1 * 4) / 10; } }
  if (s2 >= 0 && s2 <= 2000) { if (e2 < 0) { e2 = s2; } else { int d2 = s2 - e2; if (d2 < 0) d2 = -d2; if (d2 <= 400) e2 = (e2 * 6 + s2 * 4) / 10; } }
  int c0 = e0; if (c0 < 0) c0 = 9999;
  int c1 = e1; if (c1 < 0) c1 = 9999;
  int c2 = e2; if (c2 < 0) c2 = 9999;
  if (c1 < 250) RC_drive(FORWARD, 120); else if (c1 < 600) RC_drive(FORWARD, 230); else RC_drive(FORWARD, 240);
  if (c1 < 350) { if (c0 > c2) RC_steer(LEFT); else RC_steer(RIGHT); }
  else if (c2 < 180) RC_steer(LEFT);
  else if (c0 < 180) RC_steer(RIGHT);
  else RC_steer(CENTER);
}`;
  const runField = (carMul, seed) => {
    resetNoise(); SENSOR_NOISE.on = true; SENSOR_NOISE.carSigmaMul = carMul;   // 他は実機相当既定 (σ8/2%, dropout3%)。
    seedRand(seed);
    const course = buildFromSpec({ name: 'オーバル6', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
    const slots = makeFleet(Array(6).fill(RESID), 'c', course);
    const progress = Array(6).fill(0);
    const traj = [];
    const steps = Math.round(45 * SIM.loopHz);
    for (let k = 0; k < steps; k++) {
      stepFleet(slots, course.walls, true, true, progress);
      if (k % 20 === 0) for (const s of slots) traj.push(Math.round(s.car.x * 1e4), Math.round(s.car.y * 1e4));
    }
    restoreRand();
    const running = slots.filter(s => s.running).length;
    return { progress, traj, running };
  };
  const a = runField(1.0, 616161);   // carTarget 中立
  const b = runField(3.0, 616161);   // carTarget 発火 (同一シード)
  // (a) carTarget 発火の証明: carSigmaMul だけを変えて他は同一シード → 軌跡が相違 = 車エッジ標的読が実際に発生し σ が効いた。
  const trajDiff = a.traj.length === b.traj.length && a.traj.some((v, i) => v !== b.traj[i]);
  chk(trajDiff, `carSigmaMul 1.0↔3.0 で 6 台混走の軌跡が相違 = carTarget が発火 (車エッジ標的読が発生)`);
  // (b) 機能: 全 6 台が例外で停止せず前進 (各車の累積走行距離 > 0.5m = コース上で意味のある移動)。
  const advanced = b.progress.filter(d => d > 0.5).length;
  chk(b.running === 6, `carTarget ON で 6 台とも runtime 例外なし (running=${b.running}/6)`);
  chk(advanced === 6, `carTarget ON で 6 台とも前進 (走行距離>0.5m: ${advanced}/6 台, 最小 ${Math.min(...b.progress).toFixed(2)}m)`);
}

// ── 復元 ──
Object.assign(SENSOR_NOISE, { on: SAV.on, sigmaBaseMm: SAV.sb, sigmaFrac: SAV.sf, dropout: SAV.dr, outlier: SAV.ol, outlierMinMm: SAV.om, dropoutFar: SAV.df, carSigmaMul: SAV.cm });
restoreRand();

console.log(`\n${fail === 0 ? '✅ AP19 全受け入れ基準 PASS' : `❌ AP19 ${fail} 件 FAIL`}`);
process.exit(fail === 0 ? 0 : 1);
