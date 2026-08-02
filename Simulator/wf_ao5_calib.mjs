// wf_ao5_calib.mjs — Stage AO5 受け入れゲート (リポジトリ追跡・本番フロー/実オラクル / CI-8/9/14)。
// ════════════════════════════════════════════════════════════════════════════
// AO5「fullscale 較正＋applyRegime 統合＋v2 既定化＋性能予算」を AO_spec §11/§12 AO5 の受け入れへ
// 「知覚→測定の翻訳」で連続量マージンの機械検査に落とす。**再実装せず 実 CarV2.step/applyRegime/
// applyRegimeV2/runRace/engineFingerprint・診断オラクル (_latCapSS 摩擦円容量) を呼ぶ**。
//   A 較正インフラ: applyRegimeV2 が V2 の定出力ドライブトレインを領域別に書く・**DYN(=DynCar/AN 基盤) 無改変**・
//                    tabletop/midscale v2 は駆動 0 (CAR.accel 律速)。
//   B §11 最高速: 6車種 fullscale v2 の直進終端 ∈ [300,360] km/h。
//   C ローンチ: normal/drift とも発進で後軸が hook-up (κ<0.15) = AO-3 の全面空転 (κ=3 クランプ) を解消。
//   D §11 定常横G: 摩擦円横容量 _latCapSS/g が低速 ∈[1.3,1.5]・高速(DF込) ≥1.8。
//   E 進入則 v=√(μgR): 全舵 R_kin で 1.0×=維持(βmax<10°) / 1.15×=喪失(βmax>12°) を機械判別。
//   F US/OS 創発: power-on Δβ で FF=中立(|Δβ|小)・FR=OS(Δβ<0)・drift_fr=強OS、FR は FF より OS 側。
//   G §11 制動: AWD(両軸)∈[32,45]m・かつ v2 は現行 DynCar より全車短い (改善=退行でない)。
//   H spec.physics: f0/f1 canonical byte 不変 (dynamic=canon にキー無)・v2 決定論・v2≠dynamic・mode 復元。
//   I engineFingerprint.physicsMode を持つ (版照合メタ)。
//   J 性能予算: 6台×60s fullscale v2 ヘッドレスが実時間の ≥10倍速。
// いずれか失敗で非ゼロ終了。canonical f0/f1・AO1〜4 等は別ゲートで別途緑 (v2 は guarded branch)。
// ════════════════════════════════════════════════════════════════════════════
import { CarV2, V2, applyRegimeV2 } from './public/js/physics_v2.js';
import { DynCar, DYN, applyRegime } from './public/js/physics_dyn.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace, engineFingerprint } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { CAR, CONST, PHYSICS, setPhysicsMode } from './public/js/config.js';
import { FROZEN } from './wf_frozen.mjs';   // AP3: 凍結値は中央マニフェスト経由

let pass = 0, fail = 0, skipped = 0; const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }
const DT = 1 / 60, g = 9.81;
function mk(type, regime = 'fullscale') { applyRegime(regime); const c = new CarV2({ x: 0, y: 0, theta: 0, grip: 1, downhill: 0 }); c.type = type; return c; }
const beta = (c) => Math.atan2(c.vlat, Math.abs(c.u)) * 180 / Math.PI;
function toSpeed(c, U) { c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER; let n = 0; while (c.u < U && n < 5000) { c.step(DT); n++; } }
const NORMALS = ['normal_ff', 'normal_fr', 'normal_awd'];

// ── A. 較正インフラ (applyRegimeV2 / V2 vs DYN 分離) ─────────────────────────────
{
  applyRegime('fullscale');
  ok(V2.launchAccel === 7.0 && V2.wheelPower === 455, `A: fullscale v2 駆動較正 launchAccel=${V2.launchAccel}/wheelPower=${V2.wheelPower}`);
  ok(DYN.launchAccel === 15 && DYN.wheelPower === 547, `A: DYN(DynCar/AN 基盤) 無改変 launchAccel=${DYN.launchAccel}/wheelPower=${DYN.wheelPower}`);
  applyRegime('tabletop');
  ok(V2.launchAccel === 0 && V2.wheelPower === 0, `A: tabletop v2 は駆動 0 (CAR.accel 律速・卓上 dynamic 同型)`);
  applyRegime('midscale');
  ok(V2.launchAccel === 0 && V2.wheelPower === 0, `A: midscale v2 は駆動 0 (.v2 未定義フォールバック)`);
  // applyRegime のフックで applyRegimeV2 が自動同期する (単一 choke point)
  applyRegime('fullscale');
  ok(V2.launchAccel === 7.0, `A: applyRegime フックで applyRegimeV2 自動同期 (V2.launchAccel=${V2.launchAccel})`);
}

// ── B. §11 最高速 [300,360] km/h ────────────────────────────────────────────────
{
  let allIn = true; const rep = [];
  for (const t of [...NORMALS, 'drift_fr', 'drift_awd']) {
    const c = mk(t); c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER;
    for (let i = 0; i < 9000; i++) c.step(DT);
    const kmh = c.u * 3.6; rep.push(`${t}=${kmh.toFixed(0)}`); if (kmh < 300 || kmh > 360) allIn = false;
  }
  ok(allIn, `B: 最高速 全車 ∈[300,360]km/h (${rep.join(' ')})`);
}

// ── C. ローンチ hook-up (κ<0.15・AO-3 の κ=3 全面空転を解消) ──────────────────────
{
  let allHook = true; const rep = [];
  for (const t of ['normal_fr', 'normal_awd', 'drift_fr']) {
    const c = mk(t); c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER;
    let kMax = 0, hooked = false;
    for (let i = 0; i < 90; i++) {
      c.step(DT); const vcx = Math.max(Math.abs(c.u), 0.5);
      const kR = Math.max(Math.abs(c._vw[2] - c.u), Math.abs(c._vw[3] - c.u)) / vcx;
      kMax = Math.max(kMax, kR); if (i > 3 && kR < 0.15) hooked = true;
    }
    rep.push(`${t}:κ=${kMax.toFixed(2)}${hooked ? '✓' : '✗'}`); if (!hooked || kMax > 1.0) allHook = false;
  }
  ok(allHook, `C: ローンチ後軸 hook-up (κ<0.15 到達・非空転暴走) (${rep.join(' ')})`);
}

// ── D. §11 定常横G = 摩擦円横容量 _latCapSS/g (直進 DF 込) ──────────────────────
{
  let lowOk = true, hiOk = true; const rep = [];
  for (const t of ['normal_fr', 'normal_awd']) {
    const cl = mk(t); cl.driveDir = CONST.FREE; cl.steer = CONST.CENTER;
    for (let i = 0; i < 5; i++) { cl.u = 5; cl.vlat = 0; cl.r = 0; cl.step(DT); }
    const low = cl._latCapSS / g;
    const ch = mk(t); ch.driveDir = CONST.FREE; ch.steer = CONST.CENTER;
    for (let i = 0; i < 5; i++) { ch.u = 90; ch.vlat = 0; ch.r = 0; ch.step(DT); }
    const hi = ch._latCapSS / g;
    rep.push(`${t}:低${low.toFixed(2)}/高${hi.toFixed(2)}`);
    if (low < 1.3 || low > 1.5) lowOk = false; if (hi < 1.8) hiOk = false;
  }
  ok(lowOk, `D: 低速 定常横G容量 ∈[1.3,1.5]g (${rep.join(' ')})`);
  ok(hiOk, `D: 高速(DF込) 定常横G容量 ≥1.8g`);
}

// ── E. 進入則 v=√(μgR)・1.0×維持 / 1.15×喪失 (全舵 R_kin) ────────────────────────
{
  applyRegime('fullscale');
  const L = CAR.wheelBase, Rkin = L / Math.tan(CAR.maxSteer);
  for (const t of ['normal_fr', 'normal_awd']) {
    let muG = 0;
    for (let U = 6; U <= 16; U += 0.5) {
      const c = mk(t); toSpeed(c, U); c.driveDir = CONST.FREE; c.steer = CONST.LEFT;
      let mx = 0, spun = false; for (let i = 0; i < 90; i++) { c.step(DT); mx = Math.max(mx, Math.abs(c.u * c.r)); if (Math.abs(beta(c)) > 35) spun = true; }
      if (!spun) muG = Math.max(muG, mx);
    }
    const vCrit = Math.sqrt(muG * Rkin);
    const enter = (vmul) => {
      const vT = vCrit * vmul; const c = mk(t); toSpeed(c, vT); c.steer = CONST.LEFT;
      let bMax = 0;
      for (let i = 0; i < 150; i++) { c.driveDir = (c.u < vT) ? CONST.FORWARD : CONST.FREE; c.pwm = (c.u < vT) ? 50 : 0; c.step(DT); if (i > 45) bMax = Math.max(bMax, Math.abs(beta(c))); }
      return bMax;
    };
    const bLo = enter(1.0), bHi = enter(1.15);
    ok(bLo < 10, `E: ${t} 1.0×v_crit 維持 (βmax=${bLo.toFixed(1)}°<10°)`);
    ok(bHi > 12, `E: ${t} 1.15×v_crit グリップ喪失 (βmax=${bHi.toFixed(1)}°>12°)`);
  }
}

// ── F. US/OS 創発 (power-on Δβ: FF 中立 / FR OS / drift 強OS・FR>FF の OS 側) ─────
{
  const holdTurn = (c) => { c.driveDir = CONST.FORWARD; c.pwm = 45; c.steer = CONST.LEFT; for (let i = 0; i < 300; i++) c.step(DT); };
  const dOn = {};
  for (const t of ['normal_ff', 'normal_fr', 'drift_fr']) {
    const cb = mk(t); toSpeed(cb, 7); holdTurn(cb); const bBase = beta(cb);
    const cp = mk(t); toSpeed(cp, 7); holdTurn(cp); cp.pwm = 255; for (let i = 0; i < 45; i++) cp.step(DT);
    dOn[t] = beta(cp) - bBase;
  }
  ok(Math.abs(dOn.normal_ff) < 5, `F: FF power-on 中立/US (|Δβ|=${Math.abs(dOn.normal_ff).toFixed(1)}°<5°)`);
  ok(dOn.normal_fr < -4, `F: FR power-on オーバーステア (Δβ=${dOn.normal_fr.toFixed(1)}°<-4°=リア外)`);
  ok(dOn.drift_fr < -20, `F: drift_fr power-on 強パワーオーバー (Δβ=${dOn.drift_fr.toFixed(1)}°<-20°)`);
  ok(dOn.normal_fr < dOn.normal_ff, `F: FR は FF より OS 側 (${dOn.normal_fr.toFixed(1)}° < ${dOn.normal_ff.toFixed(1)}°)`);
}

// ── G. §11 制動: AWD(両軸)∈[32,45]m・v2 は DynCar より全車短い (改善) ──────────────
{
  function brakeDist(Ctor, t) {
    applyRegime('fullscale'); const c = new Ctor({ x: 0, y: 0, theta: 0, grip: 1, downhill: 0 }); c.type = t;
    c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER;
    let n0 = 0; while (c.u < 27.78 && n0 < 6000) { c.step(DT); n0++; }
    const x0 = c.x; c.driveDir = CONST.BRAKE; c.pwm = 0;
    let n = 0; while (c.u > 0.05 && n < 4000) { c.step(DT); n++; } return c.x - x0;
  }
  const awdV2 = brakeDist(CarV2, 'normal_awd');
  ok(awdV2 >= 32 && awdV2 <= 45, `G: AWD(両軸) 制動 ∈[32,45]m (${awdV2.toFixed(1)}m)`);
  let improved = true; const rep = [];
  for (const t of NORMALS) { const v2 = brakeDist(CarV2, t), dyn = brakeDist(DynCar, t); rep.push(`${t}:v2 ${v2.toFixed(0)}<dyn ${dyn.toFixed(0)}`); if (!(v2 < dyn)) improved = false; }
  ok(improved, `G: v2 制動は現行 DynCar より全車短い=改善 (${rep.join(' ')})`);
}

// ── H. spec.physics: f0/f1 canonical byte 不変・v2 決定論/≠dynamic・mode 復元 ─────
{
  applyRegime('tabletop');   // canonical f0/f1 は tabletop 既定スケールで定義 (regime 未指定 runRace は現在の global 幾何を使う=bench と同じ前提)
  const prog = (key) => { const p = PROGRAMS.find((x) => x.key === key); return { src: p.code, lang: 'c', carType: p.carType }; };
  const fieldOf = (...keys) => keys.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType, rear: false, encoder: false }; });
  const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
  const f0 = runRace({ report: true, course: oval, laps: 3, field: fieldOf('normal_fr', 'normal_awd', 'normal_ff'), crashRule: { rejoin: false, penaltySec: 3 } });
  const f1 = runRace({ report: true, course: oval, laps: 2, field: fieldOf('normal_ff', 'normal_fr'), crashRule: { rejoin: true, penaltySec: 3 } });
  ok(f0.verifyHash === FROZEN.f0, `H: f0 canonical byte 不変 (verify=${f0.verifyHash}=${FROZEN.f0})`);
  ok(f1.verifyHash === FROZEN.f1, `H: f1 canonical byte 不変 (verify=${f1.verifyHash}=${FROZEN.f1})`);
  const specV = { course: oval, laps: 2, field: fieldOf('normal_fr', 'normal_ff'), crashRule: { rejoin: false, penaltySec: 3 } };
  const v2a = runRace({ ...specV, physics: 'v2' });
  const v2b = runRace({ ...specV, physics: 'v2' });
  const dyn = runRace({ ...specV });
  ok(v2a.verifyHash === v2b.verifyHash, `H: spec.physics='v2' 決定論 (${v2a.verifyHash} ×2)`);
  ok(v2a.verifyHash !== dyn.verifyHash, `H: v2 ≠ dynamic (別軌跡=別ハッシュ ${v2a.verifyHash}≠${dyn.verifyHash})`);
  ok(PHYSICS.mode === 'dynamic', `H: runRace 後 PHYSICS.mode 復元 (=${PHYSICS.mode})`);
}

// ── I. engineFingerprint.physicsMode ────────────────────────────────────────────
{
  const fp = engineFingerprint();
  ok('physicsMode' in fp && ['standard', 'dynamic', 'v2'].includes(fp.physicsMode), `I: engineFingerprint.physicsMode=${fp.physicsMode}`);
}

// ── J. 性能予算: 6台×60s fullscale v2 ヘッドレス ≥10倍速 ────────────────────────
// AP21: J は唯一の壁時計 (process.hrtime) アサート＝負荷ホストで非決定論に落ちうる。
// WF_SKIP_TIMING=1 のとき J のみをスキップし (pass/fail いずれにも計上しない)、標準ランナー
// wf_run_all の timing 隔離モードで安定緑を得られるようにする (A〜I の決定論検査は不変)。
if (process.env.WF_SKIP_TIMING === '1') {
  skipped++;
  console.log('  ⤿ J: 性能予算(壁時計 ≥10×) を WF_SKIP_TIMING=1 によりスキップ (timing 隔離・AP21)');
} else {
  const courses = (await import('./public/data/courses.json', { with: { type: 'json' } })).default;
  const spec = courses.find(c => /競技サーキット/.test(c.name)) || courses.find(c => /競技グラウンド/.test(c.name));
  const course = buildFromSpec(spec);
  const prog = (k) => { const p = PROGRAMS.find(x => x.key === k); return { src: p.code, lang: p.lang || 'c', carType: p.carType }; };
  const keys = ['comp_circuit', 'comp_estimate', 'recon_racer', 'comp_circuit', 'comp_estimate', 'recon_racer'];
  const field = keys.map((k, i) => { const p = prog(k); return { name: 'C' + i, lang: p.lang, src: p.src, carType: p.carType, rear: false, encoder: true }; });
  const t0 = process.hrtime.bigint();
  const r = runRace({ course, regime: 'fullscale', laps: 40, field, physics: 'v2', crashRule: { rejoin: true, penaltySec: 3 }, interact: true, maxSec: 60 });
  const wall = Number(process.hrtime.bigint() - t0) / 1e9; const ratio = r.simSec / wall;
  ok(ratio >= 10, `J: 6台×60s fullscale v2 = ${ratio.toFixed(1)}× 実時間 (≥10× / wall=${wall.toFixed(2)}s)`);
}

applyRegime('tabletop');   // 復元

// ── 結果 ─────────────────────────────────────────────────────────────────────
const line = '─'.repeat(66);
console.log(line);
console.log('Stage AO5 ゲート  (fullscale 較正＋applyRegimeV2＋v2 既定化＋性能予算)');
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}${skipped ? ` / SKIP ${skipped} (WF_SKIP_TIMING)` : ''}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
