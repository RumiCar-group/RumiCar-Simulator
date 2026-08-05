// ═══════════════════════════════════════════════════════════════════════════
// AM1 コーン測距コア 検証ゲート (#27「レーザーが壁の外に出る」根治)。
// 知覚→測定の翻訳 (CI-14)。thin ray(v3.49.0まで) と cone(扇内最近・本ブロック) を【同一ポーズ】で
// 比較する。独立性: 審判関数 (segIntersect / lineHit / dense sampling) は readAll の coneNearest とは
// 別実装 (CI-9)。本物のセンサー readAll を実走 runRace ghost 全ポーズで回し、その上に審判を載せる。
//
// M1 退行なし     : mm_cone <= mm_thin（有効測距）を全読取で検査。cone は「扇内最近反射面」なので
//                   thin(中心1本)より遠い値を返さない=「壁の外へ伸びる(値が伸びる)」が原理的に起きない。
// M2 直線貫通=0   : 描画レイ [origin→hit] が壁【線分】を hit の手前で properly 横切る数 (segIntersect)。
//                   cone は hit=最近反射面なので手前に壁面が無い=0 が保証。
// M3 視覚 over-shoot: 端点掠め(太い壁キャップ帯の端点外れ)を「掠めた壁より D 以上先まで伸びるレイ数」で
//                   連続量計数 (D を掃引)。D 大=「壁の外へ大きく抜けた」本物の #27。cone がこれを削減。
// M4 解析=密標本   : coneNearest(本物 geom) を、扇を N 本の細レイで密標本した独立最小距離と突合。
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { readAll } from './public/js/sensors.js';
import { PROGRAMS } from './public/js/programs.js';
import { SENSORS, SENSOR_RANGE, SENSOR_FOV, VIEW } from './public/js/config.js';
import { raySeg, segIntersect, coneNearest } from './public/js/geom.js';

const specs = JSON.parse(fs.readFileSync('public/data/courses.json', 'utf8'));
const capWorld = VIEW.wallWidth / 2 * (1000 / VIEW.pxPerM) / 1000; // 壁キャップ片側 [m]
const maxM = SENSOR_RANGE.maxMm / 1000;
const OVER = [0.06, 0.10, 0.20, 0.50]; // over-shoot 閾値 D [m]（隣接コーナー benign(~cap) 超え）
let fail = 0;

// 独立審判: line-line 交差 (t,u)。
function lineHit(ox, oy, dx, dy, ax, ay, bx, by) {
  const sx = bx - ax, sy = by - ay, dn = dx * sy - dy * sx;
  if (Math.abs(dn) < 1e-12) return null;
  return { t: ((ax - ox) * sy - (ay - oy) * sx) / dn, u: ((ax - ox) * dy - (ay - oy) * dx) / dn, segLen: Math.hypot(sx, sy) };
}
// M2: レイ [o, hit] が壁線分を hit 手前(端点内 u∈[0,1])で横切る数。segIntersect は geom の別関数。
function segCrossings(ox, oy, hx, hy, walls) {
  const bx = ox + (hx - ox) * (1 - 1e-3), by = oy + (hy - oy) * (1 - 1e-3); // 終端の自壁接触を除外
  let n = 0;
  for (const w of walls) if (segIntersect({ x: ox, y: oy }, { x: bx, y: by }, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 })) n++;
  return n;
}
// M3: 端点掠めの over-shoot 集合 (best - t)。キャップ帯内の端点外れのみ。
function grazeOvershoots(ox, oy, dx, dy, best, walls) {
  const out = [];
  for (const w of walls) {
    const r = lineHit(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2);
    if (!r) continue;
    if (r.t <= 0.01 || r.t >= best - capWorld) continue; // 原点/ヒット直前(隣接コーナー)除外
    let over = 0;
    if (r.u < 0) over = -r.u * r.segLen; else if (r.u > 1) over = (r.u - 1) * r.segLen; else continue;
    if (over < capWorld * 3) out.push(best - r.t);
  }
  return out;
}
function thinRead(ox, oy, ux, uy, walls) {
  let best = Infinity;
  for (const w of walls) { const t = raySeg(ox, oy, ux, uy, w.x1, w.y1, w.x2, w.y2); if (t < best) best = t; }
  return best;
}
// M4: 扇を N 本の細レイで密標本し、扇内最近距離を独立に求める (raySeg ベース・coneNearest とは別経路)。
function denseCone(ox, oy, ang, walls, N = 401) {
  let best = Infinity;
  for (let k = 0; k < N; k++) {
    const a = ang + (-SENSOR_FOV.halfRad) + (2 * SENSOR_FOV.halfRad) * k / (N - 1);
    const dx = Math.cos(a), dy = Math.sin(a);
    let t = Infinity;
    for (const w of walls) { const tt = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (tt < t) t = tt; }
    if (t < best) best = t; // 細レイの along-ray 距離 = そのヒット点までの Euclid 距離
  }
  return best;
}
// production geom.coneNearest を全壁に適用した扇内最近距離。
function anaCone(ox, oy, ux, uy, walls) {
  const pt = [0, 0]; let best = Infinity;
  for (const w of walls) { const d = coneNearest(ox, oy, ux, uy, SENSOR_FOV.cosHalf, SENSOR_FOV.sinHalf, w.x1, w.y1, w.x2, w.y2, pt); if (d < best) best = d; }
  return best;
}

const byKey = {}; for (const p of Object.values(PROGRAMS)) byKey[p.key] = p;
const field = ['normal_fr', 'normal_ff', 'normal_awd'].map(k => ({ lang: byKey[k].lang, src: byKey[k].code, carType: byKey[k].carType }));
const targets = ['S字シケイン', 'エッセ・レイアウト', 'ナローシケイン・レイアウト', 'ストップ＆ゴー・レイアウト', 'ストリート・レイアウト', 'ヘアピン'];

console.log(`capWorld=${(capWorld * 1000).toFixed(1)}mm  FoV=25°(半角12.5°)  over-shoot D[mm]=${OVER.map(d => d * 1000)}\n`);
let gRegress = 0, gSegCone = 0, gRays = 0, gMaxDiff = 0;
let gThin = OVER.map(() => 0), gCone = OVER.map(() => 0);
for (const nm of targets) {
  const spec = specs.find(s => s.name === nm); if (!spec) { console.log('skip', nm); continue; }
  const course = buildFromSpec(spec); const walls = course.walls;
  let res;
  try { res = runRace({ course, regime: 'tabletop', laps: 2, field: field.map(e => ({ ...e })), interact: true, ghost: true }); }
  catch (e) { console.log(nm, 'RACE ERR', e.message); fail++; continue; }
  const frames = res.ghost?.frames || [];
  let regress = 0, segCone = 0, rays = 0, maxDiff = 0;
  const cThin = OVER.map(() => 0), cCone = OVER.map(() => 0);
  for (const fr of frames) for (const car of fr) {
    if (car.crashed) continue;
    const sens = readAll({ x: car.x, y: car.y, theta: car.th }, walls, []);
    const c = Math.cos(car.th), s = Math.sin(car.th);
    for (let i = 0; i < SENSORS.length; i++) {
      rays++;
      const sd = SENSORS[i];
      const ox = car.x + sd.dx * c - sd.dy * s, oy = car.y + sd.dx * s + sd.dy * c;
      const ang = car.th + sd.yaw, ux = Math.cos(ang), uy = Math.sin(ang);
      const sc = sens[i];
      // M2: cone の描画レイが壁線分を横切る数
      segCone += segCrossings(ox, oy, sc.hit.x, sc.hit.y, walls);
      // M3: over-shoot (同一ポーズで thin と cone)
      const cdx = sc.hit.x - ox, cdy = sc.hit.y - oy, clen = Math.hypot(cdx, cdy);
      const coneBest = (sc.mm < 0) ? maxM : clen;
      if (clen > 1e-9) { const os = grazeOvershoots(ox, oy, cdx / clen, cdy / clen, coneBest, walls); const mx = os.length ? Math.max(...os) : -1; OVER.forEach((d, k) => { if (mx >= d) cCone[k]++; }); }
      const tb = thinRead(ox, oy, ux, uy, walls);
      const thinBest = (tb === Infinity || tb > maxM) ? maxM : tb;
      { const os = grazeOvershoots(ox, oy, ux, uy, thinBest, walls); const mx = os.length ? Math.max(...os) : -1; OVER.forEach((d, k) => { if (mx >= d) cThin[k]++; }); }
      // M1: 退行 (cone <= thin)
      const mmCone = (sc.mm < 0) ? maxM * 1000 : sc.mm;
      const mmThin = (tb === Infinity || tb > maxM) ? maxM * 1000 : Math.round(tb * 1000);
      if (mmCone > mmThin + 1) regress++;
      // M4: 解析 coneNearest vs 密標本 (有効測距のみ・毎16読取で1回=負荷制御)
      if (sc.mm >= 0 && (rays % 16 === 0)) {
        const ana = anaCone(ox, oy, ux, uy, walls);
        const dense = denseCone(ox, oy, ang, walls);
        if (ana <= maxM && dense <= maxM) { const diff = Math.abs(ana - dense); if (diff > maxDiff) maxDiff = diff; }
      }
    }
  }
  gRegress += regress; gSegCone += segCone; gRays += rays; if (maxDiff > gMaxDiff) gMaxDiff = maxDiff;
  OVER.forEach((_, k) => { gThin[k] += cThin[k]; gCone[k] += cCone[k]; });
  const red = OVER.map((_, k) => cThin[k] ? (100 * (cThin[k] - cCone[k]) / cThin[k]).toFixed(0) + '%' : '—').join('/');
  console.log(`${nm.padEnd(22)} 退行=${regress} 線分貫通(cone)=${segCone}  over-shoot thin[${cThin.join(' ')}] cone[${cCone.join(' ')}] 削減=${red}  解析vs密max=${(maxDiff * 1000).toFixed(2)}mm`);
}
console.log(`\n${'='.repeat(60)}`);
console.log(`M1 退行(mm_cone>mm_thin)         = ${gRegress} / ${gRays} 読取   ${gRegress === 0 ? '○' : '✗'}`);
if (gRegress) fail++;
console.log(`M2 cone 描画レイの壁線分 properly 貫通 = ${gSegCone}   ${gSegCone === 0 ? '○' : '✗'}`);
if (gSegCone) fail++;
console.log(`M3 over-shoot 視覚貫通 (>=D mm) thin -> cone:`);
OVER.forEach((d, k) => { const r = gThin[k] ? (100 * (gThin[k] - gCone[k]) / gThin[k]).toFixed(1) : '—'; console.log(`     D>=${String(d * 1000).padStart(3)}mm : ${String(gThin[k]).padStart(4)} -> ${String(gCone[k]).padStart(4)}  削減 ${r}%`); });
console.log(`M4 解析 coneNearest vs 密標本(401本) 最大差 = ${(gMaxDiff * 1000).toFixed(3)} mm   ${gMaxDiff < 0.02 ? '○(<20mm=標本解像度内)' : '✗'}`);
if (gMaxDiff >= 0.02) fail++;
console.log(`\n${fail === 0 ? 'AM1 cone 測距ゲート: 全パス ○' : 'AM1 cone 測距ゲート: ' + fail + ' 件 ✗'}`);
process.exit(fail === 0 ? 0 : 1);
