// wf_ao8_gonogo.mjs — Stage AO8「路面μ属性(muDecay)＋ベンチコーナー＋ドリフト優位 go/no-go 実測」
// AO_spec §5・§10.1・§12 AO8。**再実装せず 実 buildFromSpec / CarV2.step / mfCoeffs を呼ぶ**。
//
//  Part A: muDecay 伝搬 + 既存41コース byte 不変 (JSON 往復)。
//  Part B: §10.1 ドリフト優位 go/no-go 実測 (物理レベル本表・自由空間 決定論スクリプトドライバ)。
//          コーナー {ヘアピン R5/6.5/8m・中速 R50m・高速 R120m} × 路面 {乾燥 grip1.0/muDecay0.75・
//          低μ grip0.6/muDecay0.92} × 戦略 {grip / drift} × 駆動 {fr, awd}。
//          述語: 90°回頭までのセクタータイム・出口速度・βピーク・spin(crash)・進入±10% 頑健。
//          GO = drift ≤0.98×grip 最良 ∧ crash0 ∧ 進入±10% 頑健。「表が出ること」が受け入れ (AO_spec §10.1)。
//
//  層別 (AO_spec §10.1「層別」): 本表=**物理レベル** (自由空間 CarV2.step・センサー非経由・直接指令)。
//  壁接触+センサー由来のプログラムレベルは AO11 で分離実測 (差の出所を特定可能に)。
//
//  出力: 機械アサート (伝搬/byte 不変/決定論) は緑/赤。go/no-go 表は JSON (--json) で吐き
//        docs/stage_ao/drift_gonogo.md へ整形転記する。

import { buildFromSpec } from './public/js/course.js';
import { CarV2, mfCoeffs, tireParamsFor } from './public/js/physics_v2.js';
import { CAR, CONST, setPhysicsMode, APP_VERSION } from './public/js/config.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { readFileSync } from 'fs';

const DT = 1 / 60;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const rad = Math.PI / 180, deg = 180 / Math.PI;
const beta = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;   // 横滑り角 (deg)
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// ── Part A: muDecay 伝搬 + byte 不変 ────────────────────────────────────────────
setPhysicsMode('v2');
applyRegime('fullscale');
const Tn = tireParamsFor('normal');
const Rmin = CAR.wheelBase / Math.tan(CAR.maxSteer);
console.log(`\n[A] muDecay 伝搬 + 既存41コース byte 不変 (JSON 往復)  (R_min=${Rmin.toFixed(3)}m)`);

const benches = JSON.parse(readFileSync('./docs/stage_ao/bench_courses.json', 'utf8'));
// A1: 伝搬 (buildFromSpec→course→start→car)
{
  const cLow = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R5-low'));
  ok(cLow.muDecay === 0.92 && cLow.start.muDecay === 0.92, `A1 course/start.muDecay=0.92 (実 ${cLow.muDecay}/${cLow.start.muDecay})`);
  const carLow = new CarV2({ ...cLow.start, x: 0, y: 0, theta: 0 });
  ok(carLow.muDecay === 0.92 && carLow.grip === 0.6, `A1 car.muDecay=0.92 grip=0.6 (実 ${carLow.muDecay}/${carLow.grip})`);
  const cDry = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R5-dry'));
  const carDry = new CarV2({ ...cDry.start, x: 0, y: 0, theta: 0 });
  ok(carDry.muDecay === 0.75, `A1 dry car.muDecay=0.75 (実 ${carDry.muDecay})`);
}
// A2: 省略時 null (タイヤ既定へフォールバック) — 既存コース由来の car は muDecay=null
{
  const cNo = buildFromSpec({ name: 'x', kind: 'track', shape: 'stadium', L: 40, rr: 8, width: 6, samples: 80 });
  ok(cNo.muDecay == null && cNo.start.muDecay == null, `A2 muDecay 未指定→course/start 非設定`);
  const carNo = new CarV2({ ...cNo.start, x: 0, y: 0, theta: 0 });
  ok(carNo.muDecay === null, `A2 car.muDecay=null (タイヤ既定使用)`);
}
// A3: muDecay が実タイヤ力を変える (mfCoeffs 経由・大スリップ σ=2 で g(σ) が有意差)
{
  const a = mfCoeffs(0.75), b = mfCoeffs(0.92);
  const g2dry = Math.sin(a.C * Math.atan(a.Bp * 2)), g2low = Math.sin(b.C * Math.atan(b.Bp * 2));
  ok(Math.abs(g2low - g2dry) > 0.02, `A3 muDecay が σ=2 の保持力を変える (dry g=${g2dry.toFixed(4)} < low g=${g2low.toFixed(4)})`);
  ok(g2low > g2dry, `A3 低μ路面(muDecay0.92)は滑らせても保持 (g(2) 大)`);
}
// A4: 既存コース（41 + AX3 派生 18 + AY2 舵角限界ベンチ 7 = 66）byte 不変 — 全 spec を build→JSON 往復→再 build が同一・muDecay キー未混入
{
  const existing = JSON.parse(readFileSync('./public/data/courses.json', 'utf8'));
  let leaked = 0, roundtripBad = 0;
  for (const s of existing) {
    const c1 = buildFromSpec(s);
    if (c1.muDecay != null || c1.start.muDecay != null) leaked++;
    const j = JSON.stringify(c1);
    const c2 = buildFromSpec(s);
    if (JSON.stringify(c2) !== j) roundtripBad++;
  }
  // AX3 (2026-09-07): 道幅比の派生峠 18 本を末尾へ追加（利用者裁定 H2）＝ 41 → 59。索引は末尾追加ゆえ既存 41 本は不変。
  // AY2 (2026-09-08): 舵角限界ベンチ 7 本を末尾へ追加（利用者裁定）＝ 59 → 66。**末尾追加なので既存 59 本の索引は不変**
  //   （このアサートが守っているのは「コースが黙って増減/入替されないこと」であって本数そのものではない。
  //    追加のたびに版付きで刻み直す＝AX3 と同型の運用）。
  ok(existing.length === 66, `A4 既存コース数=66 (実 ${existing.length}・AX3 で峠の派生 18 本、AY2 で舵角限界ベンチ 7 本を末尾追加)`);
  ok(leaked === 0, `A4 既存コースに muDecay 混入=0 (実 ${leaked})`);
  ok(roundtripBad === 0, `A4 buildFromSpec 決定論 (JSON 往復同一)=全一致 (不一致 ${roundtripBad})`);
}

// ── Part B: go/no-go ドライバ ───────────────────────────────────────────────────
// 直進で目標速度まで加速 (FORWARD pwm255)。theta=0 の +x 直線上。
function toSpeed(car, U) {
  car.steer = CONST.CENTER; car.driveDir = CONST.FORWARD; car.pwm = 255;
  for (let i = 0; i < 8000 && car.u < U; i++) car.step(DT);
}
// 速度ホールド (grip コーナーで vgrip 近傍を保つ・過剰トルクで power-over しない最小 throttle)。
function holdSpeed(car, U) {
  const e = U - car.u;
  if (e > 0.15) { car.driveDir = CONST.FORWARD; car.pwm = Math.min(255, 30 + e * 25); }
  else if (e < -0.4) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
  else { car.driveDir = CONST.FORWARD; car.pwm = 22; }
}
const HEAD_GATE = Math.PI / 2;   // セクター=90°回頭 (固定弧長ゲート on 意図 R 線 ≒ R·π/2)
const SPIN_LIM = 115;            // |β|>115° = 明白な制御喪失 (即 spin)
const REGRIP_BETA = 35;          // 出口で |β| がこの値まで戻れば「再グリップ成立」(§9.2 EXIT)
const EXIT_STEPS = 36;           // ゲート後 0.6s の出口再グリップ観測
const TIMEOUT = 900;             // 15s
const DRIFT_BETA = 35;           // ドリフト保持目標角 (これを超えたら逆ハン=カウンター)

// 1 コーナーを走らせて測る。strat='grip'|'drift'。
// grip = **半径フィードバック 3値ステア** (目標ヨーレート r*=u/R を bang-bang で追う=デューティ自然創発)
//        + 速度ホールド。R<R_min では全舵でも r* に届かず アンダーステア (Rreal→R_min)。
// drift = リア破り (FR:後軸ロックパルス／AWD:パワーオン)→ βtarget 周りの逆ハン bang-bang。
// clean = 90°到達 ∧ 出口で再グリップ (|β|<REGRIP_BETA) ∧ 出口速度 ≥0.4×進入 (=spin/停止でない)。
//         これで「90°回頭を速く回る spin/pirouette」を GO と誤認しない (CI-14: 回頭速度でなく制御を測る)。
function runCorner(course, R, drive, strat, entryMul) {
  const car = new CarV2({ ...course.start, x: 0, y: 0, theta: 0 });
  car.type = (drive === 'fr') ? 'normal_fr' : 'normal_awd';
  car.tireSet = 'normal';
  const muEff = Tn.mu0 * (car.grip || 1);
  const vgrip = Math.sqrt(muEff * DYN.g * R);
  // grip 進入=0.9×v_grip (3値ステアのチャタが摩擦限界を越えないマージン=実レーシングラインは限界の
  // ~90%)。drift 進入=1.15×v_grip (§10.1「1.1–1.3× 進入」)。±10% 頑健は各公称の周りで掃引。
  const vEntry = (strat === 'grip' ? 0.9 : 1.15) * vgrip * entryMul;
  toSpeed(car, vEntry);

  let head = 0, prevTheta = car.theta, betaPk = 0, Rreal = Infinity, spun = false, done = false, steps = 0;
  let brakePulse = (strat === 'drift' && drive === 'fr') ? 9 : 0;   // FR turn-in: 後軸ロックで リア破り (§9.2)
  let gSteer = CONST.CENTER;
  for (let i = 0; i < TIMEOUT; i++) {
    if (strat === 'grip') {
      // 半径 R を保つ 目標ヨーレート r*=u/R への bang-bang＋ヒステリシス (デッドバンド±2%=チャタ抑制で
      // 尻の軽い FR を限界で暴れさせない=デューティ自然創発)。進入マージン(0.9×限界)ゆえ βpk 小で radius≈R。
      // R<R_min では常時 LEFT=アンダーステア→R_min。
      const rStar = car.u / R;
      if (car.r < rStar * 0.98) gSteer = CONST.LEFT;
      else if (car.r > rStar * 1.02) gSteer = CONST.CENTER;
      car.steer = gSteer;
      holdSpeed(car, vEntry);                              // 進入速度 (0.9×v_grip) を保持
    } else {                                        // drift
      const b = beta(car);
      if (brakePulse > 0) { car.steer = CONST.LEFT; car.driveDir = CONST.BRAKE; car.pwm = 0; brakePulse--; }
      else if (b > DRIFT_BETA) { car.steer = CONST.RIGHT; car.driveDir = CONST.FORWARD; car.pwm = 110; }  // 逆ハン
      else { car.steer = CONST.LEFT; car.driveDir = CONST.FORWARD; car.pwm = 255; }                       // 全舵+パワーオン
    }
    car.step(DT); steps++;
    head += wrap(car.theta - prevTheta); prevTheta = car.theta;
    const b = Math.abs(beta(car)); if (b > betaPk) betaPk = b;
    if (Math.abs(car.r) > 1e-3) { const rr = Math.abs(car.u / car.r); if (rr < Rreal) Rreal = rr; }
    if (b > SPIN_LIM) { spun = true; break; }
    if (head >= HEAD_GATE) { done = true; break; }
  }
  const tGate = steps * DT, exitU = car.u;
  // 出口 再グリップ観測 (ステア中立+緩い駆動で 0.6s・|β| が戻るか)。
  let regripped = false;
  if (done && !spun) {
    for (let k = 0; k < EXIT_STEPS; k++) {
      car.steer = CONST.CENTER; holdSpeed(car, vgrip); car.step(DT);
      if (Math.abs(beta(car)) < REGRIP_BETA) { regripped = true; break; }
    }
  }
  const clean = done && !spun && regripped && exitU >= 0.4 * vEntry;
  return { t: tGate, exitU, betaPk, Rreal: isFinite(Rreal) ? Rreal : null, spun, done, clean, regripped, vgrip, vEntry };
}

// 進入 ±10% 頑健込みで戦略を評価。clean(90°到達∧再グリップ∧速度保持) のみ有効タイム。
function evalStrat(course, R, drive, strat) {
  const muls = [0.9, 1.0, 1.1];
  const runs = muls.map(m => runCorner(course, R, drive, strat, m));
  const cleanRuns = runs.filter(r => r.clean);
  const bestT = cleanRuns.length ? Math.min(...cleanRuns.map(r => r.t)) : null;
  return {
    tBest: bestT,
    cleanAll: cleanRuns.length === muls.length,   // 全 ±10% で clean (頑健)
    cleanN: cleanRuns.length,
    betaPk: Math.max(...runs.map(r => r.betaPk)),
    exitU: runs[1].exitU,
    spunAny: runs.some(r => r.spun),
    Rreal: runs[1].Rreal,
    vgrip: runs[1].vgrip,
  };
}

console.log(`\n[B] §10.1 ドリフト優位 go/no-go (物理レベル・自由空間 決定論ドライバ・90°セクター)`);
const CORNERS = [
  { key: 'hairpin-R5', R: 5 }, { key: 'hairpin-R6.5', R: 6.5 }, { key: 'hairpin-R8', R: 8 },
  { key: 'mid-R50', R: 50 }, { key: 'high-R120', R: 120 },
];
const SURFS = [
  { key: 'dry', suffix: '-dry', grip: 1.0, muDecay: 0.75 },
  { key: 'low', suffix: '-low', grip: 0.6, muDecay: 0.92 },
];
const table = [];
for (const cn of CORNERS) {
  for (const sf of SURFS) {
    const specName = `bench-${cn.key}${sf.suffix}`;
    const spec = benches.find(b => b.name === specName);
    if (!spec) { console.log('  (missing spec ' + specName + ')'); continue; }
    const course = buildFromSpec(spec);
    for (const drive of ['fr', 'awd']) {
      const g = evalStrat(course, cn.R, drive, 'grip');
      const d = evalStrat(course, cn.R, drive, 'drift');
      // GO = drift ≤0.98×grip 最良 ∧ drift crash0(全 ±10% clean) ∧ grip も有効タイムを持つ (AO_spec §10.1)。
      const gripT = g.tBest, driftT = d.tBest;
      const GO = (driftT != null && gripT != null && driftT <= 0.98 * gripT && d.cleanAll && !d.spunAny);
      const verdict = GO ? 'GO' : 'NO-GO';
      table.push({
        corner: cn.key, R: cn.R, surf: sf.key, drive,
        vgrip: +g.vgrip.toFixed(2),
        grip_t: gripT != null ? +gripT.toFixed(3) : null, grip_exit: +g.exitU.toFixed(1),
        grip_bpk: +g.betaPk.toFixed(0), grip_Rreal: g.Rreal != null ? +g.Rreal.toFixed(2) : null,
        grip_cleanN: g.cleanN, grip_spun: g.spunAny,
        drift_t: driftT != null ? +driftT.toFixed(3) : null, drift_exit: +d.exitU.toFixed(1),
        drift_bpk: +d.betaPk.toFixed(0), drift_cleanN: d.cleanN, drift_spun: d.spunAny,
        ratio: (driftT != null && gripT != null) ? +(driftT / gripT).toFixed(3) : null,
        verdict,
      });
    }
  }
}

// 決定論チェック: 同一セルを2回走らせて bit 一致
{
  const c = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R5-dry'));
  const r1 = runCorner(c, 5, 'fr', 'drift', 1.0), r2 = runCorner(c, 5, 'fr', 'drift', 1.0);
  ok(r1.t === r2.t && r1.exitU === r2.exitU && r1.betaPk === r2.betaPk, `B 決定論 (同一セル2回 bit 一致 t=${r1.t}/${r2.t})`);
}

// 人間可読表
console.log(`\n  corner        surf drive | v_grip | grip: t   exitU bpk Rreal cln | drift: t   exitU bpk cln | ratio verdict`);
for (const r of table) {
  const gt = r.grip_t != null ? r.grip_t.toFixed(2).padStart(5) : ' DNF ';
  const dt = r.drift_t != null ? r.drift_t.toFixed(2).padStart(5) : ' DNF ';
  console.log(`  ${r.corner.padEnd(13)} ${r.surf}  ${r.drive.padEnd(3)} | ${r.vgrip.toFixed(1).padStart(5)}  | ${gt} ${String(r.grip_exit).padStart(5)} ${String(r.grip_bpk).padStart(3)} ${String(r.grip_Rreal).padStart(5)} ${r.grip_cleanN}/3  | ${dt} ${String(r.drift_exit).padStart(5)} ${String(r.drift_bpk).padStart(3)} ${r.drift_cleanN}/3  | ${r.ratio != null ? r.ratio.toFixed(2) : ' -- '} ${r.verdict}`);
}
const goN = table.filter(r => r.verdict === 'GO').length;
console.log(`\n  GO=${goN} / ${table.length} セル`);

if (process.argv.includes('--json')) {
  console.log('===JSON===');
  // AP3: 版メタを付与 (drift_gonogo.md の版スタンプ行と対応・記録の時点性=AP-0)。
  console.log(JSON.stringify({ appVersion: APP_VERSION, Rmin, table, goN, total: table.length }, null, 0));
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
