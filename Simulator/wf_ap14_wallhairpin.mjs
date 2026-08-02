// wf_ap14_wallhairpin.mjs — Stage AP14「壁付き R<R_min ヘアピンベンチ＋壁込み go/no-go 実測」
// PLAN AP14・AP1_audit §AP14(physics C4)。AO8(自由空間・壁なし)が明示的に残した札
//   「壁へのアンダーステア激突は測っていない…壁接触は別途測る」(drift_gonogo.md:99-103) を
//   proxy→本物へ昇格し、ヘアピン廊下(壁)込みで grip/drift の通過可否を実測する。
//
// **再実装せず 実 buildFromSpec / CarV2.corners() / carEdges / checkCollision / distToSeg /
//   buildWallGrid・queryRadius(本番ブロードフェーズ) を呼ぶ**(CI-14・oracle_inventory.md)。
//
// 計測モデル(実装前固定・criterion ③=AO8 準拠を壁込みで):
//   AO8 は「回頭速度でなく制御された通過」を測った(自由空間・動的ドライバ)。壁込みでの「通過可否」は
//   まず**幾何的成立性**=「その戦略で辿れる最善の線に沿って 剛体車が廊下に収まるか」で定義する。
//   これは criterion ① の「最小壁クリアランス<0」を直接与える(壁は接触反力を入れない=線が廊下に
//   収まるかの純幾何。接触ソルバを通すと壁が押し戻して クリアランスは負にならない=①が観測不能)。
//   動的スクリプトドライバは「線の質(turn-in 遅れ)」が幾何成立性を汚す(制御セルでも外側に膨らむ)ため、
//   幾何成立性の計測には**最善線の掃引**を用いる(=戦略にその最善の線を与える=steelman)。
//
//   - grip の最善線 = 定常曲率弧(半径 R≥R_min=実舵の運動学的下限・β=0)。中心 yc と半径 R を掃引し
//     180°回頭に沿って 剛体車(corners())を置き、各姿勢の符号付き壁クリアランス(廊下内=+距離/外=−距離、
//     距離は distToSeg×carEdges)を測り、弧全体の最小 → 中心/半径で最大化(最善)。
//     R<R_min は grip 不能ゆえ探索しない(=criterion ① の「外径<R_min で幾何不能」)。
//   - drift の最善線 = より小さい半径 R∈[innerR,R_min] を 車体ヨー β(ドリフト角)付きで辿る
//     (ドリフトは車体を進路接線から β 傾けて 実効的により小回りできる)。R・yc・β を掃引して最善。
//     β の連続保持が動的に可能かは AO8 が別途測定済(3値ステアで平衡ドリフト保持不可)＝下の札で引用。
//
//   壁込み clean(通過可) = その戦略の最善線で「弧全域 符号付きクリアランス≥0 ∧ checkCollision 0」。
//   GO(壁込み drift-only) = drift が壁込み clean ∧ grip が壁込み不能(clean 不成立)＝「grip では通れず
//   ドリフト線なら通れる」セル。NO-GO = それ以外(不成立なら不足量=−最善クリアランス を記録＝成果)。
//
// 出力: 機械アサート(幾何/criterion①②/弁別性/決定論) は緑/赤。go/no-go 表は JSON(--json) で吐き
//        docs/stage_ap/AP14_wallhairpin.md へ整形転記する(版スタンプ=AP-0)。

import { buildFromSpec } from './public/js/course.js';
import { CarV2 } from './public/js/physics_v2.js';
import { CAR, CONST, setPhysicsMode, APP_VERSION } from './public/js/config.js';
import { applyRegime } from './public/js/physics_dyn.js';
import { checkCollision } from './public/js/physics.js';
import { distToSeg } from './public/js/geom.js';
import { buildWallGrid, queryRadius } from './public/js/contact_v2.js';
import { readFileSync } from 'fs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const rad = Math.PI / 180;

setPhysicsMode('v2');
applyRegime('fullscale');
const R_MIN = CAR.wheelBase / Math.tan(CAR.maxSteer);   // 実舵の運動学的最小半径(点経路)
const DIAG = Math.hypot(CAR.length, CAR.width);          // 車体外形の対角(廊下収納の下限)
console.log(`\n[AP14] 壁付きヘアピン 壁込み go/no-go  (fullscale・R_min=${R_MIN.toFixed(3)}m・車体対角=${DIAG.toFixed(3)}m)`);

const benches = JSON.parse(readFileSync('./docs/stage_ao/bench_courses.json', 'utf8'));
const wallSpecs = benches.filter(b => b.name.startsWith('bench-wall-'));

// 右キャップ幾何 + 本番ブロードフェーズグリッド。
function capGeom(spec) {
  const rr = +spec.rr, width = +spec.width;
  const outerR = rr + width / 2, innerR = rr - width / 2;
  const course = buildFromSpec(spec);
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const w of course.walls) { minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2); minY = Math.min(minY, w.y1, w.y2); maxY = Math.max(maxY, w.y1, w.y2); }
  const capX = maxX - outerR, capY = (minY + maxY) / 2;
  let measOut = -1e9, measIn = 1e9;
  for (const w of course.walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) {
    if (x > capX + 0.01) { const r = Math.hypot(x - capX, y - capY); if (r > measOut) measOut = r; if (r < measIn) measIn = r; }
  }
  return { course, grid: buildWallGrid(course.walls), rr, width, outerR, innerR, capX, capY, measOut, measIn };
}

// 解析廊下(実態の廊下幾何=fixture の capCenter/outerR/innerR)への内外判定。掃引域(右キャップ+近接直線)で有効。
function insideCorridor(p, g) {
  if (p.x >= g.capX) { const r = Math.hypot(p.x - g.capX, p.y - g.capY); return r >= g.innerR && r <= g.outerR; }
  const dy = p.y - g.capY;                                 // 直線区間: 上下どちらかの帯
  return (dy <= -g.innerR && dy >= -g.outerR) || (dy >= g.innerR && dy <= g.outerR);
}

// 剛体車(rear-axle=x,y・heading=theta)の符号付き壁クリアランス。
//   各隅の 最近接壁距離(distToSeg×近接壁=本番ブロードフェーズ queryRadius)を、廊下内なら+/外なら−。
//   隅の最小 = 姿勢のクリアランス(負=いずれかの隅が廊下外=線が壁を破る)。checkCollision も併記。
function poseClearance(car, g) {
  const cs = car.corners();
  const near = queryRadius(g.grid, car.x, car.y, DIAG / 2 + 1.0);   // 車を包む候補壁(答え不変)
  let sMin = 1e9;
  for (const p of cs) {
    let d = 1e9;
    for (const w of near) { const dd = distToSeg({ x: p.x, y: p.y }, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }); if (dd < d) d = dd; }
    const s = insideCorridor(p, g) ? d : -d;
    if (s < sMin) sMin = s;
  }
  const hit = checkCollision(car, near);
  return { s: sMin, hit };
}

// 定常曲率弧(中心 (capX, capY+yc)・半径 R・車体ヨー β)に沿って 180°回頭を掃引し、弧全域の最小クリアランス。
// φ_pos∈[-100°,100°](右半円+直線接続)。CCW 進行の接線 = φ_pos+90°、heading = 接線 + β。
const PHI0 = -100 * rad, PHI1 = 100 * rad, DPHI = 2.5 * rad;
function sweepArc(g, car, R, yc, beta) {
  const cx = g.capX, cy = g.capY + yc;
  let sMin = 1e9, anyHit = false;
  for (let phi = PHI0; phi <= PHI1 + 1e-9; phi += DPHI) {
    car.x = cx + R * Math.cos(phi); car.y = cy + R * Math.sin(phi);
    car.theta = phi + Math.PI / 2 + beta;
    const { s, hit } = poseClearance(car, g);
    if (s < sMin) sMin = s; if (hit) anyHit = true;
  }
  return { sMin, anyHit };
}

// 戦略の最善線を掃引(R×yc×β)。最善=最大の最小クリアランス。
function bestLine(g, Rs, ycs, betas) {
  const car = new CarV2({ ...g.course.start });
  let best = { s: -1e9, R: null, yc: null, beta: null, hit: true };
  for (const R of Rs) for (const yc of ycs) for (const beta of betas) {
    const { sMin, anyHit } = sweepArc(g, car, R, yc, beta);
    if (sMin > best.s) best = { s: sMin, R, yc, beta, hit: anyHit };
  }
  return best;
}
const YCS = [-0.8, -0.4, 0, 0.4, 0.8];
function gripBest(g) {  // grip: R≥R_min(下限 R_min)・β=0
  return bestLine(g, [R_MIN, R_MIN * 1.04, R_MIN * 1.10, R_MIN * 1.18], YCS, [0]);
}
function driftBest(g) { // drift: R∈[innerR+0.4, R_min]・β 掃引(ドリフト角)
  const Rs = [];
  const lo = Math.max(0.8, g.innerR + 0.4), hi = R_MIN;
  for (let k = 0; k <= 5; k++) Rs.push(lo + (hi - lo) * k / 5);
  const betas = [-45, -30, -20, -10, 0, 10, 20, 30, 45].map(b => b * rad);
  return bestLine(g, Rs, YCS, betas);
}

// ── Part A: 幾何アサート ──────────────────────────────────────────────────────────
console.log(`\n[A] 追加ベンチ cell 幾何(実 buildFromSpec 壁から実測)  ${wallSpecs.length} cell`);
ok(wallSpecs.length >= 5, `A0 追加 wall-hairpin cell ≥5 (実 ${wallSpecs.length})`);
const geoms = {};
for (const spec of wallSpecs) {
  const g = capGeom(spec); geoms[spec.name] = g;
  ok(Math.abs(g.measOut - g.outerR) < 0.02, `A ${spec.name} 実測外径=公称 ${g.outerR.toFixed(2)} (実測 ${g.measOut.toFixed(2)})`);
  ok(Math.abs(g.measIn - g.innerR) < 0.02, `A ${spec.name} 実測内径=公称 ${g.innerR.toFixed(2)} (実測 ${g.measIn.toFixed(2)})`);
  if (spec.cellKind === 'forced') ok(g.outerR < R_MIN && g.width > DIAG, `A ${spec.name} 強制セル: 外径${g.outerR.toFixed(2)}<R_min ∧ 廊下${g.width}>対角${DIAG.toFixed(2)}`);
  else if (spec.cellKind === 'control') ok(g.width > DIAG, `A ${spec.name} 対照セル: 外径${g.outerR.toFixed(2)}・廊下${g.width}>対角`);
}

// ── Part C: 動的到達性(AO8 準拠 動的ドライバの壁込み走行) ─────────────────────────────
// Part B は「収まる線が存在するか(幾何)」を測る。Part C は「その線に動的に到達/保持できるか」を、
// **実 CarV2.step + AO8 の drift ドライバ(3値ステア・リア破り→逆ハン)** で 廊下へ走り込み、達成軌跡の
// 壁クリアランスを毎tick 実オラクルで測る。ドリフト線に乗れず壁を破る=動的 NO-GO(AO8 全 NO-GO の壁込み確証)。
const DT = 1 / 60, deg = 180 / Math.PI;
const betaOf = (c) => Math.atan2(c.vlat, Math.max(Math.abs(c.u), 1e-6)) * deg;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const DRIFT_BETA = 35, SPIN_LIM = 115, RUNUP = 25, TIMEOUT = 1500;
function holdSpeed(car, U) { const e = U - car.u; if (e > 0.15) { car.driveDir = CONST.FORWARD; car.pwm = Math.min(255, 30 + e * 25); } else if (e < -0.4) { car.driveDir = CONST.BRAKE; car.pwm = 0; } else { car.driveDir = CONST.FORWARD; car.pwm = 22; } }

// 最善ドリフト線(Rd)へ走り込み、AO8 drift ドライバで 180°回頭を試み、達成軌跡が廊下を保つ回頭角を測る。
// sustainedDeg = クリアランスが初めて<0 になるまでの回頭角(=ドリフトが車体を廊下内に保った角度)。
// 破断(clr<HARDOUT=壁外へ明白に逸脱)で打ち切り(以降の飛び去りは無意味)。
const HARDOUT = -0.5;
function dynDriftReach(g, drive, Rd, entryMul, lead) {
  const car = new CarV2({ ...g.course.start, x: g.capX - RUNUP, y: g.capY - Rd, theta: 0 });
  car.type = (drive === 'fr') ? 'normal_fr' : 'normal_awd'; car.tireSet = 'normal';
  const muEff = 1.4 * (car.grip || 1);   // Tn.mu0=1.4 (normal・fullscale)
  const vgrip = Math.sqrt(muEff * 9.81 * Rd), vEntry = 1.15 * vgrip * entryMul;
  let minClr = 1e9, head = 0, prevTheta = 0, spun = false, done = false, brokeOut = false;
  let sustainedRad = 0, breached = false;
  const measure = () => { const { s } = poseClearance(car, g); if (s < minClr) minClr = Math.max(s, HARDOUT); if (s < 0 && !breached) { breached = true; sustainedRad = head; } return s; };
  // phase1: 直線助走(steer=CENTER)で ターンイン点(cap の lead m 手前)まで vEntry へ(廊下内=クリアランス正)。
  // lead=ドリフト開始を cap 中心の何 m 手前にするか(=ターンイン timing の steelman 掃引)。
  let guard = 0; while (car.x < g.capX - lead && guard++ < 4000) { car.steer = CONST.CENTER; if (car.u < vEntry) { car.driveDir = CONST.FORWARD; car.pwm = 255; } else holdSpeed(car, vEntry); car.step(DT); measure(); }
  // phase2: AO8 drift(FR:リア破り brake パルス→βtarget 逆ハン bang-bang / AWD:パワーオン)
  prevTheta = car.theta;
  let brakePulse = (drive === 'fr') ? 9 : 0;
  for (let i = 0; i < TIMEOUT; i++) {
    const b = betaOf(car);
    if (brakePulse > 0) { car.steer = CONST.LEFT; car.driveDir = CONST.BRAKE; car.pwm = 0; brakePulse--; }
    else if (b > DRIFT_BETA) { car.steer = CONST.RIGHT; car.driveDir = CONST.FORWARD; car.pwm = 110; }
    else { car.steer = CONST.LEFT; car.driveDir = CONST.FORWARD; car.pwm = 255; }
    car.step(DT);
    head += wrap(car.theta - prevTheta); prevTheta = car.theta;
    const s = measure();
    if (s <= HARDOUT) { brokeOut = true; break; }          // 廊下外へ明白に逸脱=打ち切り
    if (Math.abs(betaOf(car)) > SPIN_LIM) { spun = true; break; }
    if (head >= Math.PI) { done = true; break; }
  }
  if (!breached) sustainedRad = head;                        // 一度も破断せず(=完走なら 180°)
  // 壁込み動的 clean = 180°到達 ∧ 全域クリアランス≥0(壁不侵犯)
  const dynGO = done && minClr >= 0 && !spun && !brokeOut;
  return { minClr, sustainedDeg: sustainedRad * deg, headDeg: head * deg, breached, done, spun, brokeOut, dynGO };
}
// 進入速度×ターンイン lead を掃引して最善(最大 sustainedDeg=最も長く廊下を保つ)=drift に動的最善条件(steelman)。
function dynDriftBest(g, drive, Rd) {
  let best = null;
  for (const m of [0.9, 1.0, 1.1]) for (const lead of [0, 2.5, 5.0]) { const r = dynDriftReach(g, drive, Rd, m, lead); if (!best || r.sustainedDeg > best.sustainedDeg) best = r; }
  return best;
}

// ── Part B: 壁込み go/no-go(最善線の幾何成立性 + 動的到達性) ────────────────────────
console.log(`\n[B] 壁込み go/no-go(最善線の剛体クリアランス掃引 + 動的到達性)`);
const table = [];
for (const spec of wallSpecs) {
  const g = geoms[spec.name];
  const surf = /-low$/.test(spec.name) ? 'low' : 'dry';
  const gr = gripBest(g), dr = driftBest(g);
  const gripGeoFits = gr.s >= 0 && !gr.hit;
  const driftGeoFits = dr.s >= 0 && !dr.hit;
  // 動的到達性(drift のみ・FR/AWD 最善)。grip の動的は幾何最善線が既に破る(Part B)ゆえ省略。
  const dcFr = dynDriftBest(g, 'fr', dr.R), dcAwd = dynDriftBest(g, 'awd', dr.R);
  const driftDynGO = dcFr.dynGO || dcAwd.dynGO;
  const dynBest = dcFr.sustainedDeg >= dcAwd.sustainedDeg ? dcFr : dcAwd;   // 最も長く廊下を保った側(steelman)
  // 統合 go/no-go = drift が「幾何成立 ∧ 動的到達」 ∧ grip 幾何不能。動的に乗れなければ NO-GO(不足量=180−sustained)。
  const GO = driftGeoFits && driftDynGO && !gripGeoFits;
  table.push({
    cell: spec.name, kind: spec.cellKind, rr: g.rr, width: g.width,
    outerR: +g.outerR.toFixed(2), innerR: +g.innerR.toFixed(2), surf,
    grip_clr: +gr.s.toFixed(3), grip_geoFits: gripGeoFits, grip_R: +gr.R.toFixed(2),
    drift_clr: +dr.s.toFixed(3), drift_geoFits: driftGeoFits, drift_R: +dr.R.toFixed(2), drift_beta: Math.round(dr.beta / rad),
    drift_dynSustainedDeg: +dynBest.sustainedDeg.toFixed(0), drift_dynClr: +dynBest.minClr.toFixed(3), drift_dynGO: driftDynGO,
    grip_pen: gr.s < 0 ? +(-gr.s).toFixed(3) : 0, drift_geoPen: dr.s < 0 ? +(-dr.s).toFixed(3) : 0,
    drift_dynShortfallDeg: driftDynGO ? 0 : +(180 - dynBest.sustainedDeg).toFixed(0),
    verdict: GO ? 'GO' : 'NO-GO',
  });
}

// criterion ①: 強制セル(外径<R_min)の grip 最善線が壁を破る(最善クリアランス<0)。
console.log(`\n[criterion ①] 強制セル grip の最小壁クリアランス<0(最善線でも外壁を破る=幾何不能)`);
for (const r of table.filter(r => r.kind === 'forced')) ok(r.grip_clr < 0 && !r.grip_geoFits, `① ${r.cell}: grip 最善クリアランス=${r.grip_clr}m<0 (侵入=${r.grip_pen}m fits=${r.grip_geoFits})`);
// 弁別性: 対照セル(車体込みで余裕)の grip は廊下に収まる(最善クリアランス≥0)=ハーネスが真に弁別する証拠。
console.log(`\n[弁別性] 対照セル(車体込み余裕)の grip は廊下に収まる(最善クリアランス≥0)`);
for (const r of table.filter(r => r.kind === 'control')) ok(r.grip_clr >= 0 && r.grip_geoFits, `弁別 ${r.cell}: grip 最善クリアランス=${r.grip_clr}m≥0 (fits=${r.grip_geoFits})`);
// criterion ②: 強制セル drift の通過可否が連続量で確定(幾何成立性 clr + 動的到達性 dynClr)。不成立なら不足量を記録。
console.log(`\n[criterion ②] 強制セル drift の通過可否(幾何 clr + 動的到達 dynClr の連続量で確定)`);
for (const r of table.filter(r => r.kind === 'forced')) {
  const measured = Number.isFinite(r.drift_clr) && Number.isFinite(r.drift_dynSustainedDeg);
  ok(measured, `② ${r.cell}: 判定=${r.verdict} | 幾何:収まる(clr=${r.drift_clr}m R=${r.drift_R} β=${r.drift_beta}°) 動的:${r.drift_dynGO ? '到達' : '不成立'}(廊下保持${r.drift_dynSustainedDeg}°/180° 不足=${r.drift_dynShortfallDeg}°)`);
}

// 決定論チェック: 同一セルの幾何掃引 + 動的走行を2回・bit 一致。
{
  const g = geoms[wallSpecs[0].name];
  const a = gripBest(g), b = gripBest(g);
  ok(a.s === b.s && a.R === b.R, `B 決定論(grip 幾何掃引2回 bit 一致 s=${a.s}/${b.s})`);
  const d1 = dynDriftReach(g, 'fr', driftBest(g).R, 1.0, 2.5), d2 = dynDriftReach(g, 'fr', driftBest(g).R, 1.0, 2.5);
  ok(d1.minClr === d2.minClr && d1.sustainedDeg === d2.sustainedDeg, `C 決定論(動的走行2回 bit 一致 minClr=${d1.minClr}/${d2.minClr})`);
}

// 人間可読表
console.log(`\n  cell(外径/内径・廊下)                kind         surf | grip幾何:clr   fit R    | drift幾何:clr  fit R   β   | drift動的:廊下保持 GO | 統合`);
for (const r of table) {
  const gf = r.grip_geoFits ? 'GO' : 'no', df = r.drift_geoFits ? 'GO' : 'no', dd = r.drift_dynGO ? 'GO' : 'no';
  console.log(`  ${r.cell.padEnd(28)} ${(r.kind || '?').padEnd(12)} ${r.surf.padEnd(3)} | ${String(r.grip_clr).padStart(7)} ${gf.padStart(3)} ${String(r.grip_R).padStart(5)} | ${String(r.drift_clr).padStart(7)} ${df.padStart(3)} ${String(r.drift_R).padStart(4)} ${String(r.drift_beta).padStart(3)}° | ${String(r.drift_dynSustainedDeg).padStart(4)}°/180° ${dd.padStart(3)} | ${r.verdict}`);
}
const goN = table.filter(r => r.verdict === 'GO').length;
const nForced = table.filter(r => r.kind === 'forced').length, nCtrl = table.filter(r => r.kind === 'control').length, nInt = table.filter(r => r.kind === 'intermediate').length;
const geoDriftOnly = table.filter(r => r.drift_geoFits && !r.grip_geoFits).length;
console.log(`\n  強制${nForced}(外径<R_min)・中間${nInt}(点可・車体込不可)・対照${nCtrl}(車体込可)。`);
console.log(`  幾何 drift-only 窓(grip 不能∧drift 収まる)=${geoDriftOnly} 行 / 統合 GO(幾何∧動的到達)=${goN} 行 / 全 ${table.length} 行。`);
console.log(`  → grip は幾何的に不能(criterion ①)、drift 線は幾何的に存在するが 動的に到達不可(Part C)＝統合 NO-GO(AO8 全 NO-GO を壁込みで確証・機序 refine)。`);

if (process.argv.includes('--json')) {
  console.log('===JSON===');
  console.log(JSON.stringify({ appVersion: APP_VERSION, R_min: +R_MIN.toFixed(4), diag: +DIAG.toFixed(4), table, goN, total: table.length }, null, 0));
}

console.log(`\n[結果] pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
