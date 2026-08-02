// ═══════════════════════════════════════════════════════════════════════════
// AM4 後方センサーのコーン測距 検証ゲート (#27 の根治が後方 ToF にも及ぶことを実証)。
// readRear は readSensor(SENSOR_REAR) へ委譲する = 前方3センサーと【同一機構】(AM1 の coneNearest)。
// 本ゲートは「委譲しているから正しい」を主張せず、本物の readRear を実走ポーズ上で回し、
// 前方 (wf_am1_cone) と同じ独立審判 (別実装 segIntersect / dense sampling / thin ray) で
// 連続量マージンとして後方でも #27 の「壁の外へ抜ける」が起きないことを検査する (CI-9/CI-14)。
//
// R1 返り形+dir : readRear は {mm,hit,origin,dir} を返し dir は後方中心方位(θ+π)の単位ベクトル。
// R2 退行なし   : mm_cone <= mm_thin（有効測距）= 扇内最近ゆえ thin(中心1本)より遠い値を返さない。
// R3 直線貫通=0 : 描画レイ [origin→hit] が壁線分を hit の手前で properly 横切る数 = 0。
// R4 解析=密標本 : coneNearest(本物 geom) を後方扇の密標本(401本)独立最小と突合。
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import { buildFromSpec } from './public/js/course.js';
import { runRace } from './public/js/race_engine.js';
import { readRear } from './public/js/sensors.js';
import { PROGRAMS } from './public/js/programs.js';
import { SENSOR_REAR, SENSOR_RANGE, SENSOR_FOV } from './public/js/config.js';
import { raySeg, segIntersect, coneNearest } from './public/js/geom.js';

const specs = JSON.parse(fs.readFileSync('public/data/courses.json', 'utf8'));
const maxM = SENSOR_RANGE.maxMm / 1000;
let fail = 0;

// 独立審判: 中心1本 thin ray の最近ヒット距離 [m]。
function thinRead(ox, oy, ux, uy, walls) {
  let best = Infinity;
  for (const w of walls) { const t = raySeg(ox, oy, ux, uy, w.x1, w.y1, w.x2, w.y2); if (t < best) best = t; }
  return best;
}
// 独立審判: レイ [o, hit] が壁線分を hit 手前(端点内)で横切る数 (segIntersect は geom の別関数)。
function segCrossings(ox, oy, hx, hy, walls) {
  const bx = ox + (hx - ox) * (1 - 1e-3), by = oy + (hy - oy) * (1 - 1e-3); // 終端の自壁接触を除外
  let n = 0;
  for (const w of walls) if (segIntersect({ x: ox, y: oy }, { x: bx, y: by }, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 })) n++;
  return n;
}
// 独立審判: 扇を N 本の細レイで密標本した扇内最近距離 (raySeg ベース・coneNearest とは別経路)。
function denseCone(ox, oy, ang, walls, N = 401) {
  let best = Infinity;
  for (let k = 0; k < N; k++) {
    const a = ang - SENSOR_FOV.halfRad + 2 * SENSOR_FOV.halfRad * k / (N - 1);
    const dx = Math.cos(a), dy = Math.sin(a);
    for (const w of walls) { const tt = raySeg(ox, oy, dx, dy, w.x1, w.y1, w.x2, w.y2); if (tt < best) best = tt; }
  }
  return best;
}
function anaCone(ox, oy, ux, uy, walls) {
  const pt = [0, 0]; let best = Infinity;
  for (const w of walls) { const d = coneNearest(ox, oy, ux, uy, SENSOR_FOV.cosHalf, SENSOR_FOV.sinHalf, w.x1, w.y1, w.x2, w.y2, pt); if (d < best) best = d; }
  return best;
}

const byKey = {}; for (const p of Object.values(PROGRAMS)) byKey[p.key] = p;
const field = ['normal_fr', 'normal_ff', 'normal_awd'].map(k => ({ lang: byKey[k].lang, src: byKey[k].code, carType: byKey[k].carType }));
const targets = ['S字シケイン', 'エッセ・レイアウト', 'ナローシケイン・レイアウト', 'ヘアピン', 'ストリート・レイアウト'];

console.log(`後方センサー SENSOR_REAR: yaw=${(SENSOR_REAR.yaw * 180 / Math.PI).toFixed(0)}° dx=${SENSOR_REAR.dx}  FoV=25°(半角12.5°)\n`);
let gShape = 0, gRegress = 0, gSeg = 0, gRays = 0, gMaxDiff = 0;
for (const nm of targets) {
  const spec = specs.find(s => s.name === nm); if (!spec) { console.log('skip', nm); continue; }
  const course = buildFromSpec(spec); const walls = course.walls;
  let res;
  try { res = runRace({ course, regime: 'tabletop', laps: 2, field: field.map(e => ({ ...e })), interact: true, ghost: true }); }
  catch (e) { console.log(nm, 'RACE ERR', e.message); fail++; continue; }
  const frames = res.ghost?.frames || [];
  let shapeBad = 0, regress = 0, seg = 0, rays = 0, maxDiff = 0;
  for (const fr of frames) for (const car of fr) {
    if (car.crashed) continue;
    const pose = { x: car.x, y: car.y, theta: car.th };
    const r = readRear(pose, walls, []);              // ★ 本物の readRear (production 経路)
    rays++;
    const c = Math.cos(car.th), s = Math.sin(car.th);
    const ox = car.x + SENSOR_REAR.dx * c - SENSOR_REAR.dy * s;
    const oy = car.y + SENSOR_REAR.dx * s + SENSOR_REAR.dy * c;
    const ang = car.th + SENSOR_REAR.yaw, ux = Math.cos(ang), uy = Math.sin(ang);
    // R1: 返り形 + dir が後方中心方位の単位ベクトル、origin が搭載位置
    const okShape = r && typeof r.mm === 'number' && r.hit && r.origin && r.dir
      && Math.abs(r.dir.x - ux) < 1e-9 && Math.abs(r.dir.y - uy) < 1e-9
      && Math.abs(r.origin.x - ox) < 1e-9 && Math.abs(r.origin.y - oy) < 1e-9;
    if (!okShape) shapeBad++;
    // R3: cone 描画レイが壁線分を properly 貫通する数
    seg += segCrossings(ox, oy, r.hit.x, r.hit.y, walls);
    // R2: 退行 (cone <= thin) — 有効測距のみ
    const tb = thinRead(ox, oy, ux, uy, walls);
    const mmCone = (r.mm < 0) ? maxM * 1000 : r.mm;
    const mmThin = (tb === Infinity || tb > maxM) ? maxM * 1000 : Math.round(tb * 1000);
    if (mmCone > mmThin + 1) regress++;
    // R4: 解析 coneNearest vs 密標本 (有効測距のみ・毎8読取で1回=負荷制御)
    if (r.mm >= 0 && (rays % 8 === 0)) {
      const ana = anaCone(ox, oy, ux, uy, walls);
      const dense = denseCone(ox, oy, ang, walls);
      if (ana <= maxM && dense <= maxM) { const diff = Math.abs(ana - dense); if (diff > maxDiff) maxDiff = diff; }
    }
  }
  gShape += shapeBad; gRegress += regress; gSeg += seg; gRays += rays; if (maxDiff > gMaxDiff) gMaxDiff = maxDiff;
  console.log(`${nm.padEnd(22)} 読取=${String(rays).padStart(5)} 形崩れ=${shapeBad} 退行=${regress} 線分貫通=${seg} 解析vs密max=${(maxDiff * 1000).toFixed(2)}mm`);
}
console.log(`\n${'='.repeat(60)}`);
console.log(`R1 返り形+dir(後方中心方位の単位ベクトル)崩れ = ${gShape} / ${gRays} 読取   ${gShape === 0 ? '○' : '✗'}`);
if (gShape) fail++;
console.log(`R2 退行(mm_cone>mm_thin)                    = ${gRegress} / ${gRays} 読取   ${gRegress === 0 ? '○' : '✗'}`);
if (gRegress) fail++;
console.log(`R3 cone 描画レイの壁線分 properly 貫通       = ${gSeg}   ${gSeg === 0 ? '○' : '✗'}`);
if (gSeg) fail++;
console.log(`R4 解析 coneNearest vs 密標本(401本) 最大差  = ${(gMaxDiff * 1000).toFixed(3)} mm   ${gMaxDiff < 0.02 ? '○(<20mm=標本解像度内)' : '✗'}`);
if (gMaxDiff >= 0.02) fail++;
console.log(`\n${fail === 0 ? 'AM4 後方コーン測距ゲート: 全パス ○' : 'AM4 後方コーン測距ゲート: ' + fail + ' 件 ✗'}`);
process.exit(fail === 0 ? 0 : 1);
