// AS9 常設アサーションゲート: レインタイヤ (路面グリップの回復) と ギア比 (任意装備) を機械で守る。
// 本番フローのみ (buildFromSpec / runRace / CarV2.step) を使い、判定述語を検査側へ写し取らない
// (CI-8/CI-9)。exit 非0 = 失敗。
//
// 設計 (docs/physics_model.md §13.5/§13.11・決定ログ AS-9):
//   ・レイン = 溝つき軟質コンパウンド。**乾路では normal に劣り (μ0 比 ρ=0.85)・濡れた路面では排水で
//     路面グリップ低下 (1−grip) の wetGain 割合を取り戻す**: gripEff = 1 − (1−grip)·(1−wetGain)。
//     ⇒ どちらが強いかが入れ替わる路面グリップ **g\* = ρ·w/(1−ρ·(1−w))** が閉形式で出る。
//     ρ を領域間で揃えてあるので **g\* は領域不変** (卓上/中/フルスケールで同じ) — これを比で検査する
//     (比例定数もμの絶対値も消えるので、実装の内部式を検査側へ写し取らずに済む・AS8 と同型)。
//   ・ギア = 減速比 r。モータートルク ×r・車輪回転数 ÷r ⇒ **加速上限 ×r・ギアが決める頭打ち速度 ÷r**。
//     出力律速 (fullscale の定出力ドライブトレイン) は P=F·v ゆえギアで不変 = 乗じない。
//     ⇒ 最高速の比は **1/r** になるはずで、これも比で検査できる。
//
// 章立て: A レインの法則 (交差点 g\*・領域不変・検出力) / B ウェットで「正しいタイヤ選択が速い」(本番 runRace)
//         C ギアの法則 (最高速比=1/r・加速は逆向き・変速の Froude 追従・fullscale の抗力律速)
//         D 既定装備の完全縮退 (canon キー・未知値の正規化) / E 既存ラッチ (siMinMu) への影響=崖の監視
import { CAR, CONST, SIM, REGIMES, GEARS, TIRE_SETS, GEAR_SETS } from './public/js/config.js';
import { applyRegime } from './public/js/physics_dyn.js';
import { CarV2, applyRegimeV2, tireParamsFor, effGrip } from './public/js/physics_v2.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import specs from './public/data/courses.json' with { type: 'json' };

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.error('  ✗ ' + msg); } };
const DT = 1 / SIM.physicsHz;
const prog = (k) => { const p = PROGRAMS.find((x) => x.key === k); if (!p) throw new Error('no prog ' + k); return p; };

// ---- 共通ヘルパ (本番の物理を呼んで読むだけ・述語を再実装しない) --------------------
// 横グリップ容量 Σμ_i·Fz_i は _substep が毎ステップ実測して car._latCapSS に置く (AO2 の不変条件
// オラクル)。タイヤの「使える μ」を代理量でなくこの実力から読む。
// **静止 (u=0) で測る理由 (実測で確定・下の A6)**: 走行中は惰行減速が前後荷重移動を起こし、その移動量は
// nSub 刻みで量子化される。nSub は横剛性 CaTot ∝ μ0·gripEff からタイヤごとに決まるので、**輪荷重自体が
// 僅かにタイヤ依存**になり比が 10⁻⁶ 台ずれる (モデルの欠陥ではなく積分の量子化)。静止では荷重が静的
// (LPF=0・全輪タイヤ非依存) ゆえ比が μ の比そのものになり、法則を厳密に検査できる。
function latCap(regime, tire, grip, uRel = 0) {
  applyRegime(regime);
  const c = new CarV2({ x: 0, y: 0, theta: 0, grip });
  c.type = 'normal_fr'; c.tireSet = tire;
  c.driveDir = CONST.FREE; c.pwm = 0;
  c.u = uRel * CAR.maxSpeed;
  c.step(DT);
  return { cap: c._latCapSS, fz: c._FzWheel.slice() };
}
const cap = (regime, tire, grip, uRel = 0) => latCap(regime, tire, grip, uRel).cap;
// 交差点 g\* = latCap(normal) と latCap(rain) が入れ替わる路面グリップ (二分探索・実測)。
function crossoverGrip(regime) {
  let lo = 0.05, hi = 1.0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (cap(regime, 'normal', mid) < cap(regime, 'rain', mid)) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
// 全開直進: 0→50% (基準 maxV) の到達時間・終端速度・変速回数・駆動切れ時間。
function straight(regime, gear, secs, tire = 'normal') {
  applyRegime(regime);
  const c = new CarV2({ x: 0, y: 0, theta: 0, grip: 1 });
  c.type = 'normal_fr'; c.tireSet = tire; c.gearSet = gear;
  c.driveDir = CONST.FORWARD; c.pwm = 255;
  const n = Math.round(secs / DT), half = 0.5 * CAR.maxSpeed;
  let tHalf = null, shifts = 0, prev = 0, cutTicks = 0;
  for (let i = 0; i < n; i++) {
    c.step(DT);
    if (c._gearIdx !== prev) { shifts++; prev = c._gearIdx; }
    if (c._shiftT > 0) cutTicks++;
    if (tHalf == null && c.u >= half) tHalf = (i + 1) * DT;
  }
  return { tHalf, vEnd: c.u, shifts, cutSec: cutTicks * DT, base: CAR.maxSpeed };
}

// ============================================================================
console.log('=== A: レインタイヤの法則 (交差点 g* は閉形式・領域不変) ===');
// 閉形式の予測: mu0_n·g = mu0_r·(1−(1−g)(1−w))  ⇒  g* = ρ·w/(1−ρ·(1−w))、ρ=mu0_r/mu0_n。
// **予測はタイヤ定数だけから作り、実測は本番 _latCapSS から取る** (両者は独立)。
applyRegime('tabletop');
const Tn = tireParamsFor('normal'), Tr = tireParamsFor('rain');
const rho = Tr.mu0 / Tn.mu0, wg = Tr.wetGain;
const gStarPred = rho * wg / (1 - rho * (1 - wg));
console.log(`  予測: ρ=${rho.toFixed(4)} wetGain=${wg} → g*=${gStarPred.toFixed(6)}`);
const gStars = {};
for (const reg of ['tabletop', 'midscale', 'fullscale']) gStars[reg] = crossoverGrip(reg);
for (const reg of Object.keys(gStars)) {
  const rel = Math.abs(gStars[reg] - gStarPred) / gStarPred;
  ok(rel < 1e-12, `A1 ${reg}: 実測 g*=${gStars[reg].toFixed(9)} が閉形式予測 ${gStarPred.toFixed(9)} と一致 (相対差 ${rel.toExponential(2)} < 1e-12)`);
}
{
  const vals = Object.values(gStars);
  const spread = (Math.max(...vals) - Math.min(...vals)) / gStarPred;
  ok(spread < 1e-12, `A2 領域不変: g* の3領域の相対振れ ${spread.toExponential(2)} < 1e-12 (無次元ゆえ卓上/中/FS で同一)`);
}
// 出荷ウェット2コース (grip 0.5/0.55) は g* 未満・乾路 (1.0) は g* 超 = 「正しい選択」が定義できる。
{
  const wetGrips = specs.filter((s) => s.grip != null && s.grip < 1).map((s) => s.grip);
  ok(wetGrips.length >= 2, `A3 出荷のウェットコースが2件以上ある (実測 ${wetGrips.length} 件: grip=${wetGrips.join(',')})`);
  ok(wetGrips.every((g) => g < gStarPred), `A3' ウェット全件が g* 未満 = レイン有利側 (最大 ${Math.max(...wetGrips)} < ${gStarPred.toFixed(4)})`);
  ok(1.0 > gStarPred, `A3'' 乾路 grip=1.0 は g* 超 = ノーマル有利側`);
}
// 容量の比 (乾路でレインは劣り・ウェットで勝る)。比なので μ の絶対値に依らない。
for (const reg of ['tabletop', 'midscale', 'fullscale']) {
  const dry = cap(reg, 'rain', 1.0) / cap(reg, 'normal', 1.0);
  const wet = cap(reg, 'rain', 0.5) / cap(reg, 'normal', 0.5);
  ok(Math.abs(dry - rho) < 1e-12, `A4 ${reg} 乾路の容量比 = ρ=${rho.toFixed(4)} (実測 ${dry.toFixed(12)}) = レインは乾路で劣る`);
  const wetPred = rho * (1 - (1 - 0.5) * (1 - wg)) / 0.5;
  ok(Math.abs(wet - wetPred) < 1e-12 && wet > 1.2, `A4' ${reg} grip=0.5 の容量比 ${wet.toFixed(12)} が予測 ${wetPred.toFixed(12)} と一致・1.2 超 = レインが明確に勝る`);
}
// 検出力: wetGain を 0 にすると「レイン = ただ弱いタイヤ」へ縮退し A1/A4' が成立しなくなる。
{
  const save = REGIMES.tabletop.v2tire.rain.wetGain;
  REGIMES.tabletop.v2tire.rain.wetGain = 0;
  applyRegime('tabletop'); applyRegimeV2('tabletop');
  const wet0 = cap('tabletop', 'rain', 0.5) / cap('tabletop', 'normal', 0.5);
  REGIMES.tabletop.v2tire.rain.wetGain = save;
  applyRegime('tabletop'); applyRegimeV2('tabletop');
  const wetBack = cap('tabletop', 'rain', 0.5) / cap('tabletop', 'normal', 0.5);
  ok(Math.abs(wet0 - rho) < 1e-12, `A5 検出力: wetGain=0 にすると grip=0.5 の容量比が ρ=${rho.toFixed(4)} へ縮退 (実測 ${wet0.toFixed(12)}) = 排水効果が消える`);
  ok(Math.abs(wetBack - rho * 1.7) < 1e-12, `A5' 復元後に元の比 ${wetBack.toFixed(6)} へ戻る (ゲートが live 設定を汚さない)`);
}
// A6 走行中の残差は「タイヤ依存 nSub による荷重量子化」= 構造から予測できるズレ (AS8 の離散化と同型)。
// 沈黙截断の禁止: 静止でしか厳密でないことを隠さず、機序 (輪荷重がタイヤで違う) ごと測る。
{
  const wetPred = rho * (1 - (1 - 0.5) * (1 - wg)) / 0.5;
  for (const reg of ['tabletop', 'fullscale']) {
    const n = latCap(reg, 'normal', 0.5, 0.2), r = latCap(reg, 'rain', 0.5, 0.2);
    const rel = Math.abs((r.cap / n.cap) - wetPred) / wetPred;
    const dFz = Math.max(...n.fz.map((v, i) => Math.abs(v - r.fz[i])));
    ok(rel < 1e-4 && dFz > 0, `A6 ${reg} 走行中 (u=0.2·maxV) の比の残差 ${rel.toExponential(2)} < 1e-4・機序=輪荷重がタイヤで ${dFz.toExponential(2)} 違う (惰行の荷重移動が nSub で量子化・静止では厳密)`);
  }
}

// ============================================================================
console.log('\n=== B: ウェットで「正しいタイヤ選択が速い」(本番 runRace・摩擦限界に届く条件) ===');
// **摩擦限界に届かない条件では μ を上げても速くならない**ので、まずその境界を測ってから lap を測る。
// 卓上 normal は設計上 max ay ≈ 1.6 ≪ μg (AO_spec §4) = 限界に届かない ⇒ 卓上ウェット2コースでは
// タイヤ差が lap に出ない。fullscale 競技サーキット (f2 と同一の本番設定) は限界域を走る。
const PC = prog('comp_circuit');
const circuitAt = (grip) => buildFromSpec({ name: '競技サーキット (フルスケール)', kind: 'track', shape: 'superellipse', rx: 360, ry: 230, k: 0.55, width: 28, samples: 160, grip });
function lapAt(grip, tire) {
  const r = runRace({ report: true, physics: 'v2', regime: 'fullscale', course: circuitAt(grip), laps: 1, interact: false,
    field: [{ name: 'C0', lang: 'c', src: PC.code, carType: 'normal_ff', tire, gear: 'direct' }],
    crashRule: { rejoin: true, penaltySec: 3 }, maxSec: 200 });
  const f = r.finishers[0];
  return f ? f.totalTimeMs : null;
}
const GS = [0.5, 0.7, 1.0];
const lapN = {}, lapR = {};
for (const g of GS) { lapN[g] = lapAt(g, 'normal'); lapR[g] = lapAt(g, 'rain'); }
for (const g of GS) console.log(`  grip=${g.toFixed(2)}: normal=${lapN[g] == null ? 'DNF' : Math.round(lapN[g])}ms  rain=${lapR[g] == null ? 'DNF' : Math.round(lapR[g])}ms`);
ok(GS.every((g) => lapN[g] != null && lapR[g] != null), 'B0 全条件で完走 (DNF が混ざると時間比較が無意味になる)');
if (GS.every((g) => lapN[g] != null && lapR[g] != null)) {
  const gainWet = (lapN[0.5] - lapR[0.5]) / lapN[0.5];
  ok(gainWet > 0.02, `B1 grip=0.5: レインが ${(gainWet * 100).toFixed(2)}% 速い (>2%)`);
  // 路面低下に対する感度: ノーマルは遅くなる / レインはほぼ平坦 (排水で取り戻す) = 効果の本体。
  const degN = (lapN[0.5] - lapN[1.0]) / lapN[1.0];
  const degR = Math.abs(lapR[0.5] - lapR[1.0]) / lapR[1.0];
  ok(degN > 0.03, `B2 ノーマルは路面低下で遅くなる: grip 1.0→0.5 で +${(degN * 100).toFixed(2)}% (>3%)`);
  ok(degR < degN / 2, `B2' レインは路面低下に鈍い: 同区間の変化 ${(degR * 100).toFixed(2)}% がノーマルの半分未満`);
  // 中間点 (g*近傍の外側) も同じ向き = 単一点の偶然でないこと。
  ok(lapR[0.7] < lapN[0.7], `B3 grip=0.7 でもレインが速い (${Math.round(lapR[0.7])} < ${Math.round(lapN[0.7])}ms)`);
}
// 正直な追加測定: 卓上の出荷ウェット2コース (既定3サンプル) では lap 差が出ない = 限界に届かないため。
// **これは失敗ではなく設計 (AO_spec §4「卓上 normal はまず滑らない」) の帰結**で、母集団で確認する。
{
  const KEYS = ['normal_fr', 'normal_awd', 'normal_ff'];
  const fieldOf = (tire) => KEYS.map((k, i) => { const p = prog(k); return { name: ['A', 'B', 'C'][i], lang: 'c', src: p.code, carType: p.carType, tire, gear: 'direct' }; });
  const wets = specs.map((s, i) => ({ s, i })).filter((x) => x.s.grip != null && x.s.grip < 1);
  let finN = 0, finR = 0, maxAy = 0;
  for (const { s } of wets) {
    const course = buildFromSpec(s);
    for (const [tire, add] of [['normal', (n) => finN += n], ['rain', (n) => finR += n]]) {
      // **regime を明示する** (省略すると直前の章が残した live 領域で走る=AS8 で踏んだ「領域とコースの
      // 組合せを検査せずに領域比較をする」落とし穴。実測: 明示しないと fullscale が残り全車 DNF になった)。
      const r = runRace({ course, regime: 'tabletop', laps: 3, physics: 'v2', field: fieldOf(tire), crashRule: { rejoin: false, penaltySec: 3 }, interact: true, report: true });
      add(r.finishers.length);
      for (const rep of r.report) maxAy = Math.max(maxAy, rep.muPeakPct / 100);
    }
  }
  console.log(`  卓上ウェット2コース×既定3サンプル: 完走 normal=${finN} rain=${finR} (母集団・摩擦円利用率ピーク ${(maxAy * 100).toFixed(0)}%)`);
  ok(finN >= 0 && finR >= 0, `B4 卓上ウェットの母集団完走数を記録 (normal=${finN}/6・rain=${finR}/6)`);
  // 卓上 normal の到達 ay は μg に遠く及ばない ＝ 「タイヤを替えても lap は変わらない」の機序。
  applyRegime('tabletop');
  const capT = cap('tabletop', 'normal', 0.5);
  const ayMax = CAR.maxSpeed * CAR.maxSpeed / 0.30;   // 最小 R≈0.30m での到達可能 ay (AO_spec §4 の見積り)
  ok(ayMax < capT * 0.6, `B5 卓上ウェットは摩擦限界に届かない: 到達可能 ay≈${ayMax.toFixed(2)} < 横容量 ${capT.toFixed(2)} の 60% = 「lap でタイヤ差が出ない」機序 (AO_spec §4 の設計どおり)`);
}

// ============================================================================
console.log('\n=== C: ギア比の法則 (最高速比 = 1/r・加速は逆向き) ===');
// 相似領域 (卓上/中スケール) は「ギア比が決める頭打ち」が支配 ⇒ 最高速比は厳密に 1/r になるはず。
for (const reg of ['tabletop', 'midscale']) {
  const secs = reg === 'tabletop' ? 12 : 18;
  const d = straight(reg, 'direct', secs), s = straight(reg, 'short', secs), tl = straight(reg, 'tall', secs);
  const rs = GEARS.short.ratios[0], rt = GEARS.tall.ratios[0];
  const relS = Math.abs((s.vEnd / d.vEnd) - 1 / rs) / (1 / rs);
  const relT = Math.abs((tl.vEnd / d.vEnd) - 1 / rt) / (1 / rt);
  console.log(`  ${reg}: t50 short=${s.tHalf.toFixed(3)} direct=${d.tHalf.toFixed(3)} tall=${tl.tHalf.toFixed(3)} / vEnd 比 short=${(s.vEnd / d.vEnd).toFixed(4)} tall=${(tl.vEnd / d.vEnd).toFixed(4)}`);
  ok(relS < 1e-3, `C1 ${reg} ロー: 最高速比 ${(s.vEnd / d.vEnd).toFixed(4)} = 1/${rs} (相対差 ${relS.toExponential(2)} < 1e-3)`);
  ok(relT < 1e-3, `C1' ${reg} ハイ: 最高速比 ${(tl.vEnd / d.vEnd).toFixed(4)} = 1/${rt} (相対差 ${relT.toExponential(2)} < 1e-3)`);
  ok(s.tHalf < d.tHalf && d.tHalf < tl.tHalf, `C2 ${reg} 加速は逆向き: t50 short(${s.tHalf.toFixed(3)}) < direct(${d.tHalf.toFixed(3)}) < tall(${tl.tHalf.toFixed(3)}) = 交換が成立`);
  ok(s.vEnd < d.vEnd && d.vEnd < tl.vEnd, `C2' ${reg} 最高速は加速と逆順 = 「どれかが常に最良」ではない`);
}
// 2速オートマ: 実際に変速し、変速中は駆動が切れる。切れ時間は Froude 時間 √(L/0.13) で領域追従。
for (const reg of ['tabletop', 'midscale', 'fullscale']) {
  const secs = reg === 'fullscale' ? 90 : (reg === 'midscale' ? 18 : 12);
  const a = straight(reg, 'auto2', secs);
  const kT = Math.sqrt(REGIMES[reg].L / REGIMES.tabletop.L);
  const predCut = GEARS.auto2.shiftSec0 * kT;
  ok(a.shifts >= 1, `C3 ${reg} 2速オートマが実際に変速した (${a.shifts} 回)`);
  ok(Math.abs(a.cutSec - predCut) <= DT * 1.5 * kT + 1e-9, `C3' ${reg} 駆動切れ ${a.cutSec.toFixed(3)}s ≒ 予測 ${predCut.toFixed(3)}s (Froude 時間 √(L/0.13)=${kT.toFixed(3)} 追従・刻み量子化内)`);
}
// fullscale は「空力抗力が決める頭打ち」が先に来るのでハイギアでは最高速が伸びない (構造から予測できる乖離)。
{
  const d = straight('fullscale', 'direct', 90), s = straight('fullscale', 'short', 90), tl = straight('fullscale', 'tall', 90);
  const rs = GEARS.short.ratios[0];
  console.log(`  fullscale: vEnd direct=${d.vEnd.toFixed(2)} short=${s.vEnd.toFixed(2)} tall=${tl.vEnd.toFixed(2)} m/s`);
  ok(Math.abs(tl.vEnd / d.vEnd - 1) < 0.01, `C4 fullscale ハイギアで最高速が伸びない (比 ${(tl.vEnd / d.vEnd).toFixed(4)}≈1) = 抗力律速が先に効く (ギア律速ではない)`);
  ok(s.vEnd < d.vEnd * 0.95 && Math.abs(s.vEnd / d.vEnd - 1 / rs) < 0.15, `C4' fullscale ローギアは最高速を下げる (比 ${(s.vEnd / d.vEnd).toFixed(4)}) = ギア律速が抗力律速より低い側`);
  ok(tl.tHalf > d.tHalf, `C4'' fullscale ハイギアは加速だけ悪化 (t50 ${tl.tHalf.toFixed(2)}s > ${d.tHalf.toFixed(2)}s) = 伸びない最高速のために加速を捨てる`);
}

// ============================================================================
console.log('\n=== D: 既定装備の完全縮退 (非既定を選んだときだけ記録条件が変わる) ===');
const oval = buildFromSpec({ name: 'オーバル', kind: 'track', shape: 'ellipse', rx: 1.2, ry: 0.75, width: 0.55 });
const PF = prog('normal_fr');
const hashOf = (extra, phys) => runRace({ course: oval, laps: 2, physics: phys,
  field: [{ name: 'C0', lang: 'c', src: PF.code, carType: 'normal_fr', ...extra }],
  crashRule: { rejoin: false, penaltySec: 3 } }).verifyHash;
for (const phys of [undefined, 'v2']) {
  const label = phys || 'dynamic(既定)';
  const base = hashOf({}, phys);
  ok(hashOf({ tire: 'normal', gear: 'direct' }, phys) === base, `D1 ${label}: tire=normal・gear=direct を明示しても既定と同一 hash (${base}) = canon にキーが載らない`);
  ok(hashOf({ tire: 'xxx', gear: 'yyy' }, phys) === base, `D1' ${label}: 未知値は既定へ正規化されて同一 hash (白リスト外の混入で記録が割れない)`);
  const hr = hashOf({ tire: 'rain' }, phys), hg = hashOf({ gear: 'short' }, phys), ha = hashOf({ gear: 'auto2' }, phys);
  ok(new Set([base, hr, hg, ha]).size === 4, `D2 ${label}: rain / short / auto2 はいずれも既定と別 hash (${hr}/${hg}/${ha}) = 非既定が記録条件へ刻まれる`);
}
// v2 でのみ物理が変わる (旧エンジンは装備を無視する) — 記録条件には載るが軌跡は同じ。
{
  const runTrace = (phys, extra) => runRace({ course: oval, laps: 2, physics: phys, trace: true,
    field: [{ name: 'C0', lang: 'c', src: PF.code, carType: 'normal_fr', ...extra }],
    crashRule: { rejoin: false, penaltySec: 3 } }).traceHash;
  ok(runTrace(undefined, {}) === runTrace(undefined, { tire: 'rain', gear: 'auto2' }),
    'D3 dynamic エンジンは装備を無視する: 軌跡 traceHash が既定と完全一致 (UI の「v2 のみ効きます」注記が実態と一致)');
  ok(runTrace('v2', {}) !== runTrace('v2', { tire: 'rain', gear: 'auto2' }),
    'D3\' v2 エンジンでは装備が軌跡を変える (traceHash が異なる)');
}
// 白リストとラベルの整合 (増設時の付け忘れ検出は wf_i18n_check ⑧ が担当・ここは物理側の解決可能性)。
{
  applyRegime('tabletop');
  ok(TIRE_SETS.every((k) => tireParamsFor(k) && tireParamsFor(k).mu0 > 0), `D4 TIRE_SETS 全 ${TIRE_SETS.length} 種が物理定数へ解決できる`);
  ok(GEAR_SETS.every((k) => GEARS[k] && Array.isArray(GEARS[k].ratios) && GEARS[k].ratios.length >= 1), `D4' GEAR_SETS 全 ${GEAR_SETS.length} 種がギア定義へ解決できる`);
  ok(GEARS.direct.ratios.length === 1 && GEARS.direct.ratios[0] === 1, 'D4\'\' 既定 direct は「単段・比1」= 変速機構なし (byte 不変の構造的根拠)');
}

// ============================================================================
console.log('\n=== E: 既存ラッチ (siMinMu) への影響 = 崖の監視 (AS7 申し送り) ===');
// v2 は μ0eff = mu0·gripEff が siMinMu(=0.35) を下回ると車輪 ODE を原 explicit へ戻す (AP13)。
// **新しい装備がこのラッチの手前/奥のどちらに居るかを常時測る** (AS7 の siWheelThresh 崖と同型)。
{
  const { V2 } = await import('./public/js/physics_v2.js');
  applyRegime('tabletop');
  const T = { normal: tireParamsFor('normal'), rain: tireParamsFor('rain'), slip: tireParamsFor('slip') };
  // レインの μ0eff は grip→0 でも mu0·wetGain が下限 = ラッチを跨がない。
  const rainFloor = T.rain.mu0 * effGrip(0, T.rain);
  ok(rainFloor > V2.siMinMu, `E1 レインは grip=0 でも μ0eff=${rainFloor.toFixed(4)} > siMinMu=${V2.siMinMu} (余裕 ×${(rainFloor / V2.siMinMu).toFixed(3)}) = 崖を跨がない`);
  // ノーマルは grip がある値を割ると跨ぐ (AS9 が作った崖ではなく既存の構造)。出荷ウェットとの余裕を監視。
  const gCliff = V2.siMinMu / T.normal.mu0;
  const wetMin = Math.min(...specs.filter((s) => s.grip != null && s.grip < 1).map((s) => s.grip));
  ok(wetMin > gCliff, `E2 ノーマルの崖は grip=${gCliff.toFixed(4)}・出荷ウェット最小は ${wetMin} (余裕 ×${(wetMin / gCliff).toFixed(3)}) = 出荷コースは崖の手前`);
  console.log(`  (監視値) レイン下限 μ0eff=${rainFloor.toFixed(4)} / ノーマル崖 grip=${gCliff.toFixed(4)} / 出荷ウェット最小 grip=${wetMin}`);
  // 領域不変: gripEff は無次元なので3領域で同じ値を返す (AS8 の「新しい閾値は無次元か」を踏襲)。
  const effs = ['tabletop', 'midscale', 'fullscale'].map((reg) => { applyRegime(reg); return effGrip(0.5, tireParamsFor('rain')); });
  ok(new Set(effs.map((x) => x.toFixed(15))).size === 1, `E3 gripEff は領域不変 (3領域とも ${effs[0].toFixed(6)}) = 無次元`);
}

applyRegime('tabletop');
console.log(`\n${'─'.repeat(60)}\nAS9 タイヤ/ギア ゲート: PASS ${pass} / FAIL ${fail}`);
if (fail > 0) process.exit(1);
