// wf_ap26_pendulum.mjs — Stage AP26「S字ペンデュラム専用ベンチ＋β持ち越しオラクル」
// PLAN AP26・AP1_audit §AP26(physics C5)。
//   出荷S字(S字シケイン)は「切返し間隔/緩和長 relLen」が大きすぎて β 持ち越し(pre-swing で作った横滑り角 β が
//   次の turn-in まで生き残る効果)を測れない。本ゲートは:
//     ① 治具(bench-schicane-*)の切返し間隔/relLen が [2,4] にあること、出荷S字は ≫4(不適)であることを
//        **実 buildFromSpec の中心線**から機械確認する(criterion ①)。
//     ② 事前振り(pre-swing flick)有/無での turn-in β 差を**連続量 deg** で測り、分解能を超えて分離するか、
//        または「効果なし(ゼロ)」を測定確定するか、を実 CarV2 で確定する(criterion ②)。
//
// **再実装せず 実 buildFromSpec / CarV2(精密 v2)/ 実 CAR.wheelBase(relLen=relLenFrac·L) を呼ぶ**
//   (CI-14・oracle_inventory.md)。物理ソース(public/js)は1行も触らない=criterion ③(f0〜f3 不変)。
//
// 計測モデル(実装前固定):
//  【切返し間隔】= 閉中心線の**符号付き曲率の符号反転(左→右の切返し)間の平均弧長**。中心線は track 型が
//     course に保持しないため、実 buildFromSpec の**壁**から復元する(outer[i]=walls[i], inner[i]=walls[n+i],
//     中点=中心線点。offsetTrack の定義そのもの=純幾何)。
//  【緩和長 relLen】= relLenFrac(0.5)·L(=実 CAR.wheelBase、tabletop v2 で 0.065m)。physics_v2.js:300 と同一式。
//  【β 持ち越し】= 直進速度 U で走行中に **右へ brief flick(dFlick)→直進(CENTER)で carry 距離 d を走る**とき、
//     carry 後に残る |β|(横滑り角 = atan2(vlat,|u|))の**包絡**(位相依存の振動を平均するため d±0.5relLen 窓の max)。
//     事前振り無し(直進のみ)は β=0 ゆえ、この包絡値がそのまま「事前振り有/無の turn-in β 差」= 持ち越し量。
//     carry 距離 d = 各治具/出荷S字の**実測切返し間隔**を使う(=治具幾何と β 測定を結ぶ)。
//  【分解能】= 完全緩和参照(carry 12×relLen)で残る |β|(=緩和床。AP26 起票時 ≈0.01-0.02°・AW1 v8.0.0 では 0.034°＝参照解
//     〔原 explicit〕の 0.0343° と同じ。過小伝達の物理では小さく出ていた)より上に取る保守床 0.05°。出荷 S 字の残|β|(0.0416°)に
//     対する床の余裕は 0.0084°=17%(本ゲートが印字)。
//     決定論は bit 完全一致(数値分解能 0)。0.05°未満=「持ち越しなし(緩和)」・以上=「持ち越しを分解」。
//  【弁別性】= flick 中の peak |β|(βrelease)が大きい(≥5°)=ハーネスが β を実測できている証拠(死んだ計器でない)。

import { buildFromSpec } from './public/js/course.js';
import { CarV2, V2 } from './public/js/physics_v2.js';
import { CAR, CONST, setPhysicsMode, APP_VERSION } from './public/js/config.js';
import { applyRegime } from './public/js/physics_dyn.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const deg = 180 / Math.PI, DT = 1 / 60;

setPhysicsMode('v2'); applyRegime('tabletop');
const RELLEN = 0.5 * CAR.wheelBase;                    // relLenFrac·L (tabletop v2)
const R_MIN = CAR.wheelBase / Math.tan(CAR.maxSteer);   // 実舵の運動学的最小半径
const DIAG = Math.hypot(CAR.length, CAR.width);         // 車体外形対角(廊下収納の下限)
const RES = 0.05;                                       // β 分解能床(deg・保守)
console.log(`\n[AP26] S字ペンデュラム β持ち越し  (tabletop v2・relLen=${RELLEN.toFixed(4)}m・R_min=${R_MIN.toFixed(3)}m・対角=${DIAG.toFixed(3)}m・分解能床=${RES}°)`);

// ── 中心線復元 + 切返し間隔(符号付き曲率の符号反転間の平均弧長) ─────────────────────
function centerlineFromWalls(course) {
  const w = course.walls, n = w.length / 2, cl = [];
  for (let i = 0; i < n; i++) cl.push([(w[i].x1 + w[n + i].x1) / 2, (w[i].y1 + w[n + i].y1) / 2]);
  return cl;
}
function switchbackInterval(cl) {
  const n = cl.length, P = cl.map(p => ({ x: p[0], y: p[1] }));
  let total = 0; const seg = [];
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; const d = Math.hypot(b.x - a.x, b.y - a.y); seg.push(d); total += d; }
  const kappa = [];
  for (let i = 0; i < n; i++) {
    const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
    const t1x = b.x - a.x, t1y = b.y - a.y, t2x = c.x - b.x, t2y = c.y - b.y;
    const cross = t1x * t2y - t1y * t2x, l1 = Math.hypot(t1x, t1y) || 1e-9, l2 = Math.hypot(t2x, t2y) || 1e-9;
    kappa.push(Math.asin(Math.max(-1, Math.min(1, cross / (l1 * l2)))));   // 符号付き曲率(旋回角)
  }
  let changes = 0, prevSign = 0;
  for (let i = 0; i <= n; i++) { const k = kappa[i % n]; if (Math.abs(k) < 1e-6) continue; const s = k > 0 ? 1 : -1; if (prevSign !== 0 && s !== prevSign) changes++; prevSign = s; }
  return { arclen: total, changes, interval: changes > 0 ? total / changes : Infinity };
}

// ── β 持ち越しオラクル(実 CarV2・open lane・pre-swing flick → carry → 残 |β| 包絡) ──────
const betaOf = c => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
function holdU(car, U) { const e = U - car.u; if (e > 0.05) { car.driveDir = CONST.FORWARD; car.pwm = Math.min(255, 40 + e * 300); } else if (e < -0.1) { car.driveDir = CONST.BRAKE; car.pwm = 0; } else { car.driveDir = CONST.FORWARD; car.pwm = 40; } }
function travel(car, steer, U, dist, cb) { let t = 0, px = car.x, py = car.y, g = 0; while (t < dist && g++ < 20000) { car.steer = steer; holdU(car, U); car.step(DT); t += Math.hypot(car.x - px, car.y - py); px = car.x; py = car.y; if (cb) cb(car); } }
// flick RIGHT(dFlick) → CENTER carry(記録); βrelease=flick 中の peak|β|; 各 carry 距離での残|β| サンプル。
function carryProfile(U, dFlick) {
  const car = new CarV2({ x: 0, y: 0, theta: 0 }); car.type = 'normal_fr'; car.tireSet = 'normal';
  let g = 0; while (car.u < U * 0.995 && g++ < 4000) { car.steer = CONST.CENTER; holdU(car, U); car.step(DT); }
  let betaRelease = 0; travel(car, CONST.RIGHT, U, dFlick, c => { const b = Math.abs(betaOf(c)); if (b > betaRelease) betaRelease = b; });
  const samp = []; let s = 0, qx = car.x, qy = car.y; g = 0;
  while (s < 1.2 && g++ < 40000) { car.steer = CONST.CENTER; holdU(car, U); car.step(DT); s += Math.hypot(car.x - qx, car.y - qy); qx = car.x; qy = car.y; samp.push([s, Math.abs(betaOf(car))]); }
  return { betaRelease, samp };
}
// carry 距離 dd での残|β| 包絡(位相平均のため dd±0.5relLen 窓の max)
function envAt(samp, dd) { let m = 0; for (const [s, b] of samp) if (Math.abs(s - dd) <= 0.5 * RELLEN && b > m) m = b; return m; }

// ── Part A: 治具/出荷S字 の切返し間隔/relLen (criterion ①) ───────────────────────────
console.log(`\n[A] 切返し間隔/relLen (実 buildFromSpec 中心線)  目標: 治具∈[2,4] / 出荷S字≫4`);
const benches = JSON.parse(readFileSync('./docs/stage_ao/bench_courses.json', 'utf8'));
const jigSpecs = benches.filter(b => b.name.startsWith('bench-schicane-'));
ok(jigSpecs.length >= 2, `A0 治具 cell ≥2 (実 ${jigSpecs.length})`);
const jigs = [];
for (const spec of jigSpecs) {
  const c = buildFromSpec(spec);
  const sb = switchbackInterval(centerlineFromWalls(c));
  const ratio = sb.interval / RELLEN;
  jigs.push({ name: spec.name, interval: sb.interval, ratio, changes: sb.changes, width: +spec.width });
  ok(ratio >= 2 && ratio <= 4, `A ${spec.name}: 切返し間隔=${sb.interval.toFixed(4)}m /relLen=${ratio.toFixed(2)} ∈[2,4] (符号反転${sb.changes})`);
  ok(spec.width > DIAG, `A ${spec.name}: 廊下${spec.width}>車体対角${DIAG.toFixed(3)}(車体が収まる=走行可能床)`);
}
// 出荷S字シケインは ≫4 (不適)。当ゲートの明確な定義での実測値を報告(AP1_audit の見積り 10.7 と同帯)。
const courses = JSON.parse(readFileSync('./public/data/courses.json', 'utf8'));
const arr = Array.isArray(courses) ? courses : (courses.courses || []);
const shipSpec = arr.find(c => c.name === 'S字シケイン');
const shipSb = switchbackInterval(centerlineFromWalls(buildFromSpec(shipSpec)));
const shipRatio = shipSb.interval / RELLEN;
ok(shipRatio > 4, `A 出荷S字シケイン: 切返し間隔=${shipSb.interval.toFixed(4)}m /relLen=${shipRatio.toFixed(2)} >4 =β持ち越し測定に不適 (AP1_audit 見積り≈10.7・当ゲート実測=${shipRatio.toFixed(2)})`);

// ── Part B: β 持ち越し(事前振り有/無の turn-in β 差・連続量 deg) (criterion ②) ────────
console.log(`\n[B] β持ち越し(pre-swing flick 後の残|β| 包絡・事前振り無し=β0 ゆえ包絡=turn-in β差)`);
const US = [0.35, 0.5, 0.68], DFLICK = 0.13;
// 完全緩和参照(carry 12×relLen)=緩和床。決定論(bit 一致)。
const betaTable = [];
for (const U of US) {
  const prof = carryProfile(U, DFLICK);
  // 弁別性: flick で有意な β を作れている(死計器でない)
  ok(prof.betaRelease >= 5, `弁別 U=${U}: βrelease=${prof.betaRelease.toFixed(2)}°≥5°(ハーネスが β を実測)`);
  const row = { U, betaRelease: +prof.betaRelease.toFixed(3) };
  // 各治具の実測間隔での残|β|(持ち越し)
  for (const j of jigs) { const e = envAt(prof.samp, j.interval); row[j.name] = +e.toFixed(4); }
  // 出荷S字の間隔 + 完全緩和参照
  row.ship = +envAt(prof.samp, shipSb.interval).toFixed(4);
  row.relaxFloor = +envAt(prof.samp, 12 * RELLEN).toFixed(4);
  betaTable.push(row);
}
// criterion ②: 治具間隔では持ち越し>分解能(分離)、出荷S字間隔では≤分解能(緩和=測定不能)。全 U で。
for (const j of jigs) {
  for (const row of betaTable) {
    ok(row[j.name] > RES, `② 治具分離 ${j.name} U=${row.U}: 残|β|=${row[j.name]}°>分解能${RES}° =β持ち越しを分解(turn-in β差 有意)`);
  }
}
for (const row of betaTable) {
  ok(row.ship <= RES, `② 出荷S字 緩和 U=${row.U}: 残|β|=${row.ship}°≤分解能${RES}° =持ち越し測定不能(出荷S字が不適の実証)`);
}
// 分離度: 最小治具/最大出荷S字 を **参照解相対（±20% ∧ ≥2）** で固定する
// 【AW1（v8.0.0）で「固定 ≥10×」から刻み直し・緩和ではなく測定対象の是正】AP26 起票時の「≥10×」は AP13 の半陰的車輪 ODE が
//   接地速度を凍結して力を過小に伝えていた物理（v4.0.0〜v7.8.0）の上で決めた余裕値で、当時の実測は 16.5×
//   （最小治具 0.2619° / 最大出荷 0.0159°）。**同じ製品コードの陽的経路（原 explicit・nSub 上限 4096＝参照解）で
//   測り直すと 3.48×（0.1452° / 0.0417°）**＝10× は真の物理では成り立っていなかった。AW1（車輪 ODE を車体加速度と
//   同一 substep で連成）は 3.36×（0.1397° / 0.0416°・参照解比 −3.5%）。核心の述語（治具 > 分解能・出荷 ≤ 分解能）は
//   不変のまま緑。出荷 S 字の残|β| は緩和床（12×relLen・0.034°）より 22% 上にあり、分解能床 0.05° に対する余裕は 0.0084°（下で印字）。
let minJig = Infinity, maxShip = 0;
for (const row of betaTable) { for (const j of jigs) minJig = Math.min(minJig, row[j.name]); maxShip = Math.max(maxShip, row.ship); }
const sepCur = minJig / Math.max(maxShip, 1e-9);
// 参照解（同じ製品コードの陽的経路・V2.siActive=false → step() が needW を課す原 explicit）で同じ分離度を測り、**参照解との相対**で固定する
// （AW1 敵対的レビュー #4: 固定値 3 は実測 3.36 の直下＝将来の微小変化で赤になる床。参照解突合なら「緩和」と「是正」を区別できる）。
const sepRef = (() => { const keep = V2.siActive; V2.siActive = false; try {
  let mj = Infinity, ms = 0;
  for (const U of US) { const prof = carryProfile(U, DFLICK); for (const j of jigs) mj = Math.min(mj, envAt(prof.samp, j.interval)); ms = Math.max(ms, envAt(prof.samp, shipSb.interval)); }
  return mj / Math.max(ms, 1e-9); } finally { V2.siActive = keep; } })();
ok(sepCur >= 2 && Math.abs(sepCur / sepRef - 1) <= 0.2,
   `② 分離度: 最小治具残|β|=${minJig.toFixed(4)}° / 最大出荷S字残|β|=${maxShip.toFixed(4)}° = ${sepCur.toFixed(2)}×（参照解 ${sepRef.toFixed(2)}× の ±20% 以内 ∧ ≥2。v7.8.0 は過小伝達の副作用で 16.5×）`);

// 決定論: 同一条件2回 bit 一致。
{
  const a = carryProfile(0.5, DFLICK), b = carryProfile(0.5, DFLICK);
  const ea = envAt(a.samp, jigs[0].interval), eb = envAt(b.samp, jigs[0].interval);
  ok(ea === eb && a.betaRelease === b.betaRelease, `B 決定論(残|β| 2回 bit 一致 ${ea}/${eb} βrelease ${a.betaRelease}/${b.betaRelease})`);
}

// ── 人間可読表 ───────────────────────────────────────────────────────────────────
console.log(`\n  治具/出荷S字 の切返し間隔:`);
for (const j of jigs) console.log(`    ${j.name.padEnd(26)} 間隔=${j.interval.toFixed(4)}m ratio=${j.ratio.toFixed(2)} 廊下=${j.width}`);
console.log(`    ${'S字シケイン(出荷)'.padEnd(24)} 間隔=${shipSb.interval.toFixed(4)}m ratio=${shipRatio.toFixed(2)} (≫4=不適)`);
console.log(`\n  β持ち越し残|β|(deg・pre-swing flick 後・carry=各間隔):`);
const hdr = `    U      βrelease | ` + jigs.map(j => j.name.replace('bench-schicane-', 'jig-')).join(' ') + ` | ship(≈11.6x) | 緩和床(12x)`;
console.log(hdr);
for (const row of betaTable) {
  console.log(`    ${String(row.U).padEnd(6)} ${String(row.betaRelease).padStart(6)}°  | ` +
    jigs.map(j => `${String(row[j.name]).padStart(6)}°`).join('       ') + `   | ${String(row.ship).padStart(7)}°   | ${String(row.relaxFloor).padStart(6)}°`);
}
const maxRelax = Math.max(...betaTable.map(r => r.relaxFloor));
console.log(`\n  出荷S字 残|β| max ${maxShip.toFixed(4)}° ≤ 分解能床 ${RES}°: 余裕 ${(RES - maxShip).toFixed(4)}°(${(100 * (RES - maxShip) / RES).toFixed(0)}%)  緩和床(12×relLen) max ${maxRelax.toFixed(4)}°(出荷は床の ${(maxShip / maxRelax).toFixed(2)} 倍)  分離度 ${sepCur.toFixed(2)}× / 参照解 ${sepRef.toFixed(2)}× (${(100 * (sepCur / sepRef - 1)).toFixed(1)}%)`);
console.log(`\n  → β持ち越しは実在(治具間隔 2-4×relLen で 残|β| ~${minJig.toFixed(2)}-${betaTable.reduce((m,r)=>Math.max(m,...jigs.map(j=>r[j.name])),0).toFixed(2)}°>分解能)が、`);
console.log(`    ~4-6×relLen 以内で緩和し、出荷S字(11.6×relLen)では ${maxShip.toFixed(3)}°≤分解能=測定不能。∴治具が必要(AP1_audit C5 の実証)。`);

if (process.argv.includes('--json')) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, relLen: +RELLEN.toFixed(4), Rmin: +R_MIN.toFixed(4), res: RES,
    jigs, shipInterval: +shipSb.interval.toFixed(4), shipRatio: +shipRatio.toFixed(2), betaTable, minJig: +minJig.toFixed(4), maxShip: +maxShip.toFixed(4) }, null, 0));
}
console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
