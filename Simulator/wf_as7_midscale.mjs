// wf_as7_midscale.mjs — Stage AS7「中スケール v2 タイヤの固有較正」の受け入れゲート。
// ════════════════════════════════════════════════════════════════════════════════════
// **本ブロックの結論は「較正しない」**。中スケール (midscale) の v2 タイヤ定数は Froude 相似
// (kL=2・kMu=kG=1) で卓上から継承されるが、AO6 まではその継承が **構造 (参照一致・値一致)** でしか
// 検査されておらず (`wf_ao6_slip.mjs` E1/E2)、唯一の挙動検査 E3 も slip の摩擦円容量比だけだった。
// 本ゲートは継承の正しさを **挙動 (α_peak・滑り出し Ay*)** で測り、較正余地が無いことを機械証明する。
//
// ── 測定設計 (CI-14「知覚→測定の翻訳」) ─────────────────────────────────────────────
// (1) **相似の比較は Froude 時間で行う**。動的相似は「長さ kL・速度 kV=√kL・**時間 kT=√kL**」の
//     three-way スケールで成立する。ところが本シムの外側刻みは全領域で 1/60 秒に固定されている
//     (時間だけスケールしない)。∴ 同じ実時間刻みで領域を比べると **モデルの非相似ではなく離散化差**
//     を測ってしまう (実測: 本番刻みで α_peak は 卓上 16.75° / 中 13.75° と 3° ズレるが、dt→0 で
//     両者とも 8.00° へ収束する = 差はモデルに無い)。∴ A は kT 倍の刻みで比較し、B で「本番刻みの差は
//     離散化であって非相似でない」ことを収束で示す。
// (2) **述語は再実装しない**。本番 `CarV2.step`・`applyRegime`・`applyRegimeV2`・`tireParamsFor`・
//     `runRace` をそのまま呼び、車の内部オラクル (`_ayTire`・`_muUseR`・`_latCapSS`) を読む。
// (3) **判定は二値でなく連続量マージン**。各検査は測った値と基準の差を必ず表示する。
// (4) **相似コースは構成的に作り、相似であることを機械検査する**。コース spec のキーを列挙して倍に
//     する方式は列挙漏れ (ヘアピンの L/rr 等) で「相似でないコース」を黙って作る (AS7 の実測中に実際に
//     踏んだ)。∴ E は **構築済みコース (walls/start/finish/bounds) を直接 k 倍**し、壁長・外形・向きが
//     厳密に k 倍であることを検査してから走らせる。
// ════════════════════════════════════════════════════════════════════════════════════
import { CarV2, V2, tireParamsFor, applyRegimeV2, mfCoeffs } from './public/js/physics_v2.js';
import { DYN, applyRegime } from './public/js/physics_dyn.js';
import { CAR, CONST, REGIMES, MASS_REF, scaleRegime } from './public/js/config.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import courses from './public/data/courses.json' with { type: 'json' };

const R2D = 180 / Math.PI;
const KL = REGIMES.midscale.L / REGIMES.tabletop.L;      // 長さスケール (=2・ソース由来)
const KT = Math.sqrt(KL);                                 // 時間スケール (kG=kMu=1 ゆえ √kL)
const KV = Math.sqrt(KL);                                 // 速度スケール
const DT = 1 / 60;

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } };

const start0 = { x: 0, y: 0, theta: 0, grip: 1, downhill: 0 };
function mk(type, tire, regime) {
  applyRegime(regime);
  const c = new CarV2(start0);
  c.type = type; c.tireSet = tire; c.reset(start0);
  return c;
}

// ── 純サイドスリップ掃引 (本番 _substep の実タイヤ横力を読む) ────────────────────────
// u を固定し横速だけを与えて α を掃引 → 各 α で状態をピン留めし緩和 (relLen) が落ち着くまで回す。
// 返す: 車両レベルの横力ピーク位置 α_peak と そのときの Ay* = ay_peak/(μ0·g)。
// dt/settle は呼び出し側が領域の時間スケールに合わせて渡す (相似比較は kT 倍で)。
function lateralSweep(type, tire, regime, dt, settleSec, { lo = 4, hi = 26, step = 0.25, uFrac = 0.7 } = {}) {
  mk(type, tire, regime);                       // 領域適用 (CAR/DYN/_tireCal)
  const u = CAR.maxSpeed * uFrac;
  const T = tireParamsFor(tire);
  const mug = T.mu0 * DYN.g;
  const n = Math.max(1, Math.round(settleSec / dt));
  let best = { aDeg: NaN, ay: -Infinity, sig: 0 };
  for (let aDeg = lo; aDeg <= hi + 1e-9; aDeg += step) {
    const c = mk(type, tire, regime);
    c.steer = CONST.CENTER; c.driveDir = CONST.FREE;
    const vlat = -u * Math.tan(aDeg / R2D);
    for (let i = 0; i < n; i++) { c.u = u; c.vlat = vlat; c.r = 0; c.step(dt); }
    const ay = Math.abs(c._ayTire);
    if (ay > best.ay) best = { aDeg, ay, sig: c._muUseR };
  }
  return { u, mug, aPeak: best.aDeg, ayPeak: best.ay, ayStar: best.ay / mug, sig: best.sig };
}

// 摩擦円容量比 (wf_ao6_slip と同型オラクル): 到達可能横G ÷ タイヤ容量 Σμ_i·Fz_i。
function capacityRatio(type, tire, regime) {
  const c = mk(type, tire, regime);
  c.driveDir = CONST.FREE; c.steer = CONST.CENTER;
  const spd = CAR.maxSpeed;
  for (let i = 0; i < 6; i++) { c.u = spd; c.vlat = 0; c.r = 0; c.step(DT); }
  const latCap = c._latCapSS;
  const Rmin = CAR.wheelBase / Math.tan(CAR.maxSteer);
  return { latCap, ayAch: spd * spd / Rmin, ratio: (spd * spd / Rmin) / latCap };
}
// 発進空転 (駆動軸の車輪面速度 vs 車速)
function launchSpin(type, tire, regime) {
  const c = mk(type, tire, regime);
  c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER;
  const rear = type !== 'normal_ff';
  let mx = 0;
  for (let i = 0; i < 90; i++) { c.step(DT); const vw = rear ? c.vwR : c.vwF; mx = Math.max(mx, (Math.abs(vw) - Math.abs(c.u)) / Math.max(Math.abs(c.u), 0.02)); }
  return mx;
}
// 過激ドリフト台本 (全開＋全舵導入→|β|>35° でカウンター)。持続スライドの成否を測る。
const betaOf = c => Math.atan2(c.vlat, Math.max(1e-6, Math.abs(c.u))) * R2D;
function driftScript(type, tire, regime) {
  const c = mk(type, tire, regime);
  c.driveDir = CONST.FORWARD;
  let inband = 0, slide = 0, peakSigR = 0, spun = false;
  for (let i = 0; i < 900; i++) {
    c.pwm = 255;
    c.steer = i < 30 ? CONST.LEFT : (Math.abs(betaOf(c)) > 35 ? (c.r > 0 ? CONST.RIGHT : CONST.LEFT) : CONST.LEFT);
    c.step(DT);
    const ab = Math.abs(betaOf(c));
    peakSigR = Math.max(peakSigR, c._muUseR);
    if (ab >= 90) spun = true;
    if (ab >= 15 && ab < 90) slide++;
    if (ab >= 15 && ab <= 50) inband++;
  }
  return { inbandSec: inband / 60, slideSec: slide / 60, peakSigR, spun };
}

console.log('Stage AS7 ゲート  (中スケール v2 タイヤ: Froude 継承の挙動検証・較正不要の機械証明)');
console.log('='.repeat(92));
console.log(`  領域スケール: kL=${KL} (=REGIMES.midscale.L/REGIMES.tabletop.L)  kV=kT=√kL=${KV.toFixed(6)}`);

// ── A. 相似の厳密性 — Froude 時間 (kT 倍の刻み) で比べると領域差はゼロ ───────────────────
// 「中スケール固有のタイヤ較正が要るか」に答える中核。要るなら領域間に挙動差が残るはず。
console.log('\nA. Froude 時間で比較したときの領域一致 (較正余地の有無)');
const A_TOL_DEG = 1e-9;      // α_peak の許容差 (掃引格子上で完全一致を要求)
const A_TOL_REL = 1e-9;      // Ay* の許容相対差
const aRows = [];
for (const tire of ['normal', 'slip']) {
  for (const type of ['normal_fr', 'normal_ff', 'normal_awd', 'drift_fr']) {
    const t = lateralSweep(type, tire, 'tabletop', DT, 2.0);
    const m = lateralSweep(type, tire, 'midscale', DT * KT, 2.0 * KT);
    const dA = Math.abs(m.aPeak - t.aPeak);
    const dR = Math.abs(m.ayStar / t.ayStar - 1);
    aRows.push({ tire, type, t, m, dA, dR });
    ok(dA <= A_TOL_DEG && dR <= A_TOL_REL,
      `A ${type.padEnd(10)}/${tire.padEnd(6)}: α_peak 卓上${t.aPeak.toFixed(2)}° = 中${m.aPeak.toFixed(2)}° (Δ=${dA.toFixed(3)}°) ・ Ay* ${t.ayStar.toFixed(9)} vs ${m.ayStar.toFixed(9)} (相対差 ${dR.toExponential(2)} ≤${A_TOL_REL.toExponential(0)})`);
  }
}
// 速度スケールの実測 (掃引の基準速度が kV 倍になっていること = 相似の前提が実際に効いている)
{
  const t = aRows[0].t, m = aRows[0].m;
  ok(Math.abs((m.u / t.u) / KV - 1) < 1e-12, `A-kV: 掃引基準速 比 ${(m.u / t.u).toFixed(12)} = kV=${KV.toFixed(12)}`);
  ok(Math.abs(m.mug / t.mug - 1) < 1e-12, `A-μg: μ0·g は領域不変 ${t.mug.toFixed(6)} = ${m.mug.toFixed(6)} (kMu=kG=1)`);
}

// ── A-D. 検出力: 中スケールに 1% の固有較正を入れたら A は必ず落ちる ────────────────────
// 「A が緑なのは検査が鈍いから」ではないことの実証。applyRegimeV2 へ摂動した v2tire を直接渡す
// (config.js は改変しない)。終わったら applyRegime('midscale') で正規の較正へ復帰させる。
console.log('\nA-D. 検出力 (中スケール固有較正 μ0×1.01 を入れると A が落ちること)');
{
  const base = REGIMES.tabletop.v2tire;
  const perturbed = {
    normal: { ...base.normal, mu0: base.normal.mu0 * 1.01 },
    slip: { ...base.slip },
  };
  const t = lateralSweep('normal_fr', 'normal', 'tabletop', DT, 2.0);
  applyRegime('midscale');
  applyRegimeV2({ ...REGIMES.midscale, v2tire: perturbed });   // 中スケールだけ μ0 を 1% ずらす
  // lateralSweep は内部で applyRegime を呼び直すので、摂動を保ったまま測るために掃引をここで展開する。
  const u = CAR.maxSpeed * 0.7, T = tireParamsFor('normal'), mug = T.mu0 * DYN.g;
  const n = Math.round(2.0 * KT / (DT * KT));
  let best = { aDeg: NaN, ay: -Infinity };
  for (let aDeg = 4; aDeg <= 26 + 1e-9; aDeg += 0.25) {
    const c = new CarV2(start0); c.type = 'normal_fr'; c.tireSet = 'normal'; c.reset(start0);
    c.steer = CONST.CENTER; c.driveDir = CONST.FREE;
    const vlat = -u * Math.tan(aDeg / R2D);
    for (let i = 0; i < n; i++) { c.u = u; c.vlat = vlat; c.r = 0; c.step(DT * KT); }
    const ay = Math.abs(c._ayTire);
    if (ay > best.ay) best = { aDeg, ay };
  }
  const ayStarP = best.ay / mug;
  const dR = Math.abs(ayStarP / t.ayStar - 1);
  applyRegime('midscale');   // 正規較正へ復帰
  const restored = tireParamsFor('normal');
  ok(dR > A_TOL_REL, `A-D1: μ0×1.01 で Ay* 相対差 ${dR.toExponential(2)} > 許容 ${A_TOL_REL.toExponential(0)} ⇒ A は摂動を検出する (検査は鈍くない)`);
  ok(restored.mu0 === REGIMES.tabletop.v2tire.normal.mu0, `A-D2: 摂動後に正規較正へ復帰 (μ0=${restored.mu0})`);
}

// ── B. 本番刻み (1/60) の領域差は「離散化」であって「非相似」ではない ────────────────────
// 連続時間の基準 (十分細かい刻み) を取り、本番刻みの偏差を領域ごとに測る。中スケールは無次元刻みが
// 1/kT 倍細かい ⇒ 連続極限に **より近い** はず (=差の向きが構造から予測できる)。
console.log('\nB. 本番刻み 1/60 の領域差は離散化 (連続極限で消える・向きも一致)');
const B_FINE = 1 / 1200;
for (const tire of ['normal', 'slip']) {
  const tCont = lateralSweep('normal_fr', tire, 'tabletop', B_FINE, 2.0);
  const mCont = lateralSweep('normal_fr', tire, 'midscale', B_FINE * KT, 2.0 * KT);
  const tProd = lateralSweep('normal_fr', tire, 'tabletop', DT, 2.0);
  const mProd = lateralSweep('normal_fr', tire, 'midscale', DT, 2.0);   // ← 本番はここ (実時間 1/60 固定)
  const dCont = Math.abs(mCont.aPeak - tCont.aPeak);
  const eT = tProd.aPeak - tCont.aPeak, eM = mProd.aPeak - mCont.aPeak;
  ok(dCont <= 1e-9, `B1 ${tire}: 連続極限 (dt=1/${1 / B_FINE}) では領域差ゼロ 卓上${tCont.aPeak.toFixed(2)}° = 中${mCont.aPeak.toFixed(2)}° (Δ=${dCont.toFixed(3)}°)`);
  ok(Math.abs(eM) <= Math.abs(eT) + 1e-9, `B2 ${tire}: 本番刻みの連続極限からの偏差は 中 ${eM.toFixed(2)}° ≤ 卓上 ${eT.toFixed(2)}° (無次元刻みが 1/kT 倍細かい構造の帰結)`);
  console.log(`     (実測) 本番 1/60: 卓上 α_peak=${tProd.aPeak.toFixed(2)}° / 中 ${mProd.aPeak.toFixed(2)}°  ← 差 ${(mProd.aPeak - tProd.aPeak).toFixed(2)}° は **モデル差ではなく刻み差**`);
}

// ── C. 半陰的化ラッチ siActive の領域マージン (無次元でない比較の脆さを数値で固定) ──────────
// applyRegimeV2 は「領域の代表最大速度での陽的 needW > siWheelThresh」で車輪 ODE の半陰的化を決める。
// needW ∝ 1/maxU ∝ 1/√kL ゆえ **この比較は無次元でない** = Froude 相似領域を大きくしていくと、
// 物理が相似のまま **積分方式だけが不連続に切り替わる**。その崖の位置を測って固定する。
console.log('\nC. 半陰的化ラッチ siActive の領域マージン (崖の位置を数値で固定)');
function needWatMax(regime) {
  applyRegime(regime);
  const maxU = Math.max(CAR.maxSpeed, DYN.absUFloor);
  const q = (DYN.rho > 0 && DYN.frontalArea > 0) ? 0.5 * DYN.rho * DYN.frontalArea / MASS_REF : 0;
  const muFz = V2.mu0 * (0.7 * DYN.g + DYN.Cl * q * maxU * maxU);
  const cb = mfCoeffs(V2.muDecay);
  return { maxU, needW: 2 * V2.wheelLambda * (muFz * cb.C * cb.Bp / (V2.kappaP * maxU)) / 60, siActive: V2.siActive, thresh: V2.siWheelThresh };
}
{
  const tt = needWatMax('tabletop'), ms = needWatMax('midscale'), fs = needWatMax('fullscale');
  ok(tt.siActive === true && tt.needW > tt.thresh, `C1 卓上:      needW=${tt.needW.toFixed(1)} / 閾値${tt.thresh} = 余裕 ×${(tt.needW / tt.thresh).toFixed(3)} → siActive=${tt.siActive}`);
  ok(ms.siActive === true && ms.needW > ms.thresh, `C2 中スケール: needW=${ms.needW.toFixed(1)} / 閾値${ms.thresh} = 余裕 ×${(ms.needW / ms.thresh).toFixed(3)} → siActive=${ms.siActive} (**卓上側に居るが余裕は薄い**)`);
  ok(fs.siActive === false && fs.needW < fs.thresh, `C3 フルスケール: needW=${fs.needW.toFixed(1)} / 閾値${fs.thresh} = ×${(fs.needW / fs.thresh).toFixed(3)} → siActive=${fs.siActive} (原 explicit=byte 不変)`);
  // 崖の位置: needW ∝ 1/√kL ⇒ 反転する kL = (needW_tabletop/閾値)²。実際に scaleRegime で作って確認する。
  const kFlip = Math.pow(tt.needW / tt.thresh, 2);
  const probe = (kL) => { const r = scaleRegime(REGIMES.tabletop, { kL }); applyRegime(r); return V2.siActive; };
  const below = probe(kFlip * 0.95), above = probe(kFlip * 1.05);
  applyRegime('tabletop');
  ok(below === true && above === false,
    `C4 崖の実測: Froude 相似領域は kL≈${kFlip.toFixed(3)} を境に半陰的化が反転する (kL=${(kFlip * 0.95).toFixed(3)}→siActive=${below} / kL=${(kFlip * 1.05).toFixed(3)}→${above})。現行 midscale の kL=${KL} は境界の ${(KL / kFlip * 100).toFixed(1)}% 地点`);
}

// ── D. 中スケールでの §10.2 述語 (AO6 は slip の容量比しか見ていなかった) ───────────────
// 「通常タイヤでは滑らない／スリップタイヤなら疑似ドリフト環境になる」という卓上の教材主張が、
// 中スケールでも同じ操作で成立するか (=Ay* 不変の教材的意味) を挙動で確かめる。
console.log('\nD. 中スケールでの §10.2 述語 (normal=滑らない / slip=疑似ドリフト環境)');
for (const type of ['normal_fr', 'drift_fr', 'normal_awd']) {
  const capT = capacityRatio(type, 'normal', 'tabletop'), capM = capacityRatio(type, 'normal', 'midscale');
  const d = driftScript(type, 'normal', 'midscale');
  const ls = launchSpin(type, 'normal', 'midscale');
  ok(capM.ratio <= 0.30 && Math.abs(capM.ratio / capT.ratio - 1) < 1e-3,
    `D1 ${type.padEnd(10)}/normal: 中の摩擦円容量比 ${capM.ratio.toFixed(6)} ≤0.30 かつ 卓上 ${capT.ratio.toFixed(6)} と一致 (相対差 ${Math.abs(capM.ratio / capT.ratio - 1).toExponential(1)})`);
  ok(d.inbandSec === 0 && d.peakSigR <= 1.0 && ls < 0.15,
    `D2 ${type.padEnd(10)}/normal: 中でも過激台本で持続スライド 0 (inband=${d.inbandSec.toFixed(2)}s・後軸σ_peak=${d.peakSigR.toFixed(2)}≤1.0・発進空転 ${ls.toFixed(3)}<0.15)`);
}
for (const type of ['normal_fr', 'drift_fr']) {
  const ls = launchSpin(type, 'slip', 'midscale');
  const d = driftScript(type, 'slip', 'midscale');
  const cap = capacityRatio(type, 'slip', 'midscale');
  ok(ls > 0.15, `D3 ${type.padEnd(10)}/slip:   中でも発進空転 (vw−u)/u=${ls.toFixed(2)} >0.15`);
  ok(d.inbandSec >= 3 && !d.spun && d.peakSigR >= 5,
    `D4 ${type.padEnd(10)}/slip:   中でも持続制御スライド 累積|β|∈[15,50]=${d.inbandSec.toFixed(2)}s ≥3s ∧ スピンアウトなし ∧ 深後軸σ=${d.peakSigR.toFixed(1)}≥5`);
  ok(cap.ratio >= 0.5 && cap.ratio <= 1.15, `D5 ${type.padEnd(10)}/slip:   中の摩擦円容量比 ${cap.ratio.toFixed(4)} ∈[0.5,1.15] (限界に届く=滑れる)`);
}

// ── E. 実走での相似 (本番 runRace・幾何相似コース) ─────────────────────────────────────
// 物理が相似でも、**プログラム側の判定距離 [mm] は領域スケールしない**ため、同じサンプルを
// 相似コースへ載せると挙動はズレる。どちらがどれだけ効くかを分離して測る (代理量でなく実態)。
console.log('\nE. 実走での相似 (本番 runRace・構築済みコースを厳密 kL 倍)');
function scaleCourse(c, k) {
  return {
    ...c, name: `${c.name}×${k}`,
    walls: c.walls.map(w => ({ ...w, x1: w.x1 * k, y1: w.y1 * k, x2: w.x2 * k, y2: w.y2 * k })),
    start: { ...c.start, x: c.start.x * k, y: c.start.y * k },
    finish: c.finish ? { ...c.finish, x1: c.finish.x1 * k, y1: c.finish.y1 * k, x2: c.finish.x2 * k, y2: c.finish.y2 * k } : null,
    bounds: { w: c.bounds.w * k, h: c.bounds.h * k },
  };
}
function similarityErrors(a, b, k) {
  const errs = [];
  if (a.walls.length !== b.walls.length) errs.push(`壁本数 ${a.walls.length}≠${b.walls.length}`);
  for (let i = 0; i < a.walls.length && !errs.length; i++) {
    const la = Math.hypot(a.walls[i].x2 - a.walls[i].x1, a.walls[i].y2 - a.walls[i].y1);
    const lb = Math.hypot(b.walls[i].x2 - b.walls[i].x1, b.walls[i].y2 - b.walls[i].y1);
    if (la > 1e-12 && Math.abs(lb / la - k) > 1e-9) errs.push(`壁${i} の長さ比 ${(lb / la).toFixed(9)}≠${k}`);
  }
  if (Math.abs(b.bounds.w / a.bounds.w - k) > 1e-9 || Math.abs(b.bounds.h / a.bounds.h - k) > 1e-9) errs.push('外形比');
  if (Math.abs(b.start.theta - a.start.theta) > 1e-15) errs.push('start.theta が不変でない');
  return errs;
}
// プログラムの判定距離 [mm] だけを k 倍 (速度/PWM/回数は無次元なので触らない)。何件置換したかを返す。
function scaleProgDistances(src, k) {
  let hits = 0;
  const out = src.split('\n').map(line => {
    if (!/^\s*int .*=\d+/.test(line)) return line;
    return line.replace(/\b(D_OPEN|D_MID|D_TURN|D_SIDE|CONF|ESC)=(\d+)/g, (m, n, v) => { hits++; return `${n}=${Math.round(+v * k)}`; });
  }).join('\n');
  return { src: out, hits };
}
function raceTotal(course, regime, progKey, src) {
  const p = PROGRAMS.find(x => x.key === progKey);
  const r = runRace({
    course, regime, physics: 'v2', laps: 2, report: true,
    field: [{ name: 'T', lang: p.lang || 'c', src: src || p.code, carType: progKey }],
    crashRule: { rejoin: true, penaltySec: 0 }, interact: false,
  });
  const f = r.finishers[0];
  return f ? f.totalTimeMs / 1000 : null;
}
{
  const E_TOL = 0.05;   // 相似ペア (プログラムの mm も kL 倍) の lap 比が kT からズレてよい割合 (実測最大 2.9%)
  const names = ['オーバル', 'ヘアピン', '90度サーキット'];
  let worstScaled = 0, worstRaw = 0, nPair = 0;
  for (const nm of names) {
    const spec = courses.find(c => c.name === nm);
    const c1 = buildFromSpec(spec), c2 = scaleCourse(c1, KL);
    const errs = similarityErrors(c1, c2, KL);
    ok(errs.length === 0, `E0 ${nm}: 相似コースの機械検査 OK (壁${c1.walls.length}本・外形 ${c1.bounds.w.toFixed(3)}×${c1.bounds.h.toFixed(3)} → ${c2.bounds.w.toFixed(3)}×${c2.bounds.h.toFixed(3)})${errs.length ? ' / ' + errs.join(',') : ''}`);
    if (errs.length) continue;
    for (const prog of ['normal_fr', 'normal_awd', 'normal_ff']) {
      const p = PROGRAMS.find(x => x.key === prog);
      const { src: sc, hits } = scaleProgDistances(p.code, KL);
      if (hits === 0) { ok(false, `E ${nm}/${prog}: 判定距離定数を1件も置換できなかった (プログラム改稿で名前が変わった?)`); continue; }
      const a = raceTotal(c1, 'tabletop', prog, null);
      const b = raceTotal(c2, 'midscale', prog, null);   // プログラムは卓上前提の mm のまま
      const d = raceTotal(c2, 'midscale', prog, sc);     // 判定距離だけ kL 倍
      if (a == null || b == null || d == null) { ok(false, `E ${nm}/${prog}: 完走しない組合せがある (卓上=${a}・中原=${b}・中mm×kL=${d})`); continue; }
      const devScaled = Math.abs((d / a) / KT - 1), devRaw = Math.abs((b / a) / KT - 1);
      worstScaled = Math.max(worstScaled, devScaled); worstRaw = Math.max(worstRaw, devRaw); nPair++;
      ok(devScaled <= E_TOL,
        `E1 ${nm}/${prog.padEnd(10)}: 判定距離も kL 倍したときの周回時間比 ${(d / a).toFixed(4)} / kT=${KT.toFixed(4)} → 逸脱 ${(devScaled * 100).toFixed(2)}% ≤${E_TOL * 100}%  (mm 据置は ${(b / a).toFixed(4)}・逸脱 ${(devRaw * 100).toFixed(2)}%)`);
    }
  }
  ok(nPair > 0 && worstRaw > worstScaled,
    `E2 主因の分離: 判定距離 [mm] を領域スケールすると kT からの最大逸脱が ${(worstRaw * 100).toFixed(2)}% → ${(worstScaled * 100).toFixed(2)}% へ縮む (n=${nPair}) ⇒ **実走で見える非相似の主因はタイヤでなくプログラム側の絶対長さ定数**`);
}

applyRegime('tabletop');   // 復元
const line = '─'.repeat(92);
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
console.log(line);
console.log(fail === 0 ? '結果: PASS' : '結果: FAIL');
process.exit(fail === 0 ? 0 : 1);
