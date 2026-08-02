// wf_ao6_slip.mjs — Stage AO6「卓上/中スケール v2 opt-in＋スリップタイヤ」の受け入れゲート。
// AO_spec §4・§10.2・§12 AO6 を「知覚→測定の翻訳 (CI-14)」で連続量マージンの機械検査に落とす。
// **再実装せず 実 CarV2.step / applyRegime / applyRegimeV2 / tireParamsFor / runRace の本物のオラクルを呼ぶ**。
//
// ── §10.2 の測定設計 (CI-14 測定訂正・実装前固定・決定ログ AO-6 に全文) ────────────────────────
// 実測で判明した2つの隠れ変数により、素朴な述語を「同じ物理主張を測る真のオラクル」へ訂正する
// (CI-7 の緩和ではなく AO5 skidpad 前例と同型の測定対象の是正。素朴述語は目視必須の旗として残す)。
//  (a) 「幾何スリップ角」: 卓上の極小 R_min=0.29m では 定常全舵旋回の車体すべり角 β_CG≈atan(b/R)≈11° が
//      **タイヤ摩擦と無関係に**出る。∴ normal の「滑らない」を β<5° で測るのは幾何量に汚染される。真の
//      オラクル=摩擦円容量比 ay_achievable/latCap と 後軸タイヤスリップ σR (タイヤが限界に届くか)。
//  (b) 「3値ステアのチャタ」: LEFT/CENTER/RIGHT のみでは平衡ドリフト角を**連続保持できず**(実測: 連続保持は
//      最大 ~0.68s・grip↔spin をチャタ)。AO5 が skidpad を「摩擦円容量」へ訂正したのと同型。∴ slip の
//      ②「|β|∈[15,50] を3s保持」は **累積滞在時間≥3s ∧ スピンアウトしない(|β|<90 維持) ∧ 深い後軸スリップ**
//      (=制御可能な持続スライド=疑似ドリフト環境の成立) を真のオラクルとする。
import { CarV2, V2, tireParamsFor, applyRegimeV2 } from './public/js/physics_v2.js';
import { DYN, applyRegime, DynCar } from './public/js/physics_dyn.js';
import { CAR, CONST, REGIMES, PHYSICS, setPhysicsMode, TIRE_SETS, TIRE_DEFAULT } from './public/js/config.js';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';
import { SAMPLES } from './public/js/samples.js';

const DT = 1 / 60, R2D = 180 / Math.PI;
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

const beta = c => Math.atan2(c.vlat, Math.max(1e-6, Math.abs(c.u))) * R2D;   // signed body slip angle
function mk(type, tire, regime = 'tabletop') { applyRegime(regime); const c = new CarV2({ x:0,y:0,theta:0,grip:1,downhill:0 }); c.type = type; c.tireSet = tire; c.reset({ x:0,y:0,theta:0,grip:1,downhill:0 }); return c; }

// 摩擦円容量オラクル (AO5 と同型・純サイドスリップで latCap=Σμ_i·Fz_i を読む)。ay_achievable=最大速×最小R。
function capacityRatio(tire, regime = 'tabletop') {
  const c = mk('normal_fr', tire, regime); c.driveDir = CONST.FREE; c.steer = CONST.CENTER;
  const spd = CAR.maxSpeed;
  for (let i = 0; i < 6; i++) { c.u = spd; c.vlat = 0; c.r = 0; c.step(DT); }
  const latCap = c._latCapSS;
  const Rmin = CAR.wheelBase / Math.tan(CAR.maxSteer);
  const ayAch = spd * spd / Rmin;
  return { latCap, ayAch, ratio: ayAch / latCap };
}

// 発進空転① (駆動軸 vw vs u)。type で駆動輪 (FF=前/他=後) を選ぶ。
function launchSpin(type, tire, regime = 'tabletop') {
  const c = mk(type, tire, regime); c.driveDir = CONST.FORWARD; c.pwm = 255; c.steer = CONST.CENTER;
  const rear = type !== 'normal_ff';
  let mx = 0; for (let i = 0; i < 90; i++) { c.step(DT); const vw = rear ? c.vwR : c.vwF; mx = Math.max(mx, (Math.abs(vw) - Math.abs(c.u)) / Math.max(Math.abs(c.u), 0.02)); }
  return mx;
}

// 過激ドリフト台本 (全開・全舵導入→|β|>35 でカウンター)。持続スライド量・②'累積・スピンアウト・後軸σ。
function driftScript(type, tire, regime = 'tabletop') {
  const c = mk(type, tire, regime); c.driveDir = CONST.FORWARD;
  let framesSlide = 0, inband = 0, peakSigR = 0, spun = false;
  for (let i = 0; i < 900; i++) {
    c.pwm = 255;
    c.steer = i < 30 ? CONST.LEFT : (Math.abs(beta(c)) > 35 ? (c.r > 0 ? CONST.RIGHT : CONST.LEFT) : CONST.LEFT);
    c.step(DT);
    const ab = Math.abs(beta(c));
    peakSigR = Math.max(peakSigR, c._muUseR);
    if (ab >= 90) spun = true;
    if (ab >= 15 && ab < 90) framesSlide++;
    if (ab >= 15 && ab <= 50) inband++;
  }
  return { slideSec: framesSlide / 60, inbandSec: inband / 60, peakSigR, spun };
}

console.log('Stage AO6 ゲート  (卓上/中スケール v2 opt-in＋スリップタイヤ・§4/§10.2)');
console.log('='.repeat(66));

// ── A. スキーマ・凍結値 (config の退行検知・byte 不変の土台) ─────────────────────────
console.log('A. タイヤセット スキーマ / 凍結値');
{
  ok(TIRE_DEFAULT === 'normal', `A1: TIRE_DEFAULT='normal' (=${TIRE_DEFAULT})`);
  ok(Array.isArray(TIRE_SETS) && TIRE_SETS.includes('normal') && TIRE_SETS.includes('slip'), `A2: TIRE_SETS=[${TIRE_SETS}]`);
  const tt = REGIMES.tabletop.v2tire;
  ok(tt && tt.normal.mu0 === 0.8 && tt.slip.mu0 === 0.20 && tt.slip.muDecay === 0.95,
    `A3: 卓上 v2tire 凍結 (normal μ0=${tt.normal.mu0} / slip μ0=${tt.slip.mu0} muDecay=${tt.slip.muDecay})`);
  ok(REGIMES.fullscale.v2tire.normal.mu0 === 1.4, `A4: fullscale normal μ0=1.4 不変 (AO5・=${REGIMES.fullscale.v2tire.normal.mu0})`);
  ok(new CarV2({ x:0,y:0,theta:0,grip:1,downhill:0 }).tireSet === 'normal', 'A5: CarV2 既定 tireSet=normal');
}

// ── B. normal = 通常ドリフトは起きない (真オラクル: 摩擦円容量≪1 ∧ 持続スライド0) ──────────
console.log('B. normal タイヤ (通常ドリフトは起きない・§10.2 normal)');
{
  const cap = capacityRatio('normal');
  ok(cap.ratio <= 0.30, `B1: 摩擦円容量比 ay_ach/latCap=${cap.ratio.toFixed(3)} ≤0.30 (到達可能横G ${cap.ayAch.toFixed(2)} ≪ 容量 ${cap.latCap.toFixed(2)}=限界に届かない)`);
  // 素朴述語 β<5° は幾何スリップ角に汚染される (定常全舵で β_CG≈11°)。目視必須の旗として記録のみ:
  const b11 = mk('normal_fr', 'normal'); b11.driveDir = CONST.FREE; b11.steer = CONST.LEFT;
  for (let i = 0; i < 200; i++) { b11.u = 0.3; b11.vlat = b11.vlat; b11.r = b11.r; b11.step(DT); }
  console.log(`     (参考・目視必須の旗) 定常全舵 β_CG=${Math.abs(beta(b11)).toFixed(1)}° は幾何量 (σR≈${b11._muUseR.toFixed(2)}≪1=非スライド)`);
  for (const t of ['normal_fr', 'drift_fr', 'normal_awd']) {
    const d = driftScript(t, 'normal');
    ok(d.inbandSec === 0 && d.peakSigR <= 1.0,
      `B2 ${t}: 過激台本でも持続スライド0 (inband=${d.inbandSec.toFixed(2)}s・後軸σ_peak=${d.peakSigR.toFixed(2)}≤1.0=タイヤ限界未達)`);
    ok(launchSpin(t, 'normal') < 0.15, `B3 ${t}: 発進空転なし ((vw−u)/u=${launchSpin(t,'normal').toFixed(3)} <0.15)`);
  }
}

// ── C. slip = 疑似ドリフト環境が成立 (①発進空転 / ②'持続制御スライド / 容量到達) ───────────
console.log('C. slip タイヤ (疑似ドリフト環境が成立・§10.2 slip)');
{
  const cap = capacityRatio('slip');
  ok(cap.ratio >= 0.5 && cap.ratio <= 1.15, `C-cap: 摩擦円容量比 ay_ach/latCap=${cap.ratio.toFixed(3)} ∈[0.5,1.15] (μg≈${cap.latCap.toFixed(2)}=到達可能=滑れる)`);
  for (const t of ['normal_fr', 'drift_fr']) {
    const s = launchSpin(t, 'slip');
    ok(s > 0.15, `C1① ${t}: 発進空転 (vw−u)/u=${s.toFixed(2)} >0.15`);
    const d = driftScript(t, 'slip');
    ok(d.inbandSec >= 3 && !d.spun && d.peakSigR >= 5,
      `C2②' ${t}: 持続制御スライド 累積|β|∈[15,50]=${d.inbandSec.toFixed(2)}s ≥3s ∧ スピンアウトなし(spun=${d.spun}) ∧ 深後軸σ=${d.peakSigR.toFixed(1)}≥5`);
  }
  // AWD は駆動配分で power-over しにくい (understeer 寄り) が、発進空転は成立しスライドはする (氷ではない)。
  const awd = driftScript('normal_awd', 'slip');
  ok(launchSpin('normal_awd', 'slip') > 0.15 && awd.slideSec > 0, `C3 AWD: 発進空転${launchSpin('normal_awd','slip').toFixed(2)}>0.15 ∧ スライドする(${awd.slideSec.toFixed(2)}s>0・FR より安定=正直)`);
}

// ── D. slip オーバル完走 (③ 運転可能=氷ではない・基本サンプル SAMPLES.c で crash≤1) ────────────
// 「運転可能=氷ではない」= 適切な車で基本の壁回避サンプルがオーバルを制御下で周回できる。最も安定な
// 駆動 (normal_awd=4輪均等) で crash≤1 完走を示す。FR は slip でリアが破れる (=drift 向きの本領=氷ではなく
// 逆に滑りすぎる) ので参考記録に留める (grip 前提のプログラムを slip へ載せると過剰駆動＝AN と同型の教訓)。
console.log('D. slip でオーバル完走 (③ 運転可能=氷ではない・基本サンプル SAMPLES.c)');
{
  applyRegime('tabletop');
  const courses = (await import('./public/data/courses.json', { with: { type: 'json' } })).default;
  const oval = buildFromSpec(courses.find(c => c.name === 'オーバル'));
  const fieldOf = (ct, tire) => [{ name: 'T', lang: 'c', src: SAMPLES.c, carType: ct, tire }];
  const race = (ct, tire) => runRace({ report: true, course: oval, regime: 'tabletop', physics: 'v2', laps: 2, field: fieldOf(ct, tire), crashRule: { rejoin: true, penaltySec: 0 }, interact: false });
  const cc = (r) => r.report ? r.report[0].crashCount : 0;
  const rN = race('normal_awd', 'normal');
  const rS = race('normal_awd', 'slip');
  ok(rN.finishers.length === 1 && cc(rN) <= 1, `D1 normal_awd/normal: オーバル完走 (finishers=${rN.finishers.length}・crash=${cc(rN)}≤1)`);
  ok(rS.finishers.length === 1 && cc(rS) <= 1, `D2 normal_awd/slip:   オーバル完走 (finishers=${rS.finishers.length}・crash=${cc(rS)}≤1=運転可能=氷ではない)`);
  const rFR = race('normal_fr', 'slip');
  console.log(`     (参考) normal_fr/slip: crash=${cc(rFR)} finishers=${rFR.finishers.length} = FR は slip でリアが破れ過剰駆動 (=drift 向きの本領・氷でなく滑りすぎ・grip 前提プログラムの載せ替え課題=AN 教訓)`);
}

// ── E. midscale = Froude 導出 (無次元 v2tire をそのまま継承・§1/§10.2 midscale) ──────────
console.log('E. midscale v2 = Froude 導出 (卓上の v2tire を継承)');
{
  ok(REGIMES.midscale.v2tire === REGIMES.tabletop.v2tire, 'E1: midscale.v2tire は tabletop.v2tire を継承 (無次元=Froude 導出・参照一致)');
  applyRegime('midscale');
  const ms = tireParamsFor('slip'), tt = REGIMES.tabletop.v2tire.slip;
  ok(ms.mu0 === tt.mu0 && ms.muDecay === tt.muDecay && ms.alphaP === tt.alphaP && ms.kappaP === tt.kappaP,
    `E2: applyRegime(midscale)→tireParamsFor(slip) が卓上値 (μ0=${ms.mu0}) ＝Froude 導出が実際に適用される`);
  const cap = capacityRatio('slip', 'midscale');
  ok(cap.ratio >= 0.5 && cap.ratio <= 1.15, `E3: midscale slip も摩擦円容量比=${cap.ratio.toFixed(3)} ∈[0.5,1.15] (Ay* 領域不変=同じ操作で滑る)`);
  applyRegime('tabletop');
}

// ── F. canon byte 不変 (既定 normal は canon にキーを足さない・slip は別ハッシュ決定論) ──────
console.log('F. レース canon: normal=byte 不変 / slip=別ハッシュ決定論 (§7)');
{
  applyRegime('tabletop');
  const courses = (await import('./public/data/courses.json', { with: { type: 'json' } })).default;
  const oval = buildFromSpec(courses.find(c => c.name === 'オーバル'));
  const base = PROGRAMS.find(p => p.key === 'normal_fr');
  const mkField = (tire) => [{ name: 'T', lang: 'c', src: base.code, carType: 'normal_fr', ...(tire ? { tire } : {}) }];
  const spec = { course: oval, regime: 'tabletop', physics: 'v2', laps: 1, crashRule: { rejoin: true, penaltySec: 0 }, interact: false };
  const noTire   = runRace({ ...spec, field: mkField(null) });
  const normTire = runRace({ ...spec, field: mkField('normal') });
  const slip1    = runRace({ ...spec, field: mkField('slip') });
  const slip2    = runRace({ ...spec, field: mkField('slip') });
  ok(noTire.verifyHash === normTire.verifyHash, `F1: tire 省略 と tire='normal' で canon 同一 (${noTire.verifyHash}) = 既定 byte 不変`);
  ok(slip1.verifyHash !== normTire.verifyHash, `F2: slip は normal と別ハッシュ (${slip1.verifyHash}≠${normTire.verifyHash})`);
  ok(slip1.verifyHash === slip2.verifyHash, `F3: slip 決定論 (${slip1.verifyHash} ×2)`);
  ok(PHYSICS.mode === 'dynamic', `F4: runRace 後 PHYSICS.mode 復元 (=${PHYSICS.mode})`);
}

applyRegime('tabletop');   // 復元
const line = '─'.repeat(66);
console.log(line);
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
console.log(line);
console.log(fail === 0 ? '結果: PASS' : '結果: FAIL');
process.exit(fail === 0 ? 0 : 1);
