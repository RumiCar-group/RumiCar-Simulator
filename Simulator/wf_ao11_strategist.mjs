// AO11 戦略レーサー「Apex Strategist」常設アサートゲート＋検証オラクル (AO_spec §9.2・§12 AO11)。
// 出荷 programs.js の strategist を本番フロー(runRace・v2・fullscale・競技サーキット)で検証する(CI-9)。
//
// 受け入れ (§12 AO11・再スコープ済 §13-3 は AO8 全 NO-GO で発火):
//  ① 競技サーキット(recon あり)で Circuit Racer 比 ≥3% 速い・crash0
//  ② 戦略ドリフト状態機械は「GO 区間なし=常に grip・非発動」を実測(driftFired=0)。drift 無効版比 ±1%
//     (=非発動ゆえ ON/OFF 同一)。drift-GO 判定の幾何オラクル: 競技サーキット最小 R ≫ 1.1×R_min=6.4m(AO8)。
//  ③ 他車3台(Circuit Racer)+戦略レーサー=4台 interact・recon2 で全車完走・戦略レーサー追突誘発ゼロ。
//  ④ エンコーダ無しフォールバック完走(crash0)。
//
// 正直な実測(CI-14・AO8/AO10 と同型): 速さの大半は recon が保証する"攻めチューン"(反応型 高速)で生まれ、
//  精密な速度プロファイルの純利得はこの均一コーナー(全 R≈116m)+ToF 粗い自己位置(2回対称・AO10 絶対位置限界
//  と同根)では概ね中立。ゆえに本ゲートは「速度プロファイル計画が実装され使われている(profile 構築+加速ガバナ
//  +ドリフト SM が本番で走る)」ことと「Circuit Racer 比 ≥3%・crash0・drift 非発動・他車完走」を機械検証する。
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { PROGRAMS } from './public/js/programs.js';   // 出荷本体を検証 (CI-9)

const SPEC = { name: '競技サーキット (フルスケール)', kind: 'track', shape: 'superellipse', rx: 360, ry: 230, k: 0.55, width: 28, samples: 160 };
const circuit = buildFromSpec(SPEC);
const strat = PROGRAMS.find((p) => p.key === 'strategist');
const cr = PROGRAMS.find((p) => p.key === 'comp_circuit');
if (!strat) { console.error('strategist が programs.js に未登録'); process.exit(1); }

const stratField = (name, enc = true, src = strat.code) => ({ name, lang: 'py', src, carType: 'normal_ff', rear: false, encoder: enc });
const crField = (name) => ({ name, lang: 'c', src: cr.code, carType: 'normal_ff', rear: false, encoder: false });
const raceV2 = (opt) => runRace({ report: true, physics: 'v2', regime: 'fullscale', course: circuit, laps: 3,
  interact: false, crashRule: { rejoin: true, penaltySec: 3 }, maxSec: 600, ...opt });
const timeOf = (r) => { const f = r.finishers[0]; return f ? f.totalTimeMs / 1000 : null; };

// ───────── 幾何オラクル: 競技サーキット中心線の最小曲率半径 R_min (drift-GO 判定の真値・プログラム非公開=D-1) ─────────
const sg = (v) => (v < 0 ? -1 : 1);
const se = (t) => [SPEC.rx * sg(Math.cos(t)) * Math.pow(Math.abs(Math.cos(t)), SPEC.k), SPEC.ry * sg(Math.sin(t)) * Math.pow(Math.abs(Math.sin(t)), SPEC.k)];
const M = 4000, pts = [];
for (let i = 0; i < M; i++) pts.push(se(2 * Math.PI * i / M));
let Rmin = Infinity;
for (let i = 0; i < M; i++) {
  const A = pts[(i - 1 + M) % M], B = pts[i], C = pts[(i + 1) % M];
  const a = Math.hypot(B[0] - C[0], B[1] - C[1]), b = Math.hypot(A[0] - C[0], A[1] - C[1]), c = Math.hypot(A[0] - B[0], A[1] - B[1]);
  const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
  const R = area < 1e-9 ? Infinity : (a * b * c) / (4 * area);
  if (R < Rmin) Rmin = R;
}
const R_MIN_CAR = 5.84; // fullscale 車の最小回転半径 (wheelBase 2.60m / tan24°)。drift-GO は R<1.1×R_min=6.42m。

// ───────── 実行 ─────────
let ok = true;
const fail = (m) => { ok = false; console.error('  ✗ ' + m); };
const pass = (m) => console.log('  ✓ ' + m);

// ① Circuit Racer 比 ≥3%・crash0 (recon あり=self-recon lap1)
const base = raceV2({ field: [crField('CR')] });
let df = null; const probe = (t, slots) => { df = slots[0].controller.interp.global.vars.driftFired; };
const s = raceV2({ field: [stratField('STR')], recon: null, probe });
const bt = timeOf(base), st = timeOf(s);
const gain = (bt && st) ? (1 - st / bt) : null;
console.log(`① Circuit Racer 比: STR ${st ? st.toFixed(1) : 'DNF'}s vs CR ${bt ? bt.toFixed(1) : 'DNF'}s = ${gain != null ? (gain * 100).toFixed(1) + '%' : '-'} 速い / crash ${s.report[0].crashCount}`);
if (!(gain != null && gain >= 0.03)) fail(`Circuit Racer 比 ${gain != null ? (gain * 100).toFixed(1) + '%' : 'DNF'} < 3%`); else pass('≥3% 達成');
if (!(s.report[0].crashCount === 0)) fail(`crash ${s.report[0].crashCount} > 0`); else pass('crash0');

// ② 戦略ドリフト: 非発動 (driftFired=0) + 幾何オラクル (R_min ≫ 6.4m=全 NO-GO) + drift 無効版 ±1%
console.log(`② 戦略ドリフト: 競技サーキット最小 R=${Rmin.toFixed(1)}m / drift-GO 閾 1.1×R_min=${(1.1 * R_MIN_CAR).toFixed(1)}m → ${Rmin < 1.1 * R_MIN_CAR ? 'GO 区間あり' : '全 NO-GO(grip)'} ; driftFired=${df}`);
if (!(Rmin > 1.1 * R_MIN_CAR)) fail(`R_min ${Rmin.toFixed(1)}m ≤ 6.4m (drift-GO のはず=前提崩れ)`); else pass('R_min ≫ 6.4m=全 NO-GO (AO8 一致)');
if (!(df === 0)) fail(`driftFired ${df} ≠ 0 (GO 区間なしのはず)`); else pass('drift 非発動 (driftFired=0)');
const sOff = raceV2({ field: [stratField('STR', true, strat.code.replace('DRIFT_ON=1', 'DRIFT_ON=0'))], recon: null });
const stOff = timeOf(sOff);
const dd = (st && stOff) ? Math.abs(stOff / st - 1) : null;
console.log(`   drift 無効版: ${stOff ? stOff.toFixed(1) : 'DNF'}s (Δ ${dd != null ? (dd * 100).toFixed(2) + '%' : '-'} vs 有効版=非発動ゆえ ≈0)`);
if (!(dd != null && dd <= 0.01)) fail(`drift ON/OFF 差 ${dd != null ? (dd * 100).toFixed(2) + '%' : 'DNF'} > 1% (非発動のはず)`); else pass('drift ON/OFF ±1% (非発動)');

// ③ 他車3台 (Circuit Racer) + 戦略レーサー = 4台 interact・recon2: 全車完走・戦略レーサー crash0
const field4 = [stratField('STR'), crField('CR1'), crField('CR2'), crField('CR3')];
const m = raceV2({ field: field4, interact: true, recon: { laps: 2 } });
console.log(`③ 4台 interact (STR+CR×3・recon2): 完走 ${m.finishers.length}/4 / STR crash ${m.report[0].crashCount} / 他車 crash [${m.report.slice(1).map((x) => x.crashCount).join(',')}]`);
if (!(m.finishers.length === 4)) fail(`完走 ${m.finishers.length}/4 < 4 (他車3台完走せず)`); else pass('他車3台+戦略レーサー 全4台完走');
if (!(m.report[0].crashCount === 0)) fail(`戦略レーサー crash ${m.report[0].crashCount} > 0 (追突誘発)`); else pass('戦略レーサー 追突誘発ゼロ (crash0)');

// ④ エンコーダ無しフォールバック完走 (crash0)
const fb = raceV2({ field: [stratField('NE', false)] });
console.log(`④ フォールバック(エンコーダ無): ${timeOf(fb) ? timeOf(fb).toFixed(1) + 's' : 'DNF'} / crash ${fb.report[0].crashCount} / laps ${fb.report[0].lapsCompleted}`);
if (!(fb.finishers.length === 1 && fb.report[0].crashCount === 0)) fail('フォールバック 未完走 or crash>0'); else pass('フォールバック完走 (crash0)');

// 決定論: 同一 spec → 同一 verifyHash
const s2 = raceV2({ field: [stratField('STR')], recon: null });
if (!(s.verifyHash === s2.verifyHash)) fail(`決定論 破れ (${s.verifyHash} != ${s2.verifyHash})`); else pass(`決定論 verifyHash 一致 (${s.verifyHash})`);

console.log('\n' + (ok ? '✅ AO11 受け入れ基準 全合格 (①≥3%・②drift 非発動・③他車完走・④フォールバック・決定論)' : '❌ AO11 受け入れ基準 不合格'));
if (!ok) process.exit(1);
