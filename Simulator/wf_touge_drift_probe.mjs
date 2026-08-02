// wf_touge_drift_probe.mjs — 将来の「峠ドリフト」Stage 用に保存する実測プローブ (2026-07-05 利用者指示「ペンディング・将来用に保存」・PROGRESS AO-17/AO-18)。
// 発端=利用者質問「タイト連続・180°ヘアピン・オーバースピード進入でドリフト優位は出ないか」の実測プローブ。
// wf_ao8_gonogo.mjs (常設ゲート・無改変) のドライバを複製し 3 点を拡張:
//   ① 回頭角 90° → {90°, 180°} (ヘアピン折返し=回頭需要2倍でドリフトの「素早い回頭」が償却されるか)
//   ② drift 進入倍率 {1.15, 1.4}×v_grip (「限界以上で侵入」の度合いを掃引)
//   ③ 総合時間 = セクター通過 + 出口直線 20m 走破 (出口速度の価値を機械的に算入=「総合的に高速で抜ける」)
// 判定・車・路面・タイヤ・積分は AO8 と同一 (実 buildFromSpec / CarV2.step)。使い捨てスクラッチ。
import { buildFromSpec } from './public/js/course.js';
import { CarV2, tireParamsFor } from './public/js/physics_v2.js';
import { CAR, CONST, setPhysicsMode } from './public/js/config.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { readFileSync } from 'fs';

const DT = 1 / 60, deg = 180 / Math.PI;
const beta = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

setPhysicsMode('v2');
applyRegime('fullscale');
const Tn = tireParamsFor('normal');
const Rmin = CAR.wheelBase / Math.tan(CAR.maxSteer);
const benches = JSON.parse(readFileSync('./docs/stage_ao/bench_courses.json', 'utf8'));

const SPIN_LIM = 115, REGRIP_BETA = 35, TIMEOUT = 1800, DRIFT_BETA = 35, EXIT_RUN_M = 20;

function toSpeed(car, U) {
  car.steer = CONST.CENTER; car.driveDir = CONST.FORWARD; car.pwm = 255;
  for (let i = 0; i < 8000 && car.u < U; i++) car.step(DT);
}
function holdSpeed(car, U) {
  const e = U - car.u;
  if (e > 0.15) { car.driveDir = CONST.FORWARD; car.pwm = Math.min(255, 30 + e * 25); }
  else if (e < -0.4) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
  else { car.driveDir = CONST.FORWARD; car.pwm = 22; }
}

// AO8 runCorner + ①角度パラメータ化 ②進入基底パラメータ化 ③出口 20m 直線走破の総合時間。
function runCorner(course, R, drive, strat, entryMul, headGate, driftEntryBase) {
  const car = new CarV2({ ...course.start, x: 0, y: 0, theta: 0 });
  car.type = (drive === 'fr') ? 'normal_fr' : 'normal_awd';
  car.tireSet = 'normal';
  const muEff = Tn.mu0 * (car.grip || 1);
  const vgrip = Math.sqrt(muEff * DYN.g * R);
  const vEntry = (strat === 'grip' ? 0.9 : driftEntryBase) * vgrip * entryMul;
  toSpeed(car, vEntry);

  let head = 0, prevTheta = car.theta, betaPk = 0, spun = false, done = false, steps = 0;
  let brakePulse = (strat === 'drift' && drive === 'fr') ? 9 : 0;
  let gSteer = CONST.CENTER;
  for (let i = 0; i < TIMEOUT; i++) {
    if (strat === 'grip') {
      const rStar = car.u / R;
      if (car.r < rStar * 0.98) gSteer = CONST.LEFT;
      else if (car.r > rStar * 1.02) gSteer = CONST.CENTER;
      car.steer = gSteer;
      holdSpeed(car, vEntry);
    } else {
      // drift = 回転フェーズ (β≈35°保持) → 回収フェーズ (catch): 残り回頭に比例して β目標を 35→0 へ絞り、
      // カウンター(逆ハン)＋スロットル調整で後輪の摩擦円を横グリップへ返す (利用者指摘の「ハンドルと
      // 駆動輪でグリップ復活させる回転制御」)。出口で車体・速度ベクトル・グリップが揃った状態を作る。
      const b = beta(car);
      const remaining = headGate - head;
      // 予見的回収: 実ドライバー同様「ヨーレート×先行時間」で catch 開始を決める (角度残でなく
      // ヨー角運動量基準)。現ヨーレートのまま先行時間 T_LEAD 走ると目標を超える、が合図。
      const T_LEAD = 0.9;                            // カウンターが効き始めるまでの先行時間 (s)
      const catchNow = remaining < Math.max(Math.abs(car.r), 0.5) * T_LEAD;
      if (brakePulse > 0) { car.steer = CONST.LEFT; car.driveDir = CONST.BRAKE; car.pwm = 0; brakePulse--; }
      else if (catchNow) {
        const bTgt = Math.max(0, Math.min(DRIFT_BETA, 60 * remaining));   // 残回頭に応じ β目標を絞る
        if (b > bTgt + 4) { car.steer = CONST.RIGHT; car.driveDir = CONST.FORWARD; car.pwm = 30; }   // 強カウンター+スロットル抜き=後輪グリップ回復
        else if (b < bTgt - 4) { car.steer = CONST.LEFT; car.driveDir = CONST.FORWARD; car.pwm = 200; }
        else { car.steer = CONST.CENTER; car.driveDir = CONST.FORWARD; car.pwm = 140; }
      }
      else if (b > DRIFT_BETA) { car.steer = CONST.RIGHT; car.driveDir = CONST.FORWARD; car.pwm = 255; }  // counter中も全開=uを補給(ラリーAWD技法)
      else { car.steer = CONST.LEFT; car.driveDir = CONST.FORWARD; car.pwm = 255; }
    }
    car.step(DT); steps++;
    head += wrap(car.theta - prevTheta); prevTheta = car.theta;
    const b = Math.abs(beta(car)); if (b > betaPk) betaPk = b;
    if (b > SPIN_LIM) { spun = true; break; }
    if (head >= headGate) { done = true; break; }
  }
  const tGate = steps * DT, exitU = car.u;

  // ③ 出口: そのまま新ヘディング方向へ全開直線 20m。ドリフト車は再グリップ回復も物理任せ
  //   (滑っている間は加速が乗らない=出口速度の価値/回復コストが総合時間に自動算入)。
  let tTotal = null, exitSpun = false;
  if (done && !spun) {
    const x0 = car.x, y0 = car.y, hx = Math.cos(car.theta), hy = Math.sin(car.theta);
    let k = 0;
    for (; k < TIMEOUT; k++) {
      // 出口も棒立ちの全開でなく安定化制御 (残β があればカウンター+スロットル調整で収束させてから全開)
      const be = beta(car);
      if (be > 15) { car.steer = CONST.RIGHT; car.driveDir = CONST.FORWARD; car.pwm = 80; }
      else if (be < -15) { car.steer = CONST.LEFT; car.driveDir = CONST.FORWARD; car.pwm = 80; }
      else { car.steer = CONST.CENTER; car.driveDir = CONST.FORWARD; car.pwm = 255; }
      car.step(DT);
      if (Math.abs(beta(car)) > SPIN_LIM) { exitSpun = true; break; }
      const s = (car.x - x0) * hx + (car.y - y0) * hy;
      if (s >= EXIT_RUN_M) break;
    }
    if (!exitSpun && k < TIMEOUT) tTotal = tGate + (k + 1) * DT;
  }
  const clean = done && !spun && !exitSpun && tTotal != null;
  return { tGate, tTotal, exitU, betaPk, spun: spun || exitSpun, clean, vgrip, vEntry };
}

function evalStrat(course, R, drive, strat, headGate, driftEntryBase) {
  const runs = [0.9, 1.0, 1.1].map(m => runCorner(course, R, drive, strat, m, headGate, driftEntryBase));
  const cleanRuns = runs.filter(r => r.clean);
  return {
    tBest: cleanRuns.length ? Math.min(...cleanRuns.map(r => r.tTotal)) : null,
    tGateBest: cleanRuns.length ? Math.min(...cleanRuns.map(r => r.tGate)) : null,
    cleanN: cleanRuns.length,
    betaPk: Math.max(...runs.map(r => r.betaPk)),
    exitU: runs[1].exitU, vgrip: runs[1].vgrip,
  };
}

console.log(`R_min=${Rmin.toFixed(3)}m  総合時間=セクター+出口直線${EXIT_RUN_M}m  (drift は進入基底 1.15/1.40 の良い方)`);
console.log(`corner        surf drive ang | grip: tGate tTot exitU cln | drift: tGate tTot exitU bpk base cln | ratio(tot) 判定`);
for (const cn of [{ key: 'hairpin-R5', R: 5 }, { key: 'hairpin-R6.5', R: 6.5 }, { key: 'hairpin-R8', R: 8 }]) {
  for (const sf of [{ key: 'dry', suffix: '-dry' }, { key: 'low', suffix: '-low' }]) {
    const spec = benches.find(b => b.name === `bench-${cn.key}${sf.suffix}`);
    const course = buildFromSpec(spec);
    for (const drive of ['fr', 'awd']) {
      for (const ang of [90, 180]) {
        const hg = ang * Math.PI / 180;
        const g = evalStrat(course, cn.R, drive, 'grip', hg, null);
        // drift: 進入基底 1.15 と 1.40 を両方試し、clean 最良を採る (「限界以上で侵入」掃引)
        const d115 = evalStrat(course, cn.R, drive, 'drift', hg, 1.15);
        const d140 = evalStrat(course, cn.R, drive, 'drift', hg, 1.40);
        const d = (d140.tBest != null && (d115.tBest == null || d140.tBest < d115.tBest)) ? { ...d140, base: '1.40' } : { ...d115, base: '1.15' };
        const ratio = (d.tBest != null && g.tBest != null) ? d.tBest / g.tBest : null;
        const verdict = (ratio != null && ratio <= 0.98 && d.cleanN === 3) ? 'GO' : 'NO-GO';
        const f = (v, w = 5) => v != null ? v.toFixed(2).padStart(w) : ' DNF '.padStart(w);
        console.log(`${cn.key.padEnd(13)} ${sf.key}  ${drive.padEnd(3)} ${String(ang).padStart(3)} | ${f(g.tGateBest)} ${f(g.tBest)} ${g.exitU.toFixed(1).padStart(5)} ${g.cleanN}/3 | ${f(d.tGateBest)} ${f(d.tBest)} ${d.exitU.toFixed(1).padStart(5)} ${String(Math.round(d.betaPk)).padStart(3)} ${d.base} ${d.cleanN}/3 | ${ratio != null ? ratio.toFixed(2).padStart(6) : '   -- '} ${verdict}`);
      }
    }
  }
}
