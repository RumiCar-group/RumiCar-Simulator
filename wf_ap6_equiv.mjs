// wf_ap6_equiv.mjs — Stage AP6 受け入れ① ゲート (リポジトリ追跡・本番フロー検証の機械側・CI-8/9/14)。
// ════════════════════════════════════════════════════════════════════════════
// AP6「壁ブロードフェーズ配線 (readSensor/checkCollision → 候補限定)」が **全走査と mm/bool byte 一致** する
// ことを 41 コース × サンプルポーズ網で【差分ゼロ】に落として機械確認する。
//   本番: sensors.js の readAll/readRear (グリッド粗セル候補限定)・physics.js の checkCollision (細セル候補限定)。
//   オラクル: 同じ幾何を **全壁走査** で計算 (coneNearest / segIntersect を全壁に回す) — グリッド非使用。
// production(候補) === oracle(全壁) を mm(センサー) と bool(衝突) で差分ゼロ検査 (hit も報告=同一距離 tie の
// 描画点差のみ許容・mm/bool には非影響)。tabletop(41コース native スケール)＋fullscale(競技サーキット=実際に
// 候補削減が起きるレンジ律速) の両領域で検査する。壁数<32 の従来経路 (受け入れ④) も両側一致で確認。
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import { readAll, readRear } from './public/js/sensors.js';
import { Car, checkCollision } from './public/js/physics.js';
import { SENSORS, SENSOR_REAR, SENSOR_RANGE, SENSOR_FOV, SENSOR_NOISE } from './public/js/config.js';
import { WALL_BP_MIN } from './public/js/contact_v2.js';
import { coneNearest, segIntersect } from './public/js/geom.js';
import { buildFromSpec } from './public/js/course.js';
import { applyRegime } from './public/js/physics_dyn.js';

let pass = 0, fail = 0; const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; if (fails.length < 40) fails.push(msg); } }

// ── オラクル: readSensor の noise-off 全走査 (sensors.js:31-56 と同一幾何・グリッド非使用) ──
function refSensor(car, walls, def) {
  const c = Math.cos(car.theta), s = Math.sin(car.theta);
  const ox = car.x + def.dx * c - def.dy * s;
  const oy = car.y + def.dx * s + def.dy * c;
  const ang = car.theta + def.yaw;
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const cosH = SENSOR_FOV.cosHalf, sinH = SENSOR_FOV.sinHalf;
  const pt = [0, 0];
  let best = Infinity, hx = 0, hy = 0;
  for (const w of walls) {
    const d = coneNearest(ox, oy, ux, uy, cosH, sinH, w.x1, w.y1, w.x2, w.y2, pt);
    if (d < best) { best = d; hx = pt[0]; hy = pt[1]; }
  }
  const maxM = SENSOR_RANGE.maxMm / 1000;
  if (best === Infinity || best > maxM) return { mm: -3, hx: ox + ux * maxM, hy: oy + uy * maxM };
  return { mm: Math.round(best * 1000), hx, hy };
}
// ── オラクル: checkCollision の全走査 (physics.js と同一・グリッド非使用) ──
function refCollision(car, walls) {
  const cs = car.corners();
  const edges = [[cs[0], cs[1]], [cs[1], cs[2]], [cs[2], cs[3]], [cs[3], cs[0]]];
  for (const w of walls) {
    const wa = { x: w.x1, y: w.y1 }, wb = { x: w.x2, y: w.y2 };
    for (const [p, q] of edges) if (segIntersect(p, q, wa, wb)) return true;
  }
  return false;
}

// 1 コースをポーズ網で検査。返り値 {poses, mmMis, boolMis, hitTie, usedGrid}。
function checkCourse(course) {
  const walls = course.walls;
  // bounds を physics 側 Car.corners() が使う座標系で得る (course.bounds は {w,h})。壁座標から算出。
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const w of walls) { minx = Math.min(minx, w.x1, w.x2); miny = Math.min(miny, w.y1, w.y2); maxx = Math.max(maxx, w.x1, w.x2); maxy = Math.max(maxy, w.y1, w.y2); }
  const spanx = (maxx - minx) || 1, spany = (maxy - miny) || 1;
  const THS = [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2, 2.1];
  const NX = 8, NY = 8;
  let poses = 0, mmMis = 0, boolMis = 0, hitTie = 0, reduced = 0;
  for (let ix = 0; ix < NX; ix++) {
    for (let iy = 0; iy < NY; iy++) {
      const x = minx + spanx * (ix + 0.5) / NX;
      const y = miny + spany * (iy + 0.5) / NY;
      for (const th of THS) {
        const car = { x, y, theta: th };
        // センサー: production(グリッド) vs oracle(全壁)。前方3。
        const prod = readAll(car, walls);
        for (let i = 0; i < 3; i++) {
          const ref = refSensor(car, walls, SENSORS[i]);
          if (prod[i].mm !== ref.mm) { mmMis++; if (fails.length < 40) fails.push(`mm差: ${course.name} pose(${x.toFixed(2)},${y.toFixed(2)},${th.toFixed(2)}) s${i} prod=${prod[i].mm} ref=${ref.mm}`); }
          else if (prod[i].hit.x !== ref.hx || prod[i].hit.y !== ref.hy) hitTie++;   // mm 同値で hit 差=同一距離 tie (許容)
        }
        // 後方センサー
        const pr = readRear(car, walls); const rr = refSensor(car, walls, SENSOR_REAR);
        if (pr.mm !== rr.mm) { mmMis++; if (fails.length < 40) fails.push(`rear mm差: ${course.name} prod=${pr.mm} ref=${rr.mm}`); }
        // 衝突: production(グリッド) vs oracle(全壁)。本物の Car を使う (corners が本番と同一)。
        const carObj = new Car({ x, y, theta: th });
        const pb = checkCollision(carObj, walls), rb = refCollision(carObj, walls);
        if (pb !== rb) { boolMis++; if (fails.length < 40) fails.push(`bool差: ${course.name} pose(${x.toFixed(2)},${y.toFixed(2)},${th.toFixed(2)}) prod=${pb} ref=${rb}`); }
        poses++;
        if (walls.length >= WALL_BP_MIN) reduced++;
      }
    }
  }
  return { poses, mmMis, boolMis, hitTie, gridEligible: walls.length >= WALL_BP_MIN };
}

// ── 検査本体 ─────────────────────────────────────────────────────────────────
SENSOR_NOISE.on = false;   // 幾何等価を決定論で検査 (ノイズは候補選定の後段=同一 pre-noise mm ゆえ ON も従う)
ok(WALL_BP_MIN === 32, `④ WALL_BP_MIN===32 (実際 ${WALL_BP_MIN})`);

// (1) tabletop: courses.json 全数 (native スケール)。
applyRegime('tabletop');
const specs = JSON.parse(fs.readFileSync('public/data/courses.json', 'utf8'));
let courses = 0, totMm = 0, totBool = 0, totPose = 0, totHitTie = 0, small = 0, big = 0;
for (const spec of specs) {
  let course; try { course = buildFromSpec(spec); } catch (e) { continue; }
  if (!course.walls || !course.walls.length) continue;
  courses++;
  const r = checkCourse(course);
  totMm += r.mmMis; totBool += r.boolMis; totPose += r.poses; totHitTie += r.hitTie;
  if (r.gridEligible) big++; else small++;
}
ok(courses >= 30, `検査コース数 ${courses} (>=30)`);
ok(big >= 1, `≥32壁コース(グリッド経路) ${big} 本を検査`);
ok(small >= 0, `<32壁コース(従来経路) ${small} 本`);
console.log(`  (1) tabletop: ${courses} コース × ポーズ計 ${totPose} → mm差=${totMm} bool差=${totBool} (hit tie=${totHitTie})  [grid経路 ${big} / 従来経路 ${small}]`);

// (2) fullscale: 競技サーキット (レンジ律速で実際に候補削減が起きる=粗グリッド照会経路)。
applyRegime('fullscale');
const circuit = buildFromSpec({ name: '競技サーキット', kind: 'track', shape: 'superellipse', rx: 360, ry: 230, k: 0.55, width: 28, samples: 160 });
const rc = checkCourse(circuit);
console.log(`  (2) fullscale circuit(${circuit.walls.length}壁): ポーズ ${rc.poses} → mm差=${rc.mmMis} bool差=${rc.boolMis} (hit tie=${rc.hitTie})`);
totMm += rc.mmMis; totBool += rc.boolMis;

ok(totMm === 0, `① センサー mm 差分ゼロ (mismatch=${totMm})`);
ok(totBool === 0, `① 衝突 bool 差分ゼロ (mismatch=${totBool})`);

applyRegime('tabletop');
const line = '─'.repeat(64);
console.log(line);
console.log('Stage AP6 ゲート  (ブロードフェーズ配線 = 全走査と mm/bool byte 一致)');
console.log(`  検査: ${pass + fail} 件 / PASS ${pass} / FAIL ${fail}`);
if (fail) { console.log(line); for (const m of fails) console.log('  ✗ ' + m); }
console.log(line);
console.log('結果: ' + (fail ? 'FAIL' : 'PASS'));
process.exit(fail ? 1 : 0);
