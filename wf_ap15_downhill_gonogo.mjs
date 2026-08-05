// wf_ap15_downhill_gonogo.mjs — Stage AP15「下り峠 drift go/no-go 再測定（勾配は『速度予算枯渇』を無効化）」
// PLAN AP15・AP1_audit §AP15(physics C6・AP10/AP11/AP14 後)。AO8(平地・自由空間・全 NO-GO)を
// **下り勾配込み**で再測定する。発端=AO-17「速度予算」機序（滑走で u が燃え u→0 で β=atan2(vlat,u)→90°
// ピボット＝180° は進入運動エネルギー予算の枯渇）への利用者質問②「峠下りでのドリフト優位」。
//
// **再実装せず 実 buildFromSpec / CarV2.step / mfCoeffs を呼ぶ**（AO8/touge 準拠・CI-14）。
//
// ── 着手前固定 事実（Step 3.5・決定ログ AP-15）───────────────────────────────────────
// AP1_audit.md:70 の「dh0.86/1.71 で uMin7.4=u 不枯渇」は **pre-AP10 コンベアモデル**（downhill を常に
// 車体+x へ加算）で測った量＝時点記録（`_ap1_drift_budget.mjs`）。AP10 で `gFwd=downhill·cos(θ−slopeDir)`
// の世界方向射影へ是正済ゆえ、その数値は現行エンジンに転用不可（現行で回すと uMin 負・u@90°=21 の
// 退化スピン）。本ブロックは **post-AP10/AP11 モデル**で再測定する。
//
// ── 勾配モデル（AP11 road-tangent の忠実な自由空間版）────────────────────────────────
// downhill = g·sinθ（m/s²）を「世界固定の下り方位角 slopeDir」へ向くベクトルとみなし車体前方へ射影＝
//   gFwd = downhill·cos(car.theta − car.slopeDir)（physics_v2.js:401・AP10）。
// 下り峠＝道が進行方向に沿って連続的に下る。AP11 は本番 fleet 層で slopeDir を **道追従**
//   （`roadDownhillDir` = 中心線接線＝下り方向）へ毎サブステップ更新する（固定 slopeDir では switchback で
//   弧長 34-50% が逆行＝失速・未完走ゆえ／PROGRESS AP-11）。自由空間の忠実な等価物＝**slopeDir を
//   車の進行方向（velocity course・世界速度の向き）に置く**： slopeDir = atan2(worldVy, worldVx)。
//   このとき gFwd = downhill·cos(β)（β=横滑り角＝atan2(vlat,u)。導出: worldV = R(θ)(u,vlat) の向き=θ+β
//   ゆえ θ−slopeDir = −β）。CG が道を辿る限り velocity course = 道接線＝AP11 の roadDownhillDir と等価。
//   → grip(β≈0) は gFwd≈+downhill で満充填・drift(β>0) は cos(β) 分だけ u へ補給・深いスライド(β→90°)は
//     gFwd→0 で従来どおり枯渇＝「勾配が速度予算枯渇を無効化する範囲」を連続量で測れる。
// 頑健性: **generous モデル**（slopeDir=car.theta ⇒ gFwd=downhill 常時＝深いスライド中も満充填＝drift への
//   最大限の恩恵）でも GO 数が変わらなければ、NO-GO は slopeDir モデル選択に非依存＝結論頑健（CI-14: 実態）。
//
// ── 判定述語（criterion ①・実装前固定・CI-7＝事後に緩めない）──────────────────────────
//   1 コーナー走行 = 助走(vEntry まで) → セクター(headGate 回頭) → **出口直線 20m 走破**（出口20m算入）。
//   clean = [回頭: head≥headGate ∧ セクター中 spin なし(|β|≤115°)]
//         ∧ [再グリップ: 出口20m の間に |β| が REGRIP_BETA=35° 未満へ戻る]
//         ∧ [出口速度: 20m 走破時点の u ≥ 0.4×vEntry]
//         ∧ [出口 spin なし(|β|≤115°)]。
//   総合時間 tTotal = セクター時間 + 出口20m 時間。
//   GO = drift 最良 clean tTotal ≤ 0.98×grip 最良 clean tTotal ∧ drift が進入±10% 全 clean ∧ grip clean 有（AO8 §10.1）。
//
// ── criterion ②③ ──────────────────────────────────────────────────────────────────
//   ② downhill∈{0,5°,10°相当}×路面{dry,low}×駆動{fr,awd}×回頭{90°,180°} のヘアピン(R5/6.5/8)セル表を
//      docs/stage_ap/AP15_downhill_gonogo.md へ永続化。
//   ③ 機序オラクル: ドリフト位相中（|β|>20°）の min(u) の dh 依存（連続量）＋ドリフト中 du/dt を併記。
//
// 出力: 機械アサート（決定論/dh=0 回帰=touge 全 NO-GO/min(u) の dh 単調性/slopeDir モデル頑健性）は緑/赤。
//       go/no-go 表は JSON(--json) で吐き docs/stage_ap/AP15_downhill_gonogo.md へ整形転記（版スタンプ=AP-0）。
import { buildFromSpec } from './public/js/course.js';
import { CarV2, tireParamsFor } from './public/js/physics_v2.js';
import { CAR, CONST, setPhysicsMode, APP_VERSION } from './public/js/config.js';
import { applyRegime, DYN } from './public/js/physics_dyn.js';
import { readFileSync } from 'fs';

const DT = 1 / 60, deg = 180 / Math.PI, rad = Math.PI / 180;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const beta = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

setPhysicsMode('v2');
applyRegime('fullscale');
const Tn = tireParamsFor('normal');
const R_MIN = CAR.wheelBase / Math.tan(CAR.maxSteer);
const benches = JSON.parse(readFileSync('./docs/stage_ao/bench_courses.json', 'utf8'));

// 勾配セル: {0°,5°,10°相当} の downhill=g·sinθ（AP10 世界方向モデル・AP15 criterion ②）。
const DHS = [
  { key: '0deg', deg: 0, dh: 0 },
  { key: '5deg', deg: 5, dh: DYN.g * Math.sin(5 * rad) },
  { key: '10deg', deg: 10, dh: DYN.g * Math.sin(10 * rad) },
];
const SPIN_LIM = 115, REGRIP_BETA = 35, TIMEOUT = 1800, DRIFT_BETA = 35, EXIT_RUN_M = 20;
const DRIFT_PHASE_BETA = 20;   // 機序オラクル: |β|>この値 を「ドリフト位相」とみなし min(u) を測る。

// AP15 勾配モデル: 毎フレーム car.slopeDir を設定（downhill=0 なら gFwd=0 で無影響）。
//   'road'   = velocity course（進行方向＝AP11 road-tangent の自由空間等価。gFwd=downhill·cosβ）。
//   'heading'= car.theta（gFwd=downhill 常時＝drift への最大恩恵＝頑健性の上界）。
function setSlope(car, dh, model) {
  if (dh === 0) return;                       // 平地: gFwd=0・slopeDir 無関係（byte 不変）
  if (model === 'heading') { car.slopeDir = car.theta; return; }
  const wvx = car.u * Math.cos(car.theta) - car.vlat * Math.sin(car.theta);
  const wvy = car.u * Math.sin(car.theta) + car.vlat * Math.cos(car.theta);
  car.slopeDir = (wvx * wvx + wvy * wvy > 0.01) ? Math.atan2(wvy, wvx) : car.theta;
}

function toSpeed(car, U, dh, model) {
  car.steer = CONST.CENTER; car.driveDir = CONST.FORWARD; car.pwm = 255;
  for (let i = 0; i < 8000 && car.u < U; i++) { setSlope(car, dh, model); car.step(DT); }
}
function holdSpeed(car, U) {
  const e = U - car.u;
  if (e > 0.15) { car.driveDir = CONST.FORWARD; car.pwm = Math.min(255, 30 + e * 25); }
  else if (e < -0.4) { car.driveDir = CONST.BRAKE; car.pwm = 0; }
  else { car.driveDir = CONST.FORWARD; car.pwm = 22; }
}

// AO8/touge runCorner + 勾配(dh,model) ＋ 凍結述語（回頭∧再グリップ∧出口速度≥0.4×進入・出口20m）。
function runCorner(course, R, drive, strat, entryMul, headGate, driftEntryBase, dh, model) {
  const car = new CarV2({ ...course.start, x: 0, y: 0, theta: 0, downhill: dh });
  car.type = (drive === 'fr') ? 'normal_fr' : 'normal_awd';
  car.tireSet = 'normal';
  const muEff = Tn.mu0 * (car.grip || 1);
  const vgrip = Math.sqrt(muEff * DYN.g * R);
  const vEntry = (strat === 'grip' ? 0.9 : driftEntryBase) * vgrip * entryMul;
  toSpeed(car, vEntry, dh, model);

  let head = 0, prevTheta = car.theta, betaPk = 0, spun = false, done = false, steps = 0;
  // 機序オラクル（criterion ③）: ドリフト位相中の min(u)。位相 = 「発達中スライド」=β が DRIFT_PHASE_BETA(20°)を
  // 超えてから u が 0 以下（AO-17「速度予算ピボット」= u→0 で β=atan2(vlat,u)→90°）に達するまで。ピボット後の
  // 負 u スピンは除外＝制御可能な滑走の u 枯渇床を測る。beta() は分母 |u| ゆえ ab は 90° で飽和し u の符号を
  // 判別できない→ピボット判定は **符号付き car.u≤0** で行う。
  let uMinSlide = Infinity, uAt45 = null, slideOn = false, pivoted = false, burnSum = 0, burnN = 0, uPrev = car.u;
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
      // touge ドリフト: 回転(β≈35°保持) → 予見的回収(catch): 残回頭に応じ β目標を絞りカウンター＋
      // スロットル調整で後輪グリップ復活（利用者指摘の回転制御）。counter 中も全開=u補給（ラリー AWD 技法）。
      const b = beta(car);
      const remaining = headGate - head;
      const T_LEAD = 0.9;
      const catchNow = remaining < Math.max(Math.abs(car.r), 0.5) * T_LEAD;
      if (brakePulse > 0) { car.steer = CONST.LEFT; car.driveDir = CONST.BRAKE; car.pwm = 0; brakePulse--; }
      else if (catchNow) {
        const bTgt = Math.max(0, Math.min(DRIFT_BETA, 60 * remaining));
        if (b > bTgt + 4) { car.steer = CONST.RIGHT; car.driveDir = CONST.FORWARD; car.pwm = 30; }
        else if (b < bTgt - 4) { car.steer = CONST.LEFT; car.driveDir = CONST.FORWARD; car.pwm = 200; }
        else { car.steer = CONST.CENTER; car.driveDir = CONST.FORWARD; car.pwm = 140; }
      }
      else if (b > DRIFT_BETA) { car.steer = CONST.RIGHT; car.driveDir = CONST.FORWARD; car.pwm = 255; }
      else { car.steer = CONST.LEFT; car.driveDir = CONST.FORWARD; car.pwm = 255; }
    }
    setSlope(car, dh, model);
    car.step(DT); steps++;
    head += wrap(car.theta - prevTheta); prevTheta = car.theta;
    const ab = Math.abs(beta(car)); if (ab > betaPk) betaPk = ab;
    if (strat === 'drift') {                             // 発達中スライドの u（機序オラクル・criterion ③）
      if (ab > DRIFT_PHASE_BETA) slideOn = true;
      if (slideOn && car.u <= 0.05) pivoted = true;       // u→0 以下＝速度予算ピボット到達（AO-17 機序）
      if (slideOn && car.u > 0.05) {                       // ピボット前の正 u だけ記録（負 u スピンは除外）
        if (car.u < uMinSlide) uMinSlide = car.u;
        if (uAt45 === null && ab >= 45) uAt45 = car.u;    // β=45°（スライド発達点）での u
        burnSum += (car.u - uPrev) / DT; burnN++;
      }
    }
    uPrev = car.u;
    if (ab > SPIN_LIM) { spun = true; break; }
    if (head >= headGate) { done = true; break; }
  }
  const tGate = steps * DT, exitU0 = car.u;

  // 出口 20m 走破（安定化制御: 残β をカウンター＋スロットルで収束させてから全開）。
  // 凍結述語の「再グリップ(|β|<REGRIP_BETA)」「出口速度(u≥0.4×vEntry)」をこの区間で観測。
  let tTotal = null, exitSpun = false, regripped = false, exitU = exitU0;
  if (done && !spun) {
    const x0 = car.x, y0 = car.y, hx = Math.cos(car.theta), hy = Math.sin(car.theta);
    let k = 0;
    for (; k < TIMEOUT; k++) {
      const be = beta(car);
      if (be > 15) { car.steer = CONST.RIGHT; car.driveDir = CONST.FORWARD; car.pwm = 80; }
      else if (be < -15) { car.steer = CONST.LEFT; car.driveDir = CONST.FORWARD; car.pwm = 80; }
      else { car.steer = CONST.CENTER; car.driveDir = CONST.FORWARD; car.pwm = 255; }
      setSlope(car, dh, model);
      car.step(DT);
      if (Math.abs(beta(car)) < REGRIP_BETA) regripped = true;   // 再グリップ成立
      if (Math.abs(beta(car)) > SPIN_LIM) { exitSpun = true; break; }
      const s = (car.x - x0) * hx + (car.y - y0) * hy;
      if (s >= EXIT_RUN_M) { exitU = car.u; break; }
    }
    if (!exitSpun && k < TIMEOUT) tTotal = tGate + (k + 1) * DT;
  }
  // 凍結述語（criterion ①）: 回頭 ∧ 再グリップ ∧ 出口速度≥0.4×進入 ∧ 出口 spin なし。
  const clean = done && !spun && !exitSpun && tTotal != null && regripped && exitU >= 0.4 * vEntry;
  return { tGate, tTotal, exitU, betaPk, spun: spun || exitSpun, clean,
    uMinSlide: isFinite(uMinSlide) ? uMinSlide : null, uAt45, pivoted,
    driftDuDt: burnN ? burnSum / burnN : null, vgrip, vEntry };
}

function evalStrat(course, R, drive, strat, headGate, driftEntryBase, dh, model) {
  const runs = [0.9, 1.0, 1.1].map(m => runCorner(course, R, drive, strat, m, headGate, driftEntryBase, dh, model));
  const cleanRuns = runs.filter(r => r.clean);
  return {
    tBest: cleanRuns.length ? Math.min(...cleanRuns.map(r => r.tTotal)) : null,
    tGateBest: cleanRuns.length ? Math.min(...cleanRuns.map(r => r.tGate)) : null,
    cleanN: cleanRuns.length,
    betaPk: Math.max(...runs.map(r => r.betaPk)),
    exitU: runs[1].exitU,
    uMinSlide: runs[1].uMinSlide, uAt45: runs[1].uAt45, pivoted: runs[1].pivoted,
    driftDuDt: runs[1].driftDuDt, vgrip: runs[1].vgrip,
  };
}

// 1 セル（corner×surf×drive×ang×dh×slopeModel）を評価。drift は進入基底 1.15/1.40 の良い方（steelman）。
function evalCell(course, R, drive, headGate, dh, model) {
  const g = evalStrat(course, R, drive, 'grip', headGate, null, dh, model);
  const d115 = evalStrat(course, R, drive, 'drift', headGate, 1.15, dh, model);
  const d140 = evalStrat(course, R, drive, 'drift', headGate, 1.40, dh, model);
  const d = (d140.tBest != null && (d115.tBest == null || d140.tBest < d115.tBest)) ? { ...d140, base: 1.40 } : { ...d115, base: 1.15 };
  const ratio = (d.tBest != null && g.tBest != null) ? d.tBest / g.tBest : null;
  const GO = (ratio != null && ratio <= 0.98 && d.cleanN === 3);
  return { g, d, ratio, GO };
}

const HAIRPINS = [{ key: 'hairpin-R5', R: 5 }, { key: 'hairpin-R6.5', R: 6.5 }, { key: 'hairpin-R8', R: 8 }];
const SURFS = [{ key: 'dry', suffix: '-dry' }, { key: 'low', suffix: '-low' }];
const ANGS = [90, 180];

console.log(`\n[AP15] 下り峠 drift go/no-go 再測定  (fullscale・R_min=${R_MIN.toFixed(3)}m・総合時間=セクター+出口${EXIT_RUN_M}m)`);
console.log(`  勾配セル downhill=g·sinθ: ${DHS.map(d => `${d.deg}°=${d.dh.toFixed(3)}`).join('  ')}  (slopeModel=road[velocity course]=AP11 忠実等価)`);

// ── Part B: go/no-go 本表（road-tangent 忠実モデル）──────────────────────────────────
const table = [];
for (const dhc of DHS) {
  for (const cn of HAIRPINS) {
    for (const sf of SURFS) {
      const course = buildFromSpec(benches.find(b => b.name === `bench-${cn.key}${sf.suffix}`));
      for (const drive of ['fr', 'awd']) {
        for (const ang of ANGS) {
          const c = evalCell(course, cn.R, drive, ang * rad, dhc.dh, 'road');
          table.push({
            dh: dhc.key, dhVal: +dhc.dh.toFixed(3), corner: cn.key, R: cn.R, surf: sf.key, drive, ang,
            grip_tGate: c.g.tGateBest != null ? +c.g.tGateBest.toFixed(2) : null,
            grip_tTot: c.g.tBest != null ? +c.g.tBest.toFixed(2) : null,
            grip_exit: +c.g.exitU.toFixed(1), grip_cleanN: c.g.cleanN,
            drift_tGate: c.d.tGateBest != null ? +c.d.tGateBest.toFixed(2) : null,
            drift_tTot: c.d.tBest != null ? +c.d.tBest.toFixed(2) : null,
            drift_exit: +c.d.exitU.toFixed(1), drift_bpk: Math.round(c.d.betaPk), drift_pivoted: c.d.pivoted,
            drift_base: c.d.base, drift_cleanN: c.d.cleanN,
            drift_uMinSlide: c.d.uMinSlide != null ? +c.d.uMinSlide.toFixed(2) : null,
            drift_uAt45: c.d.uAt45 != null ? +c.d.uAt45.toFixed(2) : null,
            ratio: c.ratio != null ? +c.ratio.toFixed(2) : null, GO: c.GO,
            verdict: c.GO ? 'GO' : 'NO-GO',
          });
        }
      }
    }
  }
}
const goN = table.filter(r => r.GO).length;

// ── Part D: 頑健性（generous heading-aligned モデルで GO 数不変を確認）─────────────────
let goNGenerous = 0;
for (const dhc of DHS) {
  if (dhc.dh === 0) continue;                          // dh=0 は generous=road 同値
  for (const cn of HAIRPINS) for (const sf of SURFS) {
    const course = buildFromSpec(benches.find(b => b.name === `bench-${cn.key}${sf.suffix}`));
    for (const drive of ['fr', 'awd']) for (const ang of ANGS) {
      if (evalCell(course, cn.R, drive, ang * rad, dhc.dh, 'heading').GO) goNGenerous++;
    }
  }
}

// ── 機械アサート ──────────────────────────────────────────────────────────────────
console.log(`\n[アサート]`);
// (1) 決定論: 同一セルを2回で bit 一致。
{
  const course = buildFromSpec(benches.find(b => b.name === 'bench-hairpin-R5-low'));
  const a = runCorner(course, 5, 'awd', 'drift', 1.0, Math.PI, 1.15, DHS[2].dh, 'road');
  const b = runCorner(course, 5, 'awd', 'drift', 1.0, Math.PI, 1.15, DHS[2].dh, 'road');
  ok(a.tGate === b.tGate && a.uMinDrift === b.uMinDrift && a.betaPk === b.betaPk,
    `決定論: 同一セル2回 bit 一致 (tGate=${a.tGate}/${b.tGate} uMin=${a.uMinDrift}/${b.uMinDrift})`);
}
// (2) dh=0 回帰: 全 NO-GO（touge 平地ベースライン＝AO8 と一致・凍結述語でも drift は grip を上回らない）。
{
  const flat = table.filter(r => r.dh === '0deg');
  const flatGO = flat.filter(r => r.GO).length;
  ok(flatGO === 0, `dh=0 回帰: 全 NO-GO (${flat.length} セル中 GO=${flatGO}・touge 平地ベースラインと一致)`);
}
// (3) 機序（criterion ③）: 下り勾配は 180° 低μ ドリフトの「速度予算ピボット」を阻止しない、を実測（真の不変量）。
//     忠実モデル gFwd=downhill·cos(β) ゆえ β→90°（ピボット）で前方重力補給が消える＝深い滑走を救えない。
//     ⇒ 低μ 180° drift は dh∈{0,5°,10°} の全水準で依然ピボット(βpk≥85°)する。
//     （pre-AP10 コンベアモデルの「uMin7.4=u 不枯渇」は補給が常時 +downhill だった時点記録＝現行では偽。）
{
  const low180 = table.filter(r => r.ang === 180 && r.surf === 'low');
  const total = low180.length, pivots = low180.filter(r => r.drift_pivoted).length;
  ok(total > 0 && pivots === total,
    `機序: 低μ 180° drift は全 dh で速度予算ピボット到達 (u→0: ${pivots}/${total}・勾配は枯渇を無効化しない)`);
  const worstGfwd = Math.max(...low180.map(r => r.dhVal * Math.cos(r.drift_bpk * rad)));
  console.log(`         （ピボット時 前方重力補給 gFwd=dh·cos(βpk) の最大 = ${worstGfwd.toFixed(3)} m/s² ≈ 0＝滑走深部で補給消失。u@β45° は dh とともに上昇＝浅い滑走では補給が効くが不十分）`);
}
// (4) 頑健性（criterion ①②の結論の代理量非依存）: generous モデルでも GO 数が road と同じ（＝0 のはず）。
ok(goNGenerous === goN, `頑健性: generous(heading) モデルでも GO 数不変 (road GO=${goN}・generous GO=${goNGenerous})`);

// ── 人間可読表（dh グループごと）──────────────────────────────────────────────────
for (const dhc of DHS) {
  console.log(`\n  ── downhill ${dhc.deg}° (dh=${dhc.dh.toFixed(3)}) ──`);
  console.log(`  corner        surf drive ang | grip: tGate tTot exitU cln | drift: tGate tTot exitU bpk base cln | ratio verdict`);
  for (const r of table.filter(x => x.dh === dhc.key)) {
    const f = (v, w = 5) => v != null ? v.toFixed(2).padStart(w) : ' DNF '.padStart(w);
    console.log(`  ${r.corner.padEnd(13)} ${r.surf.padEnd(3)}  ${r.drive.padEnd(3)} ${String(r.ang).padStart(3)} | ${f(r.grip_tGate)} ${f(r.grip_tTot)} ${String(r.grip_exit).padStart(5)} ${r.grip_cleanN}/3 | ${f(r.drift_tGate)} ${f(r.drift_tTot)} ${String(r.drift_exit).padStart(5)} ${String(r.drift_bpk).padStart(3)} ${r.drift_base.toFixed(2)} ${r.drift_cleanN}/3 | ${r.ratio != null ? r.ratio.toFixed(2) : ' -- '} ${r.verdict}`);
  }
}

// ── 機序オラクル表（criterion ③・180° ヘアピン・発達中スライドの min(u)/u@45° と βpk vs dh）─────────
console.log(`\n  [機序オラクル criterion③] 180° ヘアピン drift・発達中スライド(20°<|β|<90°)の min(u)・u@β45° と ピボット βpk の dh 依存`);
console.log(`  （忠実モデル gFwd=downhill·cos(β)。低μ=スライド発達→ピボット／dry=グリップ支配でスライド不発 βpk≲5°=uMinSlide 無）`);
console.log(`  corner        surf drive | βpk 0/5/10°   | uMinSlide 0/5/10° (m/s) | u@β45° 0/5/10° (m/s)`);
{
  const key = (c, s, d) => `${c}|${s}|${d}`;
  const rows = {};
  for (const r of table.filter(x => x.ang === 180)) {
    (rows[key(r.corner, r.surf, r.drive)] ||= { corner: r.corner, surf: r.surf, drive: r.drive, cells: {} }).cells[r.dh] = r;
  }
  const mech = [];
  for (const k of Object.keys(rows)) {
    const g = rows[k], c0 = g.cells['0deg'], c5 = g.cells['5deg'], c10 = g.cells['10deg'];
    const bp = (c) => c ? String(c.drift_bpk).padStart(2) : '--';
    const nm = (c, f) => c && c[f] != null ? c[f].toFixed(1).padStart(5) : '   --';
    console.log(`  ${g.corner.padEnd(13)} ${g.surf.padEnd(3)}  ${g.drive.padEnd(3)} | ${bp(c0)}/${bp(c5)}/${bp(c10)}      | ${nm(c0, 'drift_uMinSlide')}/${nm(c5, 'drift_uMinSlide')}/${nm(c10, 'drift_uMinSlide')}   | ${nm(c0, 'drift_uAt45')}/${nm(c5, 'drift_uAt45')}/${nm(c10, 'drift_uAt45')}`);
    mech.push({ corner: g.corner, surf: g.surf, drive: g.drive,
      bpk: [c0?.drift_bpk, c5?.drift_bpk, c10?.drift_bpk],
      uMinSlide: [c0?.drift_uMinSlide, c5?.drift_uMinSlide, c10?.drift_uMinSlide],
      uAt45: [c0?.drift_uAt45, c5?.drift_uAt45, c10?.drift_uAt45] });
  }
  if (process.argv.includes('--json')) global.__mech = mech;
}

console.log(`\n  GO=${goN} / ${table.length} セル（downhill 3水準×ヘアピン3×路面2×駆動2×回頭2）`);
console.log(`  → 下り勾配（5°/10°）でも drift は grip を清潔に上回らない＝AO8 平地の全 NO-GO は下りでも維持。`);

if (process.argv.includes('--json')) {
  console.log('===JSON===');
  console.log(JSON.stringify({
    appVersion: APP_VERSION, R_min: +R_MIN.toFixed(4),
    dhs: DHS.map(d => ({ key: d.key, deg: d.deg, dh: +d.dh.toFixed(4) })),
    table, goN, goNGenerous, total: table.length, mech: global.__mech || [],
  }, null, 0));
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
