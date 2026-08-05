// wf_as12_steer.mjs — Stage AS12「連続舵角の任意装備＋ドリフト保持 go/no-go 再実測」常設ゲート
// =============================================================================
// 実装を再実装せず **本番の buildApi / buildController / CarV2.step / runRace / race_engine canon** を呼ぶ。
//
//  A: 学習 API の後方互換と装備ゲート (C/Python/JS の本番インタプリタ経由)
//  B: 既定 (3値) の byte 不変 — steerTargetOf の恒等・255=全舵の bit 一致・canon/share の非追加
//  C: 舵の保持精度の **法則** — 3値のリップルは steerRate/指令レート に比例、連続舵は API の
//     1/255 量子化のみ (指令レート非依存・領域不変)。比で検査するので実装式を写し取らない。
//  D: AO8 20 セルの **3アーム再実測** (A=AO8 原ドライバ / B=符号是正した比例則を3値へ理想デューティ
//     量子化 / C=同一則を連続舵)。GO 述語・clean 述語・進入速度・ゲートは AO8 から一切変えない。
//     ＋ AO8 原ドライバのカウンター分岐が **一度も発火しない** ことの機械固定 (実装欠陥の記録)。
//  E: 律速の切り分け — サーボ角速度 steerRate を掃引しても連続舵の保持時間は動かない。
//     真の障壁は車両の **回復境界** (中立 0.6s で |β|<35° へ戻れる上限) である。
//  F: 本番 runRace — 未装備で連続舵プログラムを走らせると完走できない (沈黙しない=ログが出る)、
//     装備すると完走する、決定論 2 回一致、canon 刻印は非既定のときだけ。
//  G: 3エンジン共通 (standard/dynamic/v2) — 既定は3つとも旧経路と同一軌跡、装備すると3つとも効く。
// =============================================================================
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { buildApi } from './public/js/api.js';
import { buildController } from './public/js/runner.js';
import { Car } from './public/js/physics.js';
import { DynCar, applyRegime, DYN } from './public/js/physics_dyn.js';
import { CarV2, tireParamsFor } from './public/js/physics_v2.js';
import { CAR, CONST, APP_VERSION, setPhysicsMode, steerTargetOf, STEER_SETS, STEER_DEFAULT } from './public/js/config.js';
import { SHARE_FIELDS, encodeState } from './public/js/share.js';
import { normSteer } from './public/js/fleet.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const DT = 1 / 60, deg = 180 / Math.PI;
const beta = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const benches = JSON.parse(readFileSync('./docs/stage_ao/bench_courses.json', 'utf8'));

// ============================================================================
console.log('\n=== A: 学習 API の後方互換と装備ゲート (本番 buildApi / buildController) ===');
// D-1 (AO_spec §0) は「操舵3値」を学習 API 表面の不変条件と定める。連続舵はその上に載る **任意装備**
// であって置換ではない ⇒ ①1引数呼びは装備の有無に関わらず従来どおり ②未装備で2引数を渡したら
// 失敗 (0) を返し指令を一切変えない ③黙って無視せず最初の1回だけログへ理由を出す。
{
  const mk = () => {
    const car = new Car({ x: 0, y: 0, theta: 0 });
    const logs = [];
    const world = { car, walls: [], log: (m) => logs.push(String(m)), _sensors: [], _others: [], _sensGen: 0, _simMs: 0 };
    return { car, world, env: buildApi(world), logs };
  };
  // A1: 未装備 (既定) — 1引数は従来どおり / 2引数は失敗して指令不変
  {
    const { car, env, logs } = mk();
    ok(env.RC_steer(CONST.LEFT) === 1 && car.steer === CONST.LEFT && car.steerAmt === null, 'A1 未装備 1引数 RC_steer(LEFT)=1・steerAmt=null (従来どおり)');
    const before = car.steer;
    ok(env.RC_steer(CONST.RIGHT, 128) === 0, 'A1 未装備 2引数は 0 (失敗) を返す');
    ok(car.steer === before && car.steerAmt === null, 'A1 未装備 2引数は舵指令を一切変えない (サイレント全舵にならない)');
    ok(logs.length === 1 && /RC_steer/.test(logs[0]), 'A1 未装備 2引数は理由をログへ出す (沈黙截断の禁止)');
    env.RC_steer(CONST.RIGHT, 200); env.RC_steer(CONST.LEFT, 10);
    ok(logs.length === 1, 'A1 ログは one-shot (20Hz でログが溢れない)');
    ok(env.RC_steer(99) === 0 && env.RC_steer(99, 100) === 0, 'A1 不正方向は引数の数によらず 0');
  }
  // A2: 装備あり — 0..255 が フル舵への比・clamp・1引数で3値へ復帰
  {
    const { car, world, env } = mk(); world.steerSet = 'prop'; car.steerSet = 'prop';
    ok(env.RC_steer(CONST.RIGHT, 128) === 1 && car.steer === CONST.RIGHT && car.steerAmt === 128, 'A2 装備 2引数 RC_steer(RIGHT,128)=1・steerAmt=128');
    env.RC_steer(CONST.LEFT, 300); ok(car.steerAmt === 255, 'A2 装備 clamp 上 300→255 (RC_drive の pwm と同じ clampPwm)');
    env.RC_steer(CONST.LEFT, -5); ok(car.steerAmt === 0, 'A2 装備 clamp 下 −5→0');
    env.RC_steer(CONST.LEFT, 128);
    ok(env.RC_steer(CONST.LEFT) === 1 && car.steerAmt === null, 'A2 装備でも 1引数呼びは steerAmt=null へ戻す (3値へ復帰=指令が残らない)');
  }
  // A3: 本番インタプリタ経由 (C / Python / JS)。引数不足が undefined で届くことを実測で固定する。
  const CASES = [
    ['C', 'c', 'void setup(){} void loop(){ RC_steer(LEFT); }', 'void setup(){} void loop(){ RC_steer(LEFT, 128); }', CONST.LEFT, 128],
    ['Python', 'py', 'def setup():\n  pass\ndef loop():\n  rc_steer(RIGHT)\n', 'def setup():\n  pass\ndef loop():\n  rc_steer(RIGHT, 60)\n', CONST.RIGHT, 60],
    ['JS', 'js', 'function setup(){} function loop(){ RC_steer(CENTER); }', 'function setup(){} function loop(){ RC_steer(CENTER, 255); }', CONST.CENTER, 255],
  ];
  for (const [label, lang, src1, src2, dir, amt] of CASES) {
    { const { car, env } = mk(); const c = buildController(src1, lang, env); c.setup(); c.tick();
      ok(car.steerAmt === null && car.steer === dir, `A3 ${label} 1引数呼び → steer=指定・steerAmt=null (既存21プログラムの非退行)`); }
    { const { car, world, env } = mk(); world.steerSet = 'prop'; car.steerSet = 'prop';
      const c = buildController(src2, lang, env); c.setup(); c.tick();
      ok(car.steerAmt === amt && car.steer === dir, `A3 ${label} 2引数呼び(装備あり) → steerAmt=${amt}`); }
    { const { car, env, logs } = mk(); const c = buildController(src2, lang, env); c.setup(); c.tick();
      ok(car.steerAmt === null && car.steer === CONST.CENTER && logs.length === 1, `A3 ${label} 2引数呼び(未装備) → 指令不変＋ログ1件`); }
  }
}

// ============================================================================
console.log('\n=== B: 既定 (3値) の byte 不変 ===');
{
  // B1: steerTargetOf の恒等 — 既定 tri は旧式 (steer===LEFT?mx:steer===RIGHT?-mx:0) と同一 double。
  const mx = CAR.maxSteer;
  const old = (s) => (s === CONST.LEFT ? mx : s === CONST.RIGHT ? -mx : 0);
  let bad = 0, n = 0;
  for (const s of [CONST.LEFT, CONST.CENTER, CONST.RIGHT, 99]) for (const amt of [null, 0, 1, 128, 254, 255]) {
    n++; if (!Object.is(steerTargetOf(s, mx, 'tri', amt), old(s))) bad++;
    n++; if (!Object.is(steerTargetOf(s, mx, 'prop', null), old(s))) bad++;   // 装備しても指令が3値なら同一
  }
  ok(bad === 0, `B1 既定 tri (と prop×amt=null) は旧式と同一 double: ${n - bad}/${n}`);
  // B2: 255 = フル舵の bit 一致 (255/255 は IEEE754 で厳密 1.0・mx*1 は厳密恒等)
  ok(Object.is(steerTargetOf(CONST.LEFT, mx, 'prop', 255), mx) && Object.is(steerTargetOf(CONST.RIGHT, mx, 'prop', 255), -mx),
     'B2 連続舵 amt=255 は3値の全舵と bit 一致 (255/255=1.0 厳密・mx×1 厳密恒等)');
  ok(steerTargetOf(CONST.LEFT, mx, 'prop', 0) === 0, 'B2 連続舵 amt=0 は中立');
  // B2b: 検出力 — 量子化を 1 段ずらすと必ず落ちる (この検査が「何も検査していない」ことの排除)
  ok(steerTargetOf(CONST.LEFT, mx, 'prop', 254) !== mx, 'B2 検出力: amt=254 は全舵と一致しない (量子化が効いている)');
  // B3: 正規化 — 白リスト外/未指定は既定へ (UI・共有 URL・レース field が同じ規則を通る)
  ok(normSteer('prop') === 'prop' && normSteer('tri') === 'tri' && normSteer('nope') === STEER_DEFAULT
     && normSteer(undefined) === STEER_DEFAULT && normSteer(null) === STEER_DEFAULT, 'B3 normSteer: 白リスト外・未指定は既定 tri へ');
  ok(STEER_SETS.length === 2 && STEER_DEFAULT === 'tri', 'B3 STEER_SETS=[tri,prop]・既定 tri');
  // B4: 共有 URL — 既定は載らない (既存 URL byte 不変)・非既定は往復
  const legacy = { course: 'Oval', car: 'normal_fr', program: 'comp_circuit', regime: 'fullscale', laps: 5, noise: false, theme: 'dark', lang: 'ja' };
  ok(!encodeState(legacy).includes('ss='), 'B4 steerSet 省略時は ss= を出さない (既存共有 URL byte 不変)');
  ok(encodeState({ steerSet: 'prop' }).includes('ss=prop'), 'B4 非既定 steerSet=prop は ss=prop で載る');
  ok(SHARE_FIELDS.some(f => f.name === 'steerSet' && f.k === 'ss'), 'B4 SHARE_FIELDS に steerSet/ss が単一ソースとして在る');
}

// ============================================================================
console.log('\n=== C: 舵の保持精度の法則 (3値=steerRate/指令レートに比例 / 連続舵=1/255 量子化のみ) ===');
// 本番 CarV2.step のサーボを鳴らして「フル舵の 35% を保ちたい」を各指令レートで実行し、保持誤差を測る。
// 3値は目標角の上下へ steerRate·dt ずつ流れるので **リップルが指令間隔に比例**し、連続舵は目標角を
// 直接置けるので **残るのは API の 1/255 量子化だけ** (指令レートにも領域にも依らない)。
function holdErr(regime, prop, hz, frac = 0.35) {
  applyRegime(regime); setPhysicsMode('v2');
  const car = new CarV2({ x: 0, y: 0, theta: 0, grip: 1 });
  car.type = 'normal_awd'; car.tireSet = 'normal'; car.steerSet = prop ? 'prop' : 'tri';
  car.driveDir = CONST.FORWARD; car.pwm = 255;
  const cruise = CAR.maxSpeed * 0.4;
  for (let i = 0; i < 20000 && car.u < cruise; i++) { car.steer = CONST.CENTER; car.steerAmt = null; car.step(DT); }
  const per = Math.max(1, Math.round(60 / hz)), tgt = frac * CAR.maxSteer;
  const errs = [];
  for (let i = 0; i < 600; i++) {
    if (i % per === 0) {
      if (prop) { car.steer = CONST.LEFT; car.steerAmt = Math.round(frac * 255); }
      else { car.steer = (car.steerAngle < tgt) ? CONST.LEFT : CONST.RIGHT; car.steerAmt = null; }
    }
    car.step(DT);
    if (i > 180) errs.push(Math.abs(car.steerAngle - tgt) * deg);
  }
  return { avg: errs.reduce((a, b) => a + b, 0) / errs.length, max: Math.max(...errs) };
}
{
  for (const regime of ['tabletop', 'fullscale']) {
    applyRegime(regime);
    const bound = CAR.steerRate * deg;   // 1秒あたりに動ける角度。指令間隔ぶんが 3値のリップル上界
    const t60 = holdErr(regime, false, 60), t20 = holdErr(regime, false, 20);
    const p60 = holdErr(regime, true, 60), p20 = holdErr(regime, true, 20);
    // C1: 3値のリップルは指令間隔に比例 (上界 = steerRate/指令レート)
    ok(t60.max <= bound / 60 * 1.001 && t20.max <= bound / 20 * 1.001,
       `C1 ${regime}: 3値の保持誤差は steerRate/指令レート を超えない (60Hz ${t60.max.toFixed(3)}≤${(bound / 60).toFixed(3)}° / 20Hz ${t20.max.toFixed(3)}≤${(bound / 20).toFixed(3)}°)`);
    ok(t20.avg > t60.avg * 1.2, `C1 ${regime}: 指令が遅いほど 3値の誤差は大きい (60Hz ${t60.avg.toFixed(3)}° → 20Hz ${t20.avg.toFixed(3)}°)`);
    // C2: 連続舵の残差は API の 1/255 量子化そのもの (指令レート非依存)
    const q = Math.abs(Math.round(0.35 * 255) / 255 - 0.35) * CAR.maxSteer * deg;
    ok(Math.abs(p60.max - q) < 1e-9 && Math.abs(p20.max - q) < 1e-9,
       `C2 ${regime}: 連続舵の保持誤差 = API の 1/255 量子化 ${q.toFixed(4)}° (実測 60Hz ${p60.max.toFixed(4)} / 20Hz ${p20.max.toFixed(4)}・指令レート非依存)`);
    // C3: 学習プログラムの実利用 (20Hz) で何倍になるか (連続量で記録)
    const gain = t20.avg / p20.avg;
    ok(gain > 10, `C3 ${regime}: 20Hz (学習プログラムの実レート) での改善は ×${gain.toFixed(1)} (3値 ${t20.avg.toFixed(3)}° → 連続 ${p20.avg.toFixed(4)}°)`);
  }
  // C4: 検出力 — 装備を tri のままにすると C2 は必ず落ちる (=この検査は何かを検査している)
  const sham = holdErr('fullscale', false, 20);
  const q = Math.abs(Math.round(0.35 * 255) / 255 - 0.35) * CAR.maxSteer * deg;
  ok(Math.abs(sham.max - q) > 1, `C4 検出力: 装備を外すと C2 の等式は崩れる (${sham.max.toFixed(3)}° ≠ ${q.toFixed(4)}°)`);
}

// ============================================================================
console.log('\n=== D: AO8 20セル ドリフト go/no-go の 3アーム再実測 ===');
setPhysicsMode('v2'); applyRegime('fullscale');
const Tn = tireParamsFor('normal');
// ---- AO8 と同一の定数・述語 (一切変えない = CI-7) ----
const HEAD_GATE = Math.PI / 2, SPIN_LIM = 115, REGRIP_BETA = 35, EXIT_STEPS = 36, TIMEOUT = 900, DRIFT_BETA = 35;
const GAINS = { kpG: 0.45, kpD: 0.05, kdD: 0.002 };   // grip: ヨーレート P / drift: 正規化 P・D
function toSpeed(car, U) { car.steer = CONST.CENTER; car.steerAmt = null; car.driveDir = CONST.FORWARD; car.pwm = 255;
  for (let i = 0; i < 8000 && car.u < U; i++) car.step(DT); }
function holdSpeed(car, U) { const e = U - car.u;
  if (e > 0.15) { car.driveDir = CONST.FORWARD; car.pwm = Math.min(255, 30 + e * 25); }
  else if (e < -0.4) { car.driveDir = CONST.BRAKE; car.pwm = 0; } else { car.driveDir = CONST.FORWARD; car.pwm = 22; } }
// 舵の出し方 (アームで違うのはここだけ)。norm∈[-1,1] = フル舵への比 (+=LEFT)。
function applySteer(car, arm, norm, mx) {
  if (arm === 'C') { car.steer = norm >= 0 ? CONST.LEFT : CONST.RIGHT; car.steerAmt = Math.round(Math.min(1, Math.abs(norm)) * 255); }
  else { const tgt = Math.max(-1, Math.min(1, norm)) * mx; car.steer = (car.steerAngle < tgt) ? CONST.LEFT : CONST.RIGHT; car.steerAmt = null; }
}
let counterFire = 0, counterTick = 0;   // AO8 原ドライバのカウンター分岐の発火回数 (実装欠陥の機械固定)
function runCorner(course, R, drive, strat, entryMul, arm) {
  const car = new CarV2({ ...course.start, x: 0, y: 0, theta: 0 });
  car.type = (drive === 'fr') ? 'normal_fr' : 'normal_awd';
  car.tireSet = 'normal'; car.steerSet = (arm === 'C') ? 'prop' : 'tri';
  const mx = CAR.maxSteer;
  const vgrip = Math.sqrt(Tn.mu0 * (car.grip || 1) * DYN.g * R);
  const vEntry = (strat === 'grip' ? 0.9 : 1.15) * vgrip * entryMul;
  toSpeed(car, vEntry);
  let head = 0, prevTheta = car.theta, betaPk = 0, spun = false, done = false, steps = 0;
  let brake = (strat === 'drift' && drive === 'fr') ? 9 : 0, gSteer = CONST.CENTER, prevSl = -beta(car);
  for (let i = 0; i < TIMEOUT; i++) {
    if (arm === 'A') {                                  // AO8 原ドライバ (改変なし)
      if (strat === 'grip') {
        const rStar = car.u / R;
        if (car.r < rStar * 0.98) gSteer = CONST.LEFT; else if (car.r > rStar * 1.02) gSteer = CONST.CENTER;
        car.steer = gSteer; car.steerAmt = null; holdSpeed(car, vEntry);
      } else {
        const b = beta(car); counterTick++;
        if (brake > 0) { car.steer = CONST.LEFT; car.steerAmt = null; car.driveDir = CONST.BRAKE; car.pwm = 0; brake--; }
        else if (b > DRIFT_BETA) { car.steer = CONST.RIGHT; car.steerAmt = null; car.driveDir = CONST.FORWARD; car.pwm = 110; counterFire++; }
        else { car.steer = CONST.LEFT; car.steerAmt = null; car.driveDir = CONST.FORWARD; car.pwm = 255; }
      }
    } else {                                            // B/C: 同一の比例則。違いは舵の出し方だけ
      let want;
      if (strat === 'grip') { want = CAR.wheelBase / R + GAINS.kpG * (car.u / R - car.r); holdSpeed(car, vEntry); }
      else {
        // 左旋回のドリフトでは β が **負** へ振れる (実測 −77°)。滑り量 sl=−β で符号を正す。
        const sl = -beta(car), sld = (sl - prevSl) / DT;
        if (brake > 0) { want = mx; car.driveDir = CONST.BRAKE; car.pwm = 0; brake--; }
        else { want = (GAINS.kpD * (DRIFT_BETA - sl) - GAINS.kdD * sld) * mx;
               car.driveDir = CONST.FORWARD; car.pwm = (sl > DRIFT_BETA) ? 110 : 255; }
      }
      applySteer(car, arm, Math.max(-1, Math.min(1, want / mx)), mx);
    }
    prevSl = -beta(car);
    car.step(DT); steps++;
    head += wrap(car.theta - prevTheta); prevTheta = car.theta;
    const b = Math.abs(beta(car)); if (b > betaPk) betaPk = b;
    if (b > SPIN_LIM) { spun = true; break; }
    if (head >= HEAD_GATE) { done = true; break; }
  }
  const tGate = steps * DT, exitU = car.u;
  let regripped = false;
  if (done && !spun) for (let k = 0; k < EXIT_STEPS; k++) {
    car.steer = CONST.CENTER; car.steerAmt = null; holdSpeed(car, vgrip); car.step(DT);
    if (Math.abs(beta(car)) < REGRIP_BETA) { regripped = true; break; }
  }
  return { t: tGate, betaPk, clean: done && !spun && regripped && exitU >= 0.4 * vEntry, spun };
}
function evalStrat(course, R, drive, strat, arm) {
  const runs = [0.9, 1.0, 1.1].map(m => runCorner(course, R, drive, strat, m, arm));
  const cl = runs.filter(r => r.clean);
  return { tBest: cl.length ? Math.min(...cl.map(r => r.t)) : null, cleanAll: cl.length === 3, cleanN: cl.length,
           betaPk: Math.max(...runs.map(r => r.betaPk)), spunAny: runs.some(r => r.spun) };
}
const CORNERS = [['hairpin-R5', 5], ['hairpin-R6.5', 6.5], ['hairpin-R8', 8], ['mid-R50', 50], ['high-R120', 120]];
const SURFS = [['dry', '-dry'], ['low', '-low']];
export function goTable(arm) {
  const out = [];
  for (const [ck, R] of CORNERS) for (const [sk, sfx] of SURFS) {
    const course = buildFromSpec(benches.find(b => b.name === `bench-${ck}${sfx}`));
    for (const drive of ['fr', 'awd']) {
      // grip 最良は「その車で実際に使える制御則すべて」の最良。装備車でも 3値 API は使えるので
      // AO8 の3値 grip も候補に入る ⇒ GO はより **厳しく** なる (基準の緩和ではなく強化)。
      const cands = [evalStrat(course, R, drive, 'grip', 'A')];
      if (arm !== 'A') cands.push(evalStrat(course, R, drive, 'grip', arm));
      const gt = cands.map(x => x.tBest).filter(x => x != null);
      const gBest = gt.length ? Math.min(...gt) : null;
      const d = evalStrat(course, R, drive, 'drift', arm);
      out.push({ corner: ck, surf: sk, drive, gBest, gCleanN: Math.max(...cands.map(x => x.cleanN)), d,
                 GO: (d.tBest != null && gBest != null && d.tBest <= 0.98 * gBest && d.cleanAll && !d.spunAny) });
    }
  }
  return out;
}
const TABLES = {};
for (const arm of ['A', 'B', 'C']) TABLES[arm] = goTable(arm);
{
  for (const arm of ['A', 'B', 'C']) {
    const T = TABLES[arm], go = T.filter(r => r.GO).length;
    ok(T.length === 20, `D1 arm ${arm}: 20 セルの表が出る (AO_spec §10.1 の受け入れ「表が出ること」)`);
    ok(go === 0, `D1 arm ${arm}: GO=${go}/20`);
  }
  // D2: AO8 原ドライバのカウンター分岐は **一度も発火しない** (実装欠陥の機械固定)。
  //     左旋回のドリフトで β は負へ振れるのに、判定は `β > +35` (正側) を見ている。
  ok(counterFire === 0 && counterTick > 3000,
     `D2 AO8 原 drift ドライバのカウンター分岐 (β>+35) は ${counterFire}/${counterTick} tick = **一度も発火しない** (符号の取り違え・逆ハンは実行されていなかった)`);
  // D3: β の符号 — 通常旋回は正・ドリフトは負。D2 の機序そのもの。
  {
    const c = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R8-dry'));
    const car = new CarV2({ ...c.start, x: 0, y: 0, theta: 0 }); car.type = 'normal_fr'; car.tireSet = 'normal';
    toSpeed(car, 8);
    for (let i = 0; i < 120; i++) { car.steer = CONST.LEFT; car.steerAmt = null; holdSpeed(car, 8); car.step(DT); }
    const bTurn = beta(car);
    const c2 = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R8-low'));
    const car2 = new CarV2({ ...c2.start, x: 0, y: 0, theta: 0 }); car2.type = 'normal_fr'; car2.tireSet = 'normal';
    toSpeed(car2, 1.15 * Math.sqrt(Tn.mu0 * (car2.grip || 1) * DYN.g * 8));
    let bMin = 0;
    for (let i = 0; i < 120; i++) {
      if (i < 9) { car2.steer = CONST.LEFT; car2.driveDir = CONST.BRAKE; car2.pwm = 0; }
      else { car2.steer = CONST.LEFT; car2.driveDir = CONST.FORWARD; car2.pwm = 255; }
      car2.steerAmt = null; car2.step(DT); if (beta(car2) < bMin) bMin = beta(car2);
    }
    ok(bTurn > 0 && bMin < -30, `D3 β の符号: 通常の左旋回は正 (+${bTurn.toFixed(2)}°) だがドリフトは負 (${bMin.toFixed(1)}°) ⇒ AO8 の \`β>+35\` は原理的に発火しない`);
  }
  // D4: 「3値が唯一の障壁」の直接検定 — 符号を正した同一則で 3値(B) と 連続舵(C) を比べる。
  //     アクチュエータだけが違うのに GO は両方 0 ⇒ 仮説は反証される。
  const bGO = TABLES.B.filter(r => r.GO).length, cGO = TABLES.C.filter(r => r.GO).length;
  ok(bGO === 0 && cGO === 0, `D4 「3値が唯一の障壁」の反証: 同一則で 3値 GO=${bGO}/20・連続舵 GO=${cGO}/20 = **連続舵にしても GO は復活しない**`);
  // D5: 仮説が名指しした「低μヘアピンの drift 回頭」は速いままである (回頭は速い・clean にならない)。
  const named = TABLES.C.filter(r => r.surf === 'low' && r.drive === 'fr' && r.corner.startsWith('hairpin'));
  ok(named.length === 3 && named.every(r => !r.GO && r.d.cleanN === 0),
     `D5 仮説が名指しした低μヘアピン FR 3セルは連続舵でも clean 0/3 (βpk ${named.map(r => r.d.betaPk.toFixed(0)).join('/')}°)`);
}

// ============================================================================
console.log('\n=== E: 律速の切り分け (分解能か・帯域か・車両か) ===');
{
  // E1: サーボ角速度 steerRate を掃引しても **連続舵の** ドリフト保持時間は動かない。
  //     連続舵は分解能を既に無限にしているので、ここで動くのは帯域だけ。動かない ⇒ 律速は舵ではない。
  const base = CAR.steerRate;
  function holdSec(prop, rate) {
    CAR.steerRate = rate;
    const course = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R8-low'));
    const car = new CarV2({ ...course.start, x: 0, y: 0, theta: 0 });
    car.type = 'normal_fr'; car.tireSet = 'normal'; car.steerSet = prop ? 'prop' : 'tri';
    const vg = Math.sqrt(Tn.mu0 * (car.grip || 1) * DYN.g * 8);
    toSpeed(car, 1.15 * vg);
    let brake = 9, prevSl = -beta(car), run = 0, best = 0;
    for (let i = 0; i < 360; i++) {
      const sl = -beta(car), sld = (sl - prevSl) / DT;
      let want;
      if (brake > 0) { want = CAR.maxSteer; car.driveDir = CONST.BRAKE; car.pwm = 0; brake--; }
      else { want = (GAINS.kpD * (DRIFT_BETA - sl) - GAINS.kdD * sld) * CAR.maxSteer;
             car.driveDir = CONST.FORWARD; car.pwm = (sl > DRIFT_BETA) ? 110 : 255; }
      applySteer(car, prop ? 'C' : 'B', Math.max(-1, Math.min(1, want / CAR.maxSteer)), CAR.maxSteer);
      prevSl = sl; car.step(DT);
      const s2 = Math.abs(beta(car)); if (s2 > 115) break;
      if (Math.abs(s2 - DRIFT_BETA) <= 10) { run += DT; if (run > best) best = run; } else run = 0;
    }
    return best;
  }
  const rates = [1, 2, 4, 8, 16, 64];
  const held = rates.map(r => holdSec(true, r));
  CAR.steerRate = base;
  const spread = Math.max(...held) - Math.min(...held);
  ok(spread <= 0.05, `E1 サーボ角速度を ${rates[0]}→${rates[rates.length - 1]} rad/s (${rates.length}点・全舵↔逆全舵 ${(2 * CAR.maxSteer / rates[0]).toFixed(3)}→${(2 * CAR.maxSteer / 64).toFixed(3)}s) と 64 倍にしても連続舵のドリフト保持は ${held.map(h => h.toFixed(2)).join('/')}s = 振れ ${spread.toFixed(3)}s ⇒ **律速は舵ではない**`);
  // E2: 真の障壁 = 車両の回復境界。実軌道の各時点から「中立 0.6s で |β|<35° へ戻れるか」を測る。
  //     AO8 の clean 述語 (exitU ≥ 0.4×vEntry) が、スピンして止まった車の見かけの回復を既に除外している。
  const course = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R8-low'));
  const vg = Math.sqrt(Tn.mu0 * DYN.g * 8 * 0.6);
  let lastOK = null, firstNG = null;
  for (let k = 6; k <= 90; k += 6) {
    const car = new CarV2({ ...course.start, x: 0, y: 0, theta: 0 });
    car.type = 'normal_fr'; car.tireSet = 'normal'; car.steerSet = 'prop';
    const vgr = Math.sqrt(Tn.mu0 * (car.grip || 1) * DYN.g * 8);
    toSpeed(car, 1.15 * vgr);
    let brake = 9, prevSl = -beta(car);
    for (let i = 0; i < k; i++) {
      const sl = -beta(car), sld = (sl - prevSl) / DT;
      let want;
      if (brake > 0) { want = CAR.maxSteer; car.driveDir = CONST.BRAKE; car.pwm = 0; brake--; }
      else { want = (GAINS.kpD * (DRIFT_BETA - sl) - GAINS.kdD * sld) * CAR.maxSteer;
             car.driveDir = CONST.FORWARD; car.pwm = (sl > DRIFT_BETA) ? 110 : 255; }
      applySteer(car, 'C', Math.max(-1, Math.min(1, want / CAR.maxSteer)), CAR.maxSteer);
      prevSl = sl; car.step(DT);
    }
    const b0 = Math.abs(beta(car)), u0 = car.u;
    let rec = false;
    for (let j = 0; j < EXIT_STEPS; j++) { car.steer = CONST.CENTER; car.steerAmt = null; holdSpeed(car, vgr); car.step(DT);
      if (Math.abs(beta(car)) < REGRIP_BETA) { rec = true; break; } }
    if (u0 > 0.4 * 1.15 * vgr) { if (rec) lastOK = b0; else if (firstNG == null) firstNG = b0; }
  }
  ok(lastOK != null && firstNG != null && lastOK < firstNG && firstNG < 45,
     `E2 回復境界: 中立 0.6s で戻れた最後の |β|=${lastOK != null ? lastOK.toFixed(1) : '—'}° / 初めて戻れない |β|=${firstNG != null ? firstNG.toFixed(1) : '—'}° ⇒ ドリフトの動作点 (βtarget ${DRIFT_BETA}°) が境界の上に乗っている`);
}

// ============================================================================
console.log('\n=== F: 本番 runRace (実データ・本番フロー) ===');
{
  const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  // 同一の制御則。舵の出し方だけが違う (3値=不感帯つき bang-bang / 連続=比例)。
  const SRC = (prop) => `
int TOP=180;
void setup(){}
void loop(){
  int L=RC_read(LEFT), R=RC_read(RIGHT);
  if (L<0) L=30000; if (R<0) R=30000;
  int a = (L - R) / 3;
  if (a > 255) a = 255;
  if (a < -255) a = -255;
  ${prop ? 'if (a > 0) RC_steer(LEFT, a); else if (a < 0) RC_steer(RIGHT, -a); else RC_steer(CENTER);'
         : 'if (a > 40) RC_steer(LEFT); else if (a < -40) RC_steer(RIGHT); else RC_steer(CENTER);'}
  RC_drive(FORWARD, TOP);
}`;
  // **領域とエンジンを明示する** (章 D が applyRegime('fullscale')・setPhysicsMode('v2') を残しているので、
  //  省略すると卓上オーバルにフルスケールの車を出して全車 DNF になる = AS9 決定ログの「章間の領域漏れ」)。
  const race = (src, ss, extra = {}) => runRace({ course: oval, regime: 'tabletop', physics: 'dynamic',
    laps: 3, report: true, trace: true,
    field: [{ name: 'A', lang: 'c', src, carType: 'normal_awd', steerSet: ss }],
    crashRule: { rejoin: true, penaltySec: 3 }, interact: false, ...extra });
  const r3 = race(SRC(false), 'tri');
  const rP = race(SRC(true), 'prop');
  const rX = race(SRC(true), 'tri');       // 連続舵プログラム × 未装備
  ok(r3.finishers.length === 1, `F1 3値プログラム×3値装備は完走 (best ${r3.finishers[0] ? Math.round(r3.finishers[0].bestLapMs) : '-'}ms)`);
  ok(rP.finishers.length === 1, `F1 連続舵プログラム×連続装備は完走 (best ${rP.finishers[0] ? Math.round(rP.finishers[0].bestLapMs) : '-'}ms)`);
  ok(rX.finishers.length === 0, `F2 連続舵プログラム×**未装備** は完走できない (装備しないと効かない=DNF ${rX.dnf[0] && rX.dnf[0].reason})`);
  ok(rP.traceHash !== rX.traceHash, 'F2 装備の有無で軌跡が変わる (結果要約でなく実態=traceHash で測る・AS4 の教訓)');
  // F3: 決定論 — 同一 spec 2回で trace/verify 一致
  const rP2 = race(SRC(true), 'prop');
  ok(rP.traceHash === rP2.traceHash && rP.verifyHash === rP2.verifyHash, 'F3 連続舵つきレースは決定論 (2回で traceHash/verifyHash 一致)');
  // F4: canon 刻印 — 全車 tri なら末尾キーを付けない (既存全ハッシュ byte 不変)・prop が居ると刻む
  ok(r3.verifyHash !== rP.verifyHash, 'F4 装備条件は verifyHash の素へ刻まれる (W_spec §5: 連続舵の記録は3値と別ハッシュ)');
  const canon3 = race(SRC(false), 'tri', { report: false });
  ok(canon3.verifyHash === r3.verifyHash, 'F4 全車 tri (既定) は canon に steerSet キーを足さない = 既存記録 byte 不変');
}

// ============================================================================
console.log('\n=== G: 3エンジン共通 (standard / dynamic / v2) ===');
{
  // 操舵サーボは Car が持つ共通機構ゆえ tire/gear/susp (v2 専用) と違い 3 エンジンすべてで効く。
  const mkCar = (eng, prop) => {
    const s = { x: 0, y: 0, theta: 0, grip: 1 };
    const car = eng === 'v2' ? new CarV2(s) : eng === 'dynamic' ? new DynCar(s) : new Car(s);
    car.type = 'normal_awd'; car.steerSet = prop ? 'prop' : 'tri';
    return car;
  };
  applyRegime('tabletop');
  for (const eng of ['standard', 'dynamic', 'v2']) {
    // G1: 既定 (tri) は3値と厳密同一 — 連続舵の指令を出しても amt=null なら旧経路
    const a = mkCar(eng, false), b = mkCar(eng, true);
    a.steer = CONST.LEFT; a.steerAmt = null;
    b.steer = CONST.LEFT; b.steerAmt = null;
    ok(Object.is(a.steerTarget, b.steerTarget), `G1 ${eng}: 指令が3値なら装備の有無で目標舵角は同一 double`);
    // G2: 装備すると 3 エンジンとも効く (半舵が作れる)
    const c = mkCar(eng, true); c.steer = CONST.LEFT; c.steerAmt = 128;
    const d = mkCar(eng, false); d.steer = CONST.LEFT; d.steerAmt = 128;
    ok(c.steerTarget > 0 && c.steerTarget < a.steerTarget * 0.99, `G2 ${eng}: 装備すると中間舵角が作れる (${(c.steerTarget * deg).toFixed(2)}° < 全舵 ${(a.steerTarget * deg).toFixed(2)}°)`);
    ok(Object.is(d.steerTarget, a.steerTarget), `G2 ${eng}: **未装備**なら steerAmt が付いていても3値のまま (物理側でも装備を見る=多重防御)`);
    // G3: 実走で 3 エンジンとも軌跡が変わる
    const run = (prop) => { const car = mkCar(eng, prop); car.driveDir = CONST.FORWARD; car.pwm = 200;
      for (let i = 0; i < 300; i++) { car.steer = CONST.LEFT; car.steerAmt = prop ? 100 : null; car.step(DT); }
      return { x: car.x, y: car.y, th: car.theta }; };
    const p = run(true), q = run(false);
    ok(Math.hypot(p.x - q.x, p.y - q.y) > 1e-3, `G3 ${eng}: 実走で連続舵が効く (300 step 後の位置差 ${Math.hypot(p.x - q.x, p.y - q.y).toFixed(4)} m)`);
  }
}

// ============================================================================
if (process.argv.includes('--table')) {
  console.log('\n===TABLE===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, arms: TABLES,
    counterFire, counterTick }, null, 0));
}
console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
